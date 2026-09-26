//! M5: whole-machine filename search.
//!
//! Two tiers, tried in order by `search_files`:
//! 1. Everything IPC (`everything.rs`, Windows only) — instant if the user
//!    runs Everything; we ride its MFT index.
//! 2. A self-built in-memory index: one parallel walk of every indexed drive
//!    (`ignore` crate), maintained incrementally by a `notify` watcher.
//!
//! Two layout decisions exist purely to keep memory flat, and both are load
//! bearing:
//! - Each path is stored ONCE, in original case, and matching folds ASCII on
//!   the fly. Keeping a lowercase twin doubled the index (~225 B/entry →
//!   ~120 B). The trade is that 'É' no longer matches 'é'; Chinese paths are
//!   unaffected because their lowercase form is byte-identical.
//! - `main` stays sorted in that same folded order, so "everything under
//!   `D:\proj\`" is one contiguous range: a watcher batch costs
//!   O(log n + subtree) instead of a scan of every entry on the machine.
//!
//! Removals are tombstones only until `Core::merge_compact`, which rebuilds
//! `main`, frees the dead paths for real and drops duplicate live entries.
//! Without that threshold a single rewritten file would orphan its index entry
//! forever and the index would creep upward for the life of the process.

use crate::fs::drive_roots_blocking;
use notify::event::ModifyKind;
use notify::{EventKind, Watcher};
use serde::Serialize;
use std::cmp::Ordering as CmpOrdering;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex, OnceLock, RwLock};
use std::time::Duration;

const FLAG_DIR: u8 = 1;
const FLAG_DEAD: u8 = 0x80;
/// Directories never worth indexing or descending into.
const SKIP_DIRS: [&str; 2] = ["$recycle.bin", "system volume information"];
/// Watcher paths applied per write-lock acquisition, so a busy build directory
/// cannot hold queries off the index for too long at once.
const APPLY_CHUNK: usize = 2000;
/// Ceiling on the initial walk's parallelism.
const WALK_THREADS: usize = 8;
/// Ceiling on buffered watcher paths. Past that, events are dropped — a file
/// then stays out of the index until its directory changes again. Bounded
/// memory is the better half of that trade.
const PENDING_CAP: usize = 50_000;
/// Rebuild once tombstoned + appended entries exceed max(len / RATIO, MIN).
const COMPACT_RATIO: usize = 8;
const COMPACT_MIN: usize = 4096;
/// How long the apply loop sleeps when no event arrived.
const ROUND_TICK: Duration = Duration::from_millis(500);

/// Drop the calling thread one priority step below the UI. A failed call just
/// leaves it where it was, which is why there is no result to handle.
#[cfg(windows)]
fn run_below_normal() {
    use windows::Win32::System::Threading::{
        GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_BELOW_NORMAL,
    };
    unsafe {
        let _ = SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_BELOW_NORMAL);
    }
}

#[cfg(not(windows))]
fn run_below_normal() {}

/// Which drives tier 2 walks. Everything overrides all of this when running.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Scope {
    Off,
    System,
    All,
}

fn parse_scope(mode: &str) -> Scope {
    match mode {
        "off" => Scope::Off,
        "system" => Scope::System,
        _ => Scope::All,
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub name: String,
    pub is_dir: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchOutcome {
    pub hits: Vec<SearchHit>,
    pub truncated: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchStatus {
    pub ready: bool,
    /// False until a query actually asked for it — the build is lazy, so
    /// `search_status` on its own must never cost the user a full-disk walk.
    pub started: bool,
    pub files: u64,
    pub source: &'static str,
}

#[derive(Clone)]
struct Entry {
    path: Box<str>,
    flags: u8,
}

#[derive(Default)]
struct Core {
    /// Sorted by `cmp_ci`; may carry FLAG_DEAD tombstones between compactions.
    main: Vec<Entry>,
    /// Discovered since the last `merge_compact`. Unsorted, usually tiny.
    tail: Vec<Entry>,
    /// Entries flagged DEAD across both runs.
    dead: usize,
}

impl Core {
    fn len(&self) -> usize {
        self.main.len() + self.tail.len()
    }

    fn live(&self) -> usize {
        self.len() - self.dead
    }

    fn clear(&mut self) {
        self.main = Vec::new();
        self.tail = Vec::new();
        self.dead = 0;
    }

    /// Install a freshly walked drive set.
    fn load(&mut self, entries: Vec<Entry>) {
        self.main = entries;
        self.tail = Vec::new();
        self.dead = 0;
    }

    /// Rebuild `main` from the live entries of both runs: the tombstoned paths
    /// are dropped (their allocations go back to the allocator), the tail is
    /// merged in, and paths that survived twice collapse into one hit.
    fn merge_compact(&mut self) {
        let capacity = self.len();
        let mut tail = std::mem::take(&mut self.tail);
        tail.retain(|e| e.flags & FLAG_DEAD == 0);
        tail.sort_unstable_by(|a, b| cmp_ci(&a.path, &b.path));
        let main = std::mem::take(&mut self.main);
        let mut a = main
            .into_iter()
            .filter(|e| e.flags & FLAG_DEAD == 0)
            .peekable();
        let mut b = tail.into_iter().peekable();
        let mut out: Vec<Entry> = Vec::with_capacity(capacity);
        loop {
            let take_a = match (a.peek(), b.peek()) {
                (None, None) => break,
                (Some(_), None) => true,
                (None, Some(_)) => false,
                (Some(x), Some(y)) => cmp_ci(&x.path, &y.path) != CmpOrdering::Greater,
            };
            out.push(if take_a {
                a.next().expect("peeked")
            } else {
                b.next().expect("peeked")
            });
        }
        out.dedup_by(|x, y| x.path.eq_ignore_ascii_case(&y.path));
        self.main = out;
        self.dead = 0;
    }
}

struct Index {
    core: RwLock<Core>,
    scope: RwLock<Scope>,
    ready: AtomicBool,
    started: AtomicBool,
    /// Bumped whenever the drive set changes, so the superseded build/watch
    /// thread notices on its next round and drops its watchers.
    gen: AtomicU64,
    files: AtomicU64,
}

static INDEX: OnceLock<Index> = OnceLock::new();

fn index() -> &'static Index {
    INDEX.get_or_init(|| Index {
        core: RwLock::new(Core::default()),
        scope: RwLock::new(Scope::All),
        ready: AtomicBool::new(false),
        started: AtomicBool::new(false),
        gen: AtomicU64::new(0),
        files: AtomicU64::new(0),
    })
}

// ---------------------------------------------------------------- commands

#[tauri::command]
pub async fn search_files(query: String, limit: usize) -> SearchOutcome {
    // Sync commands run on the main thread; a full-index scan there freezes
    // typing. The whole query pipeline therefore stays off the UI thread.
    tauri::async_runtime::spawn_blocking(move || {
        let limit = limit.clamp(1, 1000);
        ensure_started();
        #[cfg(windows)]
        if crate::everything::available() {
            if let Some(out) = crate::everything::query(&query, limit) {
                return out;
            }
        }
        query_local(&query, limit)
    })
    .await
    .unwrap_or_else(|_| SearchOutcome {
        hits: vec![],
        truncated: false,
    })
}

#[tauri::command]
pub async fn search_status() -> SearchStatus {
    // `available()` does an Everything IPC roundtrip — keep it off the UI thread too.
    tauri::async_runtime::spawn_blocking(status_now)
        .await
        .unwrap_or_else(|_| SearchStatus {
            ready: false,
            started: false,
            files: 0,
            source: "local",
        })
}

/// Which drives the local index covers: "off" | "system" | "all". Pushed by
/// the frontend on boot and whenever the setting changes.
#[tauri::command]
pub async fn search_set_scope(mode: String) -> SearchStatus {
    tauri::async_runtime::spawn_blocking(move || {
        let idx = index();
        let changed = {
            let mut scope = idx.scope.write().unwrap();
            let old = *scope;
            *scope = parse_scope(&mode);
            old != *scope
        };
        if changed {
            // Retire the running build/watch generation: its thread exits on
            // the next gen check, dropping the watchers and the whole index.
            // The reset runs under the core write lock for the same reason the
            // build's install does: gen itself is lock-free, so without the
            // lock a finishing build could re-store `ready = true` after this
            // reset and strand a stale (or empty) index for the session. Under
            // the lock, whoever runs second wins outright.
            let mut core = idx.core.write().unwrap();
            idx.gen.fetch_add(1, Ordering::SeqCst);
            idx.ready.store(false, Ordering::SeqCst);
            idx.started.store(false, Ordering::SeqCst);
            idx.files.store(0, Ordering::Relaxed);
            core.clear();
        }
        status_now()
    })
    .await
    .unwrap_or_else(|_| status_now())
}

fn status_now() -> SearchStatus {
    #[cfg(windows)]
    if crate::everything::available() {
        return SearchStatus {
            ready: true,
            started: true,
            files: 0,
            source: "everything",
        };
    }
    let idx = index();
    SearchStatus {
        ready: idx.ready.load(Ordering::Relaxed),
        started: idx.started.load(Ordering::Relaxed),
        files: idx.files.load(Ordering::Relaxed),
        source: "local",
    }
}

/// Start the local index build — only on a real query, and only when
/// Everything is absent and a scope is enabled.
fn ensure_started() {
    #[cfg(windows)]
    if crate::everything::available() {
        return;
    }
    let idx = index();
    if *idx.scope.read().unwrap() == Scope::Off {
        return;
    }
    if idx.ready.load(Ordering::Relaxed) || idx.started.swap(true, Ordering::SeqCst) {
        return;
    }
    let gen = idx.gen.load(Ordering::SeqCst);
    std::thread::Builder::new()
        .name("search-index".into())
        .spawn(move || build_and_watch(gen))
        .expect("spawn search-index thread");
}

// ------------------------------------------------------------------- build

/// The drive root a `%SystemDrive%`-scoped index should cover, if any.
fn system_root() -> Option<String> {
    #[cfg(windows)]
    {
        std::env::var("SystemDrive")
            .ok()
            .map(|d| format!("{d}\\"))
    }
    #[cfg(not(windows))]
    {
        None
    }
}

fn scan_roots() -> Vec<String> {
    let scope = *index().scope.read().unwrap();
    if scope == Scope::Off {
        return vec![];
    }
    let only = system_root();
    // Runs on the search-index thread — use the blocking drive listing.
    drive_roots_blocking()
        .into_iter()
        .filter(|d| d.kind == "fixed" || d.kind == "removable")
        .filter(|d| match (&only, scope) {
            (Some(root), Scope::System) => d.path.eq_ignore_ascii_case(root),
            _ => true,
        })
        .map(|d| d.path)
        .collect()
}

fn skip_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s))
}

/// Prune the never-wanted directories out of any walk.
fn wanted_entry(entry: &ignore::DirEntry) -> bool {
    !(entry.file_type().is_some_and(|t| t.is_dir()) && skip_dir(&entry.file_name().to_string_lossy()))
}

fn walk_builder(root: &str) -> ignore::WalkBuilder {
    let mut builder = ignore::WalkBuilder::new(root);
    builder
        .hidden(false)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .parents(false)
        .require_git(false)
        .follow_links(false)
        .filter_entry(wanted_entry);
    builder
}

fn walk_all(roots: &[String]) -> Vec<Entry> {
    let collected = Mutex::new(Vec::<Entry>::new());
    for root in roots {
        let sink = &collected;
        let mut builder = walk_builder(root);
        // Directory listing is syscall-bound and every thread pushes into one
        // mutex, so saturating all cores only lengthens the convoy. Eight
        // threads fill the pipe; the first search shouldn't pin the machine.
        builder.threads(
            std::thread::available_parallelism()
                .map_or(4, |n| n.get())
                .min(WALK_THREADS),
        );

        builder.build_parallel().run(|| {
            Box::new(move |entry| {
                if let Some(entry) = entry.ok().filter(|e| e.file_name().to_str().is_some()) {
                    let is_dir = entry.file_type().is_some_and(|t| t.is_dir());
                    let path = entry.path().to_string_lossy().into_owned().into_boxed_str();
                    sink.lock().unwrap().push(Entry {
                        path,
                        flags: if is_dir { FLAG_DIR } else { 0 },
                    });
                }
                ignore::WalkState::Continue
            })
        });
    }
    let mut out = collected.into_inner().unwrap();
    out.sort_unstable_by(|a, b| cmp_ci(&a.path, &b.path));
    out.dedup_by(|x, y| x.path.eq_ignore_ascii_case(&y.path));
    out
}

/// Entry point of the whole subsystem: build the initial index, then keep it
/// fresh by applying watcher events in rounds.
fn build_and_watch(gen: u64) {
    // Everything on this thread — the multi-second walk and every later round
    // — is background work and must not be what makes typing stutter. The
    // walker's own threads inherit it.
    run_below_normal();
    let idx = index();
    let roots = scan_roots();

    // Watch before walking so nothing that changes mid-build is missed.
    let (tx, rx) = mpsc::channel();
    let mut watchers = Vec::new();
    for root in &roots {
        let tx = tx.clone();
        match notify::recommended_watcher(
            move |res: Result<notify::Event, notify::Error>| {
                if let Ok(event) = res {
                    // A write to a file that is already indexed changes neither
                    // its name nor its file-or-directory flag, so the entry is
                    // already right — and it is the loudest event on a working
                    // machine. Windows reports those as `Modify(ModifyKind::Any)`
                    // (a plain `FILE_ACTION_MODIFIED`), renames as
                    // `Modify(Name(..))`, and adds/removes as `Create`/`Remove`,
                    // so the name-changing cases are exactly the ones kept.
                    if matches!(
                        event.kind,
                        EventKind::Modify(kind) if !matches!(kind, ModifyKind::Name(_))
                    ) {
                        return;
                    }
                    for path in event.paths {
                        let _ = tx.send(path);
                    }
                }
            },
        ) {
            Ok(mut w) => {
                if let Err(e) = w.watch(Path::new(root), notify::RecursiveMode::Recursive) {
                    eprintln!("watch {root} failed: {e}");
                }
                watchers.push(w);
            }
            Err(e) => eprintln!("watcher init failed: {e}"),
        }
    }
    drop(tx);

    // Pump events from the moment the watches exist. The walk below can run
    // for minutes, and an unpumped channel would hold every path the machine
    // touched meanwhile.
    let pending: Arc<Mutex<HashSet<PathBuf>>> = Arc::new(Mutex::new(HashSet::new()));
    {
        let pending = pending.clone();
        let _ = std::thread::Builder::new()
            .name("search-pump".into())
            .spawn(move || {
                while let Ok(path) = rx.recv() {
                    let mut set = pending.lock().unwrap();
                    if set.len() < PENDING_CAP {
                        set.insert(path);
                    }
                }
            });
    }

    let entries = walk_all(&roots);
    {
        // Install under the write lock with the gen re-check INSIDE it. The
        // scope reset in `search_set_scope` takes this same lock after bumping
        // gen, so the two critical sections are mutually exclusive: a scope
        // change either lands wholly before (check aborts) or wholly after
        // (its reset wipes the fresh install) — `ready = true` can no longer
        // survive alongside stale or cleared entries.
        let mut core = idx.core.write().unwrap();
        if idx.gen.load(Ordering::SeqCst) != gen {
            return; // scope moved on while we walked — drop the watchers
        }
        core.load(entries);
        idx.files.store(core.live() as u64, Ordering::Relaxed);
        idx.ready.store(true, Ordering::SeqCst);
    }

    apply_rounds(watchers, pending, gen);
}

fn apply_rounds(
    watchers: Vec<impl Watcher>,
    pending: Arc<Mutex<HashSet<PathBuf>>>,
    gen: u64,
) {
    // Held for the thread's lifetime; dropping unregisters the watches.
    let _keepers = watchers;
    loop {
        if index().gen.load(Ordering::SeqCst) != gen {
            return;
        }
        // Take the whole set: chunking happens below, so no event is lost.
        let batch: Vec<PathBuf> = pending.lock().unwrap().drain().collect();
        if batch.is_empty() {
            std::thread::sleep(ROUND_TICK);
            continue;
        }
        for chunk in batch.chunks(APPLY_CHUNK) {
            apply_batch(chunk, gen);
        }
    }
}

fn apply_batch(batch: &[PathBuf], gen: u64) {
    let idx = index();
    // Every disk probe happens before the lock is taken: re-walking a big
    // directory under it would keep queries off the index for as long as the
    // walk takes.
    let readded = collect_readded(batch);
    let mut core = idx.core.write().unwrap();
    // The gen check at the loop top is stale by the time this chunk runs; a
    // scope change may have cleared the core in between. Re-check under the
    // lock so an old generation's chunk cannot repopulate the fresh one.
    if idx.gen.load(Ordering::SeqCst) != gen {
        return;
    }
    apply_updates(&mut core, batch, readded);
    idx.files.store(core.live() as u64, Ordering::Relaxed);
}

/// What still exists after a batch of events, already turned into entries:
/// files directly, directories by subtree.
///
/// A change normally arrives as several events — the folder plus things inside
/// it — and every one of them would re-walk the same subtree. Directories are
/// therefore visited outermost-first and any that another one already covers is
/// skipped, so a hot folder costs one walk per round instead of one per child.
fn collect_readded(batch: &[PathBuf]) -> Vec<(Box<str>, u8)> {
    let mut out = Vec::new();
    let mut dirs = Vec::new();
    for p in batch {
        match std::fs::metadata(p) {
            Ok(m) if m.is_dir() => dirs.push(p.to_string_lossy().into_owned()),
            Ok(_) => push_entry(&mut out, &p.to_string_lossy(), false),
            Err(_) => {} // removed or renamed away — tombstoned, not re-added
        }
    }
    dirs.sort_unstable_by(|a, b| cmp_ci(a, b));
    let mut covered: Vec<u8> = Vec::new();
    for d in &dirs {
        let key = trim_sep(&fold(d));
        if !covered.is_empty() && is_self_or_child(&key, &covered) {
            continue;
        }
        covered = key;
        let builder = walk_builder(d);
        for entry in builder.build().flatten() {
            if entry.file_name().to_str().is_none() {
                continue;
            }
            push_entry(
                &mut out,
                &entry.path().to_string_lossy(),
                entry.file_type().is_some_and(|t| t.is_dir()),
            );
        }
    }
    out
}

fn push_entry(sink: &mut Vec<(Box<str>, u8)>, path: &str, is_dir: bool) {
    sink.push((
        path.to_owned().into_boxed_str(),
        if is_dir { FLAG_DIR } else { 0 },
    ));
}

/// Tombstone + re-add one chunk of watcher events, rebuilding if the garbage
/// crossed the threshold. Split out of `apply_batch` so a test can drive it
/// against a local `Core` instead of the process-wide index.
fn apply_updates(core: &mut Core, batch: &[PathBuf], readded: Vec<(Box<str>, u8)>) {
    // Phase 1: tombstone every entry that IS a changed path or sits directly
    // or deeply under a changed directory. Phase 2 re-adds whatever still
    // exists, so this is idempotent for plain edits.
    tombstone_batch(core, batch);
    for (path, flags) in readded {
        core.tail.push(Entry { path, flags });
    }

    // Garbage is bounded: past the threshold the rebuild frees it, which is
    // what stops the index from growing for the rest of the session.
    if core.dead + core.tail.len() > (core.len() / COMPACT_RATIO).max(COMPACT_MIN) {
        core.merge_compact();
    }
}

/// Mark every entry that IS one of `batch` or sits beneath one of them.
///
/// `main` is sorted, so each key costs a binary search plus a walk of its own
/// range. The unsorted tail can't be searched that way, and scanning it once
/// per key cost `batch × tail` — on a machine-sized index that comparison loop,
/// not the disk, was what a busy round spent its CPU on. So the tail is walked
/// ONCE for the whole batch, each entry matched against the batch keys through
/// its own ancestor paths.
fn tombstone_batch(core: &mut Core, batch: &[PathBuf]) {
    let mut keys: HashSet<Vec<u8>> = HashSet::with_capacity(batch.len());
    for p in batch {
        keys.insert(trim_sep(&fold(&p.to_string_lossy())));
    }

    for key in &keys {
        let (lo, hi) = prefix_range(&core.main, key);
        let mut marked = 0usize;
        for e in &mut core.main[lo..hi] {
            if e.flags & FLAG_DEAD == 0 && is_self_or_child(e.path.as_bytes(), key) {
                e.flags |= FLAG_DEAD;
                marked += 1;
            }
        }
        core.dead += marked;
    }

    let mut scratch: Vec<u8> = Vec::with_capacity(512);
    let mut marked = 0usize;
    for e in &mut core.tail {
        if e.flags & FLAG_DEAD != 0 {
            continue;
        }
        scratch.clear();
        scratch.extend(e.path.as_bytes().iter().map(u8::to_ascii_lowercase));
        if covers(&scratch, &keys) {
            e.flags |= FLAG_DEAD;
            marked += 1;
        }
    }
    core.dead += marked;
}

/// Does one of `keys` name this already-folded path, or a directory above it?
/// Walking the entry's own separators is what costs one hash per directory
/// level instead of one prefix test per key.
fn covers(folded: &[u8], keys: &HashSet<Vec<u8>>) -> bool {
    if keys.contains(&folded[..trimmed_len(folded)]) {
        return true;
    }
    for (i, &b) in folded.iter().enumerate() {
        if b == b'\\' || b == b'/' {
            let upto = trimmed_len(&folded[..i]);
            if upto > 0 && keys.contains(&folded[..upto]) {
                return true;
            }
        }
    }
    false
}

/// `path` is `key` itself or something beneath it. Requiring a separator after
/// the key is what keeps `D:\proj` from touching `D:\projx`.
fn is_self_or_child(path: &[u8], key: &[u8]) -> bool {
    starts_with(path, key)
        && (path.len() == key.len() || matches!(path[key.len()], b'\\' | b'/'))
}

fn fold(path: &str) -> Vec<u8> {
    path.as_bytes().iter().map(u8::to_ascii_lowercase).collect()
}

/// Drop trailing separators so the self-or-child test has one form to match.
/// A key that is nothing but separators ("/") is kept as-is, since trimming it
/// to "" would match every entry in the index.
fn trim_sep(bytes: &[u8]) -> Vec<u8> {
    bytes[..trimmed_len(bytes)].to_vec()
}

/// Where a path ends once trailing separators are ignored.
fn trimmed_len(bytes: &[u8]) -> usize {
    bytes
        .iter()
        .rposition(|&b| b != b'\\' && b != b'/')
        .map_or(bytes.len(), |i| i + 1)
}

// ------------------------------------------------------------ byte helpers

/// Case-insensitive prefix test against an already-folded `prefix`.
fn starts_with(hay: &[u8], prefix: &[u8]) -> bool {
    hay.len() >= prefix.len()
        && hay[..prefix.len()]
            .iter()
            .zip(prefix)
            .all(|(a, b)| a.eq_ignore_ascii_case(b))
}

/// Folded byte order — the order `main` is sorted in, so equal-folded paths
/// land next to each other and every prefix forms one contiguous range.
fn cmp_ci(a: &str, b: &str) -> CmpOrdering {
    a.as_bytes()
        .iter()
        .map(u8::to_ascii_lowercase)
        .cmp(b.as_bytes().iter().map(u8::to_ascii_lowercase))
}

fn fold_lt(bytes: &[u8], key: &[u8]) -> bool {
    bytes
        .iter()
        .map(u8::to_ascii_lowercase)
        .cmp(key.iter().copied())
        == CmpOrdering::Less
}

/// Range of the sorted run whose paths start with the folded `prefix`.
fn prefix_range(main: &[Entry], prefix: &[u8]) -> (usize, usize) {
    let lo = main.partition_point(|e| fold_lt(e.path.as_bytes(), prefix));
    let mut hi = lo;
    while hi < main.len() && starts_with(main[hi].path.as_bytes(), prefix) {
        hi += 1;
    }
    (lo, hi)
}

/// First index of `low` (already ASCII-lowercased) in `hay`, case-insensitively.
fn find_ci(hay: &[u8], low: &[u8]) -> Option<usize> {
    if low.is_empty() {
        return Some(0);
    }
    if hay.len() < low.len() {
        return None;
    }
    let first = low[0];
    let alt = if first.is_ascii_lowercase() {
        first - b' '
    } else {
        first
    };
    let rest = &low[1..];
    let mut i = 0;
    while i + low.len() <= hay.len() {
        if (hay[i] == first || hay[i] == alt)
            && hay[i + 1..i + 1 + rest.len()]
                .iter()
                .zip(rest)
                .all(|(a, b)| a.eq_ignore_ascii_case(b))
        {
            return Some(i);
        }
        i += 1;
    }
    None
}

// ------------------------------------------------------------------- query

/// Match tiers: lower is better.
const TIER_NAME_EXACT: u8 = 0;
const TIER_NAME_PREFIX: u8 = 1;
const TIER_NAME_CONTAINS: u8 = 2;
const TIER_PATH_CONTAINS: u8 = 3;
const TIER_FUZZY: u8 = 4;

/// Where does the final path segment start?
fn name_start(path: &[u8]) -> usize {
    path.iter()
        .rposition(|&c| c == b'\\' || c == b'/')
        .map_or(0, |i| i + 1)
}

/// Substring match + tier for one entry, or None. `ql` is folded.
fn match_entry(path: &str, ql: &str) -> Option<(u8, usize)> {
    let bytes = path.as_bytes();
    let pos = find_ci(bytes, ql.as_bytes())?;
    let ns = name_start(bytes);
    if pos < ns {
        return Some((TIER_PATH_CONTAINS, pos));
    }
    if pos == ns && pos + ql.len() == bytes.len() {
        Some((TIER_NAME_EXACT, pos))
    } else if pos == ns {
        Some((TIER_NAME_PREFIX, pos))
    } else {
        Some((TIER_NAME_CONTAINS, pos))
    }
}

/// Subsequence match over the name only (fuzzy tier).
fn fuzzy_name(name: &str, ql: &str) -> bool {
    let mut cursor = 0usize;
    for c in ql.chars() {
        match name[cursor..].find(c) {
            Some(i) => cursor += i + c.len_utf8(),
            None => return false,
        }
    }
    true
}

/// Virtual scan position → entry. `[0, span)` is the in-scope slice of `main`,
/// the rest is the tail, which is unsorted and therefore always scanned whole.
fn entry_at(core: &Core, k: usize, main_lo: usize, span: usize) -> &Entry {
    if k < span {
        &core.main[main_lo + k]
    } else {
        &core.tail[k - span]
    }
}

fn empty_outcome() -> SearchOutcome {
    SearchOutcome {
        hits: vec![],
        truncated: false,
    }
}

fn query_local(query: &str, limit: usize) -> SearchOutcome {
    // Space-separated terms are ANDed (Everything semantics — keeps the two
    // backends aligned). A term containing a path separator scopes the search
    // to a folder: the UI fills "D:\proj\ " when a folder is clicked, and the
    // next word the user types narrows within it. Tiering follows the LAST
    // term (the keyword); earlier ones act as scope filters.
    let ql: String = query
        .trim()
        .chars()
        .map(|c| c.to_ascii_lowercase())
        .collect();
    let terms: Vec<&str> = ql.split_whitespace().collect();
    if terms.is_empty() {
        return empty_outcome();
    }
    let idx = index();
    if !idx.ready.load(Ordering::Relaxed) {
        return empty_outcome();
    }
    let core = idx.core.read().unwrap();
    let (keyword, scopes) = terms.split_last().unwrap();

    // A scope term ending in a separator is a genuine path prefix, so the
    // sorted run narrows to one range instead of a whole-machine scan.
    let (main_lo, span) = match scopes.iter().find(|t| t.ends_with(['\\', '/'])) {
        Some(prefix) => {
            let key = fold(prefix);
            let (lo, hi) = prefix_range(&core.main, &key);
            (lo, hi - lo)
        }
        None => (0, core.main.len()),
    };
    let total = span + core.tail.len();
    let threads = std::thread::available_parallelism()
        .map_or(4, |n| n.get())
        .min(total.max(1));
    let chunk = total.div_ceil(threads);

    let matched = AtomicU64::new(0);
    let mut merged: Vec<(u8, u32)> = std::thread::scope(|scope| {
        let handles: Vec<_> = (0..threads)
            .map(|t| {
                let core = &core;
                let terms = &terms;
                let matched = &matched;
                scope.spawn(move || {
                    let mut hits: Vec<(u8, u32)> = Vec::new();
                    let start = t * chunk;
                    let end = ((t + 1) * chunk).min(total);
                    for k in start..end {
                        let e = entry_at(core, k, main_lo, span);
                        if e.flags & FLAG_DEAD != 0 {
                            continue;
                        }
                        let bytes = e.path.as_bytes();
                        if !terms.iter().all(|t| find_ci(bytes, t.as_bytes()).is_some()) {
                            continue;
                        }
                        if let Some((tier, _)) = match_entry(&e.path, keyword) {
                            matched.fetch_add(1, Ordering::Relaxed);
                            hits.push((tier, k as u32));
                            if hits.len() > 8192 {
                                hits.sort_unstable_by_key(|(tier, k)| {
                                    (*tier, entry_at(core, *k as usize, main_lo, span).path.len())
                                });
                                hits.truncate(4096);
                            }
                        }
                    }
                    hits
                })
            })
            .collect();
        handles
            .into_iter()
            .flat_map(|h| h.join().unwrap_or_default())
            .collect()
    });
    let mut truncated = matched.load(Ordering::Relaxed) > limit as u64;

    // Fuzzy top-up when the plain substring pass came up short. Parallel like
    // the substring pass — a rare query would otherwise pay a full
    // single-threaded scan while the user waits. Scope terms still filter;
    // only the keyword fuzzes.
    let seen: HashSet<u32> = merged.iter().map(|(_, k)| *k).collect();
    if merged.len() < limit {
        let fuzzy_cap = limit.saturating_mul(2);
        let fuzzy: Vec<Vec<(u8, u32)>> = std::thread::scope(|scope| {
            let handles: Vec<_> = (0..threads)
                .map(|t| {
                    let core = &core;
                    let seen = &seen;
                    scope.spawn(move || {
                        let mut hits: Vec<(u8, u32)> = Vec::new();
                        let start = t * chunk;
                        let end = ((t + 1) * chunk).min(total);
                        for k in start..end {
                            if hits.len() >= fuzzy_cap {
                                break;
                            }
                            let k = k as u32;
                            if seen.contains(&k) {
                                continue;
                            }
                            let e = entry_at(core, k as usize, main_lo, span);
                            if e.flags & FLAG_DEAD != 0 {
                                continue;
                            }
                            let bytes = e.path.as_bytes();
                            if !scopes.iter().all(|t| find_ci(bytes, t.as_bytes()).is_some()) {
                                continue;
                            }
                            let name = &e.path[name_start(bytes)..];
                            if fuzzy_name(name, keyword) {
                                hits.push((TIER_FUZZY, k));
                            }
                        }
                        hits
                    })
                })
                .collect();
            handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
        });
        merged.extend(fuzzy.into_iter().flatten());
        if merged.len() > limit {
            truncated = true;
        }
    }

    merged.sort_unstable_by(|a, b| {
        let (x, y) = (
            entry_at(&core, a.1 as usize, main_lo, span),
            entry_at(&core, b.1 as usize, main_lo, span),
        );
        (a.0.cmp(&b.0))
            .then_with(|| x.path.len().cmp(&y.path.len()))
            .then_with(|| cmp_ci(&x.path, &y.path))
    });
    merged.truncate(limit);

    let hits = merged
        .into_iter()
        .map(|(_, k)| {
            let e = entry_at(&core, k as usize, main_lo, span);
            SearchHit {
                name: e.path.rsplit(['\\', '/']).next().unwrap_or(&e.path).to_owned(),
                path: e.path.to_string(),
                is_dir: e.flags & FLAG_DIR != 0,
            }
        })
        .collect();

    SearchOutcome { hits, truncated }
}

// ------------------------------------------------------------------- tests

#[cfg(test)]
impl Core {
    /// Heap the index itself holds: path bytes, their allocation headers and
    /// the `Entry` slots. This is the number that must not creep upward.
    fn footprint(&self) -> usize {
        self.main
            .iter()
            .chain(self.tail.iter())
            .map(|e| e.path.len() + 16 + std::mem::size_of::<Entry>())
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tier_of(path: &str, q: &str) -> Option<u8> {
        match_entry(path, q).map(|(t, _)| t)
    }

    fn core_from(entries: &[(&str, bool)]) -> Core {
        let mut core = Core::default();
        core.main = entries
            .iter()
            .map(|(p, is_dir)| Entry {
                path: (*p).into(),
                flags: if *is_dir { FLAG_DIR } else { 0 },
            })
            .collect();
        core.main.sort_unstable_by(|a, b| cmp_ci(&a.path, &b.path));
        core
    }

    fn live_paths(core: &Core) -> Vec<String> {
        core.main
            .iter()
            .chain(core.tail.iter())
            .filter(|e| e.flags & FLAG_DEAD == 0)
            .map(|e| e.path.to_string())
            .collect()
    }

    #[test]
    fn name_exact_beats_prefix_beats_contains() {
        assert_eq!(tier_of(r"c:\myapp\readme.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(tier_of(r"c:\myapp\readme.md.bak", "readme"), Some(TIER_NAME_PREFIX));
        assert_eq!(tier_of(r"c:\myapp\my.readme.md", "readme"), Some(TIER_NAME_CONTAINS));
        assert_eq!(tier_of(r"c:\readme\app.txt", "readme"), Some(TIER_PATH_CONTAINS));
    }

    /// There is no lowercase twin anymore — matching folds the stored path.
    #[test]
    fn matches_regardless_of_the_stored_case() {
        assert_eq!(tier_of(r"C:\MyApp\README.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(tier_of(r"D:\Projects\SVCode\src\App.tsx", "app.tsx"), Some(TIER_NAME_EXACT));
        assert_eq!(tier_of(r"C:\Temp\ReadMe.TXT", "readme"), Some(TIER_NAME_PREFIX));
        assert_eq!(tier_of(r"C:\myapp\main.rs", "readme"), None);
    }

    /// The first folded occurrence decides the tier, so a keyword that also
    /// appears in a parent folder name is reported as a path match.
    #[test]
    fn first_occurrence_wins() {
        assert_eq!(tier_of(r"C:\Windows\WinSxS\Manifests", "winsxs"), Some(TIER_PATH_CONTAINS));
        assert_eq!(tier_of(r"C:\Windows\WinSxS\Manifests", "manifests"), Some(TIER_NAME_EXACT));
    }

    #[test]
    fn chinese_names_match() {
        assert_eq!(tier_of("d:\\项目\\计划书.md", "计划书"), Some(TIER_NAME_PREFIX));
        assert_eq!(tier_of("d:\\项目\\计划书.md", "书.md"), Some(TIER_NAME_CONTAINS));
        assert_eq!(tier_of("d:\\项目\\计划书.md", "不存在"), None);
    }

    #[test]
    fn posix_paths_use_forward_slash() {
        assert_eq!(tier_of("/home/user/readme.md", "readme.md"), Some(TIER_NAME_EXACT));
        assert_eq!(name_start(b"/home/user/readme.md"), 11);
    }

    #[test]
    fn find_ci_locates_the_first_folded_match() {
        assert_eq!(find_ci(b"C:\\WinSxS", b"win"), Some(3));
        // Folding is symmetric, so an unfolded needle matches too; the query
        // path folds up front only so it folds once per query.
        assert_eq!(find_ci(b"C:\\WinSxS", b"WINS"), Some(3));
        assert_eq!(find_ci(b"C:\\WinSxS", b"shell"), None);
        assert_eq!(find_ci(b"readme", b""), Some(0));
        assert_eq!(find_ci(b"ab", b"abc"), None);
    }

    #[test]
    fn fuzzy_matches_subsequence_only() {
        assert!(fuzzy_name("reactmain.tsx", "rmts"));
        assert!(fuzzy_name("计划书.md", "计书"));
        assert!(!fuzzy_name("react.tsx", "rmts"));
    }

    #[test]
    fn skip_dirs_ignore_case() {
        assert!(skip_dir("$RECYCLE.BIN"));
        assert!(skip_dir("System Volume Information"));
        assert!(!skip_dir("windows"));
    }

    #[test]
    fn cmp_ci_orders_case_insensitively() {
        let mut v = vec!["D:\\b", "C:\\Z", "c:\\a", "D:\\A"];
        v.sort_unstable_by(|a, b| cmp_ci(a, b));
        assert_eq!(v, vec!["c:\\a", "C:\\Z", "D:\\A", "D:\\b"]);
    }

    /// A trailing separator gives the tight subtree range the query path uses.
    /// Without one the range is a superset — `d:\projx` shares the `d:\proj`
    /// byte prefix — and `tombstone`'s separator test narrows it.
    #[test]
    fn prefix_range_covers_the_subtree_only() {
        let core = core_from(&[
            (r"c:\other", true),
            (r"d:\proj", true),
            (r"d:\proj\a.txt", false),
            (r"d:\proj\sub", true),
            (r"d:\proj\sub\b.txt", false),
            (r"d:\projx\c.txt", false),
        ]);
        let range = |p: &str| {
            let (lo, hi) = prefix_range(&core.main, &fold(p));
            core.main[lo..hi].iter().map(|e| e.path.as_ref()).collect::<Vec<_>>()
        };
        assert_eq!(
            range(r"d:\proj\"),
            vec![r"d:\proj\a.txt", r"d:\proj\sub", r"d:\proj\sub\b.txt"]
        );
        assert_eq!(range(r"d:\projx"), vec![r"d:\projx\c.txt"]);
        assert!(range(r"c:\nope").is_empty());
    }

    #[test]
    fn tombstone_marks_self_and_descendants_not_siblings() {
        let mut core = core_from(&[
            (r"d:\proj", true),
            (r"d:\proj\a.txt", false),
            (r"d:\proj\sub\b.txt", false),
            (r"d:\projx\c.txt", false),
            (r"d:\other\d.txt", false),
        ]);
        tombstone_batch(&mut core, &[PathBuf::from(r"d:\proj\")]);
        assert_eq!(core.dead, 3);
        assert_eq!(live_paths(&core), vec![r"d:\other\d.txt", r"d:\projx\c.txt"]);
    }

    #[test]
    fn tombstone_of_a_drive_root_clears_that_drive() {
        let mut core = core_from(&[
            (r"c:\windows", true),
            (r"c:\windows\a.dll", false),
            (r"d:\proj\a.txt", false),
        ]);
        tombstone_batch(&mut core, &[PathBuf::from(r"c:\")]);
        assert_eq!(live_paths(&core), vec![r"d:\proj\a.txt"]);
    }

    /// The tail is walked once for the whole batch now, so every key in the
    /// chunk has to reach its own descendants there — and still stop at the
    /// directory boundary.
    #[test]
    fn tombstone_batch_covers_every_key_in_the_chunk() {
        let mut core = core_from(&[
            (r"d:\keep\c.txt", false),
            (r"d:\proj\a.txt", false),
            (r"e:\cache\b.tmp", false),
        ]);
        for (path, flags) in [
            (r"d:\proj\new.txt", 0),
            (r"e:\cache\new.tmp", 0),
            (r"d:\projx\late.txt", 0),
        ] {
            core.tail.push(Entry { path: path.into(), flags });
        }
        tombstone_batch(
            &mut core,
            &[PathBuf::from(r"d:\proj"), PathBuf::from(r"e:\cache\")],
        );
        assert_eq!(
            live_paths(&core),
            vec![r"d:\keep\c.txt", r"d:\projx\late.txt"]
        );
    }

    #[test]
    fn merge_compact_frees_dead_entries_and_duplicates() {
        let mut core = core_from(&[
            (r"d:\a.txt", false),
            (r"d:\gone.txt", false),
            (r"d:\z.txt", false),
        ]);
        tombstone_batch(&mut core, &[PathBuf::from(r"d:\gone.txt")]);
        // A live path appended twice, plus one that a tombstone already covers.
        for dup in [r"d:\new.txt", r"d:\new.txt", r"d:\a.txt"] {
            core.tail.push(Entry { path: dup.into(), flags: 0 });
        }
        assert_eq!(core.live(), 5);
        core.merge_compact();
        assert_eq!(core.dead, 0);
        assert!(core.tail.is_empty());
        assert_eq!(
            live_paths(&core),
            vec![r"d:\a.txt", r"d:\new.txt", r"d:\z.txt"]
        );
        // Still sorted, so prefix ranges keep working after a rebuild.
        for w in core.main.windows(2) {
            assert_eq!(cmp_ci(&w[0].path, &w[1].path), CmpOrdering::Less);
        }
    }

    /// A directory event re-adds the whole subtree, not just the directory.
    #[test]
    fn collect_readded_walks_directories() {
        let dir = std::env::temp_dir().join(format!("svcode-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("sub")).unwrap();
        std::fs::write(dir.join("f.txt"), b"x").unwrap();
        std::fs::write(dir.join("sub").join("g.txt"), b"y").unwrap();
        std::fs::write(dir.join("new.txt"), b"z").unwrap();

        let out = collect_readded(&[dir.clone()]);
        // root dir itself + f.txt + new.txt + sub dir + sub/g.txt
        assert_eq!(out.len(), 5);
        assert!(out.iter().any(|(_, f)| f & FLAG_DIR != 0));
        assert!(out.iter().any(|(p, _)| p.ends_with("g.txt")));
        // A batch naming a directory AND something inside it walks the outer
        // one once: no entry twice, none missing.
        assert_eq!(
            collect_readded(&[dir.clone(), dir.join("sub")]).len(),
            5
        );
        // A file event yields the file alone.
        let file = dir.join("f.txt");
        assert_eq!(collect_readded(&[file]).len(), 1);
        // A vanished path yields nothing — the tombstone already covered it.
        assert!(collect_readded(&[dir.join("gone.txt")]).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn scope_modes_parse() {
        assert_eq!(parse_scope("off"), Scope::Off);
        assert_eq!(parse_scope("system"), Scope::System);
        assert_eq!(parse_scope("all"), Scope::All);
        assert_eq!(parse_scope("garbage"), Scope::All);
    }

    /// Queries run across the sorted run AND the append tail, which the
    /// virtual scan index has to map into both.
    #[test]
    fn query_local_spans_both_runs() {
        let idx = index();
        {
            let mut core = idx.core.write().unwrap();
            core.load(vec![
                Entry { path: r"d:\proj\readme.md".into(), flags: 0 },
                Entry { path: r"d:\proj\lib\mod.rs".into(), flags: 0 },
                Entry { path: r"d:\projx\README.md".into(), flags: FLAG_DIR },
            ]);
            core.tail.push(Entry { path: r"e:\new\Readme.TXT".into(), flags: 0 });
        }
        idx.ready.store(true, Ordering::SeqCst);

        let hits = query_local("readme", 10).hits;
        let names: Vec<&str> = hits.iter().map(|h| h.name.as_str()).collect();
        assert!(names.contains(&"Readme.TXT"), "tail entry missed: {names:?}");
        assert_eq!(hits[0].name, "readme.md");
        assert!(hits.iter().any(|h| h.is_dir), "directory flag lost: {names:?}");

        // A scope term narrows to that folder's range; the tail is still
        // scanned but its terms filter it out.
        let scoped = query_local(r"D:\proj\ readme", 10).hits;
        assert_eq!(
            scoped.iter().map(|h| h.path.as_str()).collect::<Vec<_>>(),
            vec![r"d:\proj\readme.md"]
        );

        // Fuzzy only kicks in when the substring pass comes up short.
        let fuzzy = query_local("rmd", 10).hits;
        assert!(fuzzy.iter().any(|h| h.name == "readme.md"), "fuzzy missed: {fuzzy:?}");
    }

    /// Real-machine smoke test — run with `cargo test -- --ignored`. Walks the
    /// drives the way the app does, then replays tens of thousands of
    /// file-change events and asserts the index comes back to roughly its
    /// starting size instead of creeping upward, which is what the old
    /// tombstone-only design did for the life of the process.
    #[test]
    #[ignore = "walks every drive on the machine"]
    fn churn_does_not_grow_the_index() {
        fn mb(bytes: usize) -> usize {
            bytes / 1024 / 1024
        }
        let roots = scan_roots();
        assert!(!roots.is_empty(), "no drives to index");
        let mut core = Core::default();
        let walked = std::time::Instant::now();
        core.load(walk_all(&roots));
        let (base, live) = (core.footprint(), core.live());
        println!(
            "index: {live} entries, {} MB, walked in {:?}",
            mb(base),
            walked.elapsed()
        );

        // A wide sample of real files, each "changed" once — far more churn
        // than a whole session produces.
        let sample: Vec<PathBuf> = core
            .main
            .iter()
            .step_by((core.main.len() / 40_000).max(1))
            .filter(|e| e.flags & FLAG_DIR == 0)
            .map(|e| PathBuf::from(&*e.path))
            .collect();
        let t0 = std::time::Instant::now();
        for chunk in sample.chunks(APPLY_CHUNK) {
            apply_updates(&mut core, chunk, collect_readded(chunk));
        }
        let applied = t0.elapsed();
        core.merge_compact();
        let after = core.footprint();
        println!(
            "after {} change events in {:?} ({:.1} µs each): {} entries, {} MB",
            sample.len(),
            applied,
            applied.as_secs_f64() * 1e6 / sample.len() as f64,
            core.live(),
            mb(after)
        );
        // Files may legitimately vanish from disk mid-test; growth may not.
        assert!(
            core.live() >= live - live / 100,
            "index lost {} of {live} entries",
            live - core.live()
        );
        assert!(
            after < base * 6 / 5,
            "index grew {} MB → {} MB",
            mb(base),
            mb(after)
        );
    }
}

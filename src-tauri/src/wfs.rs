//! WFSearch engine client over its loopback HTTP gateway
//! (`http://127.0.0.1:15100/api/v1/..`, protocol v1) plus the lifecycle of
//! the bundled `wfs-server` sidecar. All calls are blocking and must run off
//! the UI thread (`spawn_blocking`).
//!
//! HTTP rather than the named pipe on purpose: a service-installed engine
//! runs as LocalSystem, and the pipe it creates then refuses connections from
//! a plain-user SVCode (OS error 5).
//!
//! Since engine 0.1.0 **every** route demands the `x-wfs-token` header, whose
//! value is the contents of `<data dir>\http.token` (`%ProgramData%\WFSearch`
//! unless the engine's config overrides it). The engine mints a fresh token on
//! each start and publishes it under the DACL its `acl` setting selects, so
//! *reading that file* is the credential — which is why it is read per request
//! rather than cached: an engine restart rewrites it.
//!
//! If an engine is already listening — e.g. the user installed WFSearch as a
//! Windows service — we simply ride it; the sidecar is only spawned when the
//! port is free, and only once per cooldown window.
//!
//! A registered service always outranks the sidecar, even while stopped: the
//! sidecar runs as this user, so it can bind the port but cannot read a single
//! MFT. It would serve nothing but `failed` volumes and, worse, keep the port,
//! so the service could never bind at its next start.

use serde::Deserialize;
use serde_json::Value;
use std::io::{self, Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const HOST: &str = "127.0.0.1";
const PORT: u16 = 15100;
const TIMEOUT: Duration = Duration::from_secs(3);
/// Header the gateway authenticates; mirrors `wfs_server::http::TOKEN_HEADER`.
const TOKEN_HEADER: &str = "x-wfs-token";
/// Minimum gap between sidecar spawn attempts — a server whose REPL stdin
/// was closed dies on startup, and a failed elevation retry should not
/// become a spawn storm.
const SPAWN_COOLDOWN: Duration = Duration::from_secs(15);

/// The `console` REPL exits the moment its stdin hits EOF, so the piped
/// stdin handle — carried by this `Child` — is what keeps the engine alive.
/// When SVCode quits, the handle drops, the REPL sees EOF and shuts the
/// engine down gracefully (snapshot included): no orphans either way.
static SIDECAR: Mutex<Option<Child>> = Mutex::new(None);
static LAST_SPAWN_MS: AtomicU64 = AtomicU64::new(0);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Availability {
    /// An engine is answering our credential.
    Ready,
    /// Something holds the port but will not accept our token: an engine
    /// older than 0.1.0, an `acl = restricted` engine whose token file this
    /// user cannot read, or a token file that is simply absent. Spawning the
    /// sidecar would only collide on the port, so this waits for the user.
    Blocked,
    /// Nothing listening — the sidecar can be started.
    Absent,
}

#[derive(Deserialize)]
pub struct FileResult {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[derive(Deserialize)]
pub struct SearchResp {
    pub total_matched: u64,
    pub results: Vec<FileResult>,
}

#[derive(Deserialize)]
struct VolumeStatus {
    phase: String,
    files: u64,
}

#[derive(Deserialize)]
struct StatusResp {
    volumes: Vec<VolumeStatus>,
}

pub struct EngineStatus {
    pub ready: bool,
    pub building: bool,
    pub files: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Where the engine publishes its bearer token — the same path
/// `wfs_client::default_token_path` computes.
fn token_path() -> PathBuf {
    std::env::var("ProgramData")
        .map(|p| PathBuf::from(p).join("WFSearch"))
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("http.token")
}

fn read_token() -> io::Result<String> {
    let path = token_path();
    let text = std::fs::read_to_string(&path).map_err(|e| {
        io::Error::other(format!(
            "read {}: {e} — start an engine 0.1.0+ (an older service never \
             publishes a token, and acl=restricted hides it from standard users)",
            path.display()
        ))
    })?;
    let token = text.trim().to_string();
    if token.is_empty() {
        return Err(io::Error::other(format!("{} is empty", path.display())));
    }
    Ok(token)
}

fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn port_open() -> bool {
    TcpStream::connect((HOST, PORT)).is_ok()
}

/// One-shot authenticated GET → (status code, JSON body). Hand-rolled on
/// `TcpStream` to stay dependency-free against a server that always answers
/// with `content-length` + JSON.
fn http_get(path: &str, token: &str) -> io::Result<(u16, Value)> {
    let mut sock = TcpStream::connect((HOST, PORT))?;
    sock.set_read_timeout(Some(TIMEOUT))?;
    sock.set_write_timeout(Some(TIMEOUT))?;
    sock.write_all(
        format!(
            "GET {path} HTTP/1.1\r\nHost: {HOST}:{PORT}\r\n{TOKEN_HEADER}: {token}\r\nConnection: close\r\n\r\n"
        )
        .as_bytes(),
    )?;
    sock.flush()?;

    let mut head = Vec::new();
    {
        let mut byte = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            if sock.read(&mut byte)? == 0 {
                return Err(io::Error::other("wfs: gateway closed mid-header"));
            }
            head.push(byte[0]);
            if head.len() > 8192 {
                return Err(io::Error::other("wfs: oversized response header"));
            }
        }
    }
    let text = String::from_utf8_lossy(&head);
    let status: u16 = text
        .split_whitespace()
        .nth(1)
        .and_then(|c| c.parse().ok())
        .ok_or_else(|| io::Error::other("wfs: bad status line"))?;
    let length: usize = text
        .lines()
        .find_map(|l| {
            let (k, v) = l.split_once(':')?;
            k.trim().eq_ignore_ascii_case("content-length")
                .then(|| v.trim().parse().ok())?
        })
        .ok_or_else(|| io::Error::other("wfs: missing content-length"))?;

    let mut body = vec![0u8; length];
    sock.read_exact(&mut body)?;
    let json: Value = serde_json::from_slice(&body).map_err(io::Error::other)?;
    Ok((status, json))
}

/// Error body is `{code, message}`; surface the message.
fn err_msg(json: &Value) -> io::Error {
    let m = json
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or("unknown error");
    io::Error::other(format!("wfs: {m}"))
}

fn get(path: &str) -> io::Result<Value> {
    let (status, json) = http_get(path, &read_token()?)?;
    if status != 200 {
        return Err(err_msg(&json));
    }
    Ok(json)
}

pub fn availability() -> Availability {
    if !port_open() {
        return Availability::Absent;
    }
    let Ok(token) = read_token() else {
        return Availability::Blocked;
    };
    match http_get("/api/v1/status", &token) {
        Ok((200, _)) => Availability::Ready,
        // 401 means the engine re-minted its token while ours went stale, or
        // the port belongs to a process that is not the engine at all. Either
        // way the sidecar cannot take the port, so it is Blocked, not Absent.
        _ => Availability::Blocked,
    }
}

pub fn ping() -> bool {
    availability() == Availability::Ready
}

pub fn search(q: &str, limit: u32) -> io::Result<SearchResp> {
    let json = get(&format!("/api/v1/search?q={}&limit={limit}", urlencode(q)))?;
    serde_json::from_value(json).map_err(io::Error::other)
}

pub fn status() -> io::Result<EngineStatus> {
    let json = get("/api/v1/status")?;
    let resp: StatusResp = serde_json::from_value(json).map_err(io::Error::other)?;
    Ok(EngineStatus {
        ready: resp.volumes.iter().any(|v| v.phase == "ready"),
        building: resp.volumes.iter().any(|v| v.phase == "building"),
        files: resp.volumes.iter().map(|v| v.files).sum(),
    })
}

/// Where the bundler put the sidecar: Tauri keeps the target-triple suffix
/// next to the app executable, and dev builds may copy it under the plain
/// name — accept both.
fn sidecar_path() -> Option<PathBuf> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    let names = [
        "wfs-server-x86_64-pc-windows-msvc.exe",
        "wfs-server.exe",
    ];
    names.iter().map(|n| dir.join(n)).find(|p| p.exists())
}

/// Runs `sc.exe` with no window and returns its exit code, or `None` when the
/// SCM itself could not be reached. Only the code is read: `sc` localizes its
/// messages.
#[cfg(windows)]
fn sc(args: &str) -> Option<i32> {
    use std::os::windows::process::CommandExt;
    use std::process::Stdio;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let mut cmd = std::process::Command::new("sc.exe");
    cmd.args(args.split(' '))
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    cmd.status().ok().map(|s| s.code().unwrap_or(-1))
}

/// Whether the installer registered the engine as a service. Cached: the
/// answer cannot change during this process's lifetime, and it decides whether
/// the sidecar is allowed to take the port at all.
#[cfg(windows)]
fn service_registered() -> bool {
    static KNOWN: AtomicBool = AtomicBool::new(false);
    static ANSWER: AtomicBool = AtomicBool::new(false);
    if KNOWN.swap(true, Ordering::SeqCst) {
        return ANSWER.load(Ordering::SeqCst);
    }
    let registered = sc("query WFSearch") == Some(0);
    ANSWER.store(registered, Ordering::SeqCst);
    registered
}

/// Asks the SCM to start a registered-but-stopped engine. A standard user is
/// refused (error 5), which is exactly why the installer hook does this once
/// while it is still elevated; this retry only covers the service having been
/// stopped since. Attempted once per process.
#[cfg(windows)]
fn request_service_start() {
    static TRIED: AtomicBool = AtomicBool::new(false);
    if !TRIED.swap(true, Ordering::SeqCst) {
        sc("start WFSearch");
    }
}

/// Make sure an engine is (or is becoming) available: probe, then spawn the
/// bundled `wfs-server console` once per cooldown window. Returns whether an
/// engine is answering; callers otherwise read the outcome through
/// `ping`/`status`.
pub fn ensure_server() -> bool {
    match availability() {
        Availability::Ready => return true,
        // The port is taken by an engine we cannot authenticate to; nothing
        // spawning can fix, and a retry would only collide.
        Availability::Blocked => return false,
        Availability::Absent => {}
    }
    #[cfg(windows)]
    if service_registered() {
        // The port belongs to the service; a sidecar would only serve `failed`
        // volumes and lock the engine out of it for good.
        request_service_start();
        return availability() == Availability::Ready;
    }
    let mut sidecar = SIDECAR.lock().unwrap();
    if let Some(child) = sidecar.as_mut() {
        // Ours is alive but the gateway isn't answering (yet): still booting,
        // or wedged on a machine that can't grant volume access. Either way
        // it holds the port, so respawning would only collide.
        if matches!(child.try_wait(), Ok(None)) {
            return false;
        }
        *sidecar = None;
    }
    let last = LAST_SPAWN_MS.swap(now_ms(), Ordering::SeqCst);
    if now_ms().saturating_sub(last) < SPAWN_COOLDOWN.as_millis() as u64 {
        return false;
    }
    let Some(exe) = sidecar_path() else {
        return false;
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        *sidecar = std::process::Command::new(exe)
            .arg("console")
            // Piped and never written: keeps the REPL blocked, see SIDECAR.
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .ok();
    }
    // The engine mints and publishes its token before opening the gateway, so
    // a short wait usually turns the next probe green; when the spawn lacks
    // the rights to read the MFT it simply never serves results and the
    // cooldown keeps us quiet.
    std::thread::sleep(Duration::from_millis(400));
    ping()
}

#[cfg(all(test, windows))]
mod tests {
    /// Round-trips a real `ping` through the shipped client code. Needs a
    /// live engine, so it is ignored by default:
    /// `cargo test -- wfs::tests --ignored`
    #[test]
    #[ignore]
    fn ping_roundtrip_against_live_engine() {
        assert!(super::ping(), "no engine answering on {}:{}", super::HOST, super::PORT);
        let s = super::status().expect("status round-trip");
        assert!(!s.ready || s.files > 0);
    }

    #[test]
    #[ignore]
    fn search_roundtrip_against_live_engine() {
        let r = super::search("rust-toolchain", 20).expect("search round-trip");
        assert!(
            r.results.iter().any(|f| f.name.contains("rust-toolchain")),
            "engine answered but found no rust-toolchain file"
        );
    }

    /// The gateway answers 401 for a wrong credential; `ping` must agree that
    /// there is no usable engine rather than counting a response as health.
    /// Also needs a live 0.1.0+ engine — a pre-token one answers 200 instead.
    #[test]
    #[ignore]
    fn bad_token_is_not_ready() {
        assert!(
            super::port_open(),
            "no engine listening on {}:{}",
            super::HOST,
            super::PORT
        );
        let (status, body) =
            super::http_get("/api/v1/status", "definitely-not-the-token").expect("gateway reply");
        assert_eq!(status, 401, "engine accepted a forged token: {body}");
        assert_eq!(body["code"], 4);
        // Whether the client then calls this engine Blocked depends on the
        // engine's `acl`: a restricted one publishes a token this user cannot
        // read, so the credential is missing and the sidecar must not be
        // spawned; a shared one publishes a readable token, which is Ready.
        let token_readable = std::fs::read_to_string(super::token_path())
            .map(|t| !t.trim().is_empty())
            .unwrap_or(false);
        assert_eq!(
            super::availability(),
            if token_readable {
                super::Availability::Ready
            } else {
                super::Availability::Blocked
            }
        );
    }

    /// The engine publishes `<data dir>\http.token` and its default data dir
    /// is `%ProgramData%\WFSearch`; reading a different path just looks like
    /// a missing engine.
    #[test]
    fn token_path_is_the_engines_published_location() {
        let path = super::token_path();
        assert!(
            path.ends_with(std::path::Path::new("WFSearch").join("http.token")),
            "{}",
            path.display()
        );
    }
}

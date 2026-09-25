//! Search tier 1: talk to a running Everything instance over its IPC
//! (`everything-ipc` crate, WM_COPYDATA). When Everything is running this
//! gives literally-Everything-speed results with zero indexing on our side.
//! Availability is re-checked at most every 30s so starting Everything later
//! still gets picked up without restarting SVCode.

use super::search::{SearchHit, SearchOutcome};
use everything_ipc::wm::{EverythingClient, RequestFlags};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

static AVAILABLE: AtomicBool = AtomicBool::new(false);
static LAST_CHECK_MS: AtomicU64 = AtomicU64::new(0);

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn available() -> bool {
    let last = LAST_CHECK_MS.load(Ordering::Relaxed);
    let now = now_ms();
    if now.saturating_sub(last) < Duration::from_secs(30).as_millis() as u64 {
        return AVAILABLE.load(Ordering::Relaxed);
    }
    LAST_CHECK_MS.store(now, Ordering::Relaxed);
    let ok = EverythingClient::new().is_ok();
    AVAILABLE.store(ok, Ordering::Relaxed);
    ok
}

pub fn query(q: &str, limit: usize) -> Option<SearchOutcome> {
    let client = EverythingClient::new().ok()?;
    let q = q.trim();
    if q.is_empty() {
        return None;
    }
    run(&client, q, limit)
}

fn run(client: &EverythingClient, q: &str, limit: usize) -> Option<SearchOutcome> {
    let list = client
        .query_wait(q)
        .request_flags(
            RequestFlags::FileName
                | RequestFlags::FullPathAndFileName
                | RequestFlags::Attributes,
        )
        .max_results(limit as u32)
        .call()
        .ok()?;

    const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x10;
    let mut hits = Vec::new();
    for item in list.iter() {
        let full = item
            .get_str(RequestFlags::FullPathAndFileName)
            .map(|p| p.display().to_string());
        let Some(full) = full else {
            continue;
        };
        let name = full.rsplit(['\\', '/']).next().unwrap_or(&full).to_owned();
        let attrs = item.get_u32(RequestFlags::Attributes).unwrap_or(0);
        hits.push(SearchHit {
            is_dir: attrs & FILE_ATTRIBUTE_DIRECTORY != 0,
            path: full,
            name,
        });
    }

    let truncated = list.total_len() > hits.len();
    Some(SearchOutcome { hits, truncated })
}

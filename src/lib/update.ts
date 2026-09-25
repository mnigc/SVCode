import pkg from '../../package.json'

export const REPO = 'mnigc/SVCode'
export const REPO_URL = `https://github.com/${REPO}`

/** Real app version in production (tauri.conf.json); falls back to
 * package.json in the browser mock where the tauri app plugin is absent. */
export async function resolveAppVersion(): Promise<string> {
  try {
    const { getVersion } = await import('@tauri-apps/api/app')
    const v = await getVersion()
    if (v) return v
  } catch {
    // not running inside Tauri
  }
  return pkg.version
}

export interface LatestRelease {
  tag: string
  url: string
  notes: string | null
  publishedAt: string | null
}

export async function fetchLatestRelease(): Promise<LatestRelease> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = (await res.json()) as {
    tag_name?: unknown
    html_url?: unknown
    body?: unknown
    published_at?: unknown
  }
  if (typeof data.tag_name !== 'string' || !data.tag_name) {
    throw new Error('malformed release payload')
  }
  return {
    tag: data.tag_name,
    url: typeof data.html_url === 'string' ? data.html_url : `${REPO_URL}/releases`,
    notes: typeof data.body === 'string' && data.body ? data.body : null,
    publishedAt: typeof data.published_at === 'string' ? data.published_at : null,
  }
}

/** Dotted numeric compare ("v0.2.10" > "v0.2.9"); a pre-release suffix
 * (0.3.0-beta.1) ranks below the same version without one. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate)
  const b = parseVersion(current)
  if (!a || !b) return false
  const len = Math.max(a.nums.length, b.nums.length)
  for (let i = 0; i < len; i++) {
    const x = a.nums[i] ?? 0
    const y = b.nums[i] ?? 0
    if (x !== y) return x > y
  }
  return !a.pre && !!b.pre
}

function parseVersion(v: string): { nums: number[]; pre: string | null } | null {
  const s = v.trim().replace(/^v/i, '')
  const [core, pre] = s.split('-', 2)
  const nums = core.split('.').map((part) => parseInt(part, 10))
  if (!nums.length || nums.some((n) => Number.isNaN(n) || n < 0)) return null
  return { nums, pre: pre ?? null }
}

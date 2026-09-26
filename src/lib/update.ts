/**
 * In-app updates, riding `tauri-plugin-updater`: it fetches the signed
 * `latest.json` published with each GitHub Release, compares versions and
 * verifies the minisign signature against the public key in
 * `tauri.conf.json`. So this module holds UI state only — no version parsing,
 * no release API, and no download code of our own.
 *
 * The whole install path is Tauri-only: in the plain-browser UI mock the
 * dynamic import fails and the check reports an error, which is honest —
 * there is nothing to install into there.
 */
import { create } from 'zustand'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'
import { kv } from './persist'
import pkg from '../../package.json'

export const REPO = 'mnigc/SVCode'
export const REPO_URL = `https://github.com/${REPO}`

/** A background check is cheap for us and expensive for a throttled network. */
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000

export type UpdatePhase = 'idle' | 'checking' | 'uptodate' | 'available' | 'installing' | 'error'

export interface UpdateInfo {
  version: string
  /** Release notes, straight from the GitHub release body. */
  notes: string | null
  date: string | null
  /** 0..1 while the installer downloads, null before and after. */
  progress: number | null
}

interface UpdateState {
  phase: UpdatePhase
  update: UpdateInfo | null
  error: string
}

export const useUpdate = create<UpdateState>(() => ({
  phase: 'idle',
  update: null,
  error: '',
}))

/** The plugin's handle is a native resource, not UI state — it lives here so
 * `installUpdate` can pick up the version `checkForUpdate` surfaced. */
let pending: Update | null = null

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

/**
 * Ask the updater endpoint. Resolves to the new version, or null when the app
 * is current — including when the check itself failed, which the caller reads
 * off `useUpdate` if it wants to say so.
 */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  useUpdate.setState({ phase: 'checking', error: '' })
  try {
    const { check } = await import('@tauri-apps/plugin-updater')
    const update = await check({ timeout: 15_000 })
    if (!update) {
      pending = null
      useUpdate.setState({ phase: 'uptodate', update: null })
      return null
    }
    pending = update
    const info: UpdateInfo = {
      version: update.version,
      notes: update.body || null,
      date: update.date ?? null,
      progress: null,
    }
    useUpdate.setState({ phase: 'available', update: info })
    return info
  } catch (e) {
    useUpdate.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    return null
  }
}

/**
 * Download the installer and run it. On Windows the app exits as the installer
 * starts, so a caller that wants to save state first must do so before this.
 */
export async function installUpdate(): Promise<void> {
  if (!pending) return
  useUpdate.setState({ phase: 'installing' })
  let total = 0
  let size = 0
  const report = (progress: number | null) =>
    useUpdate.setState((s) =>
      s.update ? { update: { ...s.update, progress } } : s,
    )
  try {
    await pending.downloadAndInstall((event: DownloadEvent) => {
      if (event.event === 'Started') size = event.data.contentLength ?? 0
      else if (event.event === 'Progress' && size) {
        total += event.data.chunkLength
        report(Math.min(1, total / size))
      }
    })
    report(null)
  } catch (e) {
    report(null)
    useUpdate.setState({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
  }
}

/**
 * Startup entry point: at most one check per day, and a failure stays silent —
 * a blocked network must not look like a broken app. A hit leaves the store in
 * `available`, which is what lights the menu hint.
 */
export async function checkOnStartup(): Promise<void> {
  const store = await kv('update.kv')
  const last = (await store.get<number>('lastCheck')) ?? 0
  if (Date.now() - last < RECHECK_AFTER_MS) return
  await store.set('lastCheck', Date.now())
  await checkForUpdate()
}

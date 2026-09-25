/**
 * Key-value persistence shared by settings and session state. Uses
 * tauri-plugin-store (files under the app config dir) when running inside
 * Tauri, and falls back to localStorage so `pnpm dev` in a plain browser
 * (the UI-mock workflow) still keeps state.
 */

export interface KVStore {
  get<T>(key: string): Promise<T | undefined>
  set(key: string, value: unknown): Promise<void>
}

const LS_PREFIX = 'svcode:'

function localStorageBackend(): KVStore {
  return {
    async get<T>(key: string): Promise<T | undefined> {
      const raw = localStorage.getItem(LS_PREFIX + key)
      if (raw === null) return undefined
      try {
        return JSON.parse(raw) as T
      } catch {
        return undefined
      }
    },
    async set(key, value) {
      try {
        localStorage.setItem(LS_PREFIX + key, JSON.stringify(value))
      } catch {
        // Quota exceeded — persistence is best-effort, never break the UI.
      }
    },
  }
}

const backends = new Map<string, Promise<KVStore>>()

export function kv(file: string): Promise<KVStore> {
  let pending = backends.get(file)
  if (!pending) {
    pending = (async () => {
      try {
        const { load } = await import('@tauri-apps/plugin-store')
        const store = await load(file, { autoSave: true })
        return {
          get: <T,>(key: string) => store.get<T>(key),
          set: (key, value) => store.set(key, value),
        }
      } catch {
        return localStorageBackend()
      }
    })()
    backends.set(file, pending)
  }
  return pending
}

import { create } from 'zustand'
import { kv } from '../lib/persist'

/**
 * 快速访问 (Quick Access): user-pinned folders shown above the file tree.
 * The list is user intent, not session state — it persists immediately in
 * its own KV file and survives "reset session" style clears.
 */
interface QuickAccessState {
  pinned: string[]
  /** Guard so App can fire load() on mount without double-reading the KV. */
  loaded: boolean
  load: () => Promise<void>
  pin: (path: string) => void
  unpin: (path: string) => void
}

function persist(pinned: string[]) {
  return kv('pinned.json')
    .then((k) => k.set('pinned', pinned))
    .catch(() => {})
}

export const useQuickAccess = create<QuickAccessState>((set, get) => ({
  pinned: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return
    const saved = await kv('pinned.json')
      .then((k) => k.get<string[]>('pinned'))
      .catch(() => undefined)
    set({ pinned: Array.isArray(saved) ? saved : [], loaded: true })
  },
  pin: (path) => {
    if (get().pinned.includes(path)) return
    set({ pinned: [...get().pinned, path] })
    void persist(get().pinned)
  },
  unpin: (path) => {
    set({ pinned: get().pinned.filter((p) => p !== path) })
    void persist(get().pinned)
  },
}))

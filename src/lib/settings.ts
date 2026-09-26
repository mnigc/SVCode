import { create } from 'zustand'
import { kv } from './persist'
import { applySearchScope } from './search'

export type ThemeName = 'dark' | 'light' | 'auto'
export type LangPref = 'auto' | 'zh' | 'en'
export type ViewPref = 'edit' | 'both' | 'preview'
/** Drives the built-in filename index walks. Everything wins over all of
 * these when it is running. */
export type SearchScope = 'off' | 'system' | 'all'

/** Everything the user can configure, with the defaults used before any
 * settings.json exists. New settings go here + in the dialog below. */
export interface SettingsValues {
  theme: ThemeName
  lang: LangPref
  fontSize: number
  tabSize: number
  wordWrap: boolean
  lineNumbers: boolean
  showHidden: boolean
  /** Initial view mode of NEW editor groups (split / open to the side);
   * existing groups keep their sticky per-group view. */
  defaultView: ViewPref
  /** UNC paths (\\server\share…) mounted under 此电脑, Windows only. */
  netLocations: string[]
  searchScope: SearchScope
}

export const DEFAULT_SETTINGS: SettingsValues = {
  theme: 'dark',
  lang: 'auto',
  fontSize: 13,
  tabSize: 2,
  wordWrap: true,
  lineNumbers: true,
  showHidden: false,
  defaultView: 'both',
  netLocations: [],
  searchScope: 'all',
}

const PERSIST_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsValues)[]

export interface SettingsState extends SettingsValues {
  loaded: boolean

  load: () => Promise<void>
  patch: (changes: Partial<SettingsValues>) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  loaded: false,

  load: async () => {
    try {
      const saved = await kv('settings.json').then((k) => k.get<Partial<SettingsValues>>('settings'))
      if (saved) {
        // Only known keys, over the defaults — stale/unknown entries in the
        // file must not leak into state (e.g. after a setting is removed).
        const clean = PERSIST_KEYS.reduce<Partial<SettingsValues>>((acc, key) => {
          if (saved[key] !== undefined) (acc[key] as SettingsValues[typeof key]) = saved[key]!
          return acc
        }, {})
        set({ ...clean, loaded: true })
      }
    } catch {
      // A broken store must not take the boot chain down: App.tsx loads the
      // file system in a .then() off this, so swallow and use the defaults.
    } finally {
      set({ loaded: true })
      applyTheme(get().theme)
      // Hand the saved scope to the backend; a no-op there unless it differs
      // from its own default.
      applySearchScope(get().searchScope)
    }
  },

  patch: (changes) => {
    set(changes)
    if (changes.theme !== undefined) applyTheme(changes.theme)
    if (changes.searchScope !== undefined) applySearchScope(changes.searchScope)
    const s = get()
    const values = Object.fromEntries(PERSIST_KEYS.map((key) => [key, s[key]]))
    void kv('settings.json').then((k) => k.set('settings', values))
  },
}))

/** Resolve `auto` against the OS preference and pin it on <html data-theme>. */
export function applyTheme(theme: ThemeName): 'dark' | 'light' {
  const resolved =
    theme === 'auto'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : theme
  document.documentElement.dataset.theme = resolved
  return resolved
}

// Keep `auto` live when the OS flips mid-session.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (useSettings.getState().theme === 'auto') applyTheme('auto')
})

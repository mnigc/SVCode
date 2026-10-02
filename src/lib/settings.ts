import { create } from 'zustand'
import { kv } from './persist'

export type ThemeName = 'dark' | 'light' | 'auto'
export type LangPref = 'auto' | 'zh' | 'en'
export type ViewPref = 'edit' | 'both' | 'preview'

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
  /** Close button hides to the tray (background) instead of quitting. */
  closeToTray: boolean
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
  closeToTray: true,
}

const PERSIST_KEYS = Object.keys(DEFAULT_SETTINGS) as (keyof SettingsValues)[]

/**
 * Per-field load validation. settings.json is data at rest (older app
 * versions, manual edits, a truncated write): a value of the wrong type or
 * outside the UI's own range is dropped in favour of the default rather than
 * trusted — the Stepper offers fontSize 11–24 and tabSize 2/4/8, so anything
 * else was never a legitimate choice.
 */
const THEME_NAMES: ThemeName[] = ['dark', 'light', 'auto']
const LANG_NAMES: LangPref[] = ['auto', 'zh', 'en']
const VIEW_NAMES: ViewPref[] = ['edit', 'both', 'preview']

function isValidValue(key: keyof SettingsValues, v: unknown): boolean {
  switch (key) {
    case 'theme':
      return THEME_NAMES.includes(v as ThemeName)
    case 'lang':
      return LANG_NAMES.includes(v as LangPref)
    case 'defaultView':
      return VIEW_NAMES.includes(v as ViewPref)
    case 'fontSize':
      return typeof v === 'number' && Number.isInteger(v) && v >= 11 && v <= 24
    case 'tabSize':
      return typeof v === 'number' && (v === 2 || v === 4 || v === 8)
    case 'netLocations':
      return Array.isArray(v) && v.every((p) => typeof p === 'string' && p.length > 0)
    case 'wordWrap':
    case 'lineNumbers':
    case 'showHidden':
    case 'closeToTray':
      return typeof v === 'boolean'
  }
}

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
        // Only known keys of the right type/range, over the defaults — stale
        // or malformed entries in the file must not leak into state (e.g.
        // after a setting is removed or a file was hand-edited).
        const clean = PERSIST_KEYS.reduce<Partial<SettingsValues>>((acc, key) => {
          if (saved[key] !== undefined && isValidValue(key, saved[key]))
            (acc[key] as SettingsValues[typeof key]) = saved[key]!
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
    }
  },

  patch: (changes) => {
    set(changes)
    if (changes.theme !== undefined) applyTheme(changes.theme)
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

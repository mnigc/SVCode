import { create } from 'zustand'
import { kv } from './persist'

export type ThemeName = 'dark' | 'light' | 'auto'
export type LangPref = 'auto' | 'zh' | 'en'

export interface SettingsState {
  theme: ThemeName
  lang: LangPref
  fontSize: number
  tabSize: number
  wordWrap: boolean
  showHidden: boolean
  loaded: boolean

  load: () => Promise<void>
  patch: (
    changes: Partial<
      Pick<SettingsState, 'theme' | 'lang' | 'fontSize' | 'tabSize' | 'wordWrap' | 'showHidden'>
    >,
  ) => void
}

export const useSettings = create<SettingsState>((set, get) => ({
  theme: 'dark',
  lang: 'auto',
  fontSize: 13,
  tabSize: 2,
  wordWrap: true,
  showHidden: false,
  loaded: false,

  load: async () => {
    try {
      const saved = await kv('settings.json').then((k) => k.get<Partial<SettingsState>>('settings'))
      if (saved) set({ ...saved, loaded: true })
    } finally {
      set({ loaded: true })
      applyTheme(get().theme)
    }
  },

  patch: (changes) => {
    set(changes)
    if (changes.theme !== undefined) applyTheme(changes.theme)
    void kv('settings.json').then((k) =>
      k.set('settings', {
        theme: get().theme,
        lang: get().lang,
        fontSize: get().fontSize,
        tabSize: get().tabSize,
        wordWrap: get().wordWrap,
        showHidden: get().showHidden,
      }),
    )
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

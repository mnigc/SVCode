import { useEffect, useState } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useWorkspace } from '../store/workspace'
import { useSettings, type ThemeName } from '../lib/settings'
import { useT, type TextKey } from '../lib/i18n'
import { useUpdate } from '../lib/update'
import { AboutDialog } from './AboutDialog'
import { SettingsDialog } from './SettingsDialog'
import { NetworkLocationDialog } from './NetworkLocationDialog'
import logoUrl from '../assets/logo.png'

interface MenuEntry {
  label?: string
  hint?: string
  separator?: boolean
  disabled?: boolean
  checked?: boolean
  onSelect?: () => void
}

export function TitleBar() {
  const t = useT()
  const maximized = useMaximized()
  const win = getCurrentWindow()
  const settings = useSettings()
  const [openMenu, setOpenMenu] = useState<string | null>(null)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [checkSeq, setCheckSeq] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [netDialogOpen, setNetDialogOpen] = useState(false)
  // The startup check leaves this set when a signed newer build exists: the
  // menu item shows the version, so nothing interrupts the user outright.
  const updateVersion = useUpdate((s) => (s.phase === 'available' ? s.update?.version : undefined))

  // Global shortcut: Ctrl+, opens Settings (works even when the editor has
  // focus — it's a key the editor never uses).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setOpenMenu(null)
        setSettingsOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    if (!openMenu) return
    // Dismiss on any press that isn't inside a menu (its button or its panel) —
    // including the top bar's own blank, draggable areas.
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.topbar-menu')) {
        setOpenMenu(null)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpenMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openMenu])

  const menus: Record<string, MenuEntry[]> = {    [t('menu.file')]: [
      {
        label: t('menu.save'),
        hint: 'Ctrl+S',
        onSelect: () => void useWorkspace.getState().saveActive(),
      },
      {
        label: t('menu.closeTab'),
        hint: 'Ctrl+W',
        onSelect: () => {
          const s = useWorkspace.getState()
          const active = s.groupActive[s.activeGroup]
          if (active) void s.closeTab(active)
        },
      },
      { separator: true },
      {
        label: t('menu.openTerminal'),
        hint: 'Ctrl+`',
        onSelect: () => void useWorkspace.getState().openInTerminal(),
        disabled: !useWorkspace.getState().selectedDir,
      },
      {
        label: t('net.add'),
        onSelect: () => setNetDialogOpen(true),
      },
      { separator: true },
      {
        label: t('menu.settings'),
        hint: 'Ctrl+,',
        onSelect: () => setSettingsOpen(true),
      },
      { separator: true },
      { label: t('menu.exit'), onSelect: () => void win.close() },
    ],
    [t('menu.view')]: [
      ...([
        ['dark', 'theme.dark'],
        ['light', 'theme.light'],
        ['auto', 'theme.auto'],
      ] as [ThemeName, TextKey][]).map(([value, key]) => ({
        label: t(key),
        checked: settings.theme === value,
        onSelect: () => useSettings.getState().patch({ theme: value }),
      })),
      { separator: true },
      ...([
        ['zh', 'lang.zh'],
        ['en', 'lang.en'],
        ['auto', 'lang.auto'],
      ] as const).map(([value, key]) => ({
        label: t(key as TextKey),
        checked: settings.lang === value,
        onSelect: () => useSettings.getState().patch({ lang: value }),
      })),
      { separator: true },
      {
        label: t('menu.wordWrap'),
        checked: settings.wordWrap,
        onSelect: () => useSettings.getState().patch({ wordWrap: !settings.wordWrap }),
      },
      {
        label: t('menu.showHidden'),
        checked: settings.showHidden,
        onSelect: () => useSettings.getState().patch({ showHidden: !settings.showHidden }),
      },
    ],
    [t('menu.help')]: [
      {
        label: t('menu.checkUpdate'),
        hint: updateVersion,
        onSelect: () => {
          setAboutOpen(true)
          setCheckSeq((seq) => seq + 1)
        },
      },
      { label: t('menu.about'), onSelect: () => setAboutOpen(true) },
    ],
  }

  return (
    <>
      <header className="titlebar" data-tauri-drag-region>
      <button
        className="btn-icon"
        title={t('title.toggleSidebar')}
        onClick={() => useWorkspace.getState().toggleSidebar()}
      >
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
          <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" stroke="currentColor" strokeWidth="1.3" />
          <path d="M6.2 2.8v10.4" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>

      <span className="brand" data-tauri-drag-region>
        <img src={logoUrl} width="16" height="16" alt="" aria-hidden />
        SVCode
      </span>

      {Object.entries(menus).map(([name, entries]) => (
        <div className="topbar-menu" key={name}>
          <button
            className={`topbar-menu-btn${openMenu === name ? ' is-open' : ''}`}
            onClick={() => setOpenMenu(openMenu === name ? null : name)}
          >
            {name}
          </button>
          {openMenu === name && (
            <div className="menu-panel" role="menu">
              {entries.map((entry, i) =>
                entry.separator ? (
                  <div className="menu-sep" key={i} />
                ) : (
                  <button
                    key={i}
                    className="menu-item"
                    role="menuitem"
                    disabled={entry.disabled}
                    onClick={() => {
                      setOpenMenu(null)
                      entry.onSelect?.()
                    }}
                  >
                    {/* The check column exists only in menus that have
                        checkable items, so pure-action menus (文件) don't
                        carry a dead gutter. */}
                    {entries.some((e) => e.checked !== undefined) && (
                      <span className="menu-check" aria-hidden>
                        {entry.checked ? '✓' : ''}
                      </span>
                    )}
                    <span className="menu-label">{entry.label}</span>
                    {entry.hint && <span className="menu-hint">{entry.hint}</span>}
                  </button>
                ),
              )}
            </div>
          )}
        </div>
      ))}

      <div className="caption-buttons">
        <button className="caption" title={t('title.minimize')} onClick={() => void win.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
        <button
          className="caption"
          title={maximized ? t('title.restore') : t('title.maximize')}
          onClick={() => void win.toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
              <path d="M2.5 0.5h7v7" stroke="currentColor" strokeWidth="1" />
              <rect x="0.5" y="2.5" width="7" height="7" stroke="currentColor" strokeWidth="1" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden fill="none">
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" strokeWidth="1" />
            </svg>
          )}
        </button>
        <button className="caption is-close" title={t('title.close')} onClick={() => void win.close()}>
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
          </svg>
        </button>
      </div>
    </header>

    <AboutDialog open={aboutOpen} checkSeq={checkSeq} onClose={() => setAboutOpen(false)} />
    <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    {netDialogOpen && <NetworkLocationDialog onClose={() => setNetDialogOpen(false)} />}
    </>
  )
}

/** The restore glyph has to follow the real window state, not our guess. */
function useMaximized() {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    const win = getCurrentWindow()
    let alive = true
    const read = () => {
      void win.isMaximized().then((value) => {
        if (alive) setMaximized(value)
      })
    }
    read()
    const unlisten = win.onResized(read)
    return () => {
      alive = false
      void unlisten.then((stop) => stop())
    }
  }, [])

  return maximized
}

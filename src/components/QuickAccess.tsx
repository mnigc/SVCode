import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useWorkspace } from '../store/workspace'
import { useQuickAccess } from '../store/quickAccess'
import { useT } from '../lib/i18n'
import { DIR_ICON } from '../lib/fileIcons'
import { basename } from '../lib/paths'
import { scrollTreeRow } from '../lib/reveal'
import { NodeIcon } from './NodeIcon'
import { NodeMenu } from './NodeMenu'

/**
 * 快速访问 (Quick Access): pinned folders above the tree, Windows-Explorer
 * style. A click reveals the folder in the tree below; the row's context
 * menu is the shared NodeMenu for that path (which carries the unpin item).
 * Pinned paths that no longer resolve stay listed but dimmed — like
 * Explorer, the entry is only removed by the user.
 */
export function QuickAccess() {
  const pinned = useQuickAccess((s) => s.pinned)
  const t = useT()
  const [open, setOpen] = useState(true)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())

  // Probe each pinned path so deleted/unreachable folders render dimmed
  // instead of failing silently on click. Sequential is fine — the list is
  // short and check_access is a cheap read_dir probe.
  useEffect(() => {
    let alive = true
    void (async () => {
      const gone = new Set<string>()
      for (const p of pinned) {
        const ok = await invoke<boolean>('check_access', { path: p }).catch(() => false)
        if (!ok) gone.add(p)
      }
      if (alive) setMissing(gone)
    })()
    return () => {
      alive = false
    }
  }, [pinned])

  // Same outside-dismissal as the FileTree menu.
  useEffect(() => {
    if (!menu) return
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest('.ctx-menu')) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  /** Expand the folder in the tree below, then bring its row into view so
   * deep pins visibly "locate" instead of changing state off-screen. */
  const reveal = async (p: string) => {
    await useWorkspace.getState().revealPinned(p)
    scrollTreeRow(p)
  }

  return (
    <div className="qa">
      <button className="qa-head" onClick={() => setOpen(!open)}>
        <span className={`chevron${open ? ' is-open' : ''}`} />
        <span className="qa-title">{t('sidebar.quickAccess')}</span>
      </button>
      {open && pinned.length === 0 && <div className="qa-empty">{t('qa.empty')}</div>}
      {open &&
        pinned.map((p) => {
          const gone = missing.has(p)
          return (
            <div
              key={p}
              className={`tree-row qa-row${gone ? ' is-missing' : ''}${menu?.path === p ? ' is-ctx-open' : ''}`}
              style={{ paddingLeft: 8 }}
              onClick={() => {
                if (!gone) void reveal(p)
              }}
              onContextMenu={(e) => {
                e.preventDefault()
                setMenu({ x: e.clientX, y: e.clientY, path: p })
              }}
              title={gone ? `${p}\n${t('qa.missing')}` : p}
            >
              <span className="chevron is-hidden" />
              <NodeIcon spec={DIR_ICON} />
              <span className="node-name is-dir">{basename(p)}</span>
            </div>
          )
        })}
      {menu && (
        <NodeMenu
          path={menu.path}
          x={menu.x}
          y={menu.y}
          hint={{ isDir: true, missing: missing.has(menu.path) }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useWorkspace, THIS_PC, ROOT } from '../store/workspace'
import { useSettings } from '../lib/settings'
import { useSearch } from '../lib/search'
import { useT, tBackend } from '../lib/i18n'
import { NodeIcon } from './NodeIcon'
import { NodeMenu, useTreeEditing, openExternal } from './NodeMenu'

/** How long the collapse animation runs before unmounting the rows. */
const COLLAPSE_MS = 180

interface TreeCtx {
  openMenu: (path: string, x: number, y: number) => void
  /** Path whose context menu is currently open — keeps the row highlighted
   * while the pointer wanders into the menu (hover alone would drop it). */
  menuPath: string | null
}

function TreeNode({ path, depth, ctx }: { path: string; depth: number; ctx: TreeCtx }) {
  const node = useWorkspace((s) => s.nodes[path])
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const activePath = useWorkspace((s) => s.groupActive[s.activeGroup] ?? null)
  const toggleNode = useWorkspace((s) => s.toggleNode)
  const openFile = useWorkspace((s) => s.openFile)
  const editing = useTreeEditing((s) => s.editing)
  const setEditing = useTreeEditing((s) => s.set)
  const probeAccess = useWorkspace((s) => s.probeAccess)
  const showHidden = useSettings((s) => s.showHidden)
  const t = useT()

  const expanded = node?.expanded ?? false
  // Mount/unmount is separate from the open class so the 0fr→1fr height
  // transition has a painted starting frame on expand, and the rows stay
  // mounted for the collapse animation before being removed.
  const [mounted, setMounted] = useState(expanded)
  const [open, setOpen] = useState(expanded)

  useEffect(() => {
    if (expanded) {
      setMounted(true)
      const raf = requestAnimationFrame(() =>
        requestAnimationFrame(() => setOpen(true)),
      )
      return () => cancelAnimationFrame(raf)
    }
    setOpen(false)
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [expanded])

  // Once the 0fr→1fr expansion settles, position the expanded folder a
  // quarter from the top of the tree viewport, so its freshly listed
  // children fill the rest of the window instead of revealing a single row.
  // Never scrolls up, and is a no-op while the folder already sits above
  // that anchor (e.g. expansions near the top of the tree).
  const childrenRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!expanded) return
    const timer = setTimeout(() => {
      const container = childrenRef.current
      const row = container?.previousElementSibling as HTMLElement | null
      if (!container || !row) return
      let scroller: HTMLElement | null = container.parentElement
      while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
        scroller = scroller.parentElement
      }
      if (!scroller) return
      const absTop =
        row.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop
      const target = absTop - scroller.clientHeight * 0.25
      if (target > scroller.scrollTop) {
        scroller.scrollTo({ top: Math.min(target, scroller.scrollHeight - scroller.clientHeight), behavior: 'smooth' })
      }
    }, COLLAPSE_MS)
    return () => clearTimeout(timer)
  }, [expanded])

  if (!node) return null
  // Hidden entries stay in the store (search/reveal keep working); only the
  // display is filtered, per the 视图 → 显示隐藏文件 toggle.
  if (node.hidden && !showHidden) return null

  const indent = 8 + depth * 15
  const onRowClick = () => {
    // Denied dirs must not even attempt to expand (the failed listing would
    // flash the row open before collapsing back).
    if (node.isDir && node.access === 'denied') return
    if (node.isDir) {
      // Offer the folder as a search scope — passive: the box shows a hint
      // and the search only starts if the user focuses the input.
      if (path !== THIS_PC && path !== ROOT) useSearch.getState().setPendingScope(path)
      void toggleNode(path)
    } else {
      void openFile(path)
    }
  }
  const renaming = editing?.kind === 'rename' && editing.path === path
  // Full selection highlight belongs to the active file only; the folder
  // holding it (or last clicked) gets a lighter treatment — tinted name.
  const fileActive = !node.isDir && activePath === path
  const dirActive = node.isDir && selectedDir === path

  return (
    <>
      <div
        className={`tree-row${fileActive ? ' is-selected' : ''}${dirActive ? ' is-dir-active' : ''}${node.access === 'denied' ? ' is-denied' : ''}${ctx.menuPath === path ? ' is-ctx-open' : ''}`}
        style={{ paddingLeft: indent }}
        // Quick Access reveal scrolls this row into view by path.
        data-path={path}
        onClick={onRowClick}
        // A double-click on a file ALSO hands it to the system default
        // application (the single clicks still open it in the editor).
        onDoubleClick={node.isDir ? undefined : () => openExternal(path)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          ctx.openMenu(path, e.clientX, e.clientY)
        }}
        onMouseEnter={() => void probeAccess(path)}
        title={
          node.error
            ? `${path}\n${tBackend(node.error)}`
            : node.access === 'denied'
              ? `${path}\n${t('tree.noAccess')}`
              : path
        }
      >
        <span
          className={`chevron${node.isDir ? (node.expanded ? ' is-open' : '') : ' is-hidden'}`}
        />
        <NodeIcon spec={node.icon} expanded={node.expanded} />
        {renaming ? (
          <InlineInput
            initial={node.name}
            kind="rename"
            onCommit={(name) => {
              setEditing(null)
              if (name && name !== node.name) void useWorkspace.getState().renameNode(path, name)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <span className={`node-name${node.isDir ? ' is-dir' : ''}`}>{node.name}</span>
        )}
        {node.loading && <span className="node-spinner">…</span>}
      </div>
      {node.isDir && mounted && (
        <div
          className={`tree-children${open ? ' is-open' : ''}`}
          aria-hidden={!open}
          ref={childrenRef}
        >
          <div>
            {node.error && (
              <div className="tree-note" style={{ paddingLeft: indent + 25 }}>
                {node.error}
              </div>
            )}
            {editing && editing.parent === path && editing.kind !== 'rename' && (
              <div className="tree-row" style={{ paddingLeft: indent + 15 }}>
                <span className="chevron is-hidden" />
                <NodeIcon
                  spec={editing.kind === 'new-dir' ? '<dir>' : '<file>'}
                />
                <InlineInput
                  initial=""
                  kind={editing.kind}
                  onCommit={(name) => {
                    setEditing(null)
                    if (name) {
                      void useWorkspace
                        .getState()
                        .createNode(path, editing.kind === 'new-dir' ? 'dir' : 'file', name)
                    }
                  }}
                  onCancel={() => setEditing(null)}
                />
              </div>
            )}
            {node.children?.map((child) => (
              <TreeNode key={child} path={child} depth={depth + 1} ctx={ctx} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

function InlineInput({
  initial,
  kind,
  onCommit,
  onCancel,
}: {
  initial: string
  kind: 'rename' | 'new-file' | 'new-dir'
  onCommit: (name: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initial)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.focus()
    // Select the basename for renames of files with extensions.
    const dot = kind === 'rename' ? initial.lastIndexOf('.') : -1
    el.setSelectionRange(0, dot > 0 ? dot : initial.length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <input
      className="rename-input"
      ref={ref}
      value={value}
      spellCheck={false}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') onCommit(value.trim())
        else if (e.key === 'Escape') onCancel()
      }}
      onBlur={() => onCancel()}
    />
  )
}

/** Context menu for one tree node — see NodeMenu (shared with the tab strip). */

export function FileTree() {
  const t = useT()
  const ready = useWorkspace((s) => Boolean(s.nodes[ROOT]))
  const rootError = useWorkspace((s) => s.rootError)
  const netLocs = useSettings((s) => s.netLocations)
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)

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

  if (!ready) {
    return rootError ? (
      // Drive listing failed (e.g. a dead network mapping) — offer a retry
      // instead of an eternal "loading".
      <button className="tree-empty tree-retry" onClick={() => void useWorkspace.getState().loadSystemTree()}>
        {t('tree.loadFailed')}
      </button>
    ) : (
      <div className="tree-empty">{t('tree.loading')}</div>
    )
  }
  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <TreeNode
        path={ROOT}
        depth={0}
        ctx={{ openMenu: (p, x, y) => setMenu({ x, y, path: p }), menuPath: menu?.path ?? null }}
      />
      {/* Mounted \\server\share locations sit beside 此电脑, top-level. */}
      {netLocs.map((p) => (
        <TreeNode
          key={p}
          path={p}
          depth={0}
          ctx={{ openMenu: (p, x, y) => setMenu({ x, y, path: p }), menuPath: menu?.path ?? null }}
        />
      ))}
      {menu && <NodeMenu path={menu.path} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useWorkspace, THIS_PC, ROOT, subTreePrefix } from '../store/workspace'
import { useSettings } from '../lib/settings'
import { useSearch } from '../lib/search'
import { useT, tBackend } from '../lib/i18n'
import { NodeIcon } from './NodeIcon'
import { basename, dirname, isRootPath, isUncShareRoot } from '../lib/paths'
import { NodeMenu, useTreeEditing, openExternal, confirmDeleteNode } from './NodeMenu'
import { useDismiss } from '../lib/useDismiss'

/** How long the collapse animation runs before unmounting the rows. */
const COLLAPSE_MS = 180

/** Per-path in-flight dedup for hover access probes — mouseenter refires on
 * every re-entry, the probe itself is async. */
const probeInFlight = new Set<string>()

/** Rows are laid out in visual order in one flat container, so document
 * order *is* tree order — the arrow keys just walk the visible `.tree-row`s
 * (hidden files filtered out, collapsed subtrees unmounted). */
function moveRowFocus(from: HTMLElement, step: 1 | -1) {
  const rows = [...from.closest('.tree')!.querySelectorAll<HTMLElement>('.tree-row[data-path]')]
  const visible = rows.filter((r) => r.offsetParent)
  const next = visible[visible.indexOf(from) + step]
  next?.focus()
}

interface TreeCtx {
  openMenu: (path: string, x: number, y: number) => void
  /** Path whose context menu is currently open — keeps the row highlighted
   * while the pointer wanders into the menu (hover alone would drop it). */
  menuPath: string | null
}

function TreeNode({ path, depth, ctx }: { path: string; depth: number; ctx: TreeCtx }) {
  const node = useWorkspace((s) => s.nodes[path])
  const selectedPath = useWorkspace((s) => s.selectedPath)
  // A pending cut fades its target (and the whole subtree) until it lands.
  const isCut = useWorkspace((s) => {
    const c = s.clipboard
    return c?.mode === 'cut' && (path === c.path || path.startsWith(subTreePrefix(c.path)))
  })
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
    // The clicked row owns the selection background, file or folder alike.
    useWorkspace.setState({ selectedPath: path })
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
  // One selection style for every row type: the picked node carries the
  // background, nothing else does.
  const isSelected = selectedPath === path

  return (
    <>
      <div
        className={`tree-row${isSelected ? ' is-selected' : ''}${isCut ? ' is-cut' : ''}${node.access === 'denied' ? ' is-denied' : ''}${ctx.menuPath === path ? ' is-ctx-open' : ''}`}
        style={{ paddingLeft: indent }}
        // Quick Access reveal scrolls this row into view by path.
        data-path={path}
        // Every row is reachable by keyboard; ↑/↓ then walk the visible rows.
        tabIndex={0}
        role="treeitem"
        aria-expanded={node.isDir ? expanded : undefined}
        onKeyDown={(e) => {
          const row = e.currentTarget
          if (e.key === 'Enter') {
            // The inline rename/create input stops propagation, so this only
            // ever fires for a plain row.
            if (e.nativeEvent.isComposing) return
            e.preventDefault()
            onRowClick()
            return
          }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            moveRowFocus(row, e.key === 'ArrowDown' ? 1 : -1)
          } else if (e.key === 'ArrowRight') {
            e.preventDefault()
            if (!node.isDir || node.access === 'denied') return
            if (!node.expanded) void toggleNode(path)
            else moveRowFocus(row, 1)
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault()
            if (node.isDir && node.expanded) void toggleNode(path)
            else {
              // Jump to the owning folder's row, whatever nesting it sits in.
              let el: HTMLElement | null = row.parentElement
              while (el && !el.matches('.tree, .tree-row[data-path]')) el = el.parentElement
              if (el?.classList.contains('tree-row')) el.focus()
            }
          }
        }}
        onClick={onRowClick}
        // A double-click on a file ALSO hands it to the system default
        // application (the single clicks still open it in the editor).
        onDoubleClick={node.isDir ? undefined : () => openExternal(path)}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          ctx.openMenu(path, e.clientX, e.clientY)
        }}
        onMouseEnter={() => {
          // Only probe while the access state is undecided, and never twice
          // at once for the same path.
          if (node.access !== 'unknown' || probeInFlight.has(path)) return
          probeInFlight.add(path)
          void Promise.resolve(probeAccess(path)).finally(() => probeInFlight.delete(path))
        }}
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
                {tBackend(node.error)}
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
        // IME composition: Enter/Escape belong to the IME until it settles.
        if (e.nativeEvent.isComposing) return
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
  useDismiss(!!menu, () => setMenu(null), '.ctx-menu')

  // Tree clipboard/rename/delete shortcuts. The target is the row holding DOM
  // focus, so the editor keeps its own Ctrl+C/X/V and Delete: a copy picked in
  // the tree only needs a click on the folder + Ctrl+V, exactly like Explorer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || useTreeEditing.getState().editing) return
      const el = document.activeElement
      if (!(el instanceof HTMLElement) || !el.classList.contains('tree-row')) return
      const path = el.dataset.path
      if (!path) return
      const s = useWorkspace.getState()
      const node = s.nodes[path]
      // Drive roots and \\server\share roots: paste target only, like the menu.
      const isRoot = isRootPath(path) || isUncShareRoot(path)
      const denied = node?.access === 'denied'
      const canMutate = !isRoot && !denied
      const ctrl = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (ctrl && !e.shiftKey && !e.altKey && key === 'c' && !isRoot && !denied) {
        e.preventDefault()
        s.setClipboard('copy', path)
      } else if (ctrl && !e.shiftKey && !e.altKey && key === 'x' && canMutate) {
        e.preventDefault()
        s.setClipboard('cut', path)
      } else if (ctrl && !e.shiftKey && !e.altKey && key === 'v' && s.clipboard && !denied) {
        // A folder takes the paste itself; a file's parent directory does.
        const target = node?.isDir ? path : dirname(path)
        if (target) {
          e.preventDefault()
          void s.pasteInto(target)
        }
      } else if (key === 'f2' && canMutate) {
        e.preventDefault()
        useTreeEditing.getState().set({
          parent: dirname(path),
          kind: 'rename',
          path,
          initial: node?.name ?? basename(path),
        })
      } else if (e.key === 'Delete' && !e.shiftKey && canMutate) {
        e.preventDefault()
        void confirmDeleteNode(path, node?.isDir ?? false, node?.children?.length ?? 0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
  const ctx: TreeCtx = {
    openMenu: (p, x, y) => setMenu({ x, y, path: p }),
    menuPath: menu?.path ?? null,
  }
  return (
    <div className="tree" onContextMenu={(e) => e.preventDefault()}>
      <TreeNode path={ROOT} depth={0} ctx={ctx} />
      {/* Mounted \\server\share locations sit beside 此电脑, top-level. */}
      {netLocs.map((p) => (
        <TreeNode key={p} path={p} depth={0} ctx={ctx} />
      ))}
      {menu && <NodeMenu path={menu.path} x={menu.x} y={menu.y} onClose={() => setMenu(null)} />}
    </div>
  )
}

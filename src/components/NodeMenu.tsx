import type { ReactNode } from 'react'
import { create } from 'zustand'
import { openPath } from '@tauri-apps/plugin-opener'
import { useWorkspace, THIS_PC, IS_WINDOWS, type NodeInfo } from '../store/workspace'
import { useQuickAccess } from '../store/quickAccess'
import { useSettings } from '../lib/settings'
import { basename, dirname, isRootPath, isUncShareRoot } from '../lib/paths'
import { useT, t } from '../lib/i18n'

/**
 * Inline create/rename editing state for the file tree, shared so any entry
 * point (tree rows AND tab context menus) can start a rename — the input
 * itself always renders in the tree row.
 */
export interface EditState {
  parent: string
  kind: 'rename' | 'new-file' | 'new-dir'
  path?: string
  initial?: string
}

interface TreeEditingState {
  editing: EditState | null
  set: (e: EditState | null) => void
}

export const useTreeEditing = create<TreeEditingState>((set) => ({
  editing: null,
  set: (editing) => set({ editing }),
}))

/**
 * Hand a file to the Windows default application (opener plugin). Shared by
 * the context menu and the tree row's double-click; failures surface in the
 * status-bar notice.
 */
export function openExternal(path: string) {
  void openPath(path).catch((err) => {
    useWorkspace.setState({ notice: t('card.openFailed', { msg: String(err) }) })
  })
}

/**
 * Context menu for one file-system node, rendered fixed at the cursor. Used
 * by the file tree AND the tab strip (right-click a tab = operate on its
 * file, same menu). The node may be absent from the tree (a tab opened via
 * search into an unexpanded directory) — file ops still work on the path.
 */
export function NodeMenu({
  path,
  x,
  y,
  hint,
  onClose,
}: {
  path: string
  x: number
  y: number
  /** Facts the caller knows but the tree doesn't — Quick Access rows for
   * folders absent from the tree (incl. deleted ones) pass this. */
  hint?: { isDir?: boolean; missing?: boolean }
  onClose: () => void
}) {
  const stored = useWorkspace((s) => s.nodes[path]) as NodeInfo | undefined
  const clipboard = useWorkspace((s) => s.clipboard)
  const pinned = useQuickAccess((s) => s.pinned)
  const t = useT()
  if (path === THIS_PC) return null

  // Fall back to path-derived facts for nodes the tree never loaded.
  const node = stored ?? {
    path,
    name: basename(path),
    isDir: hint?.isDir ?? false,
    access: 'unknown' as const,
  }
  // A Quick Access row whose folder is gone: only unpin makes sense —
  // file ops would just surface disk errors.
  const missing = hint?.missing ?? false
  const ws = useWorkspace.getState()
  // Drive roots and \\server\share roots behave alike: browsable, paste
  // target, terminal — but not rename/delete/copy/pin material.
  const isDriveRoot = isRootPath(node.path) || isUncShareRoot(node.path)
  const isDir = node.isDir
  const denied = node.access === 'denied'
  const canCreate = isDir && !denied && !missing
  const canMutate = !isDriveRoot && !denied && !missing
  const pinnedHere = pinned.includes(path)
  // Mounted network locations can be unmounted (unlike real drives).
  const isNetRoot =
    IS_WINDOWS &&
    useSettings.getState().netLocations.some((c) => c.toLowerCase() === path.toLowerCase())

  const item = (
    label: string,
    onSelect: () => void,
    opts: { disabled?: boolean; hint?: string } = {},
  ) => (
    <button
      key={label}
      className="menu-item"
      role="menuitem"
      disabled={opts.disabled}
      onClick={() => {
        onClose()
        onSelect()
      }}
    >
      <span className="menu-label">{label}</span>
      {opts.hint && <span className="menu-hint">{opts.hint}</span>}
    </button>
  )

  const del = async () => {
    const detail =
      node.isDir && (stored?.children?.length ?? 0) > 0 ? t('tree.deleteDetail') : ''
    const ok = await import('@tauri-apps/plugin-dialog').then((m) =>
      m.ask(t('tree.confirmDelete', { name: node.name, detail }), {
        title: 'SVCode',
        kind: 'warning',
        okLabel: t('tree.delete'),
        cancelLabel: t('dialog.cancel'),
      }),
    )
    if (ok) void ws.removeNode(path)
  }

  const terminal = () => {
    useWorkspace.setState({ selectedDir: isDir ? path : dirname(path) })
    void useWorkspace.getState().openInTerminal()
  }

  const startCreate = async (kind: 'new-file' | 'new-dir') => {
    // The inline input renders in the tree row, so an unloaded folder
    // (e.g. a pinned Quick Access dir) is revealed down the chain first.
    if (!useWorkspace.getState().nodes[path]) await ws.revealPinned(path)
    else if (!stored?.expanded) await ws.toggleNode(path)
    useTreeEditing.getState().set({ parent: path, kind })
  }

  const startRename = () => {
    // The rename input renders in the tree row, so a file the tree never
    // loaded is revealed (ancestors expanded) before editing starts.
    if (useWorkspace.getState().nodes[path]) {
      useTreeEditing.getState().set({ parent: dirname(path), kind: 'rename', path, initial: node.name })
      return
    }
    void ws
      .revealPath(path)
      .then(() => {
        const n = useWorkspace.getState().nodes[path]
        if (n) {
          useTreeEditing.getState().set({ parent: dirname(path), kind: 'rename', path, initial: n.name })
        }
      })
  }

  const items: ReactNode[] = []
  if (isDir) {
    items.push(
      item(t('tree.newFile'), () => void startCreate('new-file'), { disabled: !canCreate }),
      item(t('tree.newFolder'), () => void startCreate('new-dir'), { disabled: !canCreate }),
      <div className="menu-sep" key="s1" />,
    )
  } else {
    items.push(
      item(t('tree.open'), () => void ws.openFile(path)),
      item(t('tree.openToSide'), () => void ws.openToSide(path)),
      item(t('tree.openExternal'), () => openExternal(path)),
    )
  }
  // Copying a whole drive is not a real workflow, and pinning one to Quick
  // Access just renders a useless empty entry — drop both for drive roots.
  if (!isDriveRoot) {
    items.push(item(t('tree.copy'), () => ws.setClipboard('copy', path), { disabled: denied || missing }))
  }
  items.push(
    item(t('tree.cut'), () => ws.setClipboard('cut', path), { disabled: !canMutate }),
    item(t('tree.paste'), () => void ws.pasteInto(path), {
      disabled: !isDir || denied || !clipboard,
      hint: clipboard ? undefined : t('tree.clipboardEmpty'),
    }),
    <div className="menu-sep" key="s2" />,
    item(t('tree.rename'), () => startRename(), {
      disabled: !canMutate,
    }),
    item(t('tree.delete'), () => void del(), { disabled: !canMutate }),
  )
  if (isDir) {
    items.push(
      <div className="menu-sep" key="s3" />,
      item(t('menu.openTerminal'), terminal, { disabled: missing }),
    )
    // Drives can't be pinned (a pinned drive is just an empty row), but a
    // drive pinned before this rule still needs its unpin escape hatch.
    if (!isDriveRoot || pinnedHere) {
      items.push(
        item(
          pinnedHere ? t('tree.unpin') : t('tree.pin'),
          () =>
            pinnedHere
              ? useQuickAccess.getState().unpin(path)
              : useQuickAccess.getState().pin(path),
        ),
      )
    }
  }
  if (isNetRoot) {
    items.push(
      <div className="menu-sep" key="s4" />,
      item(t('net.remove'), () => ws.removeNetworkLocation(path)),
    )
  }

  // Keep the panel on screen.
  const left = Math.min(x, window.innerWidth - 190)
  const top = Math.min(y, window.innerHeight - items.length * 30 - 20)

  return (
    <div className="ctx-menu menu-panel" role="menu" style={{ left, top }}>
      {items}
    </div>
  )
}

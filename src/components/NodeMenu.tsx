import type { ReactNode } from 'react'
import { create } from 'zustand'
import { useWorkspace, THIS_PC, type NodeInfo } from '../store/workspace'
import { basename, dirname } from '../lib/paths'
import { useT } from '../lib/i18n'

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
 * Context menu for one file-system node, rendered fixed at the cursor. Used
 * by the file tree AND the tab strip (right-click a tab = operate on its
 * file, same menu). The node may be absent from the tree (a tab opened via
 * search into an unexpanded directory) — file ops still work on the path.
 */
export function NodeMenu({
  path,
  x,
  y,
  onClose,
}: {
  path: string
  x: number
  y: number
  onClose: () => void
}) {
  const stored = useWorkspace((s) => s.nodes[path]) as NodeInfo | undefined
  const clipboard = useWorkspace((s) => s.clipboard)
  const t = useT()
  if (path === THIS_PC) return null

  // Fall back to path-derived facts for nodes the tree never loaded.
  const node = stored ?? {
    path,
    name: basename(path),
    isDir: false,
    access: 'unknown' as const,
  }
  const ws = useWorkspace.getState()
  const isDriveRoot = /^[a-zA-Z]:[\\/]$/.test(node.path) || node.path === '/'
  const isDir = node.isDir
  const denied = node.access === 'denied'
  const canCreate = isDir && !denied
  const canMutate = !isDriveRoot && !denied

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
    if (!stored?.expanded) await ws.toggleNode(path)
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
    )
  }
  items.push(
    item(t('tree.copy'), () => ws.setClipboard('copy', path), { disabled: denied }),
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
    items.push(<div className="menu-sep" key="s3" />, item(t('menu.openTerminal'), terminal))
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

import { useWorkspace } from '../store/workspace'

export function TreeNode({ path, depth }: { path: string; depth: number }) {
  const node = useWorkspace((s) => s.nodes[path])
  const activePath = useWorkspace((s) => s.activePath)
  const toggleDir = useWorkspace((s) => s.toggleDir)
  const openFile = useWorkspace((s) => s.openFile)

  if (!node) return null

  const open = () => (node.isDir ? void toggleDir(path) : void openFile(path))

  return (
    <>
      <div
        className={`tree-row${activePath === path ? ' is-active' : ''}`}
        style={{ paddingLeft: 8 + depth * 13 }}
        onClick={open}
        title={path}
      >
        <span className={`chevron${node.isDir ? (node.expanded ? ' is-open' : '') : ' is-hidden'}`} />
        <span className={`node-name${node.isDir ? ' is-dir' : ''}`}>{node.name}</span>
        {node.loading && <span className="node-spinner">…</span>}
      </div>
      {node.isDir && node.expanded && node.children?.map((child) => <TreeNode key={child} path={child} depth={depth + 1} />)}
    </>
  )
}

export function FileTree() {
  const root = useWorkspace((s) => s.root)
  const nodes = useWorkspace((s) => s.nodes)
  if (!root) return null
  const children = nodes[root]?.children
  if (!children) return <div className="tree-empty">读取中…</div>
  if (children.length === 0) return <div className="tree-empty">空文件夹</div>
  return (
    <div className="tree">
      {children.map((child) => (
        <TreeNode key={child} path={child} depth={0} />
      ))}
    </div>
  )
}

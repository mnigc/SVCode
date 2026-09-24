import { useWorkspace, THIS_PC } from '../store/workspace'
import { NodeIcon } from './NodeIcon'

function TreeNode({ path, depth }: { path: string; depth: number }) {
  const node = useWorkspace((s) => s.nodes[path])
  const selectedDir = useWorkspace((s) => s.selectedDir)
  const activePath = useWorkspace((s) => s.activePath)
  const toggleNode = useWorkspace((s) => s.toggleNode)
  const openFile = useWorkspace((s) => s.openFile)

  if (!node) return null

  const indent = 6 + depth * 13
  const selected = node.isDir ? selectedDir === path : activePath === path
  const open = () => (node.isDir ? void toggleNode(path) : void openFile(path))

  return (
    <>
      <div
        className={`tree-row${selected ? ' is-selected' : ''}`}
        style={{ paddingLeft: indent }}
        onClick={open}
        title={node.error ? `${path}\n${node.error}` : path}
      >
        <span
          className={`chevron${node.isDir ? (node.expanded ? ' is-open' : '') : ' is-hidden'}`}
        />
        <NodeIcon spec={node.icon} />
        <span className={`node-name${node.isDir ? ' is-dir' : ''}`}>{node.name}</span>
        {node.loading && <span className="node-spinner">…</span>}
      </div>
      {node.isDir && node.expanded && (
        <>
          {node.error && (
            <div className="tree-note" style={{ paddingLeft: indent + 25 }}>
              {node.error}
            </div>
          )}
          {node.children?.map((child) => (
            <TreeNode key={child} path={child} depth={depth + 1} />
          ))}
        </>
      )}
    </>
  )
}

export function FileTree() {
  const ready = useWorkspace((s) => Boolean(s.nodes[THIS_PC]))
  if (!ready) return <div className="tree-empty">正在枚举驱动器…</div>
  return (
    <div className="tree">
      <TreeNode path={THIS_PC} depth={0} />
    </div>
  )
}

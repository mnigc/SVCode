import { useWorkspace } from '../store/workspace'
import { scrollIntoContainer } from './scrollIntoContainer'

/**
 * Scroll one file-tree row into view. Rows carry `data-path` (see FileTree);
 * a missing row is harmless — e.g. the path is hidden by the 显示隐藏文件
 * filter or the tree hasn't rendered it yet.
 *
 * Scroll the nearest actually-scrollable ancestor only (up to `.app`) — the
 * native scrollIntoView would also drag `overflow: hidden` containers like
 * `.app` itself, shifting the whole app out of the window.
 */
export function scrollTreeRow(path: string) {
  const row = [...document.querySelectorAll('.tree-row')].find(
    (el) => (el as HTMLElement).dataset.path === path,
  )
  if (!row) return
  let scroller: HTMLElement | null = row.parentElement
  while (scroller && !scroller.classList.contains('app')) {
    if (
      scroller.scrollHeight > scroller.clientHeight + 1 ||
      scroller.scrollWidth > scroller.clientWidth + 1
    ) {
      scrollIntoContainer(row, scroller, { block: 'center' })
      return
    }
    scroller = scroller.parentElement
  }
}

/**
 * Locate `path` in the tree: expand its ancestor chain (expand-only —
 * re-reveals never fold the tree back up), then bring the row into view.
 * Used by tab clicks and search-result reveals.
 */
export async function revealInTree(path: string) {
  await useWorkspace.getState().revealPath(path)
  scrollTreeRow(path)
}

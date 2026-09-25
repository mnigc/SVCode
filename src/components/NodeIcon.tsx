import { glyphs, resolveSpec } from '../lib/fileIcons'

/**
 * Synchronous built-in SVG icon for a tree row or tab. `expanded` only
 * affects folders (open vs closed glyph). Glyphs carry their own
 * fill/stroke; `color` tints the silhouette via currentColor.
 */
export function NodeIcon({
  spec,
  size = 16,
  expanded = false,
}: {
  spec: string
  size?: number
  expanded?: boolean
}) {
  const { glyph, color } = resolveSpec(spec, expanded)
  return (
    <svg
      className="node-icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      style={{ color }}
      aria-hidden
    >
      {glyphs[glyph]}
    </svg>
  )
}

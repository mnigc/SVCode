import { RangeSetBuilder } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { ViewPlugin, Decoration, WidgetType, hoverTooltip } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view'

/**
 * CSS color preview for stylesheets and markup with style blocks: hover a
 * `#rgb` / `#rrggbb[aa]` / `rgb[a](…)` / `hsl[a](…)` token and a tooltip
 * shows the color as a swatch, and an always-visible inline swatch widget
 * follows every color token (VS Code color-decorator style). Pure frontend
 * pattern-matching — no language services involved.
 */

const COLOR_RE = new RegExp(
  [
    '#[0-9a-fA-F]{3}\\b',
    '#[0-9a-fA-F]{4}\\b',
    '#[0-9a-fA-F]{6}\\b',
    '#[0-9a-fA-F]{8}\\b',
    'rgba?\\([^)]*\\)',
    'hsla?\\([^)]*\\)',
  ].join('|'),
  'g',
)

const COLOR_EXT = new Set(['css', 'less', 'scss', 'html', 'htm', 'vue', 'svg'])

/** Files whose color values get swatches. */
export function colorTools(extKey: string): Extension[] {
  return COLOR_EXT.has(extKey) ? [colorHover, colorSwatches] : []
}

function parseColor(value: string): string | null {
  // Named colors would need a table; anything the browser can't parse
  // (e.g. `rgb(1 2`) while typing stays inert.
  return CSS.supports('color', value) ? value : null
}

const colorHover = hoverTooltip(
  (view, pos) => {
    const line = view.state.doc.lineAt(pos)
    const col = pos - line.from
    COLOR_RE.lastIndex = 0
    for (let m = COLOR_RE.exec(line.text); m; m = COLOR_RE.exec(line.text)) {
      if (m.index <= col && col <= m.index + m[0].length) {
        const color = parseColor(m[0])
        if (!color) return null
        const from = line.from + m.index
        return {
          pos: from,
          end: from + m[0].length,
          above: true,
          create() {
            const dom = document.createElement('div')
            dom.className = 'sv-color-tip'
            const swatch = document.createElement('span')
            swatch.className = 'sv-color-swatch'
            swatch.style.background = color
            const text = document.createElement('code')
            text.textContent = m[0]
            dom.append(swatch, text)
            return { dom }
          },
        }
      }
    }
    return null
  },
  // Visual aid, not documentation — show quickly.
  { hoverTime: 200 },
)

class SwatchWidget extends WidgetType {
  constructor(readonly color: string) {
    super()
  }
  eq(other: SwatchWidget) {
    return other.color === this.color
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'sv-color-inline'
    span.style.background = this.color
    return span
  }
  ignoreEvent() {
    return true
  }
}

function buildSwatches(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      COLOR_RE.lastIndex = 0
      for (let m = COLOR_RE.exec(line.text); m; m = COLOR_RE.exec(line.text)) {
        if (!parseColor(m[0])) continue
        // Zero-length range AFTER the token — a non-empty widget range would
        // REPLACE the token text with the swatch (CM semantics).
        const at = line.from + m.index + m[0].length
        builder.add(at, at, Decoration.widget({ widget: new SwatchWidget(m[0]), side: 1 }))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

/** In-flow swatch right after each color token; sits inside the text line,
 * so it shifts the rest of the line by its width (same as VS Code). */
const colorSwatches = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildSwatches(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildSwatches(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

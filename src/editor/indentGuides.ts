import { RangeSetBuilder } from '@codemirror/state'
import { indentUnit } from '@codemirror/language'
import { ViewPlugin, Decoration, WidgetType } from '@codemirror/view'
import type { DecorationSet } from '@codemirror/view'
import type { EditorView, PluginValue, ViewUpdate } from '@codemirror/view'

/**
 * Indent guides: a vertical hairline at every indent level that has content
 * beneath it, drawn through each line's leading whitespace (VS Code-style).
 *
 * Implementation: for each visible line, one absolutely-positioned 1px widget
 * per guide column. The widget is out of flow (no layout shift), anchored to
 * the line via `.cm-line { position: relative }` in the theme, and paints
 * above the line background (active-line tint) but below text (z-index: -1).
 * Monospace assumption: column → px via defaultCharacterWidth, tabs expanded
 * by tabSize.
 */

class GuideWidget extends WidgetType {
  constructor(readonly x: number) {
    super()
  }
  eq(other: GuideWidget) {
    return other.x === this.x
  }
  toDOM() {
    const span = document.createElement('span')
    span.className = 'cm-indent-guide'
    span.style.left = `${this.x}px`
    return span
  }
  // Out-of-flow absolute element; no text is "contained".
  ignoreEvent() {
    return true
  }
}

function buildGuides(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const unit = view.state.facet(indentUnit)
  const unitCols = unit.split('').reduce((cols, ch) => {
    if (ch === '\t') return cols + view.state.tabSize - (cols % view.state.tabSize)
    return cols + 1
  }, 0)
  if (unitCols <= 0) return builder.finish()
  const charW = view.defaultCharacterWidth
  const guide = (level: number) =>
    Decoration.widget({ widget: new GuideWidget(level * unitCols * charW), side: -1 })
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = view.state.doc.lineAt(pos)
      const ws = /^[\t ]+/.exec(line.text)
      if (ws) {
        let cols = 0
        for (const ch of ws[0]) {
          if (ch === '\t') cols += view.state.tabSize - (cols % view.state.tabSize)
          else cols += 1
        }
        // One guide per PARENT level: an indent of k units draws k-1 lines
        // (at 1u … (k-1)u) — the deepest level is the text's own column.
        const levels = Math.floor(cols / unitCols)
        for (let level = 1; level < levels; level++) builder.add(line.from, line.from, guide(level))
      }
      pos = line.to + 1
    }
  }
  return builder.finish()
}

export const indentGuides = ViewPlugin.fromClass(
  class implements PluginValue {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildGuides(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildGuides(update.view)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
)

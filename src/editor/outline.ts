import { EditorSelection, EditorState, Facet, StateEffect, StateField } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { EditorView, showPanel } from '@codemirror/view'
import type { Panel } from '@codemirror/view'
import { t } from '../lib/i18n'

/**
 * Document outline: a bottom panel listing symbols (functions/classes/
 * headings) extracted from the syntax tree, with a filter box. Ctrl+Shift+O
 * toggles it; clicking a symbol jumps there. Only languages whose grammar
 * exposes stable node names for declarations are mapped (verified against
 * the installed @lezer packages by parsing samples); other languages report
 * "no symbols" rather than guessing.
 */

export type SymbolKind = 'function' | 'class' | 'type' | 'heading'

interface OutlineSymbol {
  name: string
  kind: SymbolKind
  pos: number
  level?: number
}

const JS_EXT = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx']
const CPP_EXT = ['c', 'h', 'cpp', 'hpp', 'cc', 'hh']

/** Per-extension declaration node names. Kind drives the row badge. */
const SYMBOL_NODES: Record<string, Record<string, SymbolKind>> = {}
for (const e of JS_EXT) {
  SYMBOL_NODES[e] = {
    FunctionDeclaration: 'function',
    ClassDeclaration: 'class',
    MethodDeclaration: 'function',
  }
}
for (const e of CPP_EXT) {
  SYMBOL_NODES[e] = {
    FunctionDefinition: 'function',
    ClassSpecifier: 'class',
    StructSpecifier: 'type',
  }
}
SYMBOL_NODES.py = { FunctionDefinition: 'function', ClassDefinition: 'class' }
SYMBOL_NODES.rs = { FunctionItem: 'function', StructItem: 'type', EnumItem: 'type' }
SYMBOL_NODES.go = { FunctionDecl: 'function', MethodDecl: 'function', TypeDecl: 'type' }
SYMBOL_NODES.java = {
  ClassDeclaration: 'class',
  InterfaceDeclaration: 'class',
  MethodDeclaration: 'function',
}
// Markdown outline = headings (ATXHeading1..6, level = heading depth).
{
  const headings: Record<string, SymbolKind> = {}
  for (let i = 1; i <= 6; i++) headings[`ATXHeading${i}`] = 'heading'
  SYMBOL_NODES.md = headings
  SYMBOL_NODES.markdown = headings
  SYMBOL_NODES.mdown = headings
  SYMBOL_NODES.mkd = headings
  SYMBOL_NODES.mdx = headings
}

const KIND_LABEL: Record<SymbolKind, string> = {
  function: 'ƒ',
  class: 'C',
  type: 'T',
  heading: '#',
}

/** Declaration keywords stripped before a class/type name. */
const DECL_KEYWORDS =
  /^(?:pub(?:\s*\([^)]*\))?|pub|async|export\s+default|export|public|private|protected|internal|static|final|abstract|override|unsafe|extern|const|function|fn|func|def|fun|class|struct|enum|interface|impl|trait|type|void)\s+/
const IDENT = /[A-Za-z_$][\w$]*/
/** Keywords that may precede a `(` in ordinary code — never a name. */
const NOT_NAMES = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'return', 'typeof', 'sizeof', 'match', 'in', 'print',
  'function', 'func', 'fn', 'def', 'fun', 'class', 'struct', 'enum', 'interface', 'impl', 'trait',
])

function symbolName(text0: string, kind: SymbolKind): string {
  let text = text0
  if (kind === 'heading') return text.replace(/^#+\s*/, '').trim()
  // Names may span lines in long declarations; the identifier comes first.
  const nl = text.indexOf('\n')
  if (nl > 0) text = text.slice(0, nl)
  if (kind === 'function') {
    // Universal across the mapped grammars: the name is the identifier right
    // before the first paren group (returns types, receivers, keywords all
    // sit before it: "void start(", "func (c Config) Run(", "int main(").
    for (const m of text.matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!NOT_NAMES.has(m[1])) return m[1]
    }
  }
  let prev = ''
  while (prev !== text) {
    prev = text
    text = text.replace(DECL_KEYWORDS, '')
  }
  const m = IDENT.exec(text)
  return m ? m[0] : text.trim().slice(0, 40)
}

const MAX_SYMBOLS = 500

export function extractSymbols(state: EditorState, extKey: string): OutlineSymbol[] {
  const map = SYMBOL_NODES[extKey]
  if (!map) return []
  const docText = state.doc.toString()
  const out: OutlineSymbol[] = []
  syntaxTree(state).iterate({
    enter(node) {
      if (out.length >= MAX_SYMBOLS) return false
      const kind = map[node.name]
      if (!kind) return
      const name = symbolName(docText.slice(node.from, node.to), kind)
      if (!name) return
      out.push({
        name,
        kind,
        pos: node.from,
        level: kind === 'heading' ? Number(node.name.slice(-1)) : undefined,
      })
    },
  })
  return out
}

const setOutlinePanel = StateEffect.define<boolean>()

const outlineField = StateField.define<boolean>({
  create: () => false,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setOutlinePanel)) value = e.value
    return value
  },
  provide: (f) => showPanel.computeN([f], (state) => (state.field(f) ? [outlinePanel] : [])),
})

/** Toggle from the keymap / context menu. */
export function toggleOutline(view: EditorView): boolean {
  view.dispatch({ effects: setOutlinePanel.of(!view.state.field(outlineField, false)) })
  return true
}

function outlinePanel(view: EditorView): Panel {
  let symbols: OutlineSymbol[] = []
  let filter = ''
  const dom = document.createElement('div')
  dom.className = 'sv-outline'

  const row = document.createElement('div')
  row.className = 'sv-outline-row'
  const input = document.createElement('input')
  input.className = 'sv-outline-field'
  input.placeholder = t('outline.filter')
  const close = document.createElement('button')
  close.className = 'sv-outline-close'
  close.textContent = '✕'
  close.title = 'Esc'
  row.append(input, close)

  // Rebuilds are O(symbols) DOM churn; while the panel is open every
  // keystroke/undo step re-fired one. Debounce, but keep filter typing
  // instant (the filter rebuild only walks the already-extracted list).
  let rebuildTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleRebuild() {
    if (rebuildTimer !== null) return
    rebuildTimer = setTimeout(() => {
      rebuildTimer = null
      rebuild()
    }, 150)
  }
  function cancelScheduledRebuild() {
    if (rebuildTimer !== null) {
      clearTimeout(rebuildTimer)
      rebuildTimer = null
    }
  }

  const list = document.createElement('div')
  list.className = 'sv-outline-list'

  function rebuild() {
    list.textContent = ''
    const needle = filter.trim().toLowerCase()
    const shown = needle ? symbols.filter((s) => s.name.toLowerCase().includes(needle)) : symbols
    if (!shown.length) {
      const empty = document.createElement('div')
      empty.className = 'sv-outline-empty'
      empty.textContent = t('outline.empty')
      list.append(empty)
      return
    }
    for (const s of shown.slice(0, MAX_SYMBOLS)) {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'sv-outline-item'
      const badge = document.createElement('span')
      badge.className = `sv-outline-kind is-${s.kind}`
      badge.textContent = KIND_LABEL[s.kind]
      const name = document.createElement('span')
      name.className = 'sv-outline-name'
      name.textContent = s.name
      const line = document.createElement('span')
      line.className = 'sv-outline-line'
      line.textContent = String(view.state.doc.lineAt(s.pos).number)
      btn.append(badge, name, line)
      btn.addEventListener('click', () => {
        view.dispatch({
          selection: EditorSelection.cursor(s.pos),
          effects: EditorView.scrollIntoView(s.pos, { y: 'center' }),
        })
        view.focus()
        view.dispatch({ effects: setOutlinePanel.of(false) })
      })
      list.append(btn)
    }
  }

  function refreshSymbols(immediate = false) {
    const base = view.state.facet(outlineExtKey)
    symbols = extractSymbols(view.state, base)
    if (immediate) {
      cancelScheduledRebuild()
      rebuild()
    } else {
      scheduleRebuild()
    }
  }

  input.addEventListener('input', () => {
    filter = input.value
    // Filter feedback must feel instant — rebuild right away.
    cancelScheduledRebuild()
    rebuild()
  })
  close.addEventListener('click', () => {
    view.dispatch({ effects: setOutlinePanel.of(false) })
    view.focus()
  })
  // The close button is titled "Esc" — honor it (skip during IME composition).
  dom.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || e.isComposing) return
    e.preventDefault()
    view.dispatch({ effects: setOutlinePanel.of(false) })
    view.focus()
  })

  return {
    dom,
    top: false,
    mount() {
      refreshSymbols(true)
      input.focus()
    },
    update(update) {
      if (update.docChanged || update.transactions.some((tr) => tr.reconfigured)) refreshSymbols()
    },
    destroy() {
      cancelScheduledRebuild()
    },
  }
}

/** Marker facet so the panel knows which extension key the current state
 * was built for (the extractor is keyed by file extension). */
const outlineExtKey = Facet.define<string, string>({
  combine: (values) => values[values.length - 1] ?? '',
})

export function outline(key: string): Extension {
  return [outlineField, outlineExtKey.of(key)]
}

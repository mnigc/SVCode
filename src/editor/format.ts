import { EditorSelection } from '@codemirror/state'
import { indentRange } from '@codemirror/language'
import type { EditorView } from '@codemirror/view'
import type { Plugin } from 'prettier'
import { useSettings } from '../lib/settings'
import { useWorkspace } from '../store/workspace'
import { t } from '../lib/i18n'
import { ext } from './langs'

/**
 * Formatting — whole document (Shift-Alt-F) or the primary selection
 * (editor context menu). Prettier's standalone build covers the web-formatable
 * languages (JS/TS family, JSON, CSS family, HTML/Vue, Markdown, YAML) and is
 * pulled in lazily — standalone + the seven plugins only download the first
 * time a file is formatted. Everything else falls back to re-indenting from
 * the syntax tree, which works wherever the loaded grammar carries
 * indentation info (the native CM6 packages, e.g. sql/python) and is a no-op
 * elsewhere; a no-op reports "unsupported" rather than silently doing nothing.
 */

type PluginKey = 'babel' | 'estree' | 'typescript' | 'postcss' | 'html' | 'markdown' | 'yaml'

const PLUGINS: Record<PluginKey, () => Promise<Plugin>> = {
  babel: () => import('prettier/plugins/babel'),
  estree: () => import('prettier/plugins/estree'),
  typescript: () => import('prettier/plugins/typescript'),
  postcss: () => import('prettier/plugins/postcss'),
  html: () => import('prettier/plugins/html'),
  markdown: () => import('prettier/plugins/markdown'),
  yaml: () => import('prettier/plugins/yaml'),
}

/** parser + which plugins it needs. estree is required alongside babel and
 * typescript: the JSON parsers ride on the babel plugin but print through
 * estree (verified against prettier 3 standalone — plugins must be listed
 * explicitly or format throws ConfigError). */
const PRETTIER: Record<string, { parser: string; plugins: PluginKey[] }> = {
  js: { parser: 'babel', plugins: ['babel', 'estree'] },
  jsx: { parser: 'babel', plugins: ['babel', 'estree'] },
  mjs: { parser: 'babel', plugins: ['babel', 'estree'] },
  cjs: { parser: 'babel', plugins: ['babel', 'estree'] },
  ts: { parser: 'typescript', plugins: ['typescript', 'estree'] },
  tsx: { parser: 'typescript', plugins: ['typescript', 'estree'] },
  json: { parser: 'json', plugins: ['babel', 'estree'] },
  jsonc: { parser: 'json', plugins: ['babel', 'estree'] },
  json5: { parser: 'json5', plugins: ['babel', 'estree'] },
  css: { parser: 'css', plugins: ['postcss'] },
  less: { parser: 'less', plugins: ['postcss'] },
  scss: { parser: 'scss', plugins: ['postcss'] },
  html: { parser: 'html', plugins: ['html'] },
  htm: { parser: 'html', plugins: ['html'] },
  vue: { parser: 'vue', plugins: ['html'] },
  md: { parser: 'markdown', plugins: ['markdown'] },
  markdown: { parser: 'markdown', plugins: ['markdown'] },
  mdown: { parser: 'markdown', plugins: ['markdown'] },
  mkd: { parser: 'markdown', plugins: ['markdown'] },
  yaml: { parser: 'yaml', plugins: ['yaml'] },
  yml: { parser: 'yaml', plugins: ['yaml'] },
}

let prettierPromise: Promise<typeof import('prettier/standalone')> | null = null
const pluginPromises = new Map<PluginKey, Promise<Plugin>>()

function getPrettier() {
  return (prettierPromise ??= import('prettier/standalone'))
}

function getPlugin(key: PluginKey) {
  let p = pluginPromises.get(key)
  if (!p) {
    p = PLUGINS[key]()
    pluginPromises.set(key, p)
  }
  return p
}

/** Re-indent refuses to force-parse files beyond this size — syntaxTree on a
 * multi-megabyte doc would freeze the UI for seconds. */
const REINDENT_MAX_CHARS = 1_000_000

/** Shift-Alt-F / 文件菜单 / 编辑器右键菜单入口. Returns true so the
 * keybinding counts as handled; the actual formatting is async. */
export function formatDocument(view: EditorView, path: string): boolean {
  return runFormat(view, path, undefined)
}

/** Format the primary selection; empty selection formats the whole
 * document (the context menu routes here). */
export function formatSelection(view: EditorView, path: string): boolean {
  const range = view.state.selection.main
  return runFormat(view, path, range.empty ? undefined : { from: range.from, to: range.to })
}

function runFormat(view: EditorView, path: string, range?: { from: number; to: number }): boolean {
  const state = view.state
  if (state.readOnly) {
    useWorkspace.setState({ notice: t('format.readonly') })
    return true
  }
  const spec = PRETTIER[ext(path)]
  if (spec) void prettierFormat(view, spec, range)
  else reindent(view, range)
  return true
}

async function prettierFormat(
  view: EditorView,
  spec: { parser: string; plugins: PluginKey[] },
  range?: { from: number; to: number },
) {
  try {
    const [prettier, plugins] = await Promise.all([
      getPrettier(),
      Promise.all(spec.plugins.map(getPlugin)),
    ])
    const options = {
      parser: spec.parser,
      plugins: plugins as Plugin[],
      tabWidth: useSettings.getState().tabSize,
    }

    // The chunk load (and prettier itself) can take seconds; the user keeps
    // typing meanwhile. So: capture text + cursor, format, then dispatch ONLY
    // if the view still holds exactly the captured text (and is alive). On a
    // mismatch retry ONCE against the current text — the keystroke-storm
    // debounce intent survives — then give up silently (a later explicit
    // format covers it).
    let text = view.state.doc.toString()
    for (let attempt = 0; ; attempt++) {
      // EditorView has no public "destroyed" flag; a detached DOM node is the
      // reliable signal that the view (and its host) is gone.
      if (!view.dom.isConnected) return
      if (view.state.doc.toString() !== text) {
        // Formatted a snapshot that no longer matches: re-capture and go
        // again — but only once, to avoid chasing a moving document forever.
        if (attempt > 0) return
        text = view.state.doc.toString()
        // A staled selection range is meaningless against the new text —
        // recompute it from where the selection sits now (empty → whole doc).
        range = undefined
        const sel = view.state.selection.main
        if (!sel.empty) range = { from: sel.from, to: sel.to }
        continue
      }
      if (range) {
        // Range mode: cursorOffset doesn't combine with rangeStart/rangeEnd.
        // Prettier leaves everything outside the range byte-identical, so
        // splice just the reformatted piece back in and let CM map the
        // selection through that single change.
        const formatted = await prettier.format(text, {
          ...options,
          rangeStart: range.from,
          rangeEnd: range.to,
        })
        if (formatted === text) return
        if (!view.dom.isConnected || view.state.doc.toString() !== text) {
          if (attempt > 0) return
          text = view.state.doc.toString()
          continue
        }
        const rangeLen = formatted.length - text.length + (range.to - range.from)
        view.dispatch({
          changes: {
            from: range.from,
            to: range.to,
            insert: formatted.slice(range.from, range.from + rangeLen),
          },
        })
        return
      }
      // Multi-cursor collapses to the primary cursor — one whole-document
      // replacement can only sensibly carry one position.
      const head = view.state.selection.main.head
      let formatted: string
      let cursor: number
      try {
        const res = await prettier.formatWithCursor(text, { ...options, cursorOffset: head })
        formatted = res.formatted
        cursor = Math.min(res.cursorOffset, formatted.length)
      } catch {
        // The cursor marker is injected as a comment and some parsers choke on
        // it; format without it and map the cursor by line/column instead.
        formatted = await prettier.format(text, options)
        const line = view.state.doc.lineAt(head)
        cursor = offsetForLineCol(formatted, line.number, head - line.from)
      }
      if (formatted === text) return
      if (!view.dom.isConnected || view.state.doc.toString() !== text) {
        if (attempt > 0) return
        text = view.state.doc.toString()
        continue
      }
      view.dispatch({
        changes: { from: 0, to: text.length, insert: formatted },
        selection: EditorSelection.cursor(cursor),
      })
      return
    }
  } catch (err) {
    useWorkspace.setState({ notice: t('format.failed', { msg: shortError(err) }) })
  }
}

/** Syntax-tree re-indent for languages prettier can't handle. Dispatching the
 * ChangeSet without an explicit selection lets CM map the cursor through it. */
function reindent(view: EditorView, range?: { from: number; to: number }) {
  const state = view.state
  const from = range?.from ?? 0
  const to = range?.to ?? state.doc.length
  const unsupported = () => useWorkspace.setState({ notice: t('format.unsupported') })
  if (to - from > REINDENT_MAX_CHARS) return unsupported()
  try {
    const changes = indentRange(state, from, to)
    if (changes.empty) return unsupported()
    view.dispatch({ changes })
  } catch {
    // Grammar without indentation info, or a tree that can't be produced
    unsupported()
  }
}

function offsetForLineCol(text: string, line: number, col: number): number {
  const lines = text.split('\n')
  const i = Math.min(Math.max(line - 1, 0), lines.length - 1)
  let offset = 0
  for (let j = 0; j < i; j++) offset += lines[j].length + 1
  return offset + Math.min(col, lines[i].length)
}

function shortError(err: unknown): string {
  return String(err).split('\n')[0].replace(/^(\w+Error):\s*/, '$1: ').slice(0, 120)
}

import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Editor chrome + syntax colors, all routed through the CSS variable palette
 * in theme.css so one variable set drives the app, the editor and the preview
 * (decision #5 in the README). Values are `var(...)` strings, so switching
 * dark/light repaints the editor without rebuilding any extension.
 */
export const svcodeTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--cm-editor-fg)',
      backgroundColor: 'var(--cm-editor-bg)',
      fontSize: 'var(--cm-font-size)',
    },
    '.cm-scroller': {
      fontFamily: 'var(--font-mono)',
      lineHeight: '1.65',
      userSelect: 'text',
    },
    '.cm-content': {
      caretColor: 'var(--cm-cursor)',
      padding: '12px 0',
    },
    '&.cm-focused': {
      outline: 'none',
    },
    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--cm-cursor)',
      borderLeftWidth: '2px',
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--cm-selection)',
    },
    // The editor is declared light (`dark: false` below), so CodeMirror's
    // base theme ships a light focused-selection default whose selector —
    // and specificity — beats the rule above, painting a pale lavender over
    // the dark editor the moment it's focused (i.e. whenever the user
    // selects). Mirror its exact selector so the tie breaks to the palette.
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
      backgroundColor: 'var(--cm-selection)',
    },
    '.cm-gutters': {
      backgroundColor: 'var(--cm-gutter-bg)',
      color: 'var(--cm-gutter-fg)',
      border: 'none',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--fg) 4%, transparent)',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: 'var(--fg-dim)',
    },
    '.cm-selectionMatch': {
      backgroundColor: 'color-mix(in srgb, var(--accent) 22%, transparent)',
    },
    '.cm-searchMatch': {
      backgroundColor: 'color-mix(in srgb, var(--warn) 30%, transparent)',
      outline: '1px solid color-mix(in srgb, var(--warn) 60%, transparent)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'color-mix(in srgb, var(--warn) 55%, transparent)',
    },
    '.cm-panels': {
      backgroundColor: 'var(--bg-raised)',
      color: 'var(--fg)',
      borderBottom: '1px solid var(--border)',
    },
    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--border)',
    },
    // SVCode's own search panel (src/editor/searchPanel.ts) — the default
    // .cm-panel.cm-search is replaced via the search extension's createPanel.
    '.sv-search': {
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      padding: '8px 12px',
      fontSize: '12px',
    },
    '.sv-search-row': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    '.sv-search-field': {
      font: 'inherit',
      color: 'var(--fg)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: '6px',
      padding: '4px 8px',
      width: '220px',
    },
    '.sv-search-field:focus': {
      outline: 'none',
      borderColor: 'var(--accent)',
    },
    '.sv-search-btn, .sv-search-toggle': {
      font: 'inherit',
      color: 'var(--fg-dim)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: '6px',
      padding: '4px 9px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    },
    '.sv-search-btn:hover, .sv-search-toggle:hover': {
      background: 'var(--bg-hover)',
      color: 'var(--fg)',
    },
    '.sv-search-toggle.is-active': {
      color: 'var(--accent)',
      borderColor: 'var(--accent)',
      background: 'color-mix(in srgb, var(--accent) 12%, transparent)',
    },
    '.sv-search-count': {
      color: 'var(--fg-faint)',
      // Pushes the count to the right end of the row, ahead of the ✕.
      marginLeft: 'auto',
      fontVariantNumeric: 'tabular-nums',
      whiteSpace: 'nowrap',
    },
    '.sv-search-close': {
      border: 'none',
      background: 'none',
      color: 'var(--fg-faint)',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '2px 6px',
      marginLeft: '2px',
    },
    '.sv-search-close:hover': {
      color: 'var(--fg)',
    },
    '.cm-tooltip': {
      background: 'var(--bg-raised)',
      border: '1px solid var(--border)',
      borderRadius: '8px',
      overflow: 'hidden',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      background: 'var(--bg-active)',
      color: 'var(--fg)',
    },
  },
  { dark: false },
)

/** Token colors: one variable per family, tuned per theme in theme.css. */
const highlight = HighlightStyle.define([
  { tag: t.heading, color: 'var(--accent)', fontWeight: '600' },
  { tag: t.keyword, color: 'var(--tok-key)' },
  { tag: [t.controlKeyword, t.moduleKeyword], color: 'var(--tok-key)', fontWeight: '600' },
  { tag: [t.name, t.deleted, t.character, t.macroName], color: 'var(--tok-var)' },
  { tag: [t.propertyName], color: 'var(--tok-def)' },
  { tag: [t.variableName], color: 'var(--tok-var)' },
  { tag: [t.function(t.variableName), t.labelName], color: 'var(--tok-fn)' },
  { tag: [t.color, t.constant(t.name), t.standard(t.name)], color: 'var(--tok-atom)' },
  { tag: [t.definition(t.name), t.function(t.propertyName)], color: 'var(--tok-def)' },
  { tag: t.typeName, color: 'var(--tok-type)' },
  { tag: t.className, color: 'var(--tok-type)' },
  { tag: [t.number, t.integer, t.float, t.bool, t.null], color: 'var(--tok-num)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--tok-str)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--tok-com)', fontStyle: 'italic' },
  { tag: [t.operator, t.operatorKeyword, t.punctuation, t.separator, t.bracket], color: 'var(--tok-op)' },
  { tag: [t.meta, t.annotation], color: 'var(--tok-meta)' },
  { tag: t.link, color: 'var(--md-link)', textDecoration: 'underline' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.url, color: 'var(--tok-str)' },
  { tag: t.invalid, color: 'var(--danger)' },
])

export const svcodeHighlight = syntaxHighlighting(highlight)

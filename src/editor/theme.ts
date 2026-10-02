import { EditorView } from '@codemirror/view'
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'

/**
 * Editor chrome + syntax colors, all routed through the CSS variable palette
 * in theme.css so one variable set drives the app, the editor and the preview
 * (decision #5 in the README). Values are `var(...)` strings, so switching
 * dark/light repaints the editor without rebuilding any extension.
 *
 * The `dark` flag must reflect the app's real theme (settings store →
 * `<html data-theme>`): it decides which set of base-theme defaults
 * CodeMirror ships (focused selection, tooltip colors, …). Call sites
 * re-create this extension when the theme flips.
 */
export function makeSvcodeTheme(dark: boolean) {
  return EditorView.theme(
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
    // The base theme ships a focused-selection default whose selector — and
    // specificity — beats the shorter rule above, painting its own palette
    // color over ours the moment the editor is focused (in EITHER mode —
    // this is a specificity fix, not a dark-mode patch). Mirror its exact
    // selector so the tie breaks to the palette variable.
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
    // Anchor for the out-of-flow indent-guide widgets (indentGuides.ts).
    '.cm-line': {
      position: 'relative',
    },
    '.cm-indent-guide': {
      position: 'absolute',
      top: 0,
      bottom: 0,
      width: '1px',
      pointerEvents: 'none',
      // Above the line background (active-line tint) but below the text.
      zIndex: -1,
      background: 'color-mix(in srgb, var(--border-strong) 70%, transparent)',
    },
    // CSS color-value hover swatch (colorHover.ts).
    '.sv-color-tip': {
      display: 'flex',
      alignItems: 'center',
      gap: '7px',
      padding: '6px 9px',
      fontSize: '12px',
    },
    '.sv-color-swatch': {
      display: 'inline-block',
      width: '16px',
      height: '16px',
      borderRadius: '4px',
      border: '1px solid var(--border-strong)',
      flex: '0 0 auto',
    },
    // Inline color decorator (colorHover.ts) — sits in the text line right
    // after the color token.
    '.sv-color-inline': {
      display: 'inline-block',
      width: '0.8em',
      height: '0.8em',
      borderRadius: '3px',
      border: '1px solid var(--border-strong)',
      margin: '0 1px',
      verticalAlign: 'baseline',
    },
    // Document outline bottom panel (outline.ts) — same visual family as
    // .sv-search.
    '.sv-outline': {
      display: 'flex',
      flexDirection: 'column',
      padding: '8px 12px',
      fontSize: '12px',
      maxHeight: '260px',
    },
    '.sv-outline-row': {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      paddingBottom: '6px',
    },
    '.sv-outline-field': {
      font: 'inherit',
      color: 'var(--fg)',
      background: 'var(--bg-card)',
      border: '1px solid var(--border-strong)',
      borderRadius: '6px',
      padding: '4px 8px',
      flex: 1,
    },
    '.sv-outline-field:focus': {
      outline: 'none',
      borderColor: 'var(--accent)',
    },
    '.sv-outline-close': {
      border: 'none',
      background: 'none',
      color: 'var(--fg-faint)',
      cursor: 'pointer',
      fontSize: '14px',
      padding: '2px 6px',
    },
    '.sv-outline-close:hover': {
      color: 'var(--fg)',
    },
    '.sv-outline-list': {
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      gap: '1px',
    },
    '.sv-outline-item': {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      font: 'inherit',
      color: 'var(--fg)',
      textAlign: 'left',
      background: 'none',
      border: 'none',
      borderRadius: '5px',
      padding: '3px 8px',
      cursor: 'pointer',
    },
    '.sv-outline-item:hover': {
      background: 'var(--bg-hover)',
    },
    '.sv-outline-kind': {
      flex: '0 0 18px',
      textAlign: 'center',
      fontSize: '11px',
      color: 'var(--fg-faint)',
    },
    '.sv-outline-kind.is-function': {
      color: 'var(--tok-fn)',
    },
    '.sv-outline-kind.is-class, .sv-outline-kind.is-type': {
      color: 'var(--tok-type)',
    },
    '.sv-outline-kind.is-heading': {
      color: 'var(--accent)',
    },
    '.sv-outline-name': {
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '.sv-outline-line': {
      marginLeft: 'auto',
      color: 'var(--fg-faint)',
      fontVariantNumeric: 'tabular-nums',
    },
    '.sv-outline-empty': {
      color: 'var(--fg-faint)',
      padding: '6px 8px',
    },
  },
  { dark },
  )
}

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

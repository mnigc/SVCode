import { useEffect, useRef } from 'react'
import { EditorState, Compartment } from '@codemirror/state'
import type { Extension } from '@codemirror/state'
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
  crosshairCursor,
} from '@codemirror/view'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from '@codemirror/commands'
import { searchKeymap, search, openSearchPanel, highlightSelectionMatches } from '@codemirror/search'
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  indentOnInput,
  indentUnit,
} from '@codemirror/language'
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { useWorkspace, type TabInfo } from '../store/workspace'
import { useSettings } from '../lib/settings'
import { svcodeTheme, svcodeHighlight } from '../editor/theme'
import { loadLanguage } from '../editor/langs'

/**
 * Stashed editor states per tab, so switching tabs keeps scroll position,
 * selection and undo history. Plain EditorState snapshots — the view itself
 * is a singleton. Capped LRU-ish: refreshed on access, evicted beyond 24.
 */
const stateCache = new Map<string, EditorState>()
const CACHE_MAX = 24

function stash(path: string, state: EditorState) {
  stateCache.delete(path)
  stateCache.set(path, state)
  while (stateCache.size > CACHE_MAX) {
    const oldest = stateCache.keys().next().value
    if (oldest === undefined) break
    stateCache.delete(oldest)
  }
}

const tabSizeComp = new Compartment()
const wrapComp = new Compartment()
const langComp = new Compartment()
const readOnlyComp = new Compartment()

function baseExtensions(tab: TabInfo): Extension[] {
  const s = useSettings.getState()
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    foldGutter(),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    search({ top: true }),
    EditorState.allowMultipleSelections.of(true),
    svcodeTheme,
    svcodeHighlight,
    tabSizeComp.of([EditorState.tabSize.of(s.tabSize), indentUnit.of(' '.repeat(s.tabSize))]),
    wrapComp.of(s.wordWrap ? EditorView.lineWrapping : []),
    langComp.of([]),
    readOnlyComp.of(tab.readOnly ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : []),
    keymap.of([
      { key: 'Mod-s', preventDefault: true, run: () => (void useWorkspace.getState().saveActive(), true) },
      { key: 'Mod-/', preventDefault: true, run: toggleComment },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...foldKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
  ]
}

/** Language packages load on demand; reconfigure the compartment once the
 * import settles. Returns a canceler — with multiple editor groups each
 * instance guards its own in-flight load. */
function applyLanguage(v: EditorView, path: string): () => void {
  let stale = false
  void loadLanguage(path).then((ext) => {
    if (stale) return
    try {
      v.dispatch({ effects: langComp.reconfigure(ext) })
    } catch {
      // view destroyed while the chunk was loading
    }
  })
  return () => {
    stale = true
  }
}

/** Window-broadcast scroll ratios so the md preview can mirror the editor. */
export function emitEditorScroll(path: string, ratio: number) {
  window.dispatchEvent(new CustomEvent('svcode:editorscroll', { detail: { path, ratio } }))
}

export function CodeEditor({ tab, group, active }: { tab: TabInfo; group: number; active: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const currentPath = useRef(tab.path)
  const tabRef = useRef(tab)
  tabRef.current = tab
  const groupRef = useRef(group)
  groupRef.current = group
  const activeRef = useRef(active)
  activeRef.current = active
  const cancelLang = useRef<(() => void) | null>(null)

  // One view for the component's lifetime; states swap when the tab changes.
  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: tabRef.current.text,
        extensions: [
          ...baseExtensions(tabRef.current),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return
            useWorkspace
              .getState()
              .editActive(groupRef.current, update.state.doc.toString(), update.state.doc.lines)
          }),
        ],
      }),
    })
    view.current = v
    cancelLang.current = applyLanguage(v, tabRef.current.path)

    // Scroll sync lives on scrollDOM directly: `scroll` doesn't bubble, so
    // domEventHandlers (bound below the scroller) would never see it.
    const onScroll = () => {
      const v2 = view.current
      if (!v2) return
      const el = v2.scrollDOM
      const max = el.scrollHeight - el.clientHeight
      if (max <= 0) return
      // Programmatic writes (preview → editor sync) land here too; re-broadcasting
      // them would bounce the position back and forth between the two panes.
      if (Date.now() < ignoreEditorScrollUntil) return
      emitEditorScroll(tabRef.current.path, el.scrollTop / max)
    }
    v.scrollDOM.addEventListener('scroll', onScroll, { passive: true })

    // Only the focused group's editor answers the global Ctrl+F broadcast.
    const onFind = () => {
      if (!activeRef.current) return
      v.focus()
      void Promise.resolve().then(() => openSearchPanel(v))
    }
    window.addEventListener('svcode:find', onFind)
    window.addEventListener('svcode:replace', onFind)

    return () => {
      window.removeEventListener('svcode:find', onFind)
      window.removeEventListener('svcode:replace', onFind)
      v.scrollDOM.removeEventListener('scroll', onScroll)
      cancelLang.current?.()
      stash(currentPath.current, v.state)
      v.destroy()
      view.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tab switch: stash the outgoing state, restore (or build) the incoming.
  useEffect(() => {
    const v = view.current
    if (!v) return
    if (currentPath.current !== tab.path) {
      stash(currentPath.current, v.state)
      currentPath.current = tab.path
      const cached = stateCache.get(tab.path)
      if (cached && cached.doc.toString() === tab.text) {
        v.setState(cached)
      } else {
        stateCache.delete(tab.path)
        v.setState(
          EditorState.create({
            doc: tab.text,
            extensions: baseExtensions(tab),
          }),
        )
        cancelLang.current?.()
        cancelLang.current = applyLanguage(v, tab.path)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path, tab.text, tab.readOnly])

  // Settings live-reconfigure without touching history.
  const tabSize = useSettings((s) => s.tabSize)
  const wordWrap = useSettings((s) => s.wordWrap)
  useEffect(() => {
    view.current?.dispatch({
      effects: tabSizeComp.reconfigure([
        EditorState.tabSize.of(tabSize),
        indentUnit.of(' '.repeat(tabSize)),
      ]),
    })
  }, [tabSize])
  useEffect(() => {
    document.documentElement.style.setProperty('--cm-font-size', `${useSettings.getState().fontSize}px`)
  }, [])
  useEffect(() => {
    view.current?.dispatch({ effects: wrapComp.reconfigure(wordWrap ? EditorView.lineWrapping : []) })
  }, [wordWrap])

  // Markdown preview → editor scroll mirroring.
  useEffect(() => {
    const onPreviewScroll = (e: Event) => {
      const { path, ratio } = (e as CustomEvent<{ path: string; ratio: number }>).detail
      const v = view.current
      if (!v || path !== tabRef.current.path) return
      const max = v.scrollDOM.scrollHeight - v.scrollDOM.clientHeight
      if (max > 0) {
        // Programmatic write: its own scroll event must not echo back.
        ignoreEditorScrollUntil = Date.now() + ECHO_GUARD_MS
        v.scrollDOM.scrollTop = ratio * max
      }
    }
    window.addEventListener('svcode:previewscroll', onPreviewScroll)
    return () => window.removeEventListener('svcode:previewscroll', onPreviewScroll)
  }, [])

  return <div className="code-editor" ref={host} />
}

/** How long a programmatically-scrolled pane suppresses its own echo. */
const ECHO_GUARD_MS = 150
let ignoreEditorScrollUntil = 0

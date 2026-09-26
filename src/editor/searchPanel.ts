import { EditorView, type Panel, type ViewUpdate } from '@codemirror/view'
import type { EditorState } from '@codemirror/state'
import {
  SearchQuery,
  setSearchQuery,
  getSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
  selectSelectionMatches,
  closeSearchPanel,
} from '@codemirror/search'
import { t } from '../lib/i18n'

/**
 * SVCode's own search/replace panel, handed to the `search` extension via
 * `createPanel`. Replaces CodeMirror's English-only default panel with the
 * app's i18n strings and theme. Same wiring underneath: the query lives in
 * the editor state (setSearchQuery), and the buttons drive the stock
 * find/replace commands, so searchKeymap (F3, Ctrl+H…) keeps working.
 */

/** Hard cap on counted matches — counting is O(doc) per update and the
 * number is only a hint ("999+" reads fine on a 100k-hit file). */
const COUNT_CAP = 999

/** Total matches, plus the 1-based index of the match the selection is on
 * (0 when the selection is not on a match). */
function matchStats(query: SearchQuery, state: EditorState) {
  if (!query.search) return null
  const { from, to } = state.selection.main
  let total = 0
  let current = 0
  const cursor = query.getCursor(state)
  for (let r = cursor.next(); !r.done; r = cursor.next()) {
    const m = r.value as { from: number; to: number }
    total++
    if (m.from === from && m.to === to) current = total
    if (total >= COUNT_CAP) return { total: COUNT_CAP, current, capped: true }
  }
  return { total, current, capped: false }
}

export function svcodeSearchPanel(view: EditorView): Panel {
  const restored = getSearchQuery(view.state)
  const toggleState = {
    case: restored.caseSensitive,
    regexp: restored.regexp,
    word: restored.wholeWord,
  }

  const dom = document.createElement('div')
  dom.className = 'sv-search'
  const row1 = document.createElement('div')
  row1.className = 'sv-search-row'
  const row2 = document.createElement('div')
  row2.className = 'sv-search-row'

  const searchInput = document.createElement('input')
  searchInput.className = 'sv-search-field'
  searchInput.placeholder = t('editorSearch.find')
  searchInput.spellcheck = false
  // openSearchPanel focuses [main-field=true] after mounting the panel.
  searchInput.setAttribute('main-field', 'true')

  const replaceInput = document.createElement('input')
  replaceInput.className = 'sv-search-field'
  replaceInput.placeholder = t('editorSearch.replace')
  replaceInput.spellcheck = false

  const count = document.createElement('span')
  count.className = 'sv-search-count'

  const query = () =>
    new SearchQuery({
      search: searchInput.value,
      replace: replaceInput.value,
      caseSensitive: toggleState.case,
      regexp: toggleState.regexp,
      wholeWord: toggleState.word,
    })

  const refreshCount = () => {
    const s = matchStats(query(), view.state)
    count.textContent = !s
      ? ''
      : s.capped
        ? `${COUNT_CAP}+`
        : s.current
          ? `${s.current} / ${s.total}`
          : `${s.total}`
  }

  /** Push the inputs into the editor state, then optionally run a command. */
  const apply = (run?: (v: EditorView) => void) => {
    view.dispatch({ effects: setSearchQuery.of(query()) })
    refreshCount()
    if (run && searchInput.value) run(view)
  }

  const navButton = (label: string, title: string, run: (v: EditorView) => void) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sv-search-btn'
    b.textContent = label
    b.title = title
    b.onclick = () => apply(run)
    return b
  }

  const toggleButton = (key: 'case' | 'regexp' | 'word', label: string, title: string) => {
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'sv-search-toggle' + (toggleState[key] ? ' is-active' : '')
    b.textContent = label
    b.title = title
    b.onclick = () => {
      toggleState[key] = !toggleState[key]
      b.classList.toggle('is-active', toggleState[key])
      apply()
    }
    return b
  }

  const closeButton = document.createElement('button')
  closeButton.type = 'button'
  closeButton.className = 'sv-search-close'
  closeButton.textContent = '✕'
  closeButton.title = t('editorSearch.close')
  closeButton.onclick = () => closeSearchPanel(view)

  row1.append(
    searchInput,
    toggleButton('case', 'Aa', t('editorSearch.case')),
    toggleButton('regexp', '.*', t('editorSearch.regexp')),
    toggleButton('word', 'ab', t('editorSearch.word')),
    navButton(t('editorSearch.prev'), t('editorSearch.prev'), findPrevious),
    navButton(t('editorSearch.next'), t('editorSearch.next'), findNext),
    navButton(t('editorSearch.all'), t('editorSearch.all'), selectSelectionMatches),
    count,
    closeButton,
  )
  row2.append(
    replaceInput,
    navButton(t('editorSearch.replaceOne'), t('editorSearch.replaceOne'), replaceNext),
    navButton(t('editorSearch.replaceAll'), t('editorSearch.replaceAll'), replaceAll),
  )
  dom.append(row1, row2)

  dom.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      closeSearchPanel(view)
      return
    }
    if (e.key !== 'Enter') return
    e.preventDefault()
    if (e.target === replaceInput) apply(replaceNext)
    else apply(e.shiftKey ? findPrevious : findNext)
  })
  searchInput.addEventListener('input', () => apply())
  replaceInput.addEventListener('input', () => apply())

  return {
    dom,
    top: true,
    mount: () => {
      // First open with a non-empty selection: search what the user selected
      // (single-line only — a multiline selection is not a useful query).
      const sel = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)
      if (!searchInput.value && sel && !sel.includes('\n')) {
        searchInput.value = sel
        apply()
      }
      searchInput.focus()
      searchInput.select()
      refreshCount()
    },
    update: (u: ViewUpdate) => {
      if (u.docChanged || u.selectionSet) refreshCount()
    },
  }
}

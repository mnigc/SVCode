import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

/**
 * One shared renderer. Raw HTML is neutralized by `html: false` — markdown-it
 * escapes it into visible text, so no script/iframe from a file can reach the
 * DOM (this is the CSP-era "sanitize md HTML" decision: deny by construction
 * instead of filtering after parse).
 */
const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: false,
})

md.use(taskLists, { label: true, enabled: false })

export function renderMarkdown(text: string): string {
  return md.render(text)
}

/** Slug-free heading ids are not needed; links stay external-safe. */
export function openExternalSafe(root: HTMLElement) {
  root.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('a')
    if (!a) return
    const href = a.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) {
      e.preventDefault()
      void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(href))
    } else if (href.startsWith('#')) {
      // In-page anchor: let the browser scroll the preview.
      return
    } else {
      // Relative file links are not resolved in preview — swallow to avoid
      // the webview navigating away.
      e.preventDefault()
    }
  })
}

import MarkdownIt from 'markdown-it'
import taskLists from 'markdown-it-task-lists'

/**
 * One shared renderer. Raw HTML is parsed (`html: true`) so benign markup in
 * a file (a centered logo `<div>`, an `<img>`, tables) renders instead of
 * leaking as visible text, then the output passes an allowlist sanitizer
 * before it reaches the DOM — the CSP-era "sanitize md HTML" decision, now
 * enforced after parse: unknown tags are unwrapped, script-class tags are
 * dropped with their subtree, and only a fixed attribute set survives.
 */
const md = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
})

md.use(taskLists, { label: true, enabled: false })

/** Elements that render; everything else is unwrapped (children kept). */
const ALLOWED_TAGS = new Set([
  'a', 'abbr', 'b', 'bdi', 'blockquote', 'br', 'caption', 'code', 'dd', 'del',
  'details', 'dfn', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'h1', 'h2',
  'h3', 'h4', 'h5', 'h6', 'hr', 'i', 'img', 'input', 'ins', 'kbd', 'li', 'mark',
  'ol', 'p', 'pre', 'q', 'rp', 'rt', 'ruby', 's', 'samp', 'small', 'span',
  'strike', 'strong', 'sub', 'summary', 'sup', 'table', 'tbody', 'td', 'tfoot',
  'th', 'thead', 'tr', 'u', 'ul', 'var', 'wbr',
])

/** Elements removed with their entire subtree — nothing inside is salvageable. */
const DROP_TAGS = new Set([
  'script', 'style', 'iframe', 'frame', 'frameset', 'object', 'embed',
  'applet', 'link', 'meta', 'base', 'form', 'button', 'select', 'textarea',
  'option', 'noscript', 'template', 'svg', 'math', 'audio', 'video', 'source',
  'track', 'canvas',
])

const ALLOWED_ATTRS = new Set([
  'abbr', 'align', 'alt', 'checked', 'cite', 'class', 'colspan', 'datetime',
  'dir', 'disabled', 'height', 'href', 'id', 'lang', 'loading', 'reversed',
  'rowspan', 'src', 'start', 'title', 'type', 'width',
])

/** javascript:/vbscript:/data:text-html URLs never survive; img may keep data:image. */
function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v.startsWith('javascript:') || v.startsWith('vbscript:')) return false
  if (v.startsWith('data:') && !v.startsWith('data:image/')) return false
  return true
}

function sanitizeNode(root: ParentNode) {
  for (const child of Array.from(root.children)) {
    sanitizeNode(child)
    const tag = child.tagName.toLowerCase()
    if (DROP_TAGS.has(tag)) {
      child.remove()
      continue
    }
    if (!ALLOWED_TAGS.has(tag)) {
      child.replaceWith(...child.childNodes)
      continue
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase()
      if (!ALLOWED_ATTRS.has(name)) {
        child.removeAttribute(attr.name)
        continue
      }
      if ((name === 'href' || name === 'src') && !isSafeUrl(attr.value)) {
        child.removeAttribute(attr.name)
      }
    }
  }
}

function sanitizeMarkdownHtml(html: string): string {
  const tpl = document.createElement('template')
  tpl.innerHTML = html
  sanitizeNode(tpl.content)
  return tpl.innerHTML
}

export function renderMarkdown(text: string): string {
  return sanitizeMarkdownHtml(md.render(text))
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

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

/**
 * `id` stays allow-listed on purpose: markdown-it generates no heading ids
 * itself, but the preview resolves user-written in-page anchors (`<a
 * href="#x">` → openExternalSafe's `#` branch), which need the target's id
 * from the raw HTML. What ids must NOT do is DOM-clobber — an element whose
 * id shadows a property of window/document (`id="location"`, `id="forms"`,
 * `id="name"`) replaces that global for every script in the page.
 */
function clobbersGlobal(id: string): boolean {
  return (
    Object.prototype.hasOwnProperty.call(window, id) ||
    Object.prototype.hasOwnProperty.call(document, id)
  )
}

/**
 * javascript:/vbscript:/data:text-html URLs never survive; img may keep
 * data:image. Protocol-relative URLs (`//host/x`) are rejected too: in the
 * webview they inherit the app's origin and become an un-auditable
 * cross-origin navigation target, while remote http(s) images (a feature)
 * stay allowed.
 */
function isSafeUrl(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (v.startsWith('//')) return false
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
      if (name === 'id' && clobbersGlobal(attr.value)) {
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
  // MdPreview re-runs this effect (React strict mode / remounts) on the same
  // root element; a second click listener would open the same link twice.
  if (root.dataset.extLinksBound) return
  root.dataset.extLinksBound = '1'
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

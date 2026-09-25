import { useEffect, useState } from 'react'

/**
 * Static HTML preview. The document loads inside a fully sandboxed iframe
 * (`sandbox=""` — no scripts, forms, popups, or same-origin access), so
 * untrusted markup stays inert; blob URL is revoked when the tab changes or
 * the pane unmounts. Live re-renders as the user types, same model as the
 * SVG preview.
 */
export function HtmlPreview({ text }: { text: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/html' }))
    setUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [text])

  if (!url) return null
  return <iframe className="preview-html-frame" sandbox="" title="HTML preview" src={url} />
}

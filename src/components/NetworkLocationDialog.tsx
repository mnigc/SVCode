import { useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../store/workspace'
import { useT } from '../lib/i18n'

/**
 * Modal input for mounting a `\\server\share` location under 此电脑.
 * Format validation and the reachability probe live in the workspace
 * store's addNetworkLocation — the dialog just surfaces its thrown message.
 */
export function NetworkLocationDialog({ onClose }: { onClose: () => void }) {
  const t = useT()
  const ref = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const submit = async () => {
    if (!value.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await useWorkspace.getState().addNetworkLocation(value)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setBusy(false)
    }
  }

  return (
    <div className="about-backdrop" onClick={busy ? undefined : onClose}>
      <div
        className="settings-dialog"
        role="dialog"
        aria-modal
        onClick={(e) => e.stopPropagation()}
      >
        <div className="settings-title">{t('net.title')}</div>
        <input
          ref={ref}
          className="rename-input net-input"
          value={value}
          spellCheck={false}
          placeholder={t('net.placeholder')}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') void submit()
            else if (e.key === 'Escape') onClose()
          }}
        />
        <div className={`net-hint${error ? ' is-error' : ''}`}>{error ?? t('net.hint')}</div>
        <div className="settings-actions">
          <button className="dlg-btn" onClick={onClose} disabled={busy}>
            {t('dialog.cancel')}
          </button>
          <span className="settings-spacer" />
          <button
            className="dlg-btn is-primary"
            onClick={() => void submit()}
            disabled={busy || !value.trim()}
          >
            {t('net.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

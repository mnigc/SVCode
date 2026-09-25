import { useState } from 'react'
import { openPath, revealItemInDir } from '@tauri-apps/plugin-opener'
import { TEXT_EXT_SIZE } from '../lib/paths'
import { useT, tBackend } from '../lib/i18n'
import { useWorkspace, type TabInfo } from '../store/workspace'
import { NodeIcon } from './NodeIcon'

/**
 * Card for files SVCode cannot show itself: known-binary kinds and tabs whose
 * read failed. Lists the formats that DO have a preview form and offers to
 * hand the file to the system default application (opener plugin) or reveal
 * it in the file manager. `compact` is the preview-pane variant.
 *
 * Shown in the editor pane for binary/error tabs, and in the preview pane
 * when it is manually toggled over such a tab.
 */

export function UnsupportedCard({
  tab,
  error,
  compact = false,
}: {
  tab: TabInfo
  error?: string | null
  compact?: boolean
}) {
  const t = useT()
  const [busy, setBusy] = useState<'open' | 'reveal' | null>(null)
  const isBinary = tab.kind === 'binary'
  const hasDefaultApp = isBinary || tab.kind === 'image' || tab.kind === 'pdf' || tab.kind === 'office'

  const run = async (what: 'open' | 'reveal', fn: () => Promise<void>) => {
    setBusy(what)
    try {
      await fn()
    } catch (err) {
      useWorkspace.setState({ notice: t('card.openFailed', { msg: String(err) }) })
    } finally {
      setBusy(null)
    }
  }

  const desc = error
    ? t('card.descError')
    : isBinary
      ? t('card.descBinary')
      : tab.kind === 'text'
        ? t('card.descText')
        : t('card.descShown')

  const supportedFormats = [
    { label: 'Markdown', exts: 'md markdown mdown mkd mdx' },
    { label: t('card.images'), exts: 'png jpg jpeg gif webp bmp ico avif' },
    { label: 'PDF', exts: 'pdf' },
    { label: 'Office', exts: 'docx xlsx pptx' },
    { label: t('card.text'), exts: t('card.textExts', { n: TEXT_EXT_SIZE }) },
  ]

  return (
    <div className={`unsupported${compact ? ' is-compact' : ''}`}>
      <div className="unsupported-card">
        <NodeIcon spec={tab.icon} size={compact ? 30 : 52} />
        <div className="unsupported-name" title={tab.path}>
          {tab.name}
        </div>
        {error ? (
          // tBackend at display time: tab.error was translated when stored, so
          // a mid-session language switch would otherwise leave it stale.
          <p className="unsupported-desc">{t('card.readFailed', { msg: tBackend(error) })}</p>
        ) : (
          <p className="unsupported-desc">{desc}</p>
        )}
        <div className="unsupported-formats">
          {supportedFormats.map((f) => (
            <span className="unsupported-chip" key={f.label}>
              {f.label}
              <i>{f.exts}</i>
            </span>
          ))}
        </div>
        <div className="unsupported-actions">
          {hasDefaultApp && (
            <button
              className="unsupported-btn is-primary"
              disabled={busy !== null}
              onClick={() => void run('open', () => openPath(tab.path))}
            >
              {t('card.openWith')}
            </button>
          )}
          {(isBinary || error) && (
            <button
              className="unsupported-btn"
              disabled={busy !== null}
              onClick={() => void run('reveal', () => revealItemInDir(tab.path))}
            >
              {t('card.reveal')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import logoUrl from '../assets/logo.png'
import {
  REPO_URL,
  checkForUpdate,
  installUpdate,
  resolveAppVersion,
  useUpdate,
} from '../lib/update'

interface Props {
  open: boolean
  /** Increment to open the dialog and run an update check; a plain open
   * (sequence unchanged) shows the about page. */
  checkSeq: number
  onClose: () => void
}

export function AboutDialog({ open, checkSeq, onClose }: Props) {
  const t = useT()
  const [version, setVersion] = useState('')
  /** Which half of the dialog is on screen: the static about page, or whatever
   * the updater just reported. */
  const [mode, setMode] = useState<'about' | 'check'>('about')
  const phase = useUpdate((s) => s.phase)
  const update = useUpdate((s) => s.update)
  const error = useUpdate((s) => s.error)
  const seenSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    let alive = true
    void resolveAppVersion().then((v) => {
      if (alive) setVersion(v)
    })
    if (checkSeq !== seenSeq.current) {
      seenSeq.current = checkSeq
      setMode('check')
      void checkForUpdate()
    } else {
      setMode('about')
    }
    return () => {
      alive = false
    }
  }, [open, checkSeq])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const runCheck = () => {
    setMode('check')
    void checkForUpdate()
  }

  const openUrl = (url: string) => {
    void import('@tauri-apps/plugin-opener').then((m) => m.openUrl(url))
  }

  return (
    <div className="about-backdrop" onClick={onClose}>
      <div className="about-dialog" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="about-head">
          <span className="about-logo" aria-hidden>
            <img src={logoUrl} width="38" height="38" alt="" />
          </span>
          <div>
            <div className="about-name">SVCode</div>
            {mode === 'about' && version && <div className="about-version">v{version}</div>}
          </div>
        </div>

        {mode === 'about' && (
          <>
            <p className="about-tagline">{t('about.tagline')}</p>
            <p className="about-desc">{t('about.desc')}</p>
            <ul className="about-features">
              <li>{t('about.featPreview')}</li>
              <li>{t('about.featSearch')}</li>
              <li>{t('about.featEditor')}</li>
              <li>{t('about.featMisc')}</li>
            </ul>
            <div className="about-tech">{t('about.tech')}</div>
            <div className="about-actions">
              <button className="dlg-btn" onClick={() => openUrl(REPO_URL)}>
                {t('about.github')}
              </button>
              <button className="dlg-btn is-primary" onClick={runCheck}>
                {t('about.checkUpdate')}
              </button>
            </div>
          </>
        )}

        {mode === 'check' && phase === 'checking' && (
          <div className="about-status">
            <span className="about-spinner" aria-hidden />
            <span>{t('about.checking')}</span>
          </div>
        )}

        {mode === 'check' && phase === 'uptodate' && (
          <>
            <p className="about-tagline">
              {t('about.upToDate')}
              {version && <span className="about-version"> · v{version}</span>}
            </p>
            <div className="about-actions">
              <button className="dlg-btn" onClick={runCheck}>
                {t('about.retry')}
              </button>
              <button className="dlg-btn is-primary" onClick={onClose}>
                {t('about.close')}
              </button>
            </div>
          </>
        )}

        {mode === 'check' && (phase === 'available' || phase === 'installing') && update && (
          <>
            <p className="about-tagline">
              <strong className="about-new">
                {t('about.newVersion')}: {update.version}
              </strong>
              <br />
              {t('about.currentVersion', { current: `v${version}` })}
              {update.date &&
                ' · ' + t('about.published', { date: new Date(update.date).toLocaleDateString() })}
            </p>
            {update.notes && (
              <>
                <div className="about-notes-label">{t('about.notes')}</div>
                <pre className="about-notes">{update.notes}</pre>
              </>
            )}
            {phase === 'installing' && (
              <div className="about-status">
                <span className="about-spinner" aria-hidden />
                <span>
                  {t('about.installing')}
                  {update.progress !== null &&
                    ' ' + t('about.progress', { n: Math.round(update.progress * 100) })}
                </span>
              </div>
            )}
            <div className="about-actions">
              <button className="dlg-btn" disabled={phase === 'installing'} onClick={onClose}>
                {t('about.later')}
              </button>
              <button
                className="dlg-btn is-primary"
                disabled={phase === 'installing'}
                onClick={() => void installUpdate()}
              >
                {t('about.install')}
              </button>
            </div>
            <div className="about-tech">{t('about.restartNote')}</div>
          </>
        )}

        {mode === 'check' && phase === 'error' && (
          <>
            <p className="about-tagline">
              {t('about.failed')}
              <br />
              <span className="about-error">{error}</span>
            </p>
            <div className="about-actions">
              <button className="dlg-btn" onClick={onClose}>
                {t('about.close')}
              </button>
              <button className="dlg-btn is-primary" onClick={runCheck}>
                {t('about.retry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

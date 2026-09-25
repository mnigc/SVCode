import { useEffect, useRef, useState } from 'react'
import { useT } from '../lib/i18n'
import logoUrl from '../assets/logo.png'
import {
  REPO_URL,
  fetchLatestRelease,
  isNewerVersion,
  resolveAppVersion,
  type LatestRelease,
} from '../lib/update'

type Phase = 'about' | 'checking' | 'uptodate' | 'available' | 'error'

interface Props {
  open: boolean
  /** Increment to open the dialog and run an update check; a plain open
   * (sequence unchanged) shows the about page. */
  checkSeq: number
  onClose: () => void
}

export function AboutDialog({ open, checkSeq, onClose }: Props) {
  const t = useT()
  const [phase, setPhase] = useState<Phase>('about')
  const [version, setVersion] = useState('')
  const [release, setRelease] = useState<LatestRelease | null>(null)
  const [error, setError] = useState('')
  const seenSeq = useRef(0)

  useEffect(() => {
    if (!open) return
    let alive = true
    void resolveAppVersion().then((v) => {
      if (alive) setVersion(v)
    })
    if (checkSeq !== seenSeq.current) {
      seenSeq.current = checkSeq
      void runCheck()
    } else {
      setPhase('about')
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

  const runCheck = async () => {
    setPhase('checking')
    setError('')
    try {
      const rel = await fetchLatestRelease()
      setRelease(rel)
      setPhase(isNewerVersion(rel.tag, version) ? 'available' : 'uptodate')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
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
            {phase === 'about' && version && <div className="about-version">v{version}</div>}
          </div>
        </div>

        {phase === 'about' && (
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
              <button className="dlg-btn is-primary" onClick={() => void runCheck()}>
                {t('about.checkUpdate')}
              </button>
            </div>
          </>
        )}

        {phase === 'checking' && (
          <div className="about-status">
            <span className="about-spinner" aria-hidden />
            <span>{t('about.checking')}</span>
          </div>
        )}

        {phase === 'uptodate' && (
          <>
            <p className="about-tagline">{t('about.upToDate')}</p>
            <div className="about-actions">
              <button className="dlg-btn" onClick={() => void runCheck()}>
                {t('about.retry')}
              </button>
              <button className="dlg-btn is-primary" onClick={onClose}>
                {t('about.close')}
              </button>
            </div>
          </>
        )}

        {phase === 'available' && release && (
          <>
            <p className="about-tagline">
              <strong className="about-new">{t('about.newVersion')}: {release.tag}</strong>
              <br />
              {t('about.currentVersion', { current: `v${version}` })}
              {release.publishedAt &&
                ' · ' + t('about.published', { date: new Date(release.publishedAt).toLocaleDateString() })}
            </p>
            {release.notes && (
              <>
                <div className="about-notes-label">{t('about.notes')}</div>
                <pre className="about-notes">{release.notes}</pre>
              </>
            )}
            <div className="about-actions">
              <button className="dlg-btn" onClick={onClose}>
                {t('about.later')}
              </button>
              <button className="dlg-btn is-primary" onClick={() => openUrl(release.url)}>
                {t('about.download')}
              </button>
            </div>
          </>
        )}

        {phase === 'error' && (
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
              <button className="dlg-btn is-primary" onClick={() => void runCheck()}>
                {t('about.retry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

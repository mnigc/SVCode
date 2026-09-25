import { useEffect, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import {
  useSettings,
  DEFAULT_SETTINGS,
  type LangPref,
  type ThemeName,
  type ViewPref,
} from '../lib/settings'

/**
 * The settings dialog: every user-configurable preference in one place.
 * Changes apply AND persist immediately — there is no OK/cancel.
 */

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT()
  const s = useSettings()

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  const patch = useSettings.getState().patch

  return (
    <div className="about-backdrop" onClick={onClose}>
      <div className="settings-dialog" role="dialog" aria-modal onClick={(e) => e.stopPropagation()}>
        <div className="settings-title">{t('settings.title')}</div>

        <div className="settings-scroll">
          <Section label={t('settings.appearance')}>
            <Row name={t('settings.theme')}>
              <Seg<ThemeName>
                value={s.theme}
                onChange={(v) => patch({ theme: v })}
                options={[
                  ['dark', t('theme.dark')],
                  ['light', t('theme.light')],
                  ['auto', t('theme.auto')],
                ]}
              />
            </Row>
            <Row name={t('settings.lang')}>
              <Seg<LangPref>
                value={s.lang}
                onChange={(v) => patch({ lang: v })}
                options={[
                  ['zh', t('lang.zh')],
                  ['en', t('lang.en')],
                  ['auto', t('lang.auto')],
                ]}
              />
            </Row>
          </Section>

          <Section label={t('settings.editor')}>
            <Row name={t('settings.fontSize')}>
              <Stepper
                value={s.fontSize}
                min={11}
                max={24}
                onChange={(v) => patch({ fontSize: v })}
              />
            </Row>
            <Row name={t('settings.tabSize')}>
              <Seg<string>
                value={String(s.tabSize)}
                onChange={(v) => patch({ tabSize: Number(v) })}
                options={[
                  ['2', '2'],
                  ['4', '4'],
                  ['8', '8'],
                ]}
              />
            </Row>
            <Row name={t('settings.wordWrap')} desc={t('settings.wordWrap.desc')}>
              <Switch
                on={s.wordWrap}
                label={t('settings.wordWrap')}
                onChange={(v) => patch({ wordWrap: v })}
              />
            </Row>
            <Row name={t('settings.lineNumbers')}>
              <Switch
                on={s.lineNumbers}
                label={t('settings.lineNumbers')}
                onChange={(v) => patch({ lineNumbers: v })}
              />
            </Row>
          </Section>

          <Section label={t('settings.preview')}>
            <Row name={t('settings.defaultView')} desc={t('settings.defaultView.desc')}>
              <Seg<ViewPref>
                value={s.defaultView}
                onChange={(v) => patch({ defaultView: v })}
                options={[
                  ['edit', t('viewmode.edit')],
                  ['both', t('viewmode.both')],
                  ['preview', t('viewmode.preview')],
                ]}
              />
            </Row>
          </Section>

          <Section label={t('settings.files')}>
            <Row name={t('settings.showHidden')} desc={t('settings.showHidden.desc')}>
              <Switch
                on={s.showHidden}
                label={t('settings.showHidden')}
                onChange={(v) => patch({ showHidden: v })}
              />
            </Row>
          </Section>
        </div>

        <div className="settings-actions">
          <button
            className="dlg-btn"
            onClick={() => patch(DEFAULT_SETTINGS)}
          >
            {t('settings.reset')}
          </button>
          <span className="settings-spacer" />
          <button className="dlg-btn is-primary" onClick={onClose}>
            {t('settings.done')}
          </button>
        </div>
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="settings-section">
      <div className="settings-section-label">{label}</div>
      {children}
    </section>
  )
}

function Row({ name, desc, children }: { name: string; desc?: string; children: ReactNode }) {
  return (
    <div className="set-row">
      <div className="set-row-label">
        <div className="set-row-name">{name}</div>
        {desc && <div className="set-row-desc">{desc}</div>}
      </div>
      {children}
    </div>
  )
}

function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}) {
  return (
    <div className="set-seg" role="radiogroup">
      {options.map(([v, label]) => (
        <button
          key={v}
          role="radio"
          aria-checked={v === value}
          className={`set-seg-btn${v === value ? ' is-active' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Switch({
  on,
  label,
  onChange,
}: {
  on: boolean
  label: string
  onChange: (v: boolean) => void
}) {
  return (
    <button
      className={`set-switch${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    />
  )
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="set-stepper">
      <button
        className="set-stepper-btn"
        aria-label="-"
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        −
      </button>
      <span className="set-stepper-val">{value}</span>
      <button
        className="set-stepper-btn"
        aria-label="+"
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        ＋
      </button>
    </div>
  )
}

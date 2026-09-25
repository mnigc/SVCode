import type { ReactNode } from 'react'
import { basename, extname } from './paths'

/**
 * Built-in, cross-platform SVG icon set — no per-OS shell icons, so the tree
 * looks identical everywhere. Icons are keyed by the same spec strings the
 * workspace store already carries (`<dir>`, `<file>`, `<pc>`, `path:X`,
 * `ext:x`), resolved synchronously at render time.
 *
 * Drawing style: solid colored silhouettes with white interior details
 * (badge style). Outlines are unreadable mush at 14–16px; solid shapes with
 * cut-in details stay crisp, which is how modern editor icon themes do it.
 */

export const DIR_ICON = '<dir>'
export const PC_ICON = '<pc>'
export const NET_ICON = '<net>'
export const driveIcon = (path: string) => `path:${path}`

/** Extensions that deserve a specific icon even though they carry no dot. */
const BASENAME_EXT: Record<string, string> = {
  dockerfile: 'docker',
  containerfile: 'docker',
  makefile: 'make',
  justfile: 'make',
  'cmakelists.txt': 'make',
  vagrantfile: 'make',
  procfile: 'make',
  gemfile: 'make',
  rakefile: 'make',
}

export function fileIcon(path: string): string {
  const base = basename(path).toLowerCase()
  const byBase = BASENAME_EXT[base]
  if (byBase) return `ext:${byBase}`
  const ext = extname(path)
  return ext ? `ext:${ext}` : '<file>'
}

/**
 * One accent color per file family (GitHub-linguist-inspired, tuned so the
 * white details keep contrast). Folder/special icons use CSS vars so they
 * follow the theme.
 */
const EXT_ICONS: Record<string, { glyph: GlyphId; color: string }> = {
  md: { glyph: 'md', color: '#4a9be0' },
  markdown: { glyph: 'md', color: '#4a9be0' },
  mdown: { glyph: 'md', color: '#4a9be0' },
  mkd: { glyph: 'md', color: '#4a9be0' },
  mdx: { glyph: 'md', color: '#4a9be0' },
  json: { glyph: 'braces', color: '#d0c04a' },
  jsonc: { glyph: 'braces', color: '#d0c04a' },
  json5: { glyph: 'braces', color: '#d0c04a' },
  yaml: { glyph: 'braces', color: '#c95f5f' },
  yml: { glyph: 'braces', color: '#c95f5f' },
  toml: { glyph: 'gear', color: '#98a2b3' },
  ini: { glyph: 'gear', color: '#98a2b3' },
  cfg: { glyph: 'gear', color: '#98a2b3' },
  conf: { glyph: 'gear', color: '#98a2b3' },
  env: { glyph: 'gear', color: '#98a2b3' },
  properties: { glyph: 'gear', color: '#98a2b3' },
  editorconfig: { glyph: 'gear', color: '#98a2b3' },

  html: { glyph: 'code', color: '#e07b45' },
  htm: { glyph: 'code', color: '#e07b45' },
  xml: { glyph: 'code', color: '#629bd4' },
  css: { glyph: 'code', color: '#8f6fe0' },
  scss: { glyph: 'code', color: '#d15fa4' },
  sass: { glyph: 'code', color: '#d15fa4' },
  less: { glyph: 'code', color: '#6a83d4' },

  js: { glyph: 'code', color: '#d8b93a' },
  jsx: { glyph: 'code', color: '#d8b93a' },
  mjs: { glyph: 'code', color: '#d8b93a' },
  cjs: { glyph: 'code', color: '#d8b93a' },
  ts: { glyph: 'code', color: '#3d87e0' },
  tsx: { glyph: 'code', color: '#3d87e0' },
  vue: { glyph: 'code', color: '#3aad79' },
  svelte: { glyph: 'code', color: '#e8533d' },

  rs: { glyph: 'gear', color: '#d9743f' },
  go: { glyph: 'code', color: '#38aed4' },
  py: { glyph: 'code', color: '#4f95dd' },
  java: { glyph: 'code', color: '#c9813f' },
  kt: { glyph: 'code', color: '#b573d9' },
  kts: { glyph: 'code', color: '#b573d9' },
  c: { glyph: 'code', color: '#6f83bd' },
  h: { glyph: 'code', color: '#6f83bd' },
  cpp: { glyph: 'code', color: '#6f83bd' },
  hpp: { glyph: 'code', color: '#6f83bd' },
  cc: { glyph: 'code', color: '#6f83bd' },
  hh: { glyph: 'code', color: '#6f83bd' },
  cs: { glyph: 'code', color: '#47ab6c' },
  rb: { glyph: 'code', color: '#d94b41' },
  php: { glyph: 'code', color: '#7d8ede' },
  swift: { glyph: 'code', color: '#e85c35' },
  dart: { glyph: 'code', color: '#2fb3aa' },
  lua: { glyph: 'code', color: '#5f6fd4' },
  r: { glyph: 'code', color: '#3f8ed4' },
  pl: { glyph: 'code', color: '#4d99bd' },
  pm: { glyph: 'code', color: '#4d99bd' },
  erl: { glyph: 'code', color: '#b54fa8' },
  ex: { glyph: 'code', color: '#9660cd' },
  exs: { glyph: 'code', color: '#9660cd' },
  hs: { glyph: 'code', color: '#a675d4' },
  ml: { glyph: 'code', color: '#d6823d' },
  mli: { glyph: 'code', color: '#d6823d' },
  nim: { glyph: 'code', color: '#dbb43a' },
  zig: { glyph: 'code', color: '#dd8f32' },
  tf: { glyph: 'gear', color: '#8f68d4' },
  hcl: { glyph: 'gear', color: '#8f68d4' },
  v: { glyph: 'code', color: '#7d8cd9' },
  sv: { glyph: 'code', color: '#7d8cd9' },
  svh: { glyph: 'code', color: '#7d8cd9' },
  asm: { glyph: 'code', color: '#a37547' },
  s: { glyph: 'code', color: '#a37547' },
  re: { glyph: 'code', color: '#c65a48' },

  sh: { glyph: 'terminal', color: '#6dbd54' },
  bash: { glyph: 'terminal', color: '#6dbd54' },
  zsh: { glyph: 'terminal', color: '#6dbd54' },
  fish: { glyph: 'terminal', color: '#6dbd54' },
  bat: { glyph: 'terminal', color: '#6dbd54' },
  cmd: { glyph: 'terminal', color: '#6dbd54' },
  ps1: { glyph: 'terminal', color: '#6dbd54' },

  sql: { glyph: 'database', color: '#d08f3f' },
  graphql: { glyph: 'code', color: '#d9559f' },
  gql: { glyph: 'code', color: '#d9559f' },
  proto: { glyph: 'code', color: '#47a898' },

  docker: { glyph: 'cube', color: '#4b9bd9' },
  make: { glyph: 'gear', color: '#8a76c9' },
  cmake: { glyph: 'gear', color: '#8a76c9' },
  gradle: { glyph: 'gear', color: '#8a76c9' },
  diff: { glyph: 'diff', color: '#9aa2ae' },
  patch: { glyph: 'diff', color: '#9aa2ae' },
  tex: { glyph: 'txt', color: '#63a855' },
  bib: { glyph: 'txt', color: '#63a855' },

  txt: { glyph: 'txt', color: 'var(--icon-file)' },
  log: { glyph: 'txt', color: 'var(--icon-file)' },
  csv: { glyph: 'table', color: '#4d9e63' },
  tsv: { glyph: 'table', color: '#4d9e63' },

  gitignore: { glyph: 'git', color: '#dd6d47' },
  gitattributes: { glyph: 'git', color: '#dd6d47' },
  npmrc: { glyph: 'gear', color: '#c14d4d' },
  nvmrc: { glyph: 'gear', color: '#63a855' },
  lock: { glyph: 'lock', color: '#cf9330' },

  png: { glyph: 'image', color: '#3f95d4' },
  jpg: { glyph: 'image', color: '#3f95d4' },
  jpeg: { glyph: 'image', color: '#3f95d4' },
  gif: { glyph: 'image', color: '#3f95d4' },
  webp: { glyph: 'image', color: '#3f95d4' },
  bmp: { glyph: 'image', color: '#3f95d4' },
  ico: { glyph: 'image', color: '#3f95d4' },
  avif: { glyph: 'image', color: '#3f95d4' },
  tiff: { glyph: 'image', color: '#3f95d4' },
  svg: { glyph: 'image', color: '#d99a2b' },
  pdf: { glyph: 'pdf', color: '#dd4b4b' },

  docx: { glyph: 'word', color: '#3f7fd0' },
  doc: { glyph: 'word', color: '#3f7fd0' },
  xlsx: { glyph: 'excel', color: '#2e9e5b' },
  xls: { glyph: 'excel', color: '#2e9e5b' },
  pptx: { glyph: 'ppt', color: '#d9643a' },
  ppt: { glyph: 'ppt', color: '#d9643a' },

  zip: { glyph: 'cube', color: '#cf9d3d' },
  '7z': { glyph: 'cube', color: '#cf9d3d' },
  rar: { glyph: 'cube', color: '#cf9d3d' },
  tar: { glyph: 'cube', color: '#cf9d3d' },
  gz: { glyph: 'cube', color: '#cf9d3d' },
}

export interface IconLook {
  glyph: GlyphId
  color: string
}

const FOLDER = (): IconLook => ({ glyph: 'folder', color: 'var(--icon-folder)' })
const FOLDER_OPEN = (): IconLook => ({ glyph: 'folderOpen', color: 'var(--icon-folder)' })
const FILE = (): IconLook => ({ glyph: 'file', color: 'var(--icon-file)' })

export function resolveSpec(spec: string, expanded = false): IconLook {
  if (spec === DIR_ICON) return expanded ? FOLDER_OPEN() : FOLDER()
  if (spec === PC_ICON) return { glyph: 'pc', color: 'var(--accent)' }
  if (spec === NET_ICON) return { glyph: 'network', color: 'var(--accent)' }
  if (spec.startsWith('path:')) return { glyph: 'drive', color: 'var(--accent)' }
  if (spec.startsWith('ext:')) return EXT_ICONS[spec.slice(4)] ?? FILE()
  return FILE()
}

/*
 * 16×16 glyphs. Each path carries its own fill/stroke: the main silhouette
 * uses `currentColor`, interior details are white (they sit inside the
 * silhouette, so they read on both themes).
 */

/** Page silhouette shared by file/txt/pdf. */
const PAGE =
  'M4.5 1.5h4.4l3.6 3.6v8.4a1.5 1.5 0 0 1-1.5 1.5h-6.5A1.5 1.5 0 0 1 3 13.5V3a1.5 1.5 0 0 1 1.5-1.5Z'
const PAGE_FOLD = 'M8.9 1.5v3.6h3.6c0-.4-.16-.78-.44-1.07L9.97 1.94a1.5 1.5 0 0 0-1.07-.44Z'

/** Solid gear silhouette, generated once (teeth as one closed polygon). */
const GEAR_PATH = (() => {
  const cx = 8
  const cy = 8
  const ro = 7.1
  const ri = 5.3
  const teeth = 8
  const step = (Math.PI * 2) / teeth
  const pt = (r: number, a: number) =>
    `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`
  let d = ''
  for (let i = 0; i < teeth; i++) {
    const a = i * step
    d += `${i === 0 ? 'M' : 'L'}${pt(ri, a)} `
    d += `L${pt(ro, a + step * 0.18)} L${pt(ro, a + step * 0.5)} L${pt(ri, a + step * 0.68)} `
  }
  return d + 'Z'
})()

export const glyphs = {
  file: (
    <>
      <path fill="currentColor" d={PAGE} />
      <path fill="#fff" opacity={0.4} d={PAGE_FOLD} />
    </>
  ),
  folder: (
    <path
      fill="currentColor"
      d="M1.7 4.2c0-.83.67-1.5 1.5-1.5h3.05c.42 0 .83.18 1.11.49l.99 1.11h4.75c.83 0 1.5.67 1.5 1.5v6.58c0 .83-.67 1.5-1.5 1.5H3.2a1.5 1.5 0 0 1-1.5-1.5V4.2Z"
    />
  ),
  folderOpen: (
    <>
      <path
        fill="currentColor"
        d="M1.7 4.2c0-.83.67-1.5 1.5-1.5h3.05c.42 0 .83.18 1.11.49l.99 1.11h4.75c.83 0 1.5.67 1.5 1.5v1.4H1.7V4.2Z"
      />
      <path
        fill="currentColor"
        opacity={0.55}
        d="M1.7 7h10.9c.95 0 1.62.91 1.35 1.82l-.9 3.05a1.5 1.5 0 0 1-1.44 1.08H3.2a1.5 1.5 0 0 1-1.5-1.5V7Z"
      />
    </>
  ),
  drive: (
    <>
      <rect fill="currentColor" x="1.8" y="4.2" width="12.4" height="7.6" rx="1.7" />
      <circle fill="#fff" cx="11.6" cy="9.3" r="1" />
      <rect fill="#fff" opacity={0.55} x="3.7" y="8.9" width="3.8" height="0.9" rx="0.45" />
    </>
  ),
  pc: (
    <>
      <path
        fill="currentColor"
        d="M2 3.7c0-.83.67-1.5 1.5-1.5h9c.83 0 1.5.67 1.5 1.5v5.9c0 .83-.67 1.5-1.5 1.5h-9A1.5 1.5 0 0 1 2 9.6V3.7Z"
      />
      <path fill="currentColor" d="M7.4 12.2h1.2v1.1H7.4z" />
      <rect fill="currentColor" x="5.4" y="12.9" width="5.2" height="1.4" rx="0.7" />
      <path stroke="#fff" strokeWidth="1.4" strokeLinecap="round" d="M4.9 6.6h6.2" />
    </>
  ),
  network: (
    <>
      {/* Two linked machines — reads as "network" at 14px where a globe's
          meridians turn to mush. Same solid-accent family as pc/drive. */}
      <rect fill="currentColor" x="7.4" y="2.2" width="6.8" height="4.8" rx="1.1" />
      <rect fill="#fff" opacity={0.55} x="9.2" y="5.2" width="3.2" height="0.85" rx="0.42" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        d="M10.8 7v1.6H5.7v.8"
      />
      <rect fill="currentColor" x="1.8" y="8.6" width="7.8" height="5.2" rx="1.2" />
      <rect fill="#fff" opacity={0.55} x="3.4" y="12.1" width="4.6" height="0.85" rx="0.42" />
    </>
  ),
  code: (
    <>
      <path
        fill="currentColor"
        d="M6.55 3.1 2.25 7.4a.85.85 0 0 0 0 1.2l4.3 4.3v-2.5L4.9 8.35a.5.5 0 0 1 0-.7L6.55 5.6V3.1Z"
      />
      <path
        fill="currentColor"
        d="m9.45 3.1 4.3 4.3a.85.85 0 0 1 0 1.2l-4.3 4.3v-2.5l1.65-1.65a.5.5 0 0 0 0-.7L9.45 5.6V3.1Z"
      />
    </>
  ),
  braces: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      d="M6.2 2.7c-1.7 0-1.7 1.1-1.7 2.2 0 1.5-.4 2.35-1.6 2.8v.8c1.2.45 1.6 1.3 1.6 2.8 0 1.1 0 2.2 1.7 2.2M9.8 2.7c1.7 0 1.7 1.1 1.7 2.2 0 1.5.4 2.35 1.6 2.8v.8c-1.2.45-1.6 1.3-1.6 2.8 0 1.1 0 2.2-1.7 2.2"
    />
  ),
  md: (
    <>
      <rect fill="currentColor" x="1.4" y="3.4" width="13.2" height="9.2" rx="2" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.4}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M4.1 9.9V6l2.15 2.45L8.4 6v3.9"
      />
      <path stroke="#fff" strokeWidth={1.4} strokeLinecap="round" d="M11 6v3.1" />
      <path fill="#fff" d="M11 10.9 9.4 9h3.2z" />
    </>
  ),
  pdf: (
    <>
      <path fill="currentColor" d={PAGE} />
      <path fill="#fff" opacity={0.4} d={PAGE_FOLD} />
      <path fill="none" stroke="#fff" strokeWidth={1.5} strokeLinecap="round" d="M8 6v3" />
      <path fill="#fff" d="M8 10.9 6.3 8.8h3.4z" />
    </>
  ),
  word: (
    <>
      <rect fill="currentColor" x="1.4" y="2.4" width="13.2" height="11.2" rx="2.2" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.1 5.3 1.4 5.5 2.5-4.7 2.5 4.7 1.4-5.5"
      />
    </>
  ),
  excel: (
    <>
      <rect fill="currentColor" x="1.4" y="2.4" width="13.2" height="11.2" rx="2.2" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.6}
        strokeLinecap="round"
        d="m5.2 5.4 5.6 5.7M10.8 5.4l-5.6 5.7"
      />
    </>
  ),
  ppt: (
    <>
      <rect fill="currentColor" x="1.4" y="2.4" width="13.2" height="11.2" rx="2.2" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6.3 11V5.3h2.2a2 2 0 0 1 0 4H6.3"
      />
    </>
  ),
  image: (
    <>
      <rect fill="currentColor" x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8" />
      <circle fill="#fff" cx="5.5" cy="6.1" r="1.1" />
      <path fill="#fff" d="m4.1 11.7 2.8-3.3 2 2.3 1.4-1.6 2.6 2.6H4.1Z" />
    </>
  ),
  git: (
    <>
      <circle fill="currentColor" cx="4.1" cy="3.8" r="1.5" />
      <circle fill="currentColor" cx="4.1" cy="12.2" r="1.5" />
      <circle fill="currentColor" cx="11.9" cy="3.8" r="1.5" />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        d="M4.1 5.4v5.2M11.9 5.4v1.5a2.1 2.1 0 0 1-2.1 2.1H6.4a2.3 2.3 0 0 0-2.3 2.3"
      />
    </>
  ),
  cube: (
    <>
      <path fill="currentColor" d="M8 1.6 14 4.9v6.2L8 14.4 2 11.1V4.9L8 1.6Z" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.1}
        opacity={0.55}
        strokeLinejoin="round"
        d="M2.6 5.2 8 8.1l5.4-2.9M8 8.1v5.6"
      />
    </>
  ),
  terminal: (
    <>
      <rect fill="currentColor" x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8" />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="m4.6 5.9 2.1 2.1-2.1 2.1"
      />
      <path stroke="#fff" strokeWidth={1.5} strokeLinecap="round" d="M8.7 10.3h2.9" />
    </>
  ),
  lock: (
    <>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        d="M5.7 7V5.5a2.3 2.3 0 0 1 4.6 0V7"
      />
      <rect fill="currentColor" x="3.7" y="7" width="8.6" height="6.6" rx="1.5" />
      <circle fill="#fff" cx="8" cy="10.3" r="1.05" />
    </>
  ),
  database: (
    <>
      <path
        fill="currentColor"
        d="M2.4 3.9c0-1.16 2.5-2.1 5.6-2.1s5.6.94 5.6 2.1-2.5 2.1-5.6 2.1-5.6-.94-5.6-2.1Z"
      />
      <path
        fill="currentColor"
        d="M2.4 3.9v8.2c0 1.16 2.5 2.1 5.6 2.1s5.6-.94 5.6-2.1V3.9c0 1.16-2.5 2.1-5.6 2.1S2.4 5.06 2.4 3.9Z"
      />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.2}
        opacity={0.55}
        d="M2.4 8c0 1.16 2.5 2.1 5.6 2.1s5.6-.94 5.6-2.1"
      />
    </>
  ),
  gear: (
    <>
      <path fill="currentColor" d={GEAR_PATH} />
      <circle fill="#fff" cx="8" cy="8" r="2.5" />
    </>
  ),
  table: (
    <>
      <rect fill="currentColor" x="1.8" y="2.8" width="12.4" height="10.4" rx="1.8" />
      <path stroke="#fff" strokeWidth={1.3} opacity={0.85} d="M1.8 6.2h12.4" />
      <path stroke="#fff" strokeWidth={1.3} opacity={0.85} d="M6.3 6.2v6.5M10.7 6.2v6.5" />
    </>
  ),
  txt: (
    <>
      <path fill="currentColor" d={PAGE} />
      <path fill="#fff" opacity={0.4} d={PAGE_FOLD} />
      <path
        fill="none"
        stroke="#fff"
        strokeWidth={1.3}
        strokeLinecap="round"
        opacity={0.9}
        d="M5.9 8.1h4.2M5.9 10.2h2.8"
      />
    </>
  ),
  diff: (
    <path
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      d="M5 3v4.6M2.7 5.3h4.6M11 8.4V13M8.7 10.7h4.6"
    />
  ),
} satisfies Record<string, ReactNode>

export type GlyphId = keyof typeof glyphs

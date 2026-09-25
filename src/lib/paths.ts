import { t } from './i18n'

export type FileKind =
  | 'text'
  | 'markdown'
  | 'image'
  | 'pdf'
  | 'office'
  | 'binary'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff'])
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx'])
const PDF_EXT = new Set(['pdf'])
// OOXML only; the legacy binary formats (.doc/.xls/.ppt) have no usable
// pure-JS parser and stay unhandled.
const OFFICE_EXT = new Set(['docx', 'xlsx', 'pptx'])
// Extensions known to be binary/data files: never attempt a text read, show
// the "open with default app" card instead. Unknown extensions still go
// through the text path and are caught by the NUL-byte probe.
const BINARY_EXT = new Set([
  // archives / disk images
  'zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'zst', 'iso', 'cab', 'vmdk',
  // executables / libraries / build output
  'exe', 'dll', 'sys', 'msi', 'apk', 'jar', 'class', 'so', 'dylib', 'bin', 'o', 'obj', 'a', 'lib', 'pdb',
  // legacy Office (binary formats, no JS parser — open externally)
  'doc', 'dot', 'docm', 'xls', 'xlt', 'xlsm', 'ppt', 'pot', 'pptm',
  // media
  'mp3', 'wav', 'flac', 'ogg', 'm4a', 'aac', 'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm',
  // fonts
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // databases / data / design
  'db', 'sqlite', 'sqlite3', 'dat', 'psd', 'ai', 'sketch', 'blend', 'fbx', 'glb', 'pcap',
])

// svg is treated as text so it opens editable; the preview pane renders it separately.
const TEXT_EXT = new Set([
  'txt', 'log', 'csv', 'tsv', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg',
  'conf', 'env', 'properties', 'xml', 'html', 'htm', 'css', 'scss', 'sass', 'less',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'vue', 'svelte', 'rs', 'go', 'py', 'java', 'kt',
  'kts', 'c', 'h', 'cpp', 'hpp', 'cc', 'hh', 'cs', 'rb', 'php', 'swift', 'dart', 'lua', 'r',
  'pl', 'pm', 'sh', 'bash', 'zsh', 'fish', 'bat', 'cmd', 'ps1', 'sql', 'graphql', 'gql',
  'proto', 'dockerfile', 'makefile', 'cmake', 'gradle', 'diff', 'patch', 're', 'tex', 'bib',
  'asm', 's', 'v', 'sv', 'svh', 'erl', 'ex', 'exs', 'hs', 'ml', 'mli', 'nim', 'zig', 'tf',
  'hcl', 'mdx', 'lock', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc',
])

const TEXT_BASENAMES = new Set([
  'dockerfile', 'makefile', 'gemfile', 'rakefile', 'procfile', 'vagrantfile', 'justfile',
  'cmakelists.txt', 'license', 'copying', 'readme', 'changelog', 'contributing', 'todo',
  '.gitignore', '.gitattributes', '.editorconfig', '.npmrc', '.env', '.bashrc', '.zshrc',
  '.profile', '.condarc',
])

/** Size of the text-extension whitelist, for the "supported formats" copy. */
export const TEXT_EXT_SIZE = TEXT_EXT.size

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? path : path.slice(i + 1)
}

/** Join a directory and a name respecting the path's own separator. */
export function joinPath(dir: string, name: string): string {
  if (/[/\\]$/.test(dir)) return dir + name
  return dir + (dir.includes('\\') ? '\\' : '/') + name
}

/** True for drive roots (`C:\`) and `/`. */
export const isRootPath = (path: string) => /^[a-zA-Z]:[\\/]$/.test(path) || path === '/'

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (i < 0) return ''
  // A file at a drive root lives in `C:\`, not in the drive-relative `C:`.
  if (i === 2 && /^[a-zA-Z]:[\\/]/.test(path)) return path.slice(0, 3)
  return path.slice(0, i)
}

export function extname(path: string): string {
  const base = basename(path)
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return base === '' ? '' : base.startsWith('.') ? base.slice(1).toLowerCase() : ''
  return base.slice(dot + 1).toLowerCase()
}

export function fileKind(path: string): FileKind {
  const ext = extname(path)
  const base = basename(path).toLowerCase()
  if (PDF_EXT.has(ext)) return 'pdf'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (MARKDOWN_EXT.has(ext)) return 'markdown'
  if (OFFICE_EXT.has(ext)) return 'office'
  if (BINARY_EXT.has(ext)) return 'binary'
  if (TEXT_EXT.has(ext) || TEXT_BASENAMES.has(base)) return 'text'
  // Unknown extensions are opened as text; binary content is caught by the NUL-byte probe.
  return 'text'
}

export function kindLabel(kind: FileKind): string {
  switch (kind) {
    case 'text':
      return t('kind.text')
    case 'markdown':
      return 'Markdown'
    case 'image':
      return t('kind.image')
    case 'pdf':
      return 'PDF'
    case 'office':
      return t('kind.office')
    case 'binary':
      return t('kind.binary')
  }
}

export type FileKind = 'text' | 'markdown' | 'image' | 'pdf'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'tiff'])
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdown', 'mkd', 'mdx'])
const PDF_EXT = new Set(['pdf'])

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

export function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? path : path.slice(i + 1)
}

export function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i < 0 ? '' : path.slice(0, i)
}

export function joinPath(dir: string, name: string): string {
  if (!dir) return name
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.endsWith(sep) || dir.endsWith('/') || dir.endsWith('\\') ? dir + name : dir + sep + name
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
  if (TEXT_EXT.has(ext) || TEXT_BASENAMES.has(base)) return 'text'
  // Unknown extensions are opened as text; binary content is caught by the NUL-byte probe.
  return 'text'
}

export const KIND_LABEL: Record<FileKind, string> = {
  text: '文本',
  markdown: 'Markdown',
  image: '图片',
  pdf: 'PDF',
}

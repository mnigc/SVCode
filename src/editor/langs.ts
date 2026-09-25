import type { Extension } from '@codemirror/state'
import { StreamLanguage } from '@codemirror/language'

// Legacy (CodeMirror 5 port) grammars for languages without a native CM6
// package — good-enough highlighting at zero runtime cost. One shared
// package, tree-shaken, small enough to keep in the startup bundle.
import { csharp, kotlin, dart, objectiveC } from '@codemirror/legacy-modes/mode/clike'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { powerShell } from '@codemirror/legacy-modes/mode/powershell'
import { ruby } from '@codemirror/legacy-modes/mode/ruby'
import { lua } from '@codemirror/legacy-modes/mode/lua'
import { swift } from '@codemirror/legacy-modes/mode/swift'
import { perl } from '@codemirror/legacy-modes/mode/perl'
import { erlang } from '@codemirror/legacy-modes/mode/erlang'
import { haskell } from '@codemirror/legacy-modes/mode/haskell'
import { oCaml } from '@codemirror/legacy-modes/mode/mllike'
import { r } from '@codemirror/legacy-modes/mode/r'
import { toml } from '@codemirror/legacy-modes/mode/toml'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { diff } from '@codemirror/legacy-modes/mode/diff'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { gas } from '@codemirror/legacy-modes/mode/gas'
import { cmake } from '@codemirror/legacy-modes/mode/cmake'

const LEGACY: Record<string, Extension> = {
  cs: StreamLanguage.define(csharp as never),
  kt: StreamLanguage.define(kotlin as never),
  kts: StreamLanguage.define(kotlin as never),
  dart: StreamLanguage.define(dart as never),
  m: StreamLanguage.define(objectiveC as never),
  sh: StreamLanguage.define(shell as never),
  bash: StreamLanguage.define(shell as never),
  zsh: StreamLanguage.define(shell as never),
  fish: StreamLanguage.define(shell as never),
  ps1: StreamLanguage.define(powerShell as never),
  rb: StreamLanguage.define(ruby as never),
  lua: StreamLanguage.define(lua as never),
  swift: StreamLanguage.define(swift as never),
  pl: StreamLanguage.define(perl as never),
  pm: StreamLanguage.define(perl as never),
  erl: StreamLanguage.define(erlang as never),
  hs: StreamLanguage.define(haskell as never),
  ml: StreamLanguage.define(oCaml as never),
  mli: StreamLanguage.define(oCaml as never),
  r: StreamLanguage.define(r as never),
  toml: StreamLanguage.define(toml as never),
  ini: StreamLanguage.define(properties as never),
  cfg: StreamLanguage.define(properties as never),
  conf: StreamLanguage.define(properties as never),
  env: StreamLanguage.define(properties as never),
  properties: StreamLanguage.define(properties as never),
  diff: StreamLanguage.define(diff as never),
  patch: StreamLanguage.define(diff as never),
  dockerfile: StreamLanguage.define(dockerFile as never),
  asm: StreamLanguage.define(gas as never),
  s: StreamLanguage.define(gas as never),
  cmake: StreamLanguage.define(cmake as never),
}

const ext = (path: string): string => {
  const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
  const i = base.lastIndexOf('.')
  if (i <= 0) return base.startsWith('.') ? base.slice(1).toLowerCase() : ''
  return base.slice(i + 1).toLowerCase()
}

/** One extension per file, keyed by the basename for the extension-less
 * special cases. */
const BY_BASENAME: Record<string, () => Extension> = {
  dockerfile: () => LEGACY.dockerfile,
  'cmakelists.txt': () => LEGACY.cmake,
}

// Native CM6 language packages load on demand: each dynamic import becomes
// its own chunk, fetched the first time a file of that type is opened
// instead of shipping in the startup bundle.
const jsLoader = () => import('@codemirror/lang-javascript').then((m) => m.javascript({ jsx: true }))
const tsLoader = () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true }))
const tsxLoader = () => import('@codemirror/lang-javascript').then((m) => m.javascript({ typescript: true, jsx: true }))
const cppLoader = () => import('@codemirror/lang-cpp').then((m) => m.cpp())
const htmlLoader = () => import('@codemirror/lang-html').then((m) => m.html())
const cssLoader = () => import('@codemirror/lang-css').then((m) => m.css())
const sassLoader = () => import('@codemirror/lang-sass').then((m) => m.sass())
const jsonLoader = () => import('@codemirror/lang-json').then((m) => m.json())
const mdLoader = () => import('@codemirror/lang-markdown').then((m) => m.markdown())
const yamlLoader = () => import('@codemirror/lang-yaml').then((m) => m.yaml())

const NATIVE: Record<string, () => Promise<Extension>> = {
  js: jsLoader,
  jsx: jsLoader,
  mjs: jsLoader,
  cjs: jsLoader,
  ts: tsLoader,
  tsx: tsxLoader,
  py: () => import('@codemirror/lang-python').then((m) => m.python()),
  rs: () => import('@codemirror/lang-rust').then((m) => m.rust()),
  c: cppLoader,
  h: cppLoader,
  cpp: cppLoader,
  hpp: cppLoader,
  cc: cppLoader,
  hh: cppLoader,
  java: () => import('@codemirror/lang-java').then((m) => m.java()),
  go: () => import('@codemirror/lang-go').then((m) => m.go()),
  php: () => import('@codemirror/lang-php').then((m) => m.php()),
  vue: () => import('@codemirror/lang-vue').then((m) => m.vue()),
  html: htmlLoader,
  htm: htmlLoader,
  svg: htmlLoader,
  xml: () => import('@codemirror/lang-xml').then((m) => m.xml()),
  css: cssLoader,
  less: cssLoader,
  scss: sassLoader,
  sass: sassLoader,
  json: jsonLoader,
  jsonc: jsonLoader,
  json5: jsonLoader,
  md: mdLoader,
  markdown: mdLoader,
  mdown: mdLoader,
  mkd: mdLoader,
  mdx: mdLoader,
  yaml: yamlLoader,
  yml: yamlLoader,
  sql: () => import('@codemirror/lang-sql').then((m) => m.sql()),
}

/** Resolved extension per language key, so re-opening a file type reuses the
 * loaded grammar instead of re-running the package factory. */
const resolved = new Map<string, Promise<Extension>>()

/** Load the language extension for a file path. Native packages are
 * dynamically imported once per language; legacy grammars and unknown types
 * resolve immediately. */
export function loadLanguage(path: string): Promise<Extension | []> {
  const e = ext(path)
  const loader = NATIVE[e]
  if (!loader) {
    const base = (path.replace(/\\/g, '/').split('/').pop() ?? '').toLowerCase()
    const byBase = BY_BASENAME[base]
    if (byBase) return Promise.resolve(byBase())
    return Promise.resolve(LEGACY[e] ?? [])
  }
  let p = resolved.get(e)
  if (!p) {
    p = loader()
    resolved.set(e, p)
  }
  return p
}

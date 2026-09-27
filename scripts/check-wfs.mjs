// Compares the WFSearch engine pinned in scripts/fetch-wfs.mjs against the
// newest published release, and with --apply rewrites the pins.
// Run from project root: node scripts/check-wfs.mjs [--apply]
//
// This is the version-watch half of the two-repo setup: the release build keeps
// using the pinned binary (see fetch-wfs.mjs), and an upstream bump only ever
// reaches a package after a human merges the PR this script feeds
// (.github/workflows/wfs-bump.yml runs it daily; release.yml runs it once per
// build just to report the gap). The pins are read from and written to
// fetch-wfs.mjs so there is exactly one source of truth.
//
// `protocol` in the manifest is compared but NOT trusted as a compatibility
// gate: the 0.1.0 gateway change (mandatory x-wfs-token) shipped with
// PROTOCOL_VERSION still at 1, so a protocol match proves nothing on its own.
// That is why bumps arrive as a PR instead of being auto-followed at build time.
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pinFile = join(root, 'scripts', 'fetch-wfs.mjs')
// What SVCode's client (src-tauri/src/wfs.rs) speaks today.
const EXPECTED_PROTOCOL = 1

const readPin = (name) => {
  const text = readFileSync(pinFile, 'utf8')
  const m = new RegExp(`^const ${name} = (.+)$`, 'm').exec(text)
  if (!m) throw new Error(`const ${name} not found in ${pinFile}`)
  return m[1].trim().replace(/^'|'$/g, '')
}

const versionTuple = (v) => v.replace(/^v/, '').split('.').map((n) => Number(n) || 0)

// Longer tuple wins, and a longer-but-equal-prefix version (1.0 vs 1.0.0) is
// treated as newer so a re-tag is never silently skipped.
const isNewer = (candidate, current) => {
  const a = versionTuple(candidate)
  const b = versionTuple(current)
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) > (b[i] ?? 0)) return true
    if ((a[i] ?? 0) < (b[i] ?? 0)) return false
  }
  return candidate !== current
}

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

const pinned = {
  version: readPin('VERSION'),
  sha256: readPin('SHA256'),
  size: Number(readPin('SIZE')),
  asset: readPin('ASSET'),
}
const repo = readPin('REPO')

const res = await fetch(
  `https://github.com/${repo}/releases/latest/download/latest.json`,
  { redirect: 'follow' },
)
if (!res.ok) {
  console.error(`manifest fetch failed: HTTP ${res.status} ${res.statusText}`)
  process.exit(1)
}
const manifest = await res.json()
const asset = manifest.assets?.[pinned.asset]
if (!asset?.url || !asset?.sha256 || !asset?.size) {
  console.error(`manifest has no usable ${pinned.asset} entry:`, JSON.stringify(manifest))
  process.exit(1)
}

const protocolChanged = manifest.protocol !== EXPECTED_PROTOCOL
const updateAvailable =
  isNewer(manifest.version, pinned.version) ||
  (manifest.version === pinned.version && asset.sha256 !== pinned.sha256)

let verified = null
if (updateAvailable && process.argv.includes('--apply')) {
  const before = readFileSync(pinFile, 'utf8')
  // Do not write a pin this build never checked: download and hash before
  // touching the file, so a mismatched manifest fails the PR job loudly.
  const dl = await fetch(asset.url, { redirect: 'follow' })
  if (!dl.ok) {
    console.error(`asset fetch failed: HTTP ${dl.status} ${dl.statusText}`)
    process.exit(1)
  }
  const buf = new Uint8Array(await dl.arrayBuffer())
  const digest = sha256(buf)
  if (buf.length !== asset.size || digest !== asset.sha256) {
    console.error(
      `downloaded asset does not match the manifest: ${buf.length}/${asset.size} bytes, ${digest}`,
    )
    process.exit(1)
  }
  const after = before
    .replace(/^const VERSION = .*$/m, `const VERSION = '${manifest.version}'`)
    .replace(/^const SHA256 = .*$/m, `const SHA256 = '${asset.sha256}'`)
    .replace(/^const SIZE = .*$/m, `const SIZE = ${asset.size}`)
  if (after === before) {
    console.error('no pin rewritten — nothing to apply')
    process.exit(1)
  }
  writeFileSync(pinFile, after)
  verified = { bytes: buf.length, sha256: digest }
  console.error(`rewrote ${pinFile}`)
}

const report = {
  updateAvailable,
  protocolChanged,
  upstreamProtocol: manifest.protocol ?? null,
  expectedProtocol: EXPECTED_PROTOCOL,
  releasedAt: manifest.released_at ?? null,
  pinned,
  latest: { version: manifest.version, tag: manifest.tag ?? null, ...asset },
  verified,
}
// stdout is the machine-readable half (CI reads it with jq); keep chatter on stderr.
console.log(JSON.stringify(report, null, 2))

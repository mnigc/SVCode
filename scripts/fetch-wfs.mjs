// Fetches the WFSearch engine that SVCode ships as its search sidecar.
// Run from project root: node scripts/fetch-wfs.mjs
//
// The binary is not committed (see .gitignore): the engine is a separate
// repository, and the packaged installer just embeds whatever this file drops
// into src-tauri/binaries/. CI runs it before `tauri build`, which fails
// outright when the expected externalBin is missing.
//
// The version and hash are pinned deliberately: SVCode speaks protocol v2 to
// the gateway (content search needs it) and depends on the `x-wfs-token`
// handshake, so a silently updated engine could break search in a build nobody
// reviewed. Upgrades are manual: read the release notes at
// https://github.com/mnigc/WFSearch/releases, edit the constants below, run
// this script and re-run
// `cargo test --lib -- wfs::tests --ignored` against a live engine.
//
// Behind a proxy (this project's GitHub access goes through one locally),
// Node only honours the env vars when told: NODE_USE_ENV_PROXY=1.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const VERSION = '0.2.0'
const SHA256 = '533bb1cb9da67512c7eb8c4cf78b5f38b2f9454e04f426fec7146e7fd8282942'
const SIZE = 3703296
const ASSET = 'wfs-server.exe'
const REPO = 'mnigc/WFSearch'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// Tauri appends the target triple to externalBin names when it looks for them
// next to the executable. This project is Windows-only for now.
const target = join(root, 'src-tauri', 'binaries', `wfs-server-x86_64-pc-windows-msvc.exe`)

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

let current
try {
  current = sha256(readFileSync(target))
} catch {
  current = null
}
if (current === SHA256) {
  console.log(`wfs-server ${VERSION} is already in place (${current})`)
  process.exit(0)
}

const url = `https://github.com/${REPO}/releases/download/v${VERSION}/${ASSET}`
console.log(`downloading ${url}`)
const res = await fetch(url, { redirect: 'follow' })
if (!res.ok) {
  console.error(`fetch failed: HTTP ${res.status} ${res.statusText}`)
  process.exit(1)
}
const buf = new Uint8Array(await res.arrayBuffer())
if (buf.length !== SIZE) {
  console.error(`size mismatch: got ${buf.length}, expected ${SIZE}`)
  process.exit(1)
}
const digest = sha256(buf)
if (digest !== SHA256) {
  console.error(`sha256 mismatch: got ${digest}\n` + `             want ${SHA256}`)
  process.exit(1)
}

mkdirSync(dirname(target), { recursive: true })
// Rename, not truncate-in-place: a running `tauri build` or a locked exe from
// a previous dev run then fails loudly instead of half-overwriting the sidecar.
const tmp = `${target}.download`
writeFileSync(tmp, buf)
renameSync(tmp, target)
console.log(`wrote ${target} (${VERSION}, ${digest})`)

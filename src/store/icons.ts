import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { extname } from '../lib/paths'

/** Spec strings understood by `file_icon` in src-tauri/src/icons.rs. */
export const PC_ICON = '<pc>'
export const DIR_ICON = '<dir>'
export const driveIcon = (path: string) => `path:${path}`
export const fileIcon = (path: string) => {
  const ext = extname(path)
  return ext ? `ext:${ext}` : '<file>'
}

const ICON_PX = 32
const requesting = new Set<string>()

interface IconState {
  /** icon spec -> PNG data URL, '' once Rust had no icon for the spec */
  urls: Record<string, string>
  ensure: (specs: string[]) => void
}

export const useIcons = create<IconState>((set, get) => ({
  urls: {},

  ensure: (specs) => {
    for (const spec of new Set(specs)) {
      if (spec in get().urls || requesting.has(spec)) continue
      requesting.add(spec)
      void load(spec)
        .then((url) => set((s) => ({ urls: { ...s.urls, [spec]: url } })))
        .finally(() => requesting.delete(spec))
    }
  },
}))

/**
 * Rust sends unpacked 32x32 RGBA; the canvas re-encodes it as a PNG data URL so a
 * tree row is a plain `<img>` and repeats of an extension cost nothing.
 */
async function load(spec: string): Promise<string> {
  const buffer = await invoke<ArrayBuffer>('file_icon', { key: spec })
  const pixels = new Uint8ClampedArray(buffer)
  if (pixels.byteLength !== ICON_PX * ICON_PX * 4) return ''

  const canvas = document.createElement('canvas')
  canvas.width = ICON_PX
  canvas.height = ICON_PX
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''
  ctx.putImageData(new ImageData(pixels, ICON_PX, ICON_PX), 0, 0)
  return canvas.toDataURL('image/png')
}

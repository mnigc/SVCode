/**
 * Shared zoom limits/step for the document viewers (image/pdf/office), so the
 * in-viewer handlers and the group status bar's zoom controls clamp
 * identically.
 */
export type ZoomKind = 'image' | 'pdf' | 'office'

export const ZOOM_STEP = 1.25

const LIMITS: Record<ZoomKind, [number, number]> = {
  image: [0.2, 8],
  pdf: [0.5, 4],
  office: [0.5, 4],
}

export function clampZoom(kind: ZoomKind, z: number): number {
  const [min, max] = LIMITS[kind]
  const c = Math.min(max, Math.max(min, z))
  // Snapping values within a hair of 100% back to exactly 1 keeps the label
  // and the fit math honest after repeated multiply/divide drift.
  return Math.abs(c - 1) < 0.08 ? 1 : c
}

/**
 * Web Worker: SheetJS parse of a whole workbook off the main thread.
 * XLSX.read walks every cell of every sheet — on the main thread a large
 * file freezes the entire UI for the duration; here the rest of the app
 * stays responsive while it runs.
 *
 * Output is per-sheet HTML capped at XLSX_MAX_ROWS × XLSX_MAX_COLS by
 * clamping `!ref` (sheet_to_html walks that range) — note the clamp MUST be
 * written back to the worksheet, not just computed; the pre-worker code
 * decoded the range, dropped it, and rendered huge sheets in full.
 */
import * as XLSX from 'xlsx'
import { XLSX_MAX_COLS, XLSX_MAX_ROWS } from './xlsxLimits'

interface ParsedSheet {
  name: string
  html: string
  truncated: boolean
}

self.onmessage = (e: MessageEvent<{ buf: ArrayBuffer }>) => {
  try {
    const wb = XLSX.read(new Uint8Array(e.data.buf), { type: 'array' })
    const sheets: ParsedSheet[] = wb.SheetNames.map((name) => {
      const ws = wb.Sheets[name]
      let truncated = false
      const ref = ws['!ref']
      if (ref) {
        const range = XLSX.utils.decode_range(ref)
        if (range.e.r - range.s.r + 1 > XLSX_MAX_ROWS || range.e.c - range.s.c + 1 > XLSX_MAX_COLS) {
          truncated = true
          range.e.r = Math.min(range.e.r, range.s.r + XLSX_MAX_ROWS - 1)
          range.e.c = Math.min(range.e.c, range.s.c + XLSX_MAX_COLS - 1)
          ws['!ref'] = XLSX.utils.encode_range(range)
        }
      }
      return {
        name,
        // Bare <table> markup with merged cells and formatted numbers.
        html: XLSX.utils.sheet_to_html(ws, { header: '', footer: '' }),
        truncated,
      }
    })
    ;(self as unknown as Worker).postMessage({ type: 'done', sheets })
  } catch (err) {
    ;(self as unknown as Worker).postMessage({ type: 'error', message: String(err) })
  }
}

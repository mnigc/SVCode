/**
 * Main-thread client for the xlsx parse worker (xlsxParse.worker.ts — the
 * worker imports SheetJS; this module must never pull it into the main
 * bundle). `register` hands the live Worker to the caller so it can
 * terminate early (tab closed / file switched) instead of letting a big
 * parse burn CPU for a dead view.
 */
export interface ParsedSheet {
  name: string
  html: string
  truncated: boolean
}

export function parseXlsxInWorker(
  buf: ArrayBuffer,
  register: (w: Worker | null) => void,
): Promise<ParsedSheet[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./xlsxParse.worker.ts', import.meta.url), {
      type: 'module',
    })
    register(worker)
    const finish = (fn: () => void) => {
      worker.terminate()
      register(null)
      fn()
    }
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as
        | { type: 'done'; sheets: ParsedSheet[] }
        | { type: 'error'; message: string }
      if (msg.type === 'done') finish(() => resolve(msg.sheets))
      else finish(() => reject(new Error(msg.message)))
    }
    worker.onerror = () => finish(() => reject(new Error('xlsx worker crashed')))
    worker.postMessage({ buf }, [buf])
  })
}

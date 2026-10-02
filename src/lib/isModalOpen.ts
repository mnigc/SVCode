/**
 * True while a modal dialog (role="dialog" + aria-modal) is on screen.
 * Global shortcuts that mutate viewer state (Ctrl+E focus, viewer
 * Ctrl+=/Ctrl+-/Ctrl+0 zoom) check this so a dialog never has its target
 * yanked out from under it.
 */
export function isModalOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"]')
}

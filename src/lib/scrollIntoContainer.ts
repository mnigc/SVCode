/**
 * Bring `el` into view inside ONE specific scroll container.
 *
 * The native `scrollIntoView()` scrolls every scrollable ancestor — including
 * `overflow: hidden` ones like `.app`, since programmatic scrolling ignores
 * that property. With many tabs open, activating the rightmost tab then
 * dragged the whole application layout out of the window. Scrolling the
 * container manually keeps the effect scoped.
 */
export function scrollIntoContainer(
  el: Element,
  scroller: HTMLElement,
  opts: { block?: 'nearest' | 'center' } = {},
) {
  const block = opts.block ?? 'nearest'
  const er = el.getBoundingClientRect()
  const cr = scroller.getBoundingClientRect()

  const overflowL = er.left - cr.left
  const overflowR = er.right - cr.right
  if (overflowL < 0) scroller.scrollLeft += overflowL
  else if (overflowR > 0) scroller.scrollLeft += overflowR

  const overflowT = er.top - cr.top
  const overflowB = er.bottom - cr.bottom
  if (block === 'center') {
    scroller.scrollTop += overflowT - (cr.height - er.height) / 2
  } else if (overflowT < 0) {
    scroller.scrollTop += overflowT
  } else if (overflowB > 0) {
    scroller.scrollTop += overflowB
  }
}

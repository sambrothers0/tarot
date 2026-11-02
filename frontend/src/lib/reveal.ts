// Bring an element on screen: a smooth scroll, or an instant jump for anyone who
// has asked the OS for reduced motion. `nearest` scrolls only as far as needed,
// so an element that is already fully visible doesn't move at all.
export function reveal(element: HTMLElement | null, { focus = false } = {}) {
  if (!element) return
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  element.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' })
  // Moving focus as well lets keyboard and screen-reader users land where the
  // eye went; `preventScroll` keeps it from cutting the smooth scroll short.
  if (focus) element.focus({ preventScroll: true })
}

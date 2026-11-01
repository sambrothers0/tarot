// Dates for the saved-scans list. `now` is always passed in: reading the clock
// during render is impure, so the page samples it once when the list loads.

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dayDate = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * "just now", "12 minutes ago", "3 hours ago" — then, once the day heading
 * above already says which day, just the time of day.
 */
export function timeAgo(date: Date, now: number): string {
  const ago = now - date.getTime()
  if (ago < MINUTE) return 'just now'
  if (ago < HOUR) return relative.format(-Math.floor(ago / MINUTE), 'minute')
  if (ago < 12 * HOUR) return relative.format(-Math.floor(ago / HOUR), 'hour')
  return clock.format(date)
}

export const formatFull = (date: Date) => fullDate.format(date)

const startOfDay = (t: number) => new Date(t).setHours(0, 0, 0, 0)

/** The heading a scan files under: "Today", "Yesterday", a weekday, or a date. */
export function dayHeading(date: Date, now: number): string {
  const days = Math.round((startOfDay(now) - startOfDay(date.getTime())) / DAY)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return weekday.format(date)
  return dayDate.format(date)
}

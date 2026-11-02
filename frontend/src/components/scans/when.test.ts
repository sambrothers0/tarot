import { describe, expect, it } from 'vitest'
import { dayHeading, formatFull, timeAgo } from './when'

// Runs with TZ=UTC (see vitest.config.ts), so day boundaries are fixed.

const NOW = Date.UTC(2026, 10, 2, 15, 30) // Mon 2 Nov 2026, 15:30 UTC
const ago = (ms: number) => new Date(NOW - ms)
const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

describe('timeAgo', () => {
  it('says "just now" inside a minute', () => {
    expect(timeAgo(ago(0), NOW)).toBe('just now')
    expect(timeAgo(ago(59_999), NOW)).toBe('just now')
    // A clock slightly ahead of the server's timestamp.
    expect(timeAgo(ago(-5000), NOW)).toBe('just now')
  })

  it('counts whole minutes, then whole hours', () => {
    expect(timeAgo(ago(MIN), NOW)).toBe(relative.format(-1, 'minute'))
    expect(timeAgo(ago(59 * MIN + 59_000), NOW)).toBe(relative.format(-59, 'minute'))
    expect(timeAgo(ago(HOUR), NOW)).toBe(relative.format(-1, 'hour'))
    expect(timeAgo(ago(11 * HOUR + 59 * MIN), NOW)).toBe(relative.format(-11, 'hour'))
  })

  it('falls back to the time of day from 12 hours on', () => {
    const date = ago(12 * HOUR)
    expect(timeAgo(date, NOW)).toBe(new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(date))
  })
})

describe('dayHeading', () => {
  it('files by calendar day, not by 24-hour distance', () => {
    expect(dayHeading(ago(0), NOW)).toBe('Today')
    // 00:01 today is still today, 23:59 last night is yesterday.
    expect(dayHeading(new Date(Date.UTC(2026, 10, 2, 0, 1)), NOW)).toBe('Today')
    expect(dayHeading(new Date(Date.UTC(2026, 10, 1, 23, 59)), NOW)).toBe('Yesterday')
    expect(dayHeading(new Date(Date.UTC(2026, 10, 1, 0, 0)), NOW)).toBe('Yesterday')
  })

  it('uses the weekday within the last week, then the date', () => {
    const weekday = new Intl.DateTimeFormat(undefined, { weekday: 'long' })
    const twoDays = ago(2 * DAY)
    const sixDays = ago(6 * DAY)
    expect(dayHeading(twoDays, NOW)).toBe(weekday.format(twoDays))
    expect(dayHeading(sixDays, NOW)).toBe(weekday.format(sixDays))
    const sevenDays = ago(7 * DAY)
    expect(dayHeading(sevenDays, NOW)).toBe(
      new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(sevenDays),
    )
  })

  it('treats a future date as today', () => {
    expect(dayHeading(new Date(NOW + DAY), NOW)).toBe('Today')
  })
})

describe('formatFull', () => {
  it('includes the date and time', () => {
    const out = formatFull(new Date(NOW))
    expect(out).toContain('2026')
    expect(out).toMatch(/3:30|15:30/)
  })
})

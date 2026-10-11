/**
 * The academy's calendar day (Abu Dhabi, UTC+4, no daylight saving), as YYYY-MM-DD.
 *
 * Use this — never `new Date().toISOString().slice(0, 10)`, which is the UTC day: between
 * midnight and 4 am in Abu Dhabi that is still yesterday, so an invoice issued then would
 * carry the previous day's date and "overdue" would start a day late.
 */
export function dubaiToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3600000).toISOString().slice(0, 10);
}

/** The Abu Dhabi day `days` from today (negative for the past). */
export function dubaiDatePlus(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() + 4 * 3600000 + days * 86400000).toISOString().slice(0, 10);
}

// Date helpers for the "spent on" field. Everything is plain ISO date
// strings (YYYY-MM-DD) compared lexicographically -- that's timezone-safe
// and avoids ever constructing a Date just to compare two calendar days.

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MIN_DATE = '2000-01-01';

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Today's date (or the given date) as a local calendar date, never UTC. */
export function todayISO(d: Date = new Date()): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** True when `s` is a real calendar date, not in the future, and not
 * implausibly old. */
export function isValidSpentOn(s: string, today: string): boolean {
  if (!ISO_DATE_RE.test(s)) return false;

  const [y, m, day] = s.split('-').map(Number);
  const date = new Date(y, m - 1, day);
  // Round-trip: an out-of-range day/month (e.g. Feb 30) rolls over into a
  // different date, so re-formatting it won't match the original string.
  if (todayISO(date) !== s) return false;

  if (s > today) return false;
  if (s < MIN_DATE) return false;
  return true;
}

/** Normalizes a raw date value (possibly a timestamp, possibly garbage) down
 * to a valid ISO date, or null if it can't be trusted. Never guesses at
 * ambiguous formats like "03/04/26". */
export function normalizeSpentOn(raw: string | null | undefined, today: string): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const match = /^(\d{4}-\d{2}-\d{2})(?:T.*)?$/.exec(trimmed);
  if (!match) return null;

  const datePart = match[1];
  return isValidSpentOn(datePart, today) ? datePart : null;
}

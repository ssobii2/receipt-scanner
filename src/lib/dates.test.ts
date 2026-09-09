import { describe, it, expect } from 'bun:test';
import { todayISO, isValidSpentOn, normalizeSpentOn } from './dates';

describe('todayISO', () => {
  // A purchase date is a calendar date, not an instant. Deriving it from
  // toISOString() would use UTC and land late-evening purchases on the wrong day.
  it('uses the local calendar date, not UTC', () => {
    const lateJan31 = new Date(2026, 0, 31, 23, 30, 0);
    expect(todayISO(lateJan31)).toBe('2026-01-31');
  });

  it('zero-pads month and day', () => {
    expect(todayISO(new Date(2026, 8, 5, 12, 0, 0))).toBe('2026-09-05');
  });
});

describe('isValidSpentOn', () => {
  const today = '2026-09-09';

  it('accepts a real past date and today itself', () => {
    expect(isValidSpentOn('2026-09-08', today)).toBe(true);
    expect(isValidSpentOn('2026-09-09', today)).toBe(true);
    expect(isValidSpentOn('2024-02-29', today)).toBe(true); // real leap day
  });

  it('rejects dates that are not real', () => {
    expect(isValidSpentOn('2026-02-30', today)).toBe(false);
    expect(isValidSpentOn('2026-13-01', today)).toBe(false);
    expect(isValidSpentOn('2026-00-10', today)).toBe(false);
    expect(isValidSpentOn('2025-02-29', today)).toBe(false); // 2025 is not a leap year
  });

  it('rejects the future - a receipt cannot be from tomorrow', () => {
    expect(isValidSpentOn('2026-09-10', today)).toBe(false);
    expect(isValidSpentOn('2027-01-01', today)).toBe(false);
  });

  it('rejects implausibly old dates, which signal a misread year', () => {
    expect(isValidSpentOn('1999-12-31', today)).toBe(false);
  });

  it('rejects anything that is not exactly YYYY-MM-DD', () => {
    expect(isValidSpentOn('09/09/2026', today)).toBe(false);
    expect(isValidSpentOn('2026-9-9', today)).toBe(false);
    expect(isValidSpentOn('2026-09-09T10:00:00Z', today)).toBe(false);
    expect(isValidSpentOn('', today)).toBe(false);
  });
});

describe('normalizeSpentOn', () => {
  const today = '2026-09-09';

  it('passes through a valid ISO date', () => {
    expect(normalizeSpentOn('2026-09-08', today)).toBe('2026-09-08');
  });

  it('trims a timestamp down to its date part when still valid', () => {
    expect(normalizeSpentOn('2026-09-08T14:22:00Z', today)).toBe('2026-09-08');
  });

  // Null, not a guess. 03/04/26 is March 4 or April 3 with no way to tell.
  it('returns null rather than guessing on ambiguous or missing input', () => {
    expect(normalizeSpentOn('03/04/26', today)).toBeNull();
    expect(normalizeSpentOn(null, today)).toBeNull();
    expect(normalizeSpentOn('', today)).toBeNull();
    expect(normalizeSpentOn('yesterday', today)).toBeNull();
  });

  it('returns null for a valid-looking but invalid date', () => {
    expect(normalizeSpentOn('2026-09-10', today)).toBeNull(); // future
    expect(normalizeSpentOn('2026-02-30', today)).toBeNull(); // not real
  });
});

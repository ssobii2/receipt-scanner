import { describe, it, expect } from 'bun:test';
import { monthsBack, toSeries } from './chart';

// Shape returned by MONTHLY_TOTALS.
const row = (month: string, currency: string, total_minor: number, n = 1) =>
  ({ month, currency, total_minor, n });

describe('monthsBack', () => {
  it('runs oldest first so bars read left to right', () => {
    expect(monthsBack('2026-09', 6)).toEqual([
      '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09',
    ]);
  });

  it('crosses the year boundary', () => {
    expect(monthsBack('2026-01', 3)).toEqual(['2025-11', '2025-12', '2026-01']);
  });

  it('handles a single month', () => {
    expect(monthsBack('2026-09', 1)).toEqual(['2026-09']);
  });

  it('returns nothing for a non-positive count', () => {
    expect(monthsBack('2026-09', 0)).toEqual([]);
  });
});

describe('toSeries', () => {
  it('fills months with no spending rather than omitting them', () => {
    // A missing month must still occupy its slot -- dropping it would make a
    // gap in spending look like a continuous run of months.
    const s = toSeries([row('2026-09', 'PKR', 5000), row('2026-07', 'PKR', 1000)], '2026-09', 3);
    expect(s).toHaveLength(1);
    expect(s[0]!.bars.map((b) => b.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(s[0]!.bars.map((b) => b.totalMinor)).toEqual([1000, 0, 5000]);
  });

  it('scales each bar against the biggest month in its own currency', () => {
    const s = toSeries([row('2026-09', 'PKR', 4000), row('2026-08', 'PKR', 1000)], '2026-09', 2);
    expect(s[0]!.bars.map((b) => b.fraction)).toEqual([0.25, 1]);
  });

  it('never scales one currency against another', () => {
    // 100000 PKR and 1000 USD are not comparable numbers. Each currency is
    // its own chart with its own maximum, so both peaks reach full height.
    const s = toSeries(
      [row('2026-09', 'PKR', 100000), row('2026-09', 'USD', 1000)],
      '2026-09',
      1,
    );
    expect(s).toHaveLength(2);
    for (const series of s) expect(series.bars[0]!.fraction).toBe(1);
  });

  it('puts the most-spent currency first', () => {
    // With one currency this is a no-op, which is the common case; with two
    // it keeps the chart the user cares about at the top.
    const s = toSeries(
      [row('2026-09', 'USD', 1000), row('2026-09', 'PKR', 100000)],
      '2026-09',
      1,
    );
    expect(s.map((x) => x.currency)).toEqual(['PKR', 'USD']);
  });

  it('gives every bar zero height when a currency has no spending', () => {
    // Guards the divide-by-max: an all-zero series must not produce NaN.
    const s = toSeries([row('2026-09', 'PKR', 0)], '2026-09', 2);
    expect(s[0]!.bars.map((b) => b.fraction)).toEqual([0, 0]);
    for (const b of s[0]!.bars) expect(Number.isNaN(b.fraction)).toBe(false);
  });

  it('ignores months older than the window', () => {
    const s = toSeries([row('2026-09', 'PKR', 5000), row('2025-01', 'PKR', 999999)], '2026-09', 2);
    expect(s[0]!.bars.map((b) => b.month)).toEqual(['2026-08', '2026-09']);
    expect(s[0]!.bars.map((b) => b.totalMinor)).toEqual([0, 5000]);
  });

  it('returns no series at all when there are no receipts', () => {
    expect(toSeries([], '2026-09', 6)).toEqual([]);
  });

  it('keeps totals as exact integers', () => {
    const s = toSeries([row('2026-09', 'PKR', 3)], '2026-09', 1);
    expect(s[0]!.bars[0]!.totalMinor).toBe(3);
    expect(Number.isInteger(s[0]!.bars[0]!.totalMinor)).toBe(true);
  });
});

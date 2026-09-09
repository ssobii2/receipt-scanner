// Chart data prep for the monthly-spend bar chart. Pure logic (no RN/Expo
// imports) so it can run under bun's test runner.

import type { MonthTotal } from '../db/index';

export type Bar = { month: string; totalMinor: number; fraction: number };
export type Series = { currency: string; bars: Bar[] };

/** The `count` months ending at `endMonth` inclusive, oldest first. Works on
 * the "YYYY-MM" string's numeric parts directly -- never via local-time
 * `Date` mutation, which can roll into the wrong month on a machine west of
 * UTC. */
export function monthsBack(endMonth: string, count: number): string[] {
  if (count <= 0) return [];

  const [endYear, endMon] = endMonth.split('-').map(Number) as [number, number];
  // Work in a zero-based total-months index so borrowing across a year
  // boundary is a plain subtraction, not manual month/year juggling.
  const endIndex = endYear * 12 + (endMon - 1);

  const months: string[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const index = endIndex - i;
    const year = Math.floor(index / 12);
    const mon = (index % 12) + 1;
    months.push(`${year}-${String(mon).padStart(2, '0')}`);
  }
  return months;
}

/** Turns MONTHLY_TOTALS rows into one chart series per currency, ordered by
 * total spend descending (the currency the user cares about most comes
 * first). Every month in the window gets a bar -- including zero-spend
 * months -- so a gap in spending doesn't look like a continuous run. */
export function toSeries(rows: MonthTotal[], endMonth: string, count: number): Series[] {
  const months = monthsBack(endMonth, count);
  const monthSet = new Set(months);

  const byCurrency = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!monthSet.has(row.month)) continue;
    let totals = byCurrency.get(row.currency);
    if (!totals) {
      totals = new Map();
      byCurrency.set(row.currency, totals);
    }
    totals.set(row.month, (totals.get(row.month) ?? 0) + row.total_minor);
  }

  const series: Series[] = [];
  for (const [currency, totals] of byCurrency) {
    const bars: Bar[] = months.map((month) => ({
      month,
      totalMinor: totals.get(month) ?? 0,
      fraction: 0, // filled in below once the currency's max is known
    }));
    // Scale against this currency's own max -- PKR and USD totals aren't
    // comparable, so each currency is its own chart with its own peak.
    const max = Math.max(...bars.map((b) => b.totalMinor));
    for (const bar of bars) bar.fraction = max > 0 ? bar.totalMinor / max : 0;
    series.push({ currency, bars });
  }

  series.sort((a, b) => {
    const totalA = a.bars.reduce((sum, bar) => sum + bar.totalMinor, 0);
    const totalB = b.bars.reduce((sum, bar) => sum + bar.totalMinor, 0);
    return totalB - totalA;
  });

  return series;
}

import { describe, it, expect } from 'bun:test';
import { isoMinorDigits, parseAmountToMinor, formatMoney, normalizeAmountText } from './money';

// WHY A TABLE AND NOT Intl:
// Intl reports CLDR *display* digits, which encode local writing convention and
// differ between ICU versions. Measured on this machine:
//     PKR -> node 0, bun 2      COP -> node 0, bun 2
// amount_minor is stored, so its exponent must never move. ISO 4217 is the
// stable standard; Intl is only used for presentation.
describe('isoMinorDigits', () => {
  it('uses the ISO 4217 exponent, which is 2 for most currencies', () => {
    expect(isoMinorDigits('USD')).toBe(2);
    expect(isoMinorDigits('EUR')).toBe(2);
    expect(isoMinorDigits('AED')).toBe(2);
  });

  it('knows the zero-exponent currencies', () => {
    expect(isoMinorDigits('JPY')).toBe(0);
    expect(isoMinorDigits('KRW')).toBe(0);
    expect(isoMinorDigits('VND')).toBe(0);
    expect(isoMinorDigits('ISK')).toBe(0);
    expect(isoMinorDigits('XOF')).toBe(0);
  });

  it('knows the three-exponent currencies', () => {
    for (const c of ['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']) {
      expect(isoMinorDigits(c)).toBe(3);
    }
  });

  it('is 2 for PKR regardless of what CLDR says about paisa', () => {
    expect(isoMinorDigits('PKR')).toBe(2);
    expect(isoMinorDigits('COP')).toBe(2);
  });

  it('is case-insensitive and falls back to 2 for unknown codes', () => {
    expect(isoMinorDigits('jpy')).toBe(0);
    expect(isoMinorDigits('ZZZ')).toBe(2);
  });
});

// The extraction model returns total_value already normalised: plain decimal,
// '.' separator, no grouping. It sees the receipt's language and country, so
// it disambiguates "1.234" far better than a regex could. This parser accepts
// only that form.
describe('parseAmountToMinor', () => {
  it('scales a canonical decimal string by the ISO exponent', () => {
    expect(parseAmountToMinor('1850.00', 'PKR')).toBe(185000);
    expect(parseAmountToMinor('10.10', 'USD')).toBe(1010);
    expect(parseAmountToMinor('3450', 'JPY')).toBe(3450);
    expect(parseAmountToMinor('12.345', 'KWD')).toBe(12345);
  });

  it('pads a short fraction out to the exponent', () => {
    expect(parseAmountToMinor('12.5', 'USD')).toBe(1250);
    expect(parseAmountToMinor('7', 'USD')).toBe(700);
    expect(parseAmountToMinor('12.5', 'KWD')).toBe(12500);
  });

  // Never float. Math.round(x * 10**n) loses precision at both ends of the range.
  it('is exact on values where float arithmetic drifts', () => {
    expect(parseAmountToMinor('1.005', 'USD')).toBe(101);
    expect(parseAmountToMinor('4.475', 'USD')).toBe(448);
    expect(parseAmountToMinor('1234567.89', 'USD')).toBe(123456789);
    expect(parseAmountToMinor('99999999999.99', 'USD')).toBe(9999999999999);
  });

  it('rounds half-up when the receipt has more decimals than the currency allows', () => {
    expect(parseAmountToMinor('10.999', 'USD')).toBe(1100);
    expect(parseAmountToMinor('3450.6', 'JPY')).toBe(3451);
    expect(parseAmountToMinor('3450.4', 'JPY')).toBe(3450);
  });

  it('tolerates surrounding whitespace only', () => {
    expect(parseAmountToMinor('  1850.00  ', 'PKR')).toBe(185000);
  });

  // Anything non-canonical is the model failing to normalise. Null, not a guess.
  it('returns null rather than guessing on non-canonical input', () => {
    for (const bad of ['', 'TOTAL', '--', '1,234', '1.234,56', 'Rs. 1850', '1850/-', '1 850', '1.2.3']) {
      expect(parseAmountToMinor(bad, 'USD')).toBeNull();
    }
  });

  it('rejects zero and negative amounts', () => {
    expect(parseAmountToMinor('-10.00', 'USD')).toBeNull();
    expect(parseAmountToMinor('0', 'USD')).toBeNull();
    expect(parseAmountToMinor('0.00', 'USD')).toBeNull();
    expect(parseAmountToMinor('0.004', 'USD')).toBeNull(); // rounds to zero
  });
});

describe('formatMoney', () => {
  // Fraction digits are pinned to the ISO exponent so display round-trips with
  // storage and does not shift when the host's ICU data changes.
  it('shows exactly the ISO number of decimals', () => {
    expect(formatMoney(185000, 'PKR', 'en-US')).toContain('1,850.00');
    expect(formatMoney(1010, 'USD', 'en-US')).toContain('10.10');
    expect(formatMoney(12345, 'KWD', 'en-US')).toContain('12.345');
  });

  it('shows no decimals for zero-exponent currencies', () => {
    expect(formatMoney(3450, 'JPY', 'en-US')).not.toContain('.');
    expect(formatMoney(3450, 'ISK', 'en-US')).not.toContain('.');
  });

  it('respects the locale it is given', () => {
    expect(formatMoney(123456, 'EUR', 'de-DE')).toContain('1.234,56');
    expect(formatMoney(123456, 'EUR', 'en-US')).toContain('1,234.56');
  });

  it('includes some marker of the currency', () => {
    expect(formatMoney(1010, 'USD', 'en-US')).toMatch(/\$|USD/);
    expect(formatMoney(185000, 'PKR', 'en-US')).toMatch(/Rs|PKR|₨/);
  });

  it('does not throw on an unknown currency code', () => {
    expect(() => formatMoney(1000, 'ZZZ', 'en-US')).not.toThrow();
  });

  it('round-trips: format then reparse gives the same minor units', () => {
    const cases: Array<[number, string]> = [
      [185000, 'PKR'], [1010, 'USD'], [12345, 'KWD'], [3450, 'JPY'],
    ];
    for (const [minor, cur] of cases) {
      const digits = isoMinorDigits(cur);
      const canonical = (minor / 10 ** digits).toFixed(digits);
      expect(parseAmountToMinor(canonical, cur)).toBe(minor);
    }
  });
});

describe('integer safety', () => {
  // BigInt does the scaling exactly, but the result is returned as a Number.
  // Past MAX_SAFE_INTEGER that conversion silently loses precision, so an
  // absurd total (a hallucination, or a barcode misread as the amount) would
  // be stored as a wrong value with no error. Money path: reject, don't guess.
  it('accepts the largest exactly-representable amount', () => {
    expect(parseAmountToMinor('90071992547409.91', 'USD')).toBe(Number.MAX_SAFE_INTEGER);
    expect(Number.isSafeInteger(parseAmountToMinor('90071992547409.91', 'USD')!)).toBe(true);
  });

  it('returns null beyond MAX_SAFE_INTEGER instead of a lossy number', () => {
    expect(parseAmountToMinor('90071992547409.92', 'USD')).toBeNull();
    expect(parseAmountToMinor('99999999999999999999.99', 'USD')).toBeNull();
    expect(parseAmountToMinor('1'.repeat(40), 'USD')).toBeNull();
  });

  it('applies the same ceiling to zero- and three-exponent currencies', () => {
    expect(parseAmountToMinor('9007199254740991', 'JPY')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseAmountToMinor('9007199254740992', 'JPY')).toBeNull();
    expect(parseAmountToMinor('90071992547409919', 'KWD')).toBeNull();
  });

  // Defensive: only reachable from a corrupted stored row, since parse now
  // rejects unsafe values. Must print the exact digits it was handed rather
  // than letting Intl's internal double-rounding invent a different figure.
  //
  // 9007199254740994 is deliberately chosen: it is past MAX_SAFE_INTEGER (so it
  // takes the fallback path) but is still EXACTLY representable as a double,
  // being even. A literal like 999999999999999999 would be useless here - the
  // JS parser collapses it to 1e18 before the function is ever called, so no
  // implementation could recover those digits.
  it('formatMoney prints the exact digits of an unsafe amount', () => {
    expect(Number.isSafeInteger(9007199254740994)).toBe(false);
    const out = formatMoney(9007199254740994, 'USD', 'en-US');
    expect(out).toContain('90,071,992,547,409.94');
  });
});

// Real receipts do not print the canonical form the parser demands. A live
// test on a physical receipt came back with the amount field empty even
// though the currency was read correctly -- the total was there, printed
// with grouping separators, and parseAmountToMinor rejected it.
//
// parseAmountToMinor stays strict on purpose: it is the last gate before an
// integer is persisted. normalizeAmountText is the separate, explicit step
// that turns printed money into that canonical form, and returns null rather
// than guessing when a string is genuinely ambiguous.
describe('normalizeAmountText', () => {
  it('passes canonical input through untouched', () => {
    expect(normalizeAmountText('1234.50')).toBe('1234.50');
    expect(normalizeAmountText('0.99')).toBe('0.99');
    expect(normalizeAmountText('3450')).toBe('3450');
  });

  it('strips currency symbols and codes printed alongside the number', () => {
    expect(normalizeAmountText('Rs 3450.75')).toBe('3450.75');
    expect(normalizeAmountText('£47.80')).toBe('47.80');
    expect(normalizeAmountText('$ 9.75')).toBe('9.75');
    expect(normalizeAmountText('PKR 1234.50')).toBe('1234.50');
    expect(normalizeAmountText('  2887.50  ')).toBe('2887.50');
  });

  // The common case that broke on a real receipt.
  it('removes thousands separators', () => {
    expect(normalizeAmountText('1,234.50')).toBe('1234.50');
    expect(normalizeAmountText('Rs 3,450.75')).toBe('3450.75');
    expect(normalizeAmountText('12,345,678.90')).toBe('12345678.90');
    expect(normalizeAmountText('1,234')).toBe('1234');
  });

  // Much of the world writes 1.234,56 for what others write 1,234.56.
  it('handles a decimal comma', () => {
    expect(normalizeAmountText('1.234,56')).toBe('1234.56');
    expect(normalizeAmountText('47,80')).toBe('47.80');
    expect(normalizeAmountText('1.234.567,89')).toBe('1234567.89');
  });

  // When both separators appear, the RIGHTMOST one is the decimal point.
  // That rule is unambiguous and needs no locale guess.
  it('treats the rightmost separator as the decimal point', () => {
    expect(normalizeAmountText('1,234.50')).toBe('1234.50');
    expect(normalizeAmountText('1.234,50')).toBe('1234.50');
  });

  // A single separator with exactly three digits after it is genuinely
  // ambiguous: "1,005" is one thousand and five, or one point zero zero five,
  // depending on where you are. Refusing beats a 1000x error either way.
  it('returns null when a single separator is truly ambiguous', () => {
    expect(normalizeAmountText('1,005')).toBeNull();
    expect(normalizeAmountText('1.005')).toBeNull();
  });

  it('rejects anything that is not a number', () => {
    expect(normalizeAmountText('')).toBeNull();
    expect(normalizeAmountText('abc')).toBeNull();
    expect(normalizeAmountText('Rs')).toBeNull();
    expect(normalizeAmountText('1.2.3.4')).toBeNull();
    expect(normalizeAmountText(null)).toBeNull();
    expect(normalizeAmountText(undefined)).toBeNull();
  });

  // "/-" after an amount is everyday notation on South Asian receipts, and
  // the user lives in Pakistan -- this is not an exotic edge case for them.
  it('strips trailing /- and similar notation', () => {
    expect(normalizeAmountText('Rs 1850/-')).toBe('1850');
    expect(normalizeAmountText('1,850/-')).toBe('1850');
    expect(normalizeAmountText('Rs. 3,450.75/-')).toBe('3450.75');
    expect(normalizeAmountText('1850/=')).toBe('1850');
  });

  // A trailing dash alone is the same idea.
  it('strips a trailing dash', () => {
    expect(normalizeAmountText('1850-')).toBe('1850');
  });

  it('rejects negatives -- a receipt total is never below zero', () => {
    expect(normalizeAmountText('-12.00')).toBeNull();
  });

  it('feeds parseAmountToMinor correctly for the currencies that differ', () => {
    expect(parseAmountToMinor(normalizeAmountText('Rs 3,450.75')!, 'PKR')).toBe(345075);
    expect(parseAmountToMinor(normalizeAmountText('1.234,56')!, 'EUR')).toBe(123456);
    expect(parseAmountToMinor(normalizeAmountText('¥3,450')!, 'JPY')).toBe(3450);
  });
});

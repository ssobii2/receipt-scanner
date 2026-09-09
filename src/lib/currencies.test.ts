import { describe, it, expect } from 'bun:test';
import { MAJOR_CURRENCIES } from './currencies';
import { isoMinorDigits } from './money';

describe('MAJOR_CURRENCIES', () => {
  it('every code is a 3-letter uppercase ISO code', () => {
    for (const { code } of MAJOR_CURRENCIES) {
      expect(code).toMatch(/^[A-Z]{3}$/);
    }
  });

  it('codes are unique', () => {
    const codes = MAJOR_CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('PKR is present and first', () => {
    expect(MAJOR_CURRENCIES[0].code).toBe('PKR');
  });

  it('is wired to the ISO 4217 exponent table, not Intl (cross-runtime trap)', () => {
    expect(isoMinorDigits('JPY')).toBe(0);
    expect(isoMinorDigits('PKR')).toBe(2);
  });
});

import { describe, it, expect } from 'bun:test';
import { merchantKey } from './merchant';

describe('merchantKey', () => {
  it('lowercases and trims', () => {
    expect(merchantKey('TESCO STORES 3411')).toBe('tesco stores 3411');
    expect(merchantKey('  Foodpanda  ')).toBe('foodpanda');
  });

  it('collapses internal whitespace so spacing noise does not split a merchant', () => {
    expect(merchantKey('IMTIAZ   SUPER    MARKET')).toBe('imtiaz super market');
    expect(merchantKey('Al\tFatah\nStore')).toBe('al fatah store');
  });

  // toUpperCase() would have been the obvious choice and quietly breaks here.
  it('handles non-Latin scripts without mangling them', () => {
    expect(merchantKey('  المدينة  ')).toBe('المدينة');
    expect(merchantKey('小米之家')).toBe('小米之家');
    expect(merchantKey('ЛЕНТА')).toBe('лента');
  });

  it('NFKC-normalises so full-width and compatibility forms match their plain forms', () => {
    expect(merchantKey('ＴＥＳＣＯ')).toBe(merchantKey('TESCO'));
    expect(merchantKey('ﬁne foods')).toBe('fine foods');
  });

  it('keeps accents rather than stripping them - they distinguish real names', () => {
    expect(merchantKey('Café Zouk')).toBe('café zouk');
  });

  it('returns null for input with no usable characters', () => {
    expect(merchantKey('')).toBeNull();
    expect(merchantKey('   ')).toBeNull();
    expect(merchantKey(null)).toBeNull();
  });
});

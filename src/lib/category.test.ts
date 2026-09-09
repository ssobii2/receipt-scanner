import { describe, it, expect } from 'bun:test';
import { CATEGORIES, getCategory } from './category';

const learned = { 'imtiaz super market': 'Groceries', 'careem': 'Transport' } as const;

describe('CATEGORIES', () => {
  it('is the fixed list the extraction schema is constrained to', () => {
    expect([...CATEGORIES]).toEqual([
      'Groceries', 'Eating out', 'Transport', 'Utilities', 'Shopping', 'Health', 'Other',
    ]);
  });
});

describe('getCategory', () => {
  // The whole point of the two-layer design: the model is unstable across runs,
  // so a stored correction must win or totals silently split across slices.
  it('a stored correction beats the model guess', () => {
    expect(getCategory('imtiaz super market', 'Shopping', learned)).toBe('Groceries');
    expect(getCategory('careem', 'Eating out', learned)).toBe('Transport');
  });

  it('uses the model guess when nothing has been learned for this merchant', () => {
    expect(getCategory('foodpanda', 'Eating out', learned)).toBe('Eating out');
  });

  it('falls back to the guess when there is no merchant key to look up', () => {
    expect(getCategory(null, 'Transport', learned)).toBe('Transport');
  });

  // Null, not 'Other'. Silently bucketing an unknown into Other hides the miss.
  it('returns null when the guess is not one of the fixed categories', () => {
    expect(getCategory('new shop', 'Grocery', learned)).toBeNull();
    expect(getCategory('new shop', 'Food & Household', learned)).toBeNull();
    expect(getCategory('new shop', '', learned)).toBeNull();
  });

  it('returns null when there is neither a correction nor a guess', () => {
    expect(getCategory('new shop', null, learned)).toBeNull();
    expect(getCategory(null, null, learned)).toBeNull();
  });

  it('accepts Other as a legitimate model answer', () => {
    expect(getCategory('new shop', 'Other', learned)).toBe('Other');
  });
});

describe('getCategory prototype safety', () => {
  // `key in learned` walks the prototype chain. Real merchant keys are
  // lowercase, and 'constructor' / 'tostring' are plausible-looking shop names,
  // so an inherited property must not be mistaken for a learned correction.
  it('ignores inherited object properties', () => {
    expect(getCategory('constructor', 'Groceries', {})).toBe('Groceries');
    expect(getCategory('toString', 'Groceries', {})).toBe('Groceries');
    expect(getCategory('valueOf', null, {})).toBeNull();
    expect(getCategory('__proto__', 'Health', {})).toBe('Health');
  });

  it('still finds a genuinely learned key with an awkward name', () => {
    expect(getCategory('constructor', 'Groceries', { constructor: 'Shopping' } as const)).toBe('Shopping');
  });
});

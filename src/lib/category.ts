// Spending category. A stored (learned) correction for a merchant always
// wins over the model's guess -- the model is unstable across runs, so
// trusting it over a saved correction would silently split totals.

export const CATEGORIES = [
  'Groceries',
  'Eating out',
  'Transport',
  'Utilities',
  'Shopping',
  'Health',
  'Other',
] as const;

export type Category = (typeof CATEGORIES)[number];

function isCategory(value: string): value is Category {
  return (CATEGORIES as readonly string[]).includes(value);
}

/** Resolves the category for a receipt: a learned correction for this
 * merchant key wins; otherwise the model's guess if it's one of the fixed
 * categories; otherwise null (never a silent default). */
export function getCategory(
  key: string | null,
  llmGuess: string | null,
  learned: Readonly<Record<string, Category>>,
): Category | null {
  // Object.hasOwn (not `in`) so an inherited property like 'constructor' or
  // '__proto__' can never be mistaken for a learned correction.
  if (key != null && Object.hasOwn(learned, key)) return learned[key];
  if (llmGuess != null && isCategory(llmGuess)) return llmGuess;
  return null;
}

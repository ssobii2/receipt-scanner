// A merchant "key" is the normalized form used to match a receipt's merchant
// name against learned category corrections. It must not conflate distinct
// real-world names (so no accent stripping) but must ignore case, incidental
// whitespace, and Unicode compatibility variants.

/** Normalizes a raw merchant name into a lookup key, or null if there's
 * nothing usable in it. */
export function merchantKey(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const key = raw.normalize('NFKC').toLowerCase().trim().replace(/\s+/g, ' ');
  return key.length === 0 ? null : key;
}

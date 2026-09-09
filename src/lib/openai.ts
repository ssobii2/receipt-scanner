// Reads a receipt photo with OpenAI and hands back the raw wire object for
// validateExtraction to turn into an Extraction. This module never throws --
// every failure path (offline, a non-2xx response, a body that isn't usable
// JSON, a missing key) comes back as a discriminated result instead, so a
// flaky network never crashes the app or loses the photo the user just took.
//
// Dependencies (the API key, today's date, the base64 reader, fetch itself)
// are passed in rather than imported, so these tests exercise the real code
// paths without mocking modules. Wiring expo-file-system and the env var to
// these deps happens in the caller, not here.

import { CATEGORIES } from './category';
import { validateExtraction, type Extraction } from './extract';

// Benchmarked on realistic phone photos (angled, shadowed, low-res, noisy),
// not a single worst-case blur: gpt-5.6-luna tied the pricier models at
// 12/12, so the cheapest accurate model wins. Full data in openai.test.ts.
export const OPENAI_MODEL = 'gpt-5.6-luna';

const ENDPOINT = 'https://api.openai.com/v1/responses';

// Same class of transient failure as the old provider: 500/503 are worth a
// retry, 4xx is not (retrying only burns quota and delays the error the user
// needs to see). 429 is handled separately below -- it is never retried.
const RETRYABLE_STATUSES = new Set([500, 503]);
// Bounded to 3 total tries: someone is watching a spinner.
const MAX_ATTEMPTS = 3;

/** Backoff before the next attempt, given the attempt number just made
 * (1-indexed). Increasing so a service that just said "busy" isn't hit
 * again immediately. */
function backoffMs(attempt: number): number {
  return 300 * attempt;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  heic: 'image/heic',
};

/** Guesses the upload MIME type from a file URI's extension. Falls back to
 * jpeg for anything unrecognised -- OpenAI sniffs the bytes anyway, and a
 * wrong-but-plausible type beats refusing the upload outright. */
export function mimeTypeFor(uri: string): string {
  const ext = /\.([a-z0-9]+)$/i.exec(uri)?.[1]?.toLowerCase();
  return (ext && MIME_BY_EXT[ext]) || 'image/jpeg';
}

function buildPrompt(today: string): string {
  return [
    `Today's date is ${today}.`,
    'You are reading a photo of a purchase receipt. Extract these fields as JSON matching the given schema:',
    '- merchant: the store or vendor name as printed on the receipt.',
    "- total_value: the final total the customer paid, as a plain canonical decimal with no grouping separators and no currency symbol -- \"1234.50\", never \"1,234.50\".",
    '- total_text: the total exactly as printed, including any currency symbol or formatting.',
    '- currency: the 3-letter ISO 4217 currency code (e.g. USD, PKR, EUR).',
    `- date_iso: the purchase date resolved to ISO 8601 (YYYY-MM-DD), using today's date (${today}) to resolve relative or partial dates such as "yesterday" or "09/03".`,
    '- date_text: the date exactly as printed on the receipt.',
    `- category: one of ${CATEGORIES.join(', ')}, only if clearly implied by the merchant or items.`,
    '',
    'If a field cannot be read with confidence, return null for it instead of guessing -- never invent a value.',
  ].join('\n');
}

/** Builds the Responses API request body: the image as a data: URL plus a
 * prompt, constrained to a strict JSON schema where every field is nullable
 * so "I could not read that" is a legal answer. Strict mode requires
 * `additionalProperties: false` and every property listed in `required` --
 * nullability is expressed via `type: [..., 'null']`, not by omission. */
export function buildRequestBody(base64: string, mimeType: string, today: string) {
  const stringField = { type: ['string', 'null'] } as const;

  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['merchant', 'total_value', 'total_text', 'currency', 'date_iso', 'date_text', 'category'],
    properties: {
      merchant: stringField,
      total_value: stringField,
      total_text: stringField,
      currency: stringField,
      date_iso: stringField,
      date_text: stringField,
      category: { type: ['string', 'null'], enum: [...CATEGORIES, null] },
    },
  };

  return {
    model: OPENAI_MODEL,
    input: [
      {
        role: 'user',
        content: [
          { type: 'input_text', text: buildPrompt(today) },
          { type: 'input_image', image_url: `data:${mimeType};base64,${base64}` },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'receipt', strict: true, schema } },
  };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stripFence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  return trimmed.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
}

/** Pulls the model's JSON answer out of an OpenAI Responses API response.
 * `output` is an array of items (a `reasoning` item can precede the real
 * one); this finds the one whose `content[]` holds an `output_text`. A
 * `refusal` content item, an empty output list, a prose answer, or any other
 * shape that isn't usable JSON all return null (never throw) -- callers
 * treat that as "malformed", not a crash. */
export function parseResponseJson(response: unknown): unknown {
  if (!isRecord(response)) return null;
  const output = response.output;
  if (!Array.isArray(output)) return null;

  let text: string | undefined;
  for (const item of output) {
    const content = isRecord(item) ? item.content : undefined;
    if (!Array.isArray(content)) continue;
    const outputText = content.find((c) => isRecord(c) && c.type === 'output_text');
    if (isRecord(outputText) && typeof outputText.text === 'string') {
      text = outputText.text;
      break;
    }
  }
  if (text === undefined) return null;

  const stripped = stripFence(text);
  if (stripped.length === 0) return null;

  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}

export type ExtractDeps = {
  apiKey: string | null;
  today: string;
  readBase64: (uri: string) => Promise<string>;
  fetch: (input: string, init: RequestInit) => Promise<Response>;
  sleep: (ms: number) => Promise<void>;
  // Per attempt, not per call -- a single stalled socket must not poison the
  // retry that would have succeeded. React Native's fetch has no built-in
  // timeout, so without this a dead connection spins the UI forever.
  timeoutMs: number;
};

export type ExtractResult =
  | { ok: true; extraction: Extraction }
  | { ok: false; reason: 'offline' | 'http' | 'malformed' | 'no-key' | 'no-credit' }
  | { ok: false; reason: 'rate-limited'; retryAfterSeconds?: number };

/** Reads a receipt photo with OpenAI and returns a validated extraction.
 * Never throws: every failure path (missing key, offline, a non-2xx status,
 * a body that isn't usable JSON) comes back as {ok:false, reason} instead. */
export async function extractReceipt(uri: string, deps: ExtractDeps): Promise<ExtractResult> {
  if (!deps.apiKey) return { ok: false, reason: 'no-key' };

  let base64: string;
  try {
    base64 = await deps.readBase64(uri);
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const body = buildRequestBody(base64, mimeTypeFor(uri), deps.today);

  // Definite assignment: the loop always runs at least once and only exits
  // past this point via `break` (response set) or an early `return` (a
  // persistent throw on the last attempt) -- never falls through unset.
  let response!: Response;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // One controller per attempt: a timeout on attempt N must not carry over
    // and abort attempt N+1's fresh request.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs);
    try {
      response = await deps.fetch(ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${deps.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch {
      // A timeout abort and a dropped connection both land here and are
      // indistinguishable to the user -- both retry, then report offline.
      if (attempt === MAX_ATTEMPTS) return { ok: false, reason: 'offline' };
      await deps.sleep(backoffMs(attempt));
      continue;
    } finally {
      // Always clear, on every path (success, network error, timeout): a
      // leaked timer can fire abort() against an already-finished request
      // and keeps a task alive in React Native.
      clearTimeout(timer);
    }

    if (response.ok || !RETRYABLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) break;
    await deps.sleep(backoffMs(attempt));
  }

  if (response.status === 429) {
    // OpenAI overloads 429 for two different things. An exhausted account
    // balance carries error.code === 'insufficient_quota' -- waiting will
    // never fix that, so it gets its own reason instead of the misleading
    // "try again" that 'rate-limited' implies. An ordinary rate limit puts
    // the wait time in the Retry-After response header (not the body, unlike
    // the old provider). Neither is retried.
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const code = isRecord(json) && isRecord(json.error) ? json.error.code : undefined;
    if (code === 'insufficient_quota') return { ok: false, reason: 'no-credit' };

    const retryAfterHeader = response.headers.get('retry-after');
    const retryAfterSeconds = retryAfterHeader !== null && /^\d+$/.test(retryAfterHeader)
      ? Number(retryAfterHeader)
      : undefined;
    return retryAfterSeconds === undefined
      ? { ok: false, reason: 'rate-limited' }
      : { ok: false, reason: 'rate-limited', retryAfterSeconds };
  }

  if (!response.ok) return { ok: false, reason: 'http' };

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, reason: 'malformed' };
  }

  const raw = parseResponseJson(json);
  if (raw === null) return { ok: false, reason: 'malformed' };

  return { ok: true, extraction: validateExtraction(raw, deps.today) };
}

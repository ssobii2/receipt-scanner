// Assembles extractReceipt's real dependencies (env API key, a downscaled
// base64 read for upload, today's date, a real timer) so the UI can call it
// with just a uri. openai.ts stays free of expo imports and process.env so
// its tests can run outside Expo -- this is the only file that wires the two
// together.
import { extractReceipt, type ExtractResult } from './openai';
import { todayISO } from './dates';
import { readUploadBase64 } from './uploadPhoto';

// An empty string (unset var resolves to '' at build time, not undefined)
// must count as missing too, or extractReceipt would try to call OpenAI with
// a blank key instead of reporting 'no-key'.
const RAW_API_KEY = process.env.EXPO_PUBLIC_OPENAI_API_KEY;
const API_KEY = RAW_API_KEY && RAW_API_KEY.length > 0 ? RAW_API_KEY : null;

// Measured against the live API: a normal call takes 6-11s. 15s gives a
// stalled attempt room to be merely slow before it's cut off as dead, while
// still recovering well inside patience for a spinner the user is watching.
const TIMEOUT_MS = 15_000;

export function extractReceiptFromPhoto(uri: string): Promise<ExtractResult> {
  return extractReceipt(uri, {
    apiKey: API_KEY,
    today: todayISO(),
    readBase64: (u) => readUploadBase64(u),
    fetch: (input, init) => fetch(input, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    timeoutMs: TIMEOUT_MS,
  });
}

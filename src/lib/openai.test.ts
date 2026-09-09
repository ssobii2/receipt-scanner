// Contract for the OpenAI extraction layer, written before the implementation.
//
// Replaces the earlier provider layer. Same result shape, same principle: the
// network call is the only part of this app that can fail in ways we do not
// control, so extractReceipt never throws -- it returns a result the UI
// switches on, and every failure degrades to the manual form that already
// works.
//
// Model choice is measured, not assumed, and measured on the images this app
// will actually see. Across angled, shadowed, low-resolution and noisy
// photos of the same receipt -- 12 trials each -- every model tested scored
// 12/12: gpt-6-astra, gpt-5.6-terra, gpt-5.4-mini and gpt-5.6-luna alike.
// Clean photos are the normal case, so the cheapest accurate model wins:
// luna is ~0.03c per scan against ~1.1c for astra, roughly 35x less.
//
// The models DO separate on a deliberately destroyed image (0x4 blur), where
// only astra held up (5/5, others 0-1/5) and the rest invented plausible
// totals in the wrong currency. That case was excluded deliberately: it is
// not representative, and a photo that badly degraded is visibly bad to the
// person who just took it.
//
// Two methodology notes worth keeping:
//   - An earlier one-shot run had gpt-5.4-nano returning nulls on the blur,
//     which read as caution. Over 5 trials it was the worst of the set
//     (18.48, 158.53, 6.498,59, 1510.28). One sample is an anecdote, and a
//     nullable schema lets failure masquerade as restraint.
//   - Deciding on the pathological case rather than the common one is how
//     you end up paying 35x for insurance against a photo you would retake.

import { describe, it, expect } from 'bun:test';
import {
  buildRequestBody,
  parseResponseJson,
  mimeTypeFor,
  extractReceipt,
  OPENAI_MODEL,
  type ExtractDeps,
} from './openai';
import { CATEGORIES } from './category';

const TODAY = '2026-09-09';
const B64 = 'aGVsbG8=';

// A syntactically valid Responses API success envelope wrapping `text`.
function envelope(text: string) {
  return { output: [{ type: 'message', content: [{ type: 'output_text', text }] }] };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function deps(over: Partial<ExtractDeps> = {}): ExtractDeps {
  return {
    apiKey: 'test-key',
    today: TODAY,
    readBase64: async () => B64,
    fetch: async () => jsonResponse(envelope('{}')),
    sleep: async () => {},
    timeoutMs: 5000,
    ...over,
  };
}

describe('mimeTypeFor', () => {
  it('maps the extensions the camera and gallery actually produce', () => {
    expect(mimeTypeFor('file:///x/a.jpg')).toBe('image/jpeg');
    expect(mimeTypeFor('file:///x/a.jpeg')).toBe('image/jpeg');
    expect(mimeTypeFor('file:///x/a.png')).toBe('image/png');
    expect(mimeTypeFor('file:///x/a.heic')).toBe('image/heic');
  });

  it('is case-insensitive', () => {
    expect(mimeTypeFor('file:///x/A.JPG')).toBe('image/jpeg');
  });

  it('falls back to jpeg for anything unrecognised', () => {
    expect(mimeTypeFor('file:///x/a.tiff')).toBe('image/jpeg');
    expect(mimeTypeFor('file:///x/noextension')).toBe('image/jpeg');
  });
});

describe('buildRequestBody', () => {
  const body = buildRequestBody(B64, 'image/jpeg', TODAY);

  it('uses the measured model', () => {
    expect(body.model).toBe(OPENAI_MODEL);
    expect(OPENAI_MODEL).toBe('gpt-5.6-luna');
  });

  // The Responses API takes images as a data: URL, not raw base64.
  it('sends the image as a data URL carrying the base64', () => {
    const content = body.input[0].content;
    const image = content.find((c: any) => c.type === 'input_image');
    expect(image.image_url).toBe(`data:image/jpeg;base64,${B64}`);
  });

  it('sends the instructions as text alongside the image', () => {
    const content = body.input[0].content;
    expect(content.some((c: any) => c.type === 'input_text' && c.text.length > 0)).toBe(true);
  });

  it('constrains the response to a strict json schema', () => {
    expect(body.text.format.type).toBe('json_schema');
    expect(body.text.format.strict).toBe(true);
    expect(body.text.format.schema).toBeDefined();
  });

  it('asks for exactly the wire fields validateExtraction reads', () => {
    const props = body.text.format.schema.properties;
    expect(Object.keys(props).sort()).toEqual(
      ['category', 'currency', 'date_iso', 'date_text', 'merchant', 'total_text', 'total_value'].sort(),
    );
  });

  // Strict mode requires every property listed as required and forbids extra
  // ones; "optional" is expressed by allowing null, not by omission.
  it('satisfies strict mode: all fields required, no extras allowed', () => {
    const schema = body.text.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect([...schema.required].sort()).toEqual(Object.keys(schema.properties).sort());
  });

  // The whole design rests on this: a model forced to answer invents a total.
  it('lets every field be null', () => {
    const props = body.text.format.schema.properties;
    for (const [name, schema] of Object.entries<any>(props)) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      expect(`${name}:${types.includes('null')}`).toBe(`${name}:true`);
    }
  });

  it('constrains category to the app’s own list, plus null', () => {
    const category = body.text.format.schema.properties.category;
    for (const c of CATEGORIES) expect(category.enum).toContain(c);
    expect(category.enum).toContain(null);
  });

  it('tells the model the canonical number format', () => {
    const text = JSON.stringify(body).toLowerCase();
    expect(text).toContain('total_value');
    expect(text.includes('separator') || text.includes('1234.50') || text.includes('grouping')).toBe(true);
  });

  it('gives the model today’s date', () => {
    expect(JSON.stringify(body)).toContain(TODAY);
  });
});

describe('parseResponseJson', () => {
  it('pulls the JSON out of a normal success envelope', () => {
    expect(parseResponseJson(envelope('{"merchant":"Imtiaz"}'))).toEqual({ merchant: 'Imtiaz' });
  });

  it('finds the output_text even when other output items come first', () => {
    const withReasoning = {
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: '{"merchant":"Imtiaz"}' }] },
      ],
    };
    expect(parseResponseJson(withReasoning)).toEqual({ merchant: 'Imtiaz' });
  });

  it('tolerates a markdown fence and surrounding whitespace', () => {
    expect(parseResponseJson(envelope('```json\n{"merchant":"Imtiaz"}\n```'))).toEqual({
      merchant: 'Imtiaz',
    });
    expect(parseResponseJson(envelope('  \n {"merchant":"Imtiaz"} \n '))).toEqual({
      merchant: 'Imtiaz',
    });
  });

  // The model can decline instead of answering; that is not JSON.
  it('returns null for a refusal', () => {
    const refusal = {
      output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'I cannot help with that.' }] }],
    };
    expect(parseResponseJson(refusal)).toBeNull();
  });

  it('returns null when the model answered in prose instead of JSON', () => {
    expect(parseResponseJson(envelope('That looks like a cat.'))).toBeNull();
  });

  it('returns null for junk rather than throwing', () => {
    expect(parseResponseJson(null)).toBeNull();
    expect(parseResponseJson('a string')).toBeNull();
    expect(parseResponseJson({})).toBeNull();
    expect(parseResponseJson({ output: [] })).toBeNull();
    expect(parseResponseJson(envelope(''))).toBeNull();
  });
});

describe('extractReceipt', () => {
  it('returns a validated extraction on the happy path', async () => {
    const wire = {
      merchant: 'Imtiaz Super Market',
      total_value: '3450.75',
      total_text: 'Rs 3,450.75',
      currency: 'PKR',
      date_iso: '2026-09-08',
      date_text: '08/09/2026',
      category: 'Groceries',
    };
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => jsonResponse(envelope(JSON.stringify(wire))),
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.merchant).toBe('Imtiaz Super Market');
    expect(result.extraction.merchantKey).toBe('imtiaz super market');
    expect(result.extraction.amountMinor).toBe(345075);
    expect(result.extraction.currency).toBe('PKR');
    expect(result.extraction.spentOn).toBe('2026-09-08');
    expect(result.extraction.category).toBe('Groceries');
  });

  // The photo of a cat, and the blurred receipt nano correctly refuses to
  // guess at. Not an error: the user just fills the form in by hand.
  it('succeeds with an all-null extraction when the model read nothing', async () => {
    const allNull = {
      merchant: null, total_value: null, total_text: null,
      currency: null, date_iso: null, date_text: null, category: null,
    };
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => jsonResponse(envelope(JSON.stringify(allNull))),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.extraction.merchant).toBeNull();
    expect(result.extraction.amountMinor).toBeNull();
  });

  it('sends the key as a bearer token', async () => {
    let init: any;
    let url = '';
    await extractReceipt('file:///x/a.jpg', deps({
      fetch: async (u, i) => { url = String(u); init = i; return jsonResponse(envelope('{}')); },
    }));
    expect(init.headers.Authorization).toBe('Bearer test-key');
    expect(url).not.toContain('test-key');
    expect(url).toContain('/v1/responses');
  });

  it('reports no-key without touching the network', async () => {
    let called = false;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      apiKey: null,
      fetch: async () => { called = true; return jsonResponse(envelope('{}')); },
    }));
    expect(result).toEqual({ ok: false, reason: 'no-key' });
    expect(called).toBe(false);
  });

  it('treats an empty-string key as missing', async () => {
    const result = await extractReceipt('file:///x/a.jpg', deps({ apiKey: '' }));
    expect(result).toEqual({ ok: false, reason: 'no-key' });
  });

  it('reports offline instead of throwing when fetch rejects', async () => {
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => { throw new TypeError('Network request failed'); },
    }));
    expect(result).toEqual({ ok: false, reason: 'offline' });
  });

  it('reports malformed when the body is not usable JSON', async () => {
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => new Response('<html>gateway timeout</html>', { status: 200 }),
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  it('reports malformed when the model answers in prose', async () => {
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => jsonResponse(envelope('That looks like a cat.')),
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('malformed');
  });

  it('retries 500 and 503', async () => {
    for (const status of [500, 503]) {
      let attempts = 0;
      await extractReceipt('file:///x/a.jpg', deps({
        fetch: async () => {
          attempts += 1;
          return attempts === 1 ? jsonResponse({ error: {} }, status) : jsonResponse(envelope('{}'));
        },
      }));
      expect(`${status}:${attempts}`).toBe(`${status}:2`);
    }
  });

  it('does not retry a client error', async () => {
    for (const status of [400, 401, 403, 404]) {
      let attempts = 0;
      const result = await extractReceipt('file:///x/a.jpg', deps({
        fetch: async () => { attempts += 1; return jsonResponse({ error: {} }, status); },
      }));
      expect(`${status}:${attempts}`).toBe(`${status}:1`);
      expect(result.ok).toBe(false);
    }
  });

  it('gives up after a bounded number of attempts', async () => {
    let attempts = 0;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => { attempts += 1; return jsonResponse({ error: {} }, 503); },
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('http');
    expect(attempts).toBeGreaterThan(1);
    expect(attempts).toBeLessThanOrEqual(3);
  });

  it('retries a thrown network error before reporting offline', async () => {
    let attempts = 0;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => {
        attempts += 1;
        if (attempts === 1) throw new TypeError('Network request failed');
        return jsonResponse(envelope('{"merchant":"Imtiaz"}'));
      },
    }));
    expect(attempts).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('waits between retries, with increasing delays', async () => {
    const waits: number[] = [];
    await extractReceipt('file:///x/a.jpg', deps({
      sleep: async (ms: number) => { waits.push(ms); },
      fetch: async () => jsonResponse({ error: {} }, 503),
    }));
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every((w) => w > 0)).toBe(true);
    expect([...waits].sort((a, b) => a - b)).toEqual(waits);
  });

  // OpenAI's 429 means "slow down" and carries a Retry-After header.
  it('reports rate-limited without retrying, and reads Retry-After', async () => {
    let attempts = 0;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => {
        attempts += 1;
        return jsonResponse(
          { error: { message: 'Rate limit reached', type: 'requests' } },
          429,
          { 'retry-after': '20' },
        );
      },
    }));
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'rate-limited') return;
    expect(result.retryAfterSeconds).toBe(20);
  });

  it('still reports rate-limited when there is no Retry-After', async () => {
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => jsonResponse({ error: { message: 'Rate limit reached' } }, 429),
    }));
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'rate-limited') return;
    expect(result.retryAfterSeconds).toBeUndefined();
  });

  // A 429 whose code is insufficient_quota is NOT a rate limit -- it means
  // the account is out of credit. Waiting will never fix it, and telling the
  // user to "try again in a moment" would be a lie. Distinct reason.
  it('distinguishes an exhausted balance from a rate limit', async () => {
    let attempts = 0;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      fetch: async () => {
        attempts += 1;
        return jsonResponse(
          { error: { message: 'You exceeded your current quota', type: 'insufficient_quota', code: 'insufficient_quota' } },
          429,
        );
      },
    }));
    expect(attempts).toBe(1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe('no-credit');
  });

  it('aborts a request that never responds', async () => {
    let sawSignal = false;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      timeoutMs: 10,
      fetch: (_url, init) => {
        const signal = (init as { signal?: AbortSignal }).signal;
        sawSignal = signal instanceof AbortSignal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      },
    }));
    expect(sawSignal).toBe(true);
    expect(result).toEqual({ ok: false, reason: 'offline' });
  });

  it('times out one attempt and still succeeds on the next', async () => {
    let attempts = 0;
    const result = await extractReceipt('file:///x/a.jpg', deps({
      timeoutMs: 10,
      fetch: (_url, init) => {
        attempts += 1;
        if (attempts > 1) return Promise.resolve(jsonResponse(envelope('{"merchant":"Imtiaz"}')));
        const signal = (init as { signal?: AbortSignal }).signal;
        return new Promise<Response>((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        });
      },
    }));
    expect(attempts).toBe(2);
    expect(result.ok).toBe(true);
  });

  it('surfaces a read failure as a failure rather than crashing', async () => {
    const result = await extractReceipt('file:///x/gone.jpg', deps({
      readBase64: async () => { throw new Error('ENOENT'); },
    }));
    expect(result.ok).toBe(false);
  });

  // This key is billable. It must never reach an on-screen error string, even
  // when the upstream error text echoes it back.
  it('never leaks the API key into a failure result', async () => {
    const secret = 'sk-proj-super-secret-value';
    const result = await extractReceipt('file:///x/a.jpg', deps({
      apiKey: secret,
      fetch: async () => jsonResponse({ error: { message: `bad key ${secret}` } }, 401),
    }));
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});

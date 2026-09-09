# Receipt Scanner — Design

**Date:** 2026-09-09
**Status:** approved, implementation started

## Purpose

Photograph anything you paid for; at the end of the month know where the money
went, without doing bookkeeping.

The justification chain — break any link and the app is pointless:

> scan is cheap → so you keep logging → so there's data → so the chart answers a question

This is also a learning project. The user plans, guides and tests on device;
Claude writes the code. Opus writes tests and verifies; Sonnet subagents implement.

## Constraints

Fixed by the environment, not chosen:

- iPhone, no Mac, no paid Apple Developer account ($99) — and not buying one
- No Android device
- Linux CachyOS, fish shell, node v22.22.2, bun 1.4.0

**Therefore Expo Go only. No native modules, ever.** Every decision below falls
out of that one constraint.

## Platform

- **Supported and tested target: iOS via Expo Go.** Scan QR from `npx expo start`
- **Android:** no iOS-specific APIs are used, so there are no known blockers, but
  it is *unverified and not claimed*. An emulator exists for Claude to screenshot
  and drive the UI during development; it is not a support target
- **Web: out of scope.** `expo-sqlite` web support is alpha and needs Metro wasm
  config plus COOP/COEP headers; `expo-camera` on web returns base64 rather than
  file paths, forking the image pipeline. Not worth it to avoid picking up a phone

## The loop

1. Tap **+** → camera, or pick a screenshot from the gallery
2. ~2s → confirm form appears, already filled
3. Glance, fix anything wrong, **Save**
4. Later → Charts

## Screens

**Home** — purchases newest-first, grouped by month with a running total per
month. Tap to edit or delete.

**Capture → Confirm** — camera or gallery, then the prefilled form. Every field
editable, including a currency picker.

**Charts** — bars per month for the last 6 months. Tap a month → category
breakdown for it.

## Input

Any image with a price on it. Camera for paper receipts, gallery for screenshots
of online orders, confirmation emails, invoices, price tags. One pipeline behind
both buttons.

Rationale: defining the app by what it *extracts* rather than what it
*photographs* means the user has hundreds of usable inputs already, rather than
waiting to accumulate paper.

## Extraction

**Gemini Flash**, free tier, called over plain `fetch` so it stays inside Expo Go.

Accuracy comes from prompt and schema design, not model choice:

- `temperature: 0` — same image, same answer
- **Every field nullable**, prompt instructs: return null if not clearly legible,
  do not guess
- **`total_source_text`** returned beside the number, so a wrong read is visible
  rather than mysterious
- **`category` constrained to a fixed enum** — an unconstrained string produces
  "Grocery" / "Groceries" / "Supermarket" and one chart slice per synonym
- Code-side guards: amount > 0, integer, date not in the future

Wire shape requested from the model:

```json
{ "merchant", "total_value", "total_text", "currency",
  "date_iso", "date_text", "category" }
```

`total_value` is the **model-normalised** canonical decimal — plain digits, `.`
separator, no grouping. This is deliberate: `1.234` is one-point-two-three-four
in Karachi and one-thousand-two-hundred-thirty-four in Berlin, and no regex can
tell which without knowing the receipt's origin. The model can see the receipt's
language, currency and merchant, so it disambiguates far better than a heuristic
could — and the app's parser then accepts exactly one canonical form, with no
regional separator tables at all.

`total_text` is the literal string as printed, kept so a misread is visible.

### The one principle

**The model is allowed to not know.**

Unreadable total → null. Non-receipt image → null. Ambiguous currency → null.
Every downstream affordance — the confirm form, the currency picker, the
"couldn't read this" message — is just the UI for that rule.

This is why the design contains no classifier, no confidence threshold, and no
retry logic. One rule paid for all of it.

### Not a receipt

A cat photo, a blur, and a receipt with the total torn off all return nulls and
all show:

> Couldn't read a purchase from this image. Enter it manually, or retake.

Three causes, one user action, one code path. No detector to build or tune.

## Categories

Fixed list: `Groceries · Eating out · Transport · Utilities · Shopping · Health · Other`

Two layers, each covering the other's weakness:

- **Gemini guesses.** It knows Imtiaz is groceries and Careem is transport,
  globally, without hardcoded merchant lists
- **User corrections are remembered and always win.** Pure LLM categorisation is
  unstable — the same shop lands in different categories on different runs,
  silently splitting totals across slices

Precedence: a stored correction beats the model's guess, permanently. Predictable
over clever.

## Money, currency, dates

**Amounts:** `amount_minor` INTEGER plus ISO 4217 `currency`. Never a float.
Hardcoding ×100 would be 100× wrong on a Japanese receipt and 10× wrong on a
Kuwaiti one.

**The exponent comes from an explicit ISO 4217 table, NOT from `Intl`.**

An earlier draft of this spec derived it from
`Intl.NumberFormat(...).resolvedOptions().maximumFractionDigits`, on the grounds
that the runtime already knows. It doesn't, reliably. Measured on this machine:

```
PKR  node ICU 78.2 -> 0    bun (JSC ICU) -> 2
COP  node ICU 78.2 -> 0    bun (JSC ICU) -> 2
JPY  0 / 0     KWD  3 / 3     USD  2 / 2
```

`Intl` reports **CLDR display digits**, which encode local writing convention
(nobody uses paisa, so CLDR says PKR shows 0 decimals) and shift between ICU
releases. `amount_minor` is *persisted*: if a row is written under exponent 2 and
read back under exponent 0, the amount is silently 100× wrong and nothing errors.

So the two concerns are separated:

- **Storage and arithmetic** → ISO 4217 exponent, explicit table (~25 exceptions,
  everything else 2). Standardised, stable, identical on every runtime
- **Display** → `Intl.NumberFormat`, with `minimumFractionDigits` and
  `maximumFractionDigits` both pinned to that same ISO exponent, so what is shown
  round-trips with what is stored regardless of the host's CLDR data

Caught by TDD before any receipt existed. See `src/lib/money.test.ts`.

**Charts never sum across currencies.** One chart per currency, most-used first.
No FX conversion: converting a March purchase at September's rate is wrong, not
approximate. Correct conversion needs historical per-date rates — a real feature,
not a line of code.

**Dates:** `spent_on` stored as `'YYYY-MM-DD'`. Not a timestamp, no timezone.
A purchase date is a calendar date like a birthday, not an instant. This deletes
the month-bucketing timezone problem rather than solving it.

**Merchant keys:** Unicode NFKC normalise + lowercase, not `toUpperCase()`.
Works for Urdu, Arabic, Chinese, Cyrillic.

## Data model

```sql
CREATE TABLE receipts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  merchant          TEXT    NOT NULL,
  merchant_key      TEXT    NOT NULL,        -- NFKC + lowercase
  amount_minor      INTEGER NOT NULL,        -- integer minor units, never float
  currency          TEXT    NOT NULL,        -- ISO 4217
  spent_on          TEXT    NOT NULL,        -- 'YYYY-MM-DD'
  category          TEXT    NOT NULL,
  image_path        TEXT,
  total_source_text TEXT,                    -- literal text the model read
  created_at        TEXT    NOT NULL
);

CREATE TABLE merchant_categories (
  merchant_key TEXT PRIMARY KEY,
  category     TEXT NOT NULL
);
```

- **Aggregate in SQL**, not JS: `GROUP BY currency, strftime('%Y-%m', spent_on)`
- **Images:** copied out of the OS cache into permanent storage; the **path** is
  stored, never the bytes. Cache paths get reclaimed by iOS and the gallery rots

## Stack

Expo SDK 57 · TypeScript 6 · React 19.2.3 · React Native 0.86.3

`expo-camera` · `expo-image-picker` · `expo-sqlite` · `expo-file-system`
(current `File`/`Paths` API, not the legacy `documentDirectory` string API)

Charts are plain `<View>` bars. No chart library, not even `react-native-svg`.

## Testing

- **Automated (Opus writes, `bun test`, zero test dependencies):** money math,
  currency digits, date parsing and validation, merchant-key normalisation,
  category precedence, Gemini response validation, aggregate SQL
- SQL is tested against `bun:sqlite`.
  <!-- ponytail: tests the SQL, not expo-sqlite's binding to it. Upgrade path is
       an on-device smoke test if a binding-level bug ever appears. -->
- **Not automated:** components, camera capture, anything needing a device
- **Claude verifies** structure, data and behaviour via emulator screenshots
- **User verifies** camera capture and iOS appearance on the real iPhone

## Out of scope

Backend · auth · sync · export · search · budgets · line items · FX conversion ·
retry queue · settings screen · web · App Store · development builds

Each gets added when it becomes a real complaint, not before.

## Security

The Gemini key lives in `.env` as `EXPO_PUBLIC_GEMINI_API_KEY` and is gitignored.
The `EXPO_PUBLIC_` prefix is what makes Expo inline it — which means the key
ships inside the JS bundle and is extractable by anyone who obtains the app.

Acceptable because the app is personal and never distributed. **If this app is
ever published or the repo made public, the key must move behind a proxy** (a
~20-line Cloudflare Worker; free plan is 100k requests/day and an awaited `fetch`
does not consume the 10ms CPU budget). All network calls are isolated in
`extractReceipt()` so that change is one URL.

## Corrections to the prior handoff

`HANDOFF.md` (2026-09-09, earlier session) contained three errors:

1. **"Use SDK 54, Expo Go is pinned to it"** — backwards. Expo Go on a physical
   iPhone runs the *latest* SDK; a 54 project is what would have failed to open.
   Verified: `npm view expo dist-tags` → `latest: 57.0.21`
2. **`FileSystem.documentDirectory`** — legacy API. Current is `File` / `Paths`
3. **"No OCR possible, manual entry only"** — true for *on-device* OCR, false
   overall. Cloud vision over `fetch` works in Expo Go and is the whole app

Its rejected-paths analysis (bare RN, iOS dev builds, SideStore entitlements,
BLE, backend) held up and is not revisited.

## Known environment issue

`create-expo-app` is broken under npm 12.0.2 — npm changed `npm pack --json`
output from an array to an object, and the tool still expects an array:

```
Error: Could not parse JSON returned from "npm pack expo-template-blank-typescript@latest --dry-run"
```

Worked around by unpacking `expo-template-blank-typescript@57.0.23` directly.
Relevant only if the project is ever re-scaffolded.

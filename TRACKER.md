# Tracker

Spec: `docs/superpowers/specs/2026-09-09-receipt-scanner-design.md`

**Roles** — Opus: tests + verification. Sonnet subagents: implementation.
User: plans, guides, tests camera + iOS look on the real iPhone.

**Now:** slices 2-3. SQL layer implementing against tests.

---

## Slices

Each ends runnable on the phone. `[x]` only when its proof passed.

- [x] **1 · It runs** — confirmed on emulator AND on the iPhone.
  Hot reload measured: 2964ms cold bundle, 24ms incremental.
- [ ] **2 · Image survives** — camera + gallery, copied to permanent storage
  - proof: photo still there after force-quit and reopen
  - tests: none (device-only)
- [ ] **3 · Manual entry + list**  (SQL tests written, 21 cases) — form, SQLite, list grouped by month
  - proof: add rows, kill app, reopen, rows intact
  - tests: schema, insert/read, month grouping, money round-trip
- [ ] **4 · Gemini reads it** — `extractReceipt()` prefills the form
  - proof: real screenshot, blurry photo, non-receipt image, airplane mode — all four behave, none crash
  - tests: response validation, null handling, guards, currency digits, date parsing
- [ ] **5 · Categories** — LLM guesses, corrections stick
  - proof: correct a merchant, rescan it, remembered
  - tests: precedence, merchant-key normalisation (Urdu/Arabic/Chinese)
- [ ] **6 · Charts** — monthly bars, tap for category breakdown
  - proof: chart numbers match the list
  - tests: aggregate SQL, per-currency separation

## Lib layer

- [x] money · dates · merchant · category · extract — 61 tests
- [x] Bugs caught by tests before any app code existed:
  - exponent from `Intl` was unsafe (node says PKR 0, bun says 2) → ISO 4217 table
  - `key in learned` walked the prototype chain → `Object.hasOwn`
  - `Number(bigint)` lost precision past MAX_SAFE_INTEGER → rejected

## Setup

- [x] git init, branch `main`, `.gitignore`
- [x] Expo SDK 57 + TypeScript scaffolded
- [x] `.env` with Gemini key, gitignored
- [x] Spec written
- [x] Android emulator — `receipt` AVD, API 35, headless, verified booted
- [x] Tests written for slices 3-5 logic; dates/merchant/category implemented

## Open

- Rotate the Gemini key — it was pasted into a chat transcript
- Category list is 7; add Rent / Education / Subscriptions if they come up
- Chart history is 6 months, arbitrary

## Notes

- npm 12.0.2 breaks Expo tooling in two places: `create-expo-app` (npm pack
  --json shape change) and `npx expo install` (passes --allow-scripts, which npm
  12 rejects for project-scoped installs). Workarounds: unpack the template
  tarball; run `npx expo install` to pin versions, then plain `npm install`.
  Downgrading to npm 11.x would remove both.
- ufw was blocking port 8081; opened for the LAN subnet only.

- 10 moderate npm advisories, all one root: `uuid` via `xcode` via
  `@expo/config-plugins`. `xcode` only runs during native prebuild, which Expo Go
  never does. Not in the runtime path. `audit fix --force` would downgrade Expo.

- `create-expo-app` is broken under npm 12.0.2. Template unpacked directly. Only
  matters if re-scaffolding.
- iOS is the only supported target. Android is unverified, not claimed.

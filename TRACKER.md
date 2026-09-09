# Tracker

Spec: `docs/superpowers/specs/2026-09-09-receipt-scanner-design.md`

**Roles** — Opus: tests + verification. Sonnet subagents: implementation.
User: plans, guides, tests camera + iOS look on the real iPhone.

**Now:** slice 4 — extraction module done and proven live; UI wiring next.

---

## Slices

Each ends runnable on the phone. `[x]` only when its proof passed.

- [x] **1 · It runs** — confirmed on emulator AND on the iPhone.
  Hot reload measured: 2964ms cold bundle, 24ms incremental.
- [x] **2 · Image survives** — camera + gallery, copied to permanent storage
  - Claude: gallery verified on emulator. Persists to
    `files/.../receipts/<timestamp>-<rand>.png` — documents, not cache.
  - YOU: camera verified on iPhone, permission prompt fine, layout fine.
  - iOS path confirmed: contains `Documents` and `receipts`, not `Library/Caches`.
  - Fixed en route: RN's SafeAreaView is iOS-only and gave no Android inset, so
    the title sat under the status bar. Now react-native-safe-area-context;
    confirmed on both emulator and iPhone.
  - full "survives force-quit" proof lands with slice 3, once the path is in SQLite
  - tests: none (device-only)
- [x] **3 · Manual entry + list** — form, SQLite, list grouped by month
  - Claude: emulator — saved a row, force-quit, reopened, row intact. Month
    total sums per currency (3,450.00 + 1,250.75 = 4,700.75).
  - YOU: iPhone — everything works, survives quit + restart.
  - Fixed en route: FAB moved bottom-right (Expo's gear covered the old
    top-right button); validation errors no longer fire before first touch.
  - tests: schema, insert/read, month grouping, money round-trip — 18 cases
- [x] **3.5 · Dark mode + pickers** — fixed dark palette, no toggle
  - `src/theme.ts` is the only place a colour literal appears.
  - Currency: closed list of 15 majors, so the 3-letter free-text error is gone.
  - Date: calendar picker, capped at today, floored 2000-01-01.
  - YOU: iPhone — wheels in a bottom sheet still to verify.
  - Fixed en route: TextInput has no inherited colour in RN and defaults to
    near-black, so typed text was invisible until `color` was set explicitly.
- [x] **4 · The app reads the receipt** — `extractReceipt()` prefills the form
  - Provider: OpenAI Responses API, `gpt-5.6-luna`, strict JSON schema, every
    field nullable. ~0.03c per scan.
  - Model chosen by benchmark, not vibes: 12 trials each across angled,
    shadowed, low-res and noisy photos. astra / terra / 5.4-mini / luna all
    scored 12/12, so the cheapest accurate one won. They only separate on a
    deliberately destroyed image — not representative, and a photo that bad
    is visibly bad to whoever took it.
  - Two methodology mistakes worth not repeating: picking a model off ONE
    run (nano's null looked like caution; over 5 trials it was the worst of
    the set), and letting the pathological case drive the decision instead
    of the common one.
  - Verified end-to-end on the emulator: gallery photo -> "Reading receipt…"
    -> form prefilled IMTIAZ SUPER MARKET / 3450.75 / PKR / 2026-09-08 /
    Groceries -> saved -> month total 1,250.75 + 3,450.00 + 3,450.75 =
    8,151.50. No float anywhere in that path.
  - Failure modes all degrade to the manual form: `offline`, `http`,
    `malformed`, `no-key`, `rate-limited` (with the wait), `no-credit`
    (billing — no Retry, since retrying cannot help).
  - 15s AbortController timeout per attempt; retries 500/503 only.
  - [x] YOU: real paper receipts on the iPhone — flawless, nothing needed
    correcting.
  - Bugs your real receipts found that my generated ones could not:
    - the parser took only canonical `1234.50`, so a printed `Rs 3,450.75`
      was silently discarded and the amount came back blank
    - a receipt with no currency printed anywhere made us throw the total
      away too; now the digits survive and pair with the selected currency
    - `Rs 1850/-` is everyday notation here and produced a blank
  - Upload now downscales to <=1600px (a 130-item receipt reads fine at
    160px wide). Full-resolution photo is still what gets saved. The
    intermittent "no internet" was very likely a multi-MB upload passing
    the 15s timeout, since an abort reports as offline.
- [ ] **5 · Categories** — LLM guesses, corrections stick
  - proof: correct a merchant, rescan it, remembered
  - tests: precedence, merchant-key normalisation (Urdu/Arabic/Chinese)
- [ ] **6 · Charts** — monthly bars, tap for category breakdown
  - proof: chart numbers match the list
  - tests: aggregate SQL, per-currency separation

## Lib layer

- [x] money · dates · merchant · category · extract · currencies · gemini — 100 tests
- [x] Bugs caught by tests before any app code existed:
  - exponent from `Intl` was unsafe (node says PKR 0, bun says 2) → ISO 4217 table
  - `key in learned` walked the prototype chain → `Object.hasOwn`
  - `Number(bigint)` lost precision past MAX_SAFE_INTEGER → rejected

## Repo

- https://github.com/ssobii2/receipt-scanner (public), branch `main`
- First commit `5c91856` — 31 files. `.env` gitignored; secret-scanned before push.

## Setup

- [x] git init, branch `main`, `.gitignore`
- [x] Expo SDK 57 + TypeScript scaffolded
- [x] `.env` with Gemini key, gitignored
- [x] Spec written
- [x] Android emulator — `receipt` AVD, API 35, headless, verified booted
- [x] Tests written for slices 3-5 logic; dates/merchant/category implemented

## Before this could go public

Not needed for personal use; recorded so it is not rediscovered later.

- The key ships inside the JS bundle (`EXPO_PUBLIC_`) and is extractable from
  any install. Public release means moving it behind a proxy — all network
  calls are isolated in `extractReceipt()`, so the app-side change is one URL.
- A bare proxy is a free Gemini for the internet: needs rate limiting, an
  image-size cap, App Check, and a billing cap with alerts.
- Receipt photos are financial data leaving the device to a third party.
  Public distribution needs a privacy policy and store disclosure.
- iOS distribution needs the $99 account and a real build; Expo Go is not a
  distribution channel.

## Considered and declined

- Double-read (extract twice, blank the amount when the two disagree). Would
  turn a silently wrong total into a visibly blank one — the failure that
  matters, since model misreads are random rather than repeatable. Declined:
  the user does not want a second API call per scan. The confirm-before-save
  step remains the only guard against a misread.

## Open

- Category list is 7; add Rent / Education / Subscriptions if they come up
- Chart history is 6 months, arbitrary

## Notes

- npm 12.0.2 breaks Expo tooling in two places: `create-expo-app` (npm pack
  --json shape change) and `npx expo install` (passes --allow-scripts, which npm
  12 rejects for project-scoped installs). Workarounds: unpack the template
  tarball; run `npx expo install` to pin versions, then plain `npm install`.
  Downgrading to npm 11.19.1 fixes `create-expo-app` but NOT `expo install` —
  EALLOWSCRIPTS exists in npm 11 too. Workaround for adding SDK modules: read the
  range from `node_modules/expo/bundledNativeModules.json` and `npm install` it.
- ufw was blocking port 8081; opened for the LAN subnet only.
- Restarting the emulator drops `adb reverse tcp:8081 tcp:8081`, which Expo only
  installs on first launch. Symptom: "Cannot connect to Expo CLI" and a stale
  bundle. Re-add it; don't restart Metro.
- Expo Go ceiling: Android's native dialogs (date picker, Picker dropdown) take
  their theme from the host activity, which is Expo Go itself, so they stay light
  regardless of system dark mode. iOS-only `themeVariant` works because it's a
  view prop, not a theme resource. Android UI is staying as-is by choice.
- Dropped Gemini entirely: free tier is 5 requests/minute AND 20/day per model,
  with a ~50% 503 rate. Unusable. The swap touched three files because every
  network call sits behind one function with injected dependencies.

- 10 moderate npm advisories, all one root: `uuid` via `xcode` via
  `@expo/config-plugins`. `xcode` only runs during native prebuild, which Expo Go
  never does. Not in the runtime path. `audit fix --force` would downgrade Expo.

- `create-expo-app` is broken under npm 12.0.2. Template unpacked directly. Only
  matters if re-scaffolding.
- iOS is the target. Android runs and is used for Claude's verification only.

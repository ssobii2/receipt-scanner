# Tracker

Spec: `docs/superpowers/specs/2026-09-09-receipt-scanner-design.md`

**Roles** — Opus: tests + verification. Sonnet subagents: implementation.
User: plans, guides, tests camera + iOS look on the real iPhone.

**Now:** all six slices done. Charts and navigation confirmed on the iPhone.

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
  - Tried and reverted: native Android spinner for currency. It themes fine
    (per-item `style` crosses the bridge; the rows really do go dark), but a
    native widget brings its own layout — reserved caret, padding, minimum
    height — and the field is 90px, so only the caret rendered. Two distinct
    ceilings, worth not confusing: the date dialog CANNOT be themed at all,
    while the spinner themes and simply does not fit. Native currency is only
    viable with bare-code labels (`PKR`), losing the names.
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
  - [x] YOU: verified on iPhone — a text screenshot now shows the notice.
  - Non-receipt photos (a text screenshot, a cat) used to leave a silently
    blank form. Now `hasUsableTotal()` gates a calm, dismissable notice.
    `isEmptyExtraction` was too strict for this — a non-receipt often still
    yields a plausible merchant from a heading, so all-null never tripped.
    No Retry on it: re-reading the same photo costs a call to get the same
    answer.
  - Total includes tax and tips, confirmed intended. Not a bug.
  - Upload now downscales to <=1600px (a 130-item receipt reads fine at
    160px wide). Full-resolution photo is still what gets saved. The
    intermittent "no internet" was very likely a multi-MB upload passing
    the 15s timeout, since an abort reports as offline.
- [ ] **5 · Categories** — DEFERRED, not abandoned. Every receipt so far was
  categorised correctly, so this fixes a problem not yet observed. Lib, SQL
  and tests already exist and are committed; wiring is ~20 lines whenever
  it's wanted. Editing one receipt's category already works — only
  cross-receipt memory is missing.
  - Build charts first: the failure this prevents (one merchant split across
    two categories by an unstable model) is invisible in the list and obvious
    in a chart. Building the fix before the instrument means never learning
    whether it was needed.
  - proof, when built: correct a merchant, rescan it, remembered
  - tests: precedence, merchant-key normalisation (Urdu/Arabic/Chinese)
- [x] **6 · Charts** — monthly bars, tap for category breakdown
  - One chart per currency, no selector: with a single currency it is just
    one plain chart. PKR and USD in one bar would be a meaningless number,
    and per-currency series make a tapped bar identify (month, currency) —
    exactly the pair CATEGORY_BREAKDOWN needs, so no extra picker.
  - Bars are plain Views. Six rectangles do not justify react-native-svg.
  - Zero-spend months keep their slot and label; the gap is the information.
  - Fixed en route: MONTHLY_TOTALS `$limit` bounded ROWS, but the query
    groups by month AND currency, so one month in two currencies was two
    rows — asking for 6 months could return 3, or slice a month in half.
    The month set is now chosen in a subquery first. The old tests passed
    because their fixtures were single-currency, where rows and months
    coincide.
  - Fixed en route: the peak value was rendered inside a bar column at
    flex:1, so `PKR 16,750.00` truncated to `PKR 16,750....`. Small test
    amounts would have fit; five-figure PKR is what exposed it. Moved to
    the currency heading row where the width exists.
  - Fixed en route: Charts and Back both landed under Expo Go's floating
    dev gear at top-right. Both are now bottom-left pills — that corner
    means "the other screen" on every screen. Same collision that moved
    the + FAB earlier; the top-right corner is unusable in this project.
  - Claude verified on the emulator with 6 months of seeded data (June
    deliberately empty, USD in two months): gap slot renders, each currency
    scales to its own peak, and August PKR 16,750.00 breaks down as
    Utilities 15,800.00 + Health 950.00 — matching the bar and the list.
    The USD 129.99 in the same month is correctly absent from it.
  - [x] YOU: iPhone — charts and gestures confirmed working
  - tests: aggregate SQL (month-vs-row limit), chart geometry — 14 cases

## Navigation

Was a `useState` discriminated union — deliberately, for four screens with no
deep-linking need. Replaced with React Navigation's native stack once the real
cost showed up: Android's back QUIT the app (an unclaimed back event reaches
Expo Go's host activity, which finishes the experience), and iOS had no
edge-swipe at all. Neither is buildable on a hand-rolled stack.

- `@react-navigation/native` + `native-stack`. `react-native-screens` and
  `react-native-gesture-handler` pinned EXACTLY, no caret — Expo Go ships one
  fixed native binary per module.
- Possible in Expo Go only because those native modules are already bundled;
  React Navigation itself is pure JS driving them. iOS swipe is therefore the
  real `UINavigationController` gesture, not a JS approximation.
- `headerShown: false` — every screen draws its own header and its bottom-left
  pill.
- The four screen components were NOT rewritten to take `navigation`/`route`.
  App.tsx holds one thin adapter per route that maps params onto the callback
  props the screens already had, so four verified screens stayed untouched.
- `navigate` to a route already in the stack REPLACES its params (merging needs
  `merge: true`), which is what makes the camera round trip deliver a fresh
  `imageUri` so extraction re-fires. Checked in the router source, not assumed.
- Regression the swap caused, found in use: Home stopped showing a new receipt
  until pull-to-refresh. `load` is a `useCallback([], ...)`, so
  `useEffect(..., [load])` fires once per MOUNT — and the old useState union
  unmounted Home on every navigation, so the reload was an accident nobody had
  written down. A stack keeps Home mounted underneath, so the accident stopped.
  No test or type could have caught it: nothing in the code ever claimed
  "reload on return". Fixed with `useFocusEffect` in App.tsx's HomeRoute
  bumping a `reloadToken` prop, keeping screens navigation-agnostic; the first
  focus is skipped so launch still loads exactly once. Charts was never
  affected — it is pushed and popped, so it genuinely remounts each visit.
- No `linking` config, deliberately: it pulls `query-string` -> a
  `decode-uri-component` ReDoS advisory. Not in the runtime path while we never
  parse URLs. That is 7 of the 17 moderate npm advisories; the other 10 are the
  pre-existing `uuid` via `xcode` via `@expo/config-plugins`, prebuild-only.

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
- Notice wording differs from the spec's "Enter it manually, or retake" —
  no retake affordance on the banner, since the capture button already is one

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

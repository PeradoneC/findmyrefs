# FindMyRefs

A Windows desktop app that helps artists research visual references. Describe the artwork you
want to make (subject, setting, colors, mood, lighting, composition, camera angle, style), and the
app turns the brief into editable search categories and queries, searches image sources, and lets
you collect results on a moodboard with notes and groups.

It is a reference research tool, not an image generator.

**Zero-cost by default.** Everything works without any API key: the default AI provider is a free,
offline mock, and the default search provider returns clearly labeled demo data. Paid AI (the
Anthropic API) is optional, off until you configure it, and guarded by local spending limits.

## Stack

| Layer         | Choice                                                                     |
| ------------- | -------------------------------------------------------------------------- |
| Desktop shell | Tauri 2 (Rust)                                                             |
| UI            | React 19 + TypeScript, Vite, dark theme                                    |
| Storage       | SQLite (`rusqlite`, bundled) with versioned migrations                     |
| Secrets       | Windows Credential Manager via the `keyring` crate                         |
| Validation    | `zod` in the frontend, `serde` + sanitizing in the backend                 |
| Tests         | Vitest + Testing Library, Rust `cargo test`, Playwright (Edge) end-to-end |

## Getting started

Prerequisites (Windows): Node.js 20+, Rust (rustup, MSVC toolchain), Visual Studio 2022 Build Tools
with the "Desktop development with C++" workload, and WebView2 (built into Windows 11).

```bash
npm install
```

```bash
npm run tauri:dev
```

That starts the desktop app with hot reload. To build a release executable:

```bash
npm run tauri:build
```

The installer and executable are written to `src-tauri/target/release/`.

### Browser preview

`npm run dev` serves the UI at http://localhost:1420. Opened in a normal browser, the app uses a
**browser backend** that keeps data in `localStorage` and supports only the free providers (mock AI,
mock search, Openverse). API keys can never be configured there. The end-to-end tests use this mode.

## Using the app

1. **Projects**: create or reopen a project. Deleting a project removes its brief, saved
   references, notes and board.
2. **Discover**: write the brief (English or Thai) and optionally fill in fields such as palette or
   exclusions. **Analyze brief** creates reference categories with several short search queries
   each. Edit, disable, reprioritize or add categories and queries, choose a search source, then
   **Search references**. `Ctrl+Enter` in the brief analyzes it.
3. **Results**: a masonry grid grouped by category, with a visible **Demo data** or **Live** label.
   Filter by category, provider, orientation or text. Each card shows title, creator, provider,
   license and an **estimated text match** (share of query words found in the title/tags, which is
   not an assessment of the image). Actions: open the original source, add to board, save, hide.
   Duplicate results (same id, same normalized URL, or same thumbnail) are merged. Failed queries
   are listed with a **Retry failed** button. **Load more** fetches the next page. Buttons open a
   prefilled search on Pinterest, ArtStation, Google Images, Behance, DeviantArt or X in your
   browser; those sites are never scraped.
4. **Board**: drag cards by their title bar, or focus a title bar and use the arrow keys
   (Shift = larger steps). Write notes, type a group name per card, **Arrange by group**, highlight a
   group, extract approximate color swatches, and export the board's metadata (links, attribution,
   notes, positions) as JSON. Everything is saved automatically.
5. **Settings**: AI provider, API key, model, spending guardrails, usage history, search options,
   and data controls.

Keyboard: `Alt+1` to `Alt+5` switch screens. All controls are reachable with Tab and have visible
focus rings.

## Providers

### AI providers

| Provider                                   | Cost                   | Notes                                                                                                                       |
| ------------------------------------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Mock (free)** (default)                  | Free                   | Deterministic offline parser plus query planner (English and some Thai vocabulary). No network requests. Labeled "Mock AI". |
| **Anthropic API (usage billed separately)** | Billed by Anthropic   | Brief analysis and analysis of selected images, via the Messages API from the Rust backend.                               |

Anthropic details:

- Calls go from the Rust backend to `POST https://api.anthropic.com/v1/messages` (`x-api-key`,
  `anthropic-version: 2023-06-01`). There is no official Rust SDK, so the adapter uses raw HTTP.
- Selectable models: `claude-opus-5-5` (default), `claude-sonnet-5-5`, `claude-haiku-5-5`.
- JSON output is constrained with structured outputs (`output_config.format`, a JSON schema) at
  `effort: "low"`, then validated again in Rust and in the frontend. Invalid output is rejected
  with a clear error.
- On the Opus/Sonnet 5.5 models, requests opt into Anthropic's server-side refusal fallback
  (`fallbacks: "default"`, beta header `server-side-fallback-2026-07-01`). When a fallback model
  answers, the usage log records that model and shows **Cost unavailable**, because billing may
  differ.
- Images are sent by URL: the provider's small thumbnail (never full-size images), and only
  `https` URLs. Demo images and local files are never sent.

### Search providers

| Provider                    | Access                     | Notes                                                                                                                                                                  |
| --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Demo data (mock)** (default) | Offline                 | Deterministic placeholder SVGs, titles starting "Demo:", `example.com` links, "not a real image" license text. Always labeled **Demo data**.                         |
| **Openverse (live)**        | Official API, no key needed | https://api.openverse.org, openly licensed images (mostly Creative Commons). Shows Openverse's own thumbnails and links to the original landing page with creator and license. |
| **Pinterest (official API)** | Your access token; Pinterest must approve your app | Keyword search via `GET https://api.pinterest.com/v5/search/partner/pins`. Desktop app only. Results link to the pin on pinterest.com and show Pinterest's own image (`i.pinimg.com`). See setup below. |
| ArtStation, Google Images, Behance, DeviantArt, X (and Pinterest without API access) | Not searched | "Open on …" buttons open a prefilled search on the site in your browser. Nothing is scraped. |

Openverse anonymous access is rate limited (about 20 requests/minute and 200/day at the time of
writing). The app searches with limited concurrency and stops the remaining queries after a 429.
Keep "Queries per category" low (default 2) for large briefs.

### Setting up Pinterest search (optional, free, needs Pinterest's approval)

Pinterest's keyword search endpoint is marked by Pinterest as **beta and "not available to all
apps"**. It works only after Pinterest approves your developer app for it; until then Pinterest
answers 403 and the app shows that message. The other v5 search endpoint (`/v5/search/pins`) only
searches your own saved pins, so it is not used here. The app never scrapes pinterest.com.

1. Sign in at developers.pinterest.com with your Pinterest account and create an app (My apps).
2. Request access to keyword search ("search partner pins", `/v5/search/partner/pins`) through
   Pinterest's process for beta and restricted features. Pinterest decides; it can take time or be
   declined.
3. Create an access token for your app with the `pins:read` and `boards:read` scopes.
4. In FindMyRefs, open **Settings → Pinterest**, paste the token, press **Save token**, set your
   two-letter country (Pinterest requires one, e.g. `US` or `TH`), and press **Test connection**.
5. On **Discover**, choose **Pinterest (official API, needs approval)** as the search source.

How it is wired: the token is stored in the Windows Credential Manager (a separate entry from the
Anthropic key) and only the Rust backend sends it, to `api.pinterest.com`. The backend validates the
JSON and the frontend normalizes each pin (numeric id, an `https` image, title, description), drops
anything unsafe, and pages with Pinterest's `bookmark` cursor for **Load more**. A missing, expired
or unapproved token stops the remaining queries after the first error instead of sending them all.
Pinterest's API itself is free; it is not a paid AI feature.

Test hooks in the mock search provider: a query containing `__error__` fails, `__empty__` returns
nothing, and `__slow__` times out.

## Cost controls (paid AI)

- Paid AI is never enabled silently. It needs: the Anthropic provider selected, an API key, the
  one-time billing notice accepted, and an explicit button press (the backend rejects requests
  without the confirmation flag).
- **Anthropic API billing is separate from Claude Pro/Max.** A Claude subscription does not give
  this app API credits unless your plan explicitly says so.
- **Disable paid AI** blocks every paid request immediately, whatever else is configured.
- Image analysis is off by default. You select images and press **Analyze selected**; a dialog
  shows how many images will be sent, how many are cached, the model and its list price, and states
  that the cost cannot be estimated reliably in advance. Cancel is always available.
- **Maximum images per batch** (default 3) is enforced in the UI and again in the backend.
- Results are cached by `provider|model|source id|analysis version`, so the same image is not sent
  twice. **Re-run cached analyses** lets you refresh on purpose.
- **Monthly request limit** (default 50) and **local monthly spending target** (default $5) block
  new paid requests once reached, until you raise them or choose **Override for this month**.
- The **usage panel** records time, provider, model, feature, image count, tokens reported by the
  API, and an estimated cost from published list prices (as of 2026-10, in
  `src-tauri/src/pricing.rs`). Unknown usage or price shows **Cost unavailable**; nothing is guessed.
  You can clear the history.
- **These are local app limits, not a provider-side billing cap.** Estimates can differ from real
  charges, and other apps using the same key are not counted. The Anthropic Console billing page is
  authoritative; set limits there too if you need a hard cap.
- There are no automatic top-ups.

### Setting up the Anthropic API (optional)

1. Create an API key in the Anthropic Console (console.anthropic.com, under API keys) and set up
   billing there.
2. In the app, open **Settings → Anthropic API setup**, paste the key, and press **Save key**.
3. Select **Anthropic API (usage billed separately)**, pick a model, and review the guardrails.

## Security and privacy

The user-facing privacy policy is in [PRIVACY.md](PRIVACY.md).

- **API key**: stored in the Windows Credential Manager (service `com.findmyrefs.app`). The
  frontend can set or remove it and ask whether one exists, but the key is never returned to the
  webview, logged, or written to the database. The Rust `ApiKey` type redacts itself in
  `Debug`/`Display`. The app does **not** read API keys from environment variables or `.env`.
- **Local data**: SQLite at `%APPDATA%\com.findmyrefs.app\findmyrefs.sqlite` (override with
  `FINDMYREFS_DB_PATH`, see `.env.example`). Only metadata and links are stored, never copies of
  images. Thumbnails are loaded from the provider when displayed.
- **Untrusted data**: search results and AI output are validated and size-limited. Only
  `http(s)` links can be opened, and links open via the backend after validation. The desktop
  webview's CSP allows images only from `https:` and inline `data:` (the mock provider's SVGs) and
  network calls only to the backend and Openverse. The webview has only the core Tauri permission
  (no shell, no file system).
- **Removal**: delete projects on the Projects screen. Clear usage history and cached analyses in
  Settings.

## Development

```bash
npm run check
```

That runs `typecheck`, `lint`, `format:check` and the unit tests. The individual scripts:

| Script                 | What it does                                                    |
| ---------------------- | --------------------------------------------------------------- |
| `npm run typecheck`    | TypeScript (`tsc`) for the app, tests and tool configs          |
| `npm run lint`         | ESLint (typescript-eslint and React hooks/compiler rules)       |
| `npm run format`       | Prettier (`format:check` to verify)                             |
| `npm test`             | Vitest unit and component tests (`tests/unit`)                  |
| `npm run test:e2e`     | Playwright end-to-end tests in Microsoft Edge (`tests/e2e`)     |
| `npm run rust:test`    | Rust unit and integration tests (`cargo test`)                  |
| `npm run rust:lint`    | `cargo clippy -D warnings`                                      |
| `npm run rust:fmt`     | `cargo fmt --check`                                             |
| `npm run build`        | Typecheck and build the frontend                                |
| `npm run tauri:build`  | Build the desktop app                                           |

Playwright uses the Edge browser that ships with Windows (`PLAYWRIGHT_CHANNEL` overrides it).

### Project layout

```
src/
  app/                 shell, navigation, app-wide state (AppContext)
  components/          shared UI (badges, dialogs, banners, skeletons)
  features/brief/      Discover screen, deterministic parser, query planner, brief providers
  features/search/     Results screen, search providers (mock, Openverse, Pinterest, web links), dedupe, ranking
  features/analysis/   image-analysis providers, cache keys, confirm dialog
  features/board/      Board screen, drag/drop cards, layout, export, color swatches
  features/settings/   Settings, usage panel, billing notice
  features/projects/   Projects screen
  lib/                 shared types, zod schemas, URL helpers, model list, backends
src-tauri/src/
  db/                  SQLite connection, migrations, parameterized queries
  providers/anthropic.rs  Anthropic Messages API adapter (request building, parsing, errors)
  providers/pinterest.rs  Pinterest keyword search adapter (official API v5, token from the credential store)
  ai_service.rs        paid-request orchestration: guard -> request -> usage log -> cache
  guard.rs             spending guardrails
  pricing.rs           list prices for estimates
  secrets.rs           OS credential store, redacted ApiKey type
  settings.rs          non-secret settings with validation
  commands.rs          Tauri commands
tests/
  unit/                Vitest suites
  e2e/                 Playwright suites
src-tauri/tests/       Rust persistence integration tests
```

## Current limitations

- Live search works out of the box only with Openverse. Pinterest search needs a token from a
  Pinterest app that Pinterest has approved for keyword search; it has been tested against the
  request/response format in Pinterest's published OpenAPI description and with fake responses, but
  not with an approved app (none was available). Other sites are reachable only through "open search
  on site" links.
- Pinterest access tokens expire. The app does not run Pinterest's OAuth refresh flow; paste a new
  token when Pinterest rejects the old one.
- Search results are held in memory per session. Saved references, the board, notes and the brief
  persist; result lists do not.
- The paid Anthropic path is covered by tests against a fake transport (request shape, error
  mapping, guardrails, caching, usage logging) but has not been exercised against the live API in
  this repository, because no API key was available.
- Cost estimates use list prices only (no prompt-caching or batch discounts). Image cost cannot be
  estimated before sending.
- Color swatches work only when the image host allows cross-origin reads. Otherwise the app says
  the colors are unavailable.
- Board export is metadata JSON only (no image export yet). Cards have a fixed size.
- End-to-end tests drive the UI in a browser with the browser backend. The native Tauri window and
  SQLite path are covered by Rust tests and manual launches, not by automated UI tests (that would
  need `tauri-driver`).
- Windows is the only tested platform. The code avoids Windows-only APIs except the credential
  store choice, which `keyring` maps to Keychain or Secret Service on other platforms.

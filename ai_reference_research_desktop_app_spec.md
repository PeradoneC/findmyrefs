# AI Reference Research Desktop App --- MVP Specification for Claude Code

## 1. Role and objective

You are the lead software engineer implementing a desktop application
for artists to research, collect, and organize visual references from
multiple online sources.

Build a usable MVP first. Do not attempt to integrate every website
immediately. Prioritize a working end-to-end flow, clear architecture,
maintainability, and transparent source attribution.

The app's core promise:

> An artist describes an artwork they want to create --- including
> subject, setting, colors, theme, mood, lighting, composition, camera
> angle, and style --- and the app turns that brief into organized
> reference searches and a visual board.

This is a reference research and moodboard tool, not an image generator.

## 2. Initial product decisions

-   Initial platform: Windows desktop.
-   Desktop framework: Tauri.
-   Frontend: React + TypeScript.
-   UI: modern dark theme, designed for artists and visual research.
-   Local persistence: SQLite.
-   AI: provider abstraction, initially supporting an Anthropic Claude
    API adapter.
-   Search: provider abstraction. Use only official APIs or other
    methods permitted by the relevant provider's terms. Never make the
    MVP depend on bypassing authentication, CAPTCHAs, paywalls, or
    anti-bot controls.
-   MVP search provider: implement one real, accessible search provider
    first. If credentials are unavailable, provide a clearly labeled
    mock/demo provider so the rest of the app can be developed and
    tested.
-   Future compatibility: design for macOS, additional search providers,
    local AI, and image similarity search, but do not build these
    prematurely.

## 3. Main user journey

1.  User creates a project.
2.  User enters an art brief in natural language.
3.  AI converts the brief into structured fields and search queries.
4.  User reviews and edits the proposed categories and queries.
5.  The app searches available providers.
6.  Results appear in a grid, grouped by category.
7.  User opens a result, visits its original source, saves it, or adds
    it to a board.
8.  User arranges reference cards on a board, adds notes, and groups
    references.
9.  The project is saved locally and can be reopened later.

The user must remain in control of which references are selected. AI
recommendations are suggestions, not automatic final decisions.

## 4. Core screens

### 4.1 Discover

Include: - Project name. - Large art-brief text area. - Optional fields
for subject, environment, palette, mood, lighting, composition, camera
angle, style, and exclusions. - Search source selector. - Button:
Analyze brief. - Button: Search references. - Loading, empty, error, and
retry states. - A clear indicator of whether the result is live data or
demo data.

### 4.2 Search results

Include: - Responsive masonry/grid layout. - Thumbnail, title,
source/provider, creator name if available, and original source link. -
Category label. - Relevance score only if a real scoring method is
implemented; explain that it is an estimate. - Actions: Open source, Add
to board, Save, Hide result. - Filters by category, provider,
orientation, and search query where metadata is available. - Duplicate
detection to avoid showing the same URL or identical result
repeatedly. - Do not hotlink or cache full-size remote images unless the
provider and applicable terms allow it. Prefer provider thumbnails or
permitted image URLs.

### 4.3 Board workspace

Include: - Board with reference cards. - Add/remove cards. - Drag and
drop to reposition cards. - Editable notes per card. - Group cards by
category or custom section. - Optional color swatches extracted from a
selected image. - Save board state, card positions, notes, and groups to
SQLite. - Open original source from each card. - Basic export of board
metadata. Image export can be added after the core flow works.

### 4.4 Settings

Include: - Configure API credentials securely. - Select AI
provider/model when supported. - Select search provider. - Display
whether AI is configured. - Display a warning that API usage may incur
separate costs. - Optional per-session image-analysis limit and AI
spending guardrails. - Never print API keys to logs or expose them to
frontend code unnecessarily.

## 5. AI brief analysis

Create a typed structured schema similar to:

``` ts
type ArtBrief = {
  originalPrompt: string;
  subject: string[];
  environment: string[];
  palette: string[];
  lighting: string[];
  mood: string[];
  composition: string[];
  cameraAngle: string[];
  style: string[];
  materialsOrTextures: string[];
  exclusions: string[];
  referenceCategories: Array<{
    id: string;
    name: string;
    purpose: string;
    searchQueries: string[];
    priority: "high" | "medium" | "low";
  }>;
};
```

Requirements: - The AI should preserve the user's original intent. -
Generate multiple useful search queries per category, not just repeat
the original prompt. - Queries should be concise and suitable for image
search. - Queries can be in English to improve search coverage, while
the UI can remain easy to use for Thai speakers. - Do not invent factual
claims about images that have not been inspected. - Validate model
output against a schema and handle invalid responses. - Allow the user
to edit generated categories and queries before searching. - If AI is
not configured, allow manual search and optionally use a deterministic
basic parser.

## 6. AI image analysis and ranking

Do not send every search result image to a high-cost vision model by
default.

Design a provider interface so the app can later support: - Claude
vision API for selected images or batches when semantic reasoning is
needed. - Image embeddings or a lower-cost vision model for bulk
similarity/ranking. - Local models in a future version.

For the MVP: - Search first. - Use metadata and text relevance for
initial ranking. - Allow optional AI analysis only on selected images or
a small capped batch. - Downscale images before sending them to an
image-analysis provider when appropriate. - Cache analysis results
locally using a stable image/source identifier, where permitted. - Add
configurable limits for the number of images analyzed per action. - Show
errors and estimated-cost warnings where the provider supports reliable
estimates. - Never imply that Claude.ai subscription usage automatically
grants API access. API authentication and billing are separate unless
the user's plan explicitly provides eligible credits.

Example analysis output:

``` ts
type ReferenceAnalysis = {
  summary: string;
  detectedCategories: string[];
  palette?: string[];
  lighting?: string;
  composition?: string;
  mood?: string[];
  relevanceExplanation: string;
};
```

Treat analysis as an imperfect suggestion. Do not claim image properties
with certainty when the image is ambiguous.

## 7. Search provider architecture

Create a provider interface, for example:

``` ts
type ImageSearchQuery = {
  query: string;
  page?: number;
  safeSearch?: boolean;
};

type ImageSearchResult = {
  id: string;
  title: string;
  thumbnailUrl?: string;
  sourceUrl: string;
  provider: string;
  creatorName?: string;
  width?: number;
  height?: number;
  publishedAt?: string;
  licenseLabel?: string;
};

interface ImageSearchProvider {
  id: string;
  displayName: string;
  search(query: ImageSearchQuery): Promise<ImageSearchResult[]>;
}
```

Requirements: - Each provider lives in its own module. - Normalize
results into the same internal schema. - Keep provider-specific fields
when useful, without leaking provider-specific logic into the UI. -
Handle rate limits, timeouts, empty responses, invalid metadata, and
provider errors. - Support pagination if the provider offers it. - Use
official/authorized access paths and respect terms, attribution, and
rate limits. - Do not assume Pinterest, Google Images, X, or ArtStation
all permit the same access method. - When a direct API is unavailable,
provide a button to open a prefilled search on the provider's website
instead of scraping it. - Never fabricate results in production mode.
Clearly label mock data in development/demo mode.

## 8. Suggested architecture

Use a clean separation of responsibilities:

-   `src/` --- React UI, routes/screens, components, hooks, state.
-   `src/features/brief/` --- brief editor, schema, analysis UI.
-   `src/features/search/` --- query planning, result grid, filters.
-   `src/features/board/` --- board canvas, cards, drag/drop, notes.
-   `src/features/settings/` --- provider configuration and cost
    warnings.
-   `src/lib/` --- shared types, validation, utilities.
-   `src-tauri/` --- Tauri commands, secure configuration access, SQLite
    integration.
-   `src-tauri/src/providers/` --- provider adapters where appropriate.
-   `src-tauri/src/db/` --- database and migrations.
-   `tests/` --- unit and integration tests.

Adjust this structure if the selected Tauri template or current project
conventions require a different arrangement. Do not create needless
abstractions.

## 9. Data model

At minimum, persist:

### Project

-   `id`
-   `name`
-   `original_prompt`
-   `structured_brief_json`
-   `created_at`
-   `updated_at`

### SearchSession

-   `id`
-   `project_id`
-   `query`
-   `provider`
-   `category`
-   `created_at`

### Reference

-   `id`
-   `project_id`
-   `provider`
-   `provider_result_id`
-   `title`
-   `thumbnail_url`
-   `source_url`
-   `creator_name`
-   `width`
-   `height`
-   `license_label`
-   `user_notes`
-   `analysis_json`
-   `created_at`

### BoardItem

-   `id`
-   `project_id`
-   `reference_id`
-   `group_name`
-   `position_x`
-   `position_y`
-   `width`
-   `height`
-   `sort_order`
-   `created_at`
-   `updated_at`

Use migrations and parameterized SQL. Define foreign keys and indexes
where appropriate. Avoid storing unnecessary copies of copyrighted
images. Store source metadata and links by default.

## 10. Security and privacy

-   Keep API secrets out of source control and frontend bundles.
-   Use the operating system's secure credential storage if practical;
    otherwise document the limitations of the development implementation
    and avoid plaintext secrets where possible.
-   Add `.env.example` with placeholder names only; never commit real
    keys.
-   Validate external URLs and handle network failures safely.
-   Do not execute content returned by websites or AI.
-   Treat search results and image metadata as untrusted data.
-   Do not silently upload local user images to a third-party model.
-   Before analyzing a local image remotely, explain that it will be
    sent to the configured provider and require user action.
-   Provide a clear way to remove local projects and saved metadata.

## 11. UI/UX requirements

-   Dark theme by default, with readable contrast and clear focus
    states.
-   Artist-oriented, calm interface; avoid excessive dashboards and
    decorative clutter.
-   Use clear labels and tooltips.
-   Support keyboard navigation for primary actions.
-   Provide skeleton/loading states, empty states, actionable errors,
    and retry buttons.
-   Do not make controls look interactive if they do nothing.
-   Use realistic spacing and reusable components.
-   Prioritize the board and image grid over complex settings.

## 12. Testing and quality

Implement: - Unit tests for brief validation and query planning. - Unit
tests for result normalization and duplicate detection. - Tests for
database persistence and board positions. - Tests for provider errors,
timeouts, and empty results. - A mock provider for deterministic
tests. - Basic end-to-end test for: create project → enter prompt →
analyze/mock → search → add result → add note → restart/reopen
project. - Linting, formatting, type checking, and build scripts.

Do not claim tests passed unless you actually ran them. Document
anything that cannot be tested in the current environment.

## 13. Development sequence

Implement in small, verifiable milestones:

### Milestone 1 --- Project foundation

-   Inspect the existing repository before changing anything.
-   If the repository is empty, initialize the Tauri + React +
    TypeScript project using the current stable recommended setup.
-   Add linting, formatting, types, and a minimal app shell.
-   Ensure the app runs.

### Milestone 2 --- Local projects and persistence

-   Create project list and project creation flow.
-   Add SQLite schema/migrations.
-   Verify projects persist across restarts.

### Milestone 3 --- Art brief and query planner

-   Build the brief editor.
-   Implement typed brief schema and validation.
-   Add an AI provider abstraction and mock implementation.
-   Add Anthropic API integration only after the provider interface and
    settings are working.

### Milestone 4 --- Search results

-   Implement one real authorized search provider if credentials/access
    are available.
-   Otherwise implement a clearly labeled mock provider and a web-search
    fallback link.
-   Build normalized results, loading/error states, filters, and
    duplicate detection.

### Milestone 5 --- Board

-   Add references to a board.
-   Implement drag/drop, notes, groups, persistence, and opening source
    links.

### Milestone 6 --- Hardening

-   Add tests, secure configuration, error handling, accessibility
    improvements, and documentation.
-   Add clear API billing/cost warnings and usage limits.

Do not skip milestones or build all features in one enormous code
change. Keep the app runnable after each milestone.

## 14. Definition of done for the MVP

The MVP is acceptable when: - The desktop app launches on Windows. - A
user can create and reopen a project. - A user can enter an art brief. -
The brief can be converted into editable search categories and
queries. - Search results are displayed in a consistent grid, with mock
data explicitly labeled if no live provider is configured. - Each result
exposes its original source URL. - A user can add results to a board,
move them, write notes, and persist the layout. - Errors are visible and
recoverable. - API keys are not committed or unnecessarily exposed. -
The README explains setup, environment variables, supported providers,
current limitations, and how to run tests. - Build and tests are
actually run and their results reported.

## 15. Instructions for the coding agent

Start by inspecting the repository and reporting: 1. Current files and
framework, if any. 2. Environment/tooling constraints. 3. A short
implementation plan for Milestone 1.

Then implement Milestone 1 and verify it runs. Continue to the next
milestone only when the previous one is in a working state. Do not stop
after writing a plan; make code changes and run the relevant checks.

Make sensible defaults without asking about every minor detail. Ask a
question only when a missing decision blocks implementation or risks
major rework.

If an external API requires credentials, do not invent credentials.
Implement the interface and configuration flow, document the setup, and
keep a clearly labeled mock/demo mode so development can continue.

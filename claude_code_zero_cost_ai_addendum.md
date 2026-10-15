# Claude Code Addendum: Zero-Cost-First AI Architecture

## Purpose

Apply these requirements to the existing
`ai_reference_research_desktop_app_spec.md` specification for the AI
Reference Research Desktop App.

The goal is to build and test the app without additional AI API spending
by default, while allowing the user to explicitly enable paid AI
features later.

## 1. Cost policy

-   Development and demo mode must work without an Anthropic API key.
-   Do not assume a Claude Pro subscription includes Anthropic API usage
    or API credits.
-   Claude Pro may be used separately in Claude Code to help write and
    modify the app, subject to the user's subscription limits.
-   Calls made by the running desktop app to the Anthropic API are
    billed separately unless the user's account has an explicitly
    applicable credit or arrangement.
-   Never silently enable paid AI processing.
-   Never implement automatic top-ups.
-   Clearly label any feature that can incur API costs.
-   Do not promise that a configurable spending target is a hard billing
    cap unless the API provider guarantees that behavior. Explain the
    difference between a local app limit and a provider-enforced billing
    limit.

## 2. Default providers

Implement provider interfaces and make these the defaults:

### Mock AI provider

-   Enabled by default.
-   Requires no credentials and makes no network requests.
-   Returns deterministic, clearly labeled demo results.
-   Supports the same typed inputs and outputs as the real AI provider.
-   Allows the user to test the entire workflow, including brief
    analysis and reference categorization.

### Mock search provider

-   Enabled by default in demo mode.
-   Returns clearly labeled demo results with safe, non-deceptive sample
    metadata.
-   Never pretends demo results are live results.
-   The UI must display a visible `Demo data` label when this provider
    is active.

### Real search provider

-   Implement one provider adapter at a time.
-   Use official APIs or other permitted access methods.
-   Do not bypass authentication, CAPTCHAs, paywalls, or anti-bot
    systems.
-   If credentials are missing, show setup instructions and provide an
    option to open a prefilled search on the source website.
-   Never fabricate live results.

## 3. Optional Anthropic API provider

Create a provider interface, such as:

``` ts
interface BriefAnalysisProvider {
  id: string;
  displayName: string;
  analyzeBrief(prompt: string): Promise<ArtBrief>;
}

interface ImageAnalysisProvider {
  id: string;
  displayName: string;
  analyzeImage(input: ImageAnalysisInput): Promise<ReferenceAnalysis>;
}
```

Implement an Anthropic API adapter behind these interfaces. Use the
current official Anthropic API documentation for endpoint, model
identifiers, image input format, and authentication. Do not hardcode a
retired model or invent an endpoint.

Requirements:

-   The API provider is disabled until the user explicitly configures
    it.
-   Explain that Anthropic API billing is separate from Claude Pro.
-   Do not request or send an API key unless the user chooses to
    configure the provider.
-   Keep secrets out of the React frontend bundle and source control.
-   Use a secure OS credential store where practical. If not available
    in the current environment, document the limitation and implement
    the safest feasible alternative.
-   Never log API keys, request authorization headers, or sensitive
    image payloads.
-   Provide clear handling for invalid keys, rate limits, network
    failures, and provider errors.
-   Validate all AI responses against runtime schemas before use.
-   Treat AI output as untrusted data and never execute it as code.

## 4. Image-analysis cost controls

Do not analyze all search results automatically.

Implement these controls:

-   AI image analysis is off by default.
-   The user must select images and explicitly press an
    `Analyze selected` action.
-   Show the number of images to be analyzed before confirmation.
-   Let the user configure a maximum number of images per batch.
-   Start with a conservative default batch limit of 3 images.
-   Provide a cancel action before sending the request.
-   Avoid sending the same image/source identifier for analysis
    repeatedly when a cached result exists.
-   Cache results locally using a stable key based on provider, model,
    source identifier, and analysis version, where permitted.
-   Let the user rerun analysis manually.
-   Do not send local files or private images to a remote AI service
    without explicit user action and a clear disclosure.
-   Resize or downsample images when appropriate and permitted,
    balancing cost and analysis quality.
-   Prefer metadata/text relevance ranking before using vision models.
-   If cost cannot be estimated reliably, say so before the user
    confirms.

## 5. Usage tracking and spending guardrails

Create a local usage panel that records, when available:

-   Date/time of request.
-   Provider and model.
-   Feature: brief analysis or image analysis.
-   Number of images processed.
-   Input/output token usage if returned by the provider.
-   Estimated cost when the current pricing information and usage
    metrics make estimation possible.

Requirements:

-   Clearly label cost values as estimates.
-   Never invent token counts, rates, or costs.
-   If usage or pricing data is unavailable, show `Cost unavailable`
    rather than guessing.
-   Provide a user-configurable local monthly spending target.
-   Provide a user-configurable monthly request limit.
-   Block new paid requests when the local target or request limit has
    been reached, until the user explicitly overrides or changes the
    setting.
-   Clearly explain that a local spending target is not necessarily a
    hard provider-side billing cap; the provider's billing console is
    authoritative.
-   Provide a `Disable paid AI` setting that immediately prevents new
    API calls.
-   Provide a way to clear local usage history.

## 6. No-cost workflow

The complete app must remain useful without paid AI:

1.  User enters an art brief.
2.  Mock AI or a basic deterministic parser creates editable categories
    and queries.
3.  User edits the queries.
4.  Mock search results or an authorized real search provider supplies
    results.
5.  Text/metadata-based rules rank results when possible.
6.  User adds selected references to the board.
7.  The board, notes, and source links persist locally.

The user must be able to use the Board, local projects, saved notes,
category management, and demo mode without an AI API key.

## 7. UI requirements

In Settings, include:

-   AI provider selector: `Mock (free)` and
    `Anthropic API (usage billed separately)`.
-   Current provider status.
-   API setup instructions.
-   `Disable paid AI` toggle.
-   Maximum images per analysis batch.
-   Monthly request limit.
-   Local monthly spending target.
-   Usage summary and estimated costs where available.
-   A warning before the first paid API request.
-   A confirmation dialog before analyzing a batch of images.
-   Clear error messages and retry actions.

In the Discover screen:

-   Label demo results clearly.
-   Allow editing generated queries before a search.
-   Make AI usage visible when an action will call a paid provider.

## 8. Tests

Add tests that verify:

-   The app launches and works without an API key.
-   Mock mode makes no external AI requests.
-   Demo data is clearly labeled.
-   Paid AI cannot be called when disabled.
-   Paid AI requests require explicit user action.
-   Image batch limits are enforced.
-   Cached analyses prevent duplicate requests.
-   Monthly request limits and local spending guardrails are enforced.
-   API keys do not appear in logs or UI diagnostics.
-   Invalid API responses are handled safely.
-   Search and board features continue working when AI is unavailable.

Do not claim tests passed unless they were actually run. Report the
command and actual result.

## 9. Implementation instructions

1.  Read the main `ai_reference_research_desktop_app_spec.md` and this
    addendum completely.
2.  Inspect the repository before making changes.
3.  Integrate this addendum into the existing architecture rather than
    duplicating modules.
4.  Keep mock providers as the default.
5.  Implement in small milestones and keep the app runnable.
6.  Run linting, type checking, tests, and builds where the environment
    supports them.
7.  Report completed work, actual test results, required credentials,
    and any remaining limitations.

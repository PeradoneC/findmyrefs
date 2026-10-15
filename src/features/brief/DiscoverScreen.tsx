import { useEffect, useMemo, useRef, useState } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { Banner, DataLabel, ErrorBanner, FreeBadge, PaidBadge } from "../../components/ui";
import { emptyBrief } from "../../lib/schemas";
import type { ArtBrief, BriefFieldKey, ReferenceCategory, SearchProviderId } from "../../lib/types";
import { BillingWarningDialog } from "../settings/BillingWarningDialog";
import { SEARCH_PROVIDER_OPTIONS } from "../search/providers";
import { buildSearchPlan } from "../search/searchRunner";
import { splitFieldInput } from "./basicParser";
import {
  createAnthropicBriefProvider,
  mockBriefProvider,
  type ManualFields,
} from "./briefProviders";
import { CategoryEditor } from "./CategoryEditor";
import { BRIEF_FIELDS } from "./queryPlanner";

const SOURCE_LABELS: Record<string, string> = {
  mock: "Mock AI (demo)",
  "basic-parser": "Basic parser",
  anthropic: "Anthropic API",
  manual: "Manual",
};

export function DiscoverScreen() {
  const app = useApp();
  const {
    backend,
    project,
    settings,
    aiStatus,
    setProject,
    setScreen,
    updateSettings,
    refreshAiStatus,
  } = app;
  const [prompt, setPrompt] = useState(project?.originalPrompt ?? "");
  const [name, setName] = useState(project?.name ?? "");
  const [fieldInputs, setFieldInputs] = useState<Partial<Record<BriefFieldKey, string>>>({});
  const [draft, setDraft] = useState<ArtBrief | null>(app.brief);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingBrief = useRef<ArtBrief | null>(null);

  const paid = settings?.aiProvider === "anthropic";
  const projectId = project?.id;

  const manualFields: ManualFields = useMemo(() => {
    const out: ManualFields = {};
    for (const { key } of BRIEF_FIELDS) {
      const list = splitFieldInput(fieldInputs[key] ?? "");
      if (list.length) out[key] = list;
    }
    return out;
  }, [fieldInputs]);

  async function saveProject(patch: {
    name?: string;
    originalPrompt?: string;
    structuredBriefJson?: string | null;
  }) {
    if (!projectId) return;
    try {
      setProject(await backend.updateProject(projectId, patch));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  // Debounced brief persistence while the user edits categories.
  function persistBrief(next: ArtBrief, immediate = false) {
    setDraft(next);
    pendingBrief.current = next;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const run = () => {
      const b = pendingBrief.current;
      pendingBrief.current = null;
      saveTimer.current = null;
      if (b) void saveProject({ structuredBriefJson: JSON.stringify(b) });
    };
    if (immediate) run();
    else saveTimer.current = setTimeout(run, 500);
  }

  // Flush unsaved edits when leaving the screen.
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const b = pendingBrief.current;
      if (b && projectId)
        void backend
          .updateProject(projectId, { structuredBriefJson: JSON.stringify(b) })
          .catch(() => undefined);
    },
    [backend, projectId],
  );

  async function analyzeWithMock() {
    setError(null);
    setBlocked(null);
    setAnalyzing(true);
    try {
      const brief = await mockBriefProvider.analyzeBrief(prompt, manualFields);
      await saveProject({ originalPrompt: prompt });
      persistBrief(brief, true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }

  async function analyzeWithAnthropic() {
    setError(null);
    setBlocked(null);
    setAnalyzing(true);
    try {
      const provider = createAnthropicBriefProvider(backend);
      const { brief } = await provider.analyzeConfirmed(prompt, manualFields);
      await saveProject({ originalPrompt: prompt });
      persistBrief(brief, true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setAnalyzing(false);
      void refreshAiStatus();
    }
  }

  function onAnalyze() {
    if (!prompt.trim() && Object.keys(manualFields).length === 0) {
      setError("Describe the artwork first, or fill in at least one field.");
      return;
    }
    if (!paid) return void analyzeWithMock();
    if (aiStatus && !aiStatus.paid.available) {
      setBlocked(aiStatus.paid.blockedReason ?? "Paid AI is not available.");
      return;
    }
    if (settings && !settings.paidWarningAcknowledged) {
      setShowWarning(true);
      return;
    }
    void analyzeWithAnthropic();
  }

  async function acceptWarning() {
    setShowWarning(false);
    const next = await updateSettings({ paidWarningAcknowledged: true });
    if (next?.paidWarningAcknowledged) void analyzeWithAnthropic();
  }

  const categories = draft?.referenceCategories ?? [];
  const setCategories = (next: ReferenceCategory[]) =>
    persistBrief({
      ...(draft ?? { ...emptyBrief(prompt), generatedBy: "manual" }),
      referenceCategories: next,
    });

  const queriesPerCategory = settings?.queriesPerCategory ?? 2;
  const plan = buildSearchPlan(categories, queriesPerCategory);
  const providerId: SearchProviderId = settings?.searchProvider ?? "mock";
  const providerLabel = providerId === "pinterest" ? "Pinterest" : "Openverse";

  const [pinterestReady, setPinterestReady] = useState<boolean | null>(null);
  useEffect(() => {
    if (providerId !== "pinterest") return;
    let alive = true;
    backend.getPinterestStatus().then(
      (s) => alive && setPinterestReady(s.hasToken),
      () => alive && setPinterestReady(false),
    );
    return () => {
      alive = false;
    };
  }, [backend, providerId]);

  function onSearch() {
    if (draft && pendingBrief.current) persistBrief(draft, true);
    void app.startSearch(plan, providerId);
    setScreen("results");
  }

  if (!project) return null;

  return (
    <section className="screen" aria-labelledby="discover-title">
      <div className="screen-header">
        <div style={{ flex: 1, minWidth: 260 }}>
          <h1 id="discover-title" className="visually-hidden">
            Discover
          </h1>
          <label htmlFor="project-name">Project name</label>
          <input
            id="project-name"
            type="text"
            value={name}
            maxLength={200}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== project.name && saveProject({ name })}
            style={{ fontSize: "1.2rem", fontWeight: 600, maxWidth: 520 }}
          />
        </div>
        <DataLabel isDemo={providerId === "mock"} providerName={providerLabel} />
      </div>

      {app.briefError && <ErrorBanner message={app.briefError} />}

      <div className="discover-grid">
        <div className="panel">
          <h2>Art brief</h2>
          <label htmlFor="brief">Describe the artwork you want to create</label>
          <textarea
            id="brief"
            className="brief-textarea"
            value={prompt}
            maxLength={8000}
            placeholder="e.g. A lonely red fox in a misty bamboo forest at golden hour, watercolor, low angle, muted greens. No people."
            onChange={(e) => setPrompt(e.target.value)}
            onBlur={() =>
              prompt !== project.originalPrompt && saveProject({ originalPrompt: prompt })
            }
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                onAnalyze();
              }
            }}
          />
          <div className="field-hint">
            Subject, setting, colors, mood, lighting, composition, camera angle, style… Thai is fine
            too. Ctrl+Enter analyzes.
          </div>

          <details style={{ marginTop: 12 }}>
            <summary>Optional fields</summary>
            <div className="grid-2">
              {BRIEF_FIELDS.map(({ key, label, hint }) => (
                <div className="field" key={key}>
                  <label htmlFor={`field-${key}`}>{label}</label>
                  <input
                    id={`field-${key}`}
                    type="text"
                    value={fieldInputs[key] ?? ""}
                    placeholder={hint}
                    onChange={(e) => setFieldInputs((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="field-hint">
              Separate several values with commas. These are combined with what the analysis finds.
            </div>
          </details>

          <div className="row" style={{ marginTop: 14 }}>
            <button
              type="button"
              className={`btn btn-primary ${paid ? "btn-paid" : ""}`}
              onClick={onAnalyze}
              disabled={analyzing}
              aria-describedby="analyze-cost"
            >
              {analyzing ? "Analyzing…" : "Analyze brief"}
            </button>
            <span id="analyze-cost">
              {paid ? (
                <PaidBadge label="Anthropic API · billed separately" />
              ) : (
                <FreeBadge label="Mock AI · free" />
              )}
            </span>
            {paid && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={analyzeWithMock}
                disabled={analyzing}
              >
                Use free analysis instead
              </button>
            )}
          </div>
          {paid && aiStatus && (
            <div className="faint" style={{ marginTop: 6 }}>
              One request to {aiStatus.model}. This month: {aiStatus.month.requests} of{" "}
              {settings?.monthlyRequestLimit} requests.
            </div>
          )}
          {!paid && (
            <div className="faint" style={{ marginTop: 6 }}>
              The free Mock AI uses a deterministic offline parser. It recognizes common art
              vocabulary; edit the categories below to refine.
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            {blocked && (
              <Banner kind="warn">
                <p>{blocked}</p>
                <div className="row" style={{ marginTop: 6 }}>
                  <button type="button" className="btn btn-sm" onClick={analyzeWithMock}>
                    Use free Mock analysis
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => setScreen("settings")}
                  >
                    Open Settings
                  </button>
                </div>
              </Banner>
            )}
            {error && (
              <ErrorBanner message={error} onRetry={onAnalyze} onDismiss={() => setError(null)} />
            )}
          </div>
        </div>

        <div className="panel">
          <div className="row" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Reference categories & queries</h2>
            <span className="spacer" />
            {draft?.generatedBy && (
              <span className="badge badge-neutral" title="Who produced these suggestions">
                {SOURCE_LABELS[draft.generatedBy] ?? draft.generatedBy}
              </span>
            )}
          </div>
          <p className="faint">
            Suggestions only. Edit, disable or add categories and queries before searching.
          </p>
          {analyzing ? (
            <div className="stack" aria-busy="true">
              {[0, 1, 2].map((i) => (
                <div key={i} className="skeleton" style={{ height: 96 }} />
              ))}
            </div>
          ) : (
            <CategoryEditor categories={categories} onChange={setCategories} />
          )}

          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "16px 0" }} />
          <h3>Search</h3>
          <div className="grid-2">
            <div className="field">
              <label htmlFor="search-source">Search source</label>
              <select
                id="search-source"
                value={providerId}
                onChange={(e) =>
                  updateSettings({ searchProvider: e.target.value as SearchProviderId })
                }
              >
                {SEARCH_PROVIDER_OPTIONS.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.label}
                  </option>
                ))}
              </select>
              <div className="field-hint">
                {SEARCH_PROVIDER_OPTIONS.find((o) => o.id === providerId)?.description}
              </div>
            </div>
            <div className="field">
              <label htmlFor="qpc">Queries per category</label>
              <select
                id="qpc"
                value={queriesPerCategory}
                onChange={(e) => updateSettings({ queriesPerCategory: Number(e.target.value) })}
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
              <div className="field-hint">
                {plan.length} search request{plan.length === 1 ? "" : "s"} will be made
                {providerId === "openverse" && plan.length > 15
                  ? " (Openverse allows ~20 per minute)"
                  : ""}
                .
              </div>
            </div>
          </div>
          <div className="row">
            <button
              type="button"
              className="btn btn-primary"
              onClick={onSearch}
              disabled={plan.length === 0}
            >
              Search references
            </button>
            {providerId === "mock" && (
              <span className="faint">Results will be clearly labeled demo data.</span>
            )}
            {providerId === "openverse" && <FreeBadge label="Free API · no key" />}
            {providerId === "pinterest" && <FreeBadge label="Free API · your token" />}
          </div>
          {providerId === "pinterest" && (
            <div style={{ marginTop: 10 }}>
              {pinterestReady === false ? (
                <Banner kind="warn">
                  <p>
                    No Pinterest access token is set up yet, so Pinterest searches will fail. Add
                    one in Settings → Pinterest.
                  </p>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginTop: 6 }}
                    onClick={() => setScreen("settings")}
                  >
                    Open Settings
                  </button>
                </Banner>
              ) : (
                <p className="faint">
                  Pinterest keyword search works only if Pinterest has approved your developer app
                  for it. Otherwise the results page shows Pinterest&apos;s refusal message.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {showWarning && (
        <BillingWarningDialog onAccept={acceptWarning} onCancel={() => setShowWarning(false)} />
      )}
    </section>
  );
}

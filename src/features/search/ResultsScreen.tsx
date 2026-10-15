import { useCallback, useEffect, useMemo, useState } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import {
  Banner,
  DataLabel,
  EmptyState,
  ErrorBanner,
  FreeBadge,
  PaidBadge,
  Progress,
  SkeletonGrid,
} from "../../components/ui";
import type { SavedReference, SearchHit } from "../../lib/types";
import { AnalyzeDialog } from "../analysis/AnalyzeDialog";
import { runAnalysis, type AnalysisOutcome } from "../analysis/imageAnalysis";
import { addHitToBoard, toNewReference } from "../board/boardActions";
import { briefSummary } from "../brief/queryPlanner";
import { WEB_SEARCH_SITES } from "./providers/webSearchLinks";
import { ResultCard } from "./ResultCard";

type Orientation = "any" | "landscape" | "portrait" | "square";

function orientationOf(w?: number, h?: number): Exclude<Orientation, "any"> | "unknown" {
  if (!w || !h) return "unknown";
  const r = w / h;
  return r > 1.15 ? "landscape" : r < 0.87 ? "portrait" : "square";
}

export function ResultsScreen() {
  const {
    backend,
    project,
    brief,
    search,
    settings,
    startSearch,
    cancelSearch,
    setScreen,
    notify,
    reportError,
    refreshAiStatus,
  } = useApp();
  const projectId = project?.id ?? "";
  const [saved, setSaved] = useState<SavedReference[]>([]);
  const [boardRefIds, setBoardRefIds] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [analysis, setAnalysis] = useState<Record<string, AnalysisOutcome>>({});
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [filters, setFilters] = useState({
    category: "all",
    provider: "all",
    orientation: "any" as Orientation,
    text: "",
  });

  const [reloadToken, setReloadToken] = useState(0);
  const loadState = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    Promise.all([
      backend.listReferences(projectId),
      backend.listBoardItems(projectId),
      backend.listHiddenResults(projectId),
    ]).then(([refs, items, hiddenKeys]) => {
      if (!alive) return;
      setSaved(refs);
      setBoardRefIds(new Set(items.map((i) => i.referenceId)));
      setHidden(new Set(hiddenKeys));
    }, reportError);
    return () => {
      alive = false;
    };
  }, [backend, projectId, reportError, reloadToken]);

  const categories = useMemo(() => brief?.referenceCategories ?? [], [brief]);
  const categoryName = useCallback(
    (id: string) => categories.find((c) => c.id === id)?.name ?? id,
    [categories],
  );

  const savedByKey = useMemo(
    () => new Map(saved.map((r) => [`${r.provider}:${r.providerResultId}`, r])),
    [saved],
  );

  const hits = useMemo(() => search?.hits ?? [], [search?.hits]);
  const providers = useMemo(() => [...new Set(hits.map((h) => h.result.provider))], [hits]);

  const visible = useMemo(() => {
    const text = filters.text.trim().toLowerCase();
    return hits.filter((h) => {
      if (!showHidden && hidden.has(h.key)) return false;
      if (filters.category !== "all" && !h.categories.includes(filters.category)) return false;
      if (filters.provider !== "all" && h.result.provider !== filters.provider) return false;
      if (
        filters.orientation !== "any" &&
        orientationOf(h.result.width, h.result.height) !== filters.orientation
      )
        return false;
      if (text) {
        const hay =
          `${h.result.title} ${h.queries.join(" ")} ${h.result.creatorName ?? ""} ${(h.result.tags ?? []).join(" ")}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
  }, [hits, hidden, showHidden, filters]);

  // Group by the first category each result was found for, in category order.
  const groups = useMemo(() => {
    const order = categories.map((c) => c.id);
    const map = new Map<string, SearchHit[]>();
    for (const h of visible) {
      const primary = filters.category !== "all" ? filters.category : (h.categories[0] ?? "other");
      map.set(primary, [...(map.get(primary) ?? []), h]);
    }
    return [...map.entries()].sort(([a], [b]) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });
  }, [visible, categories, filters.category]);

  const firstQueryOf = (categoryId: string) =>
    search?.plan.find((p) => p.categoryId === categoryId)?.query ??
    categories.find((c) => c.id === categoryId)?.searchQueries[0] ??
    "";

  function withBusy(key: string, fn: () => Promise<void>) {
    setBusy((b) => new Set(b).add(key));
    fn()
      .catch(reportError)
      .finally(() =>
        setBusy((b) => {
          const n = new Set(b);
          n.delete(key);
          return n;
        }),
      );
  }

  const onSave = (hit: SearchHit) =>
    withBusy(hit.key, async () => {
      const ref = await backend.saveReference(
        toNewReference(projectId, hit, categoryName(hit.categories[0] ?? "")),
      );
      const a = analysis[hit.key]?.analysis;
      if (a) await backend.setReferenceAnalysis(ref.id, JSON.stringify(a));
      notify("Saved to project");
      loadState();
    });

  const onAddToBoard = (hit: SearchHit) =>
    withBusy(hit.key, async () => {
      const { reference } = await addHitToBoard(
        backend,
        projectId,
        hit,
        categoryName(hit.categories[0] ?? ""),
      );
      const a = analysis[hit.key]?.analysis;
      if (a) await backend.setReferenceAnalysis(reference.id, JSON.stringify(a));
      notify("Added to board");
      loadState();
    });

  const onHide = (hit: SearchHit) =>
    withBusy(hit.key, async () => {
      await backend.hideResult(projectId, hit.key);
      setHidden((h) => new Set(h).add(hit.key));
      setSelected((s) => {
        const n = new Set(s);
        n.delete(hit.key);
        return n;
      });
    });

  const onOpen = (hit: SearchHit) => backend.openExternal(hit.result.sourceUrl).catch(reportError);

  const toggleSelect = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });

  const selectedHits = hits.filter((h) => selected.has(h.key));
  const limit = settings?.maxImagesPerBatch ?? 3;
  const paid = settings?.aiProvider === "anthropic";

  async function runSelectedAnalysis(forceRefresh: boolean) {
    if (!settings) return;
    setAnalyzeOpen(false);
    setAnalyzing(true);
    setAnalysisError(null);
    try {
      const outcomes = await runAnalysis(backend, selectedHits, settings, {
        confirmed: true, // the user pressed the confirm button in AnalyzeDialog
        forceRefresh,
        categoryName: (h) => categoryName(h.categories[0] ?? ""),
        briefSummary: briefSummary(brief),
      });
      setAnalysis((a) => ({ ...a, ...Object.fromEntries(outcomes.map((o) => [o.key, o])) }));
      // Store analyses on references that are already saved.
      for (const o of outcomes) {
        const ref = savedByKey.get(o.key);
        if (ref && o.analysis)
          await backend.setReferenceAnalysis(ref.id, JSON.stringify(o.analysis));
      }
      const failed = outcomes.filter((o) => o.error).length;
      notify(failed ? `Analysis finished with ${failed} error(s)` : "Analysis finished");
      setSelected(new Set());
    } catch (err) {
      setAnalysisError(errorMessage(err));
    } finally {
      setAnalyzing(false);
      if (paid) void refreshAiStatus();
    }
  }

  if (!project) return null;

  if (!search) {
    return (
      <section className="screen">
        <h1>Results</h1>
        <EmptyState title="No search yet">
          <p>Analyze your brief and press “Search references” on the Discover screen.</p>
          <button type="button" className="btn btn-primary" onClick={() => setScreen("discover")}>
            Go to Discover
          </button>
        </EmptyState>
      </section>
    );
  }

  const running = search.status === "running";
  const hiddenCount = hits.filter((h) => hidden.has(h.key)).length;
  const retryableErrors = search.errors.filter((e) => e.retryable);

  return (
    <section className="screen" aria-labelledby="results-title">
      <div className="screen-header">
        <div>
          <div className="row">
            <h1 id="results-title" style={{ margin: 0 }}>
              Results
            </h1>
            <DataLabel isDemo={search.isDemo} providerName={search.providerName} />
          </div>
          <p>
            {running
              ? `Searching… ${search.progress.done} of ${search.progress.total} queries`
              : `${visible.length} shown of ${hits.length} unique results from ${search.plan.length} queries` +
                (search.status === "cancelled" ? " (cancelled)" : "")}
          </p>
        </div>
        <div className="row">
          {running ? (
            <button type="button" className="btn" onClick={cancelSearch}>
              Cancel search
            </button>
          ) : (
            <>
              <button
                type="button"
                className="btn"
                onClick={() => startSearch(search.plan, search.providerId)}
              >
                Search again
              </button>
              <button
                type="button"
                className="btn"
                onClick={() =>
                  startSearch(search.plan, search.providerId, {
                    append: true,
                    page: search.page + 1,
                  })
                }
                disabled={hits.length === 0}
                title="Fetch the next page of results for the same queries"
              >
                Load more
              </button>
            </>
          )}
        </div>
      </div>

      {running && <Progress done={search.progress.done} total={search.progress.total} />}

      {search.isDemo && (
        <Banner kind="demo">
          <strong>Demo data.</strong> These results come from the mock provider: placeholder images
          with example.com links, not real references. Choose “Openverse (live)” on the Discover
          screen for real, openly licensed images.
        </Banner>
      )}

      {search.errors.length > 0 && !running && (
        <div className="banner banner-error" role="alert">
          <div style={{ flex: 1 }}>
            <p>
              {search.errors.length} quer{search.errors.length === 1 ? "y" : "ies"} failed. Other
              results are still shown.
            </p>
            <ul className="query-errors">
              {search.errors.slice(0, 6).map((e, i) => (
                <li key={i} className="faint">
                  “{e.query}”: {e.message}
                </li>
              ))}
            </ul>
          </div>
          {retryableErrors.length > 0 && (
            <button
              type="button"
              className="btn btn-sm"
              onClick={() =>
                startSearch(
                  retryableErrors.map((e) => ({ categoryId: e.categoryId, query: e.query })),
                  search.providerId,
                  { append: true, page: search.page },
                )
              }
            >
              Retry failed
            </button>
          )}
        </div>
      )}

      <div className="toolbar" role="search">
        <div className="field">
          <label htmlFor="f-category">Category</label>
          <select
            id="f-category"
            value={filters.category}
            onChange={(e) => setFilters({ ...filters, category: e.target.value })}
          >
            <option value="all">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-provider">Provider</label>
          <select
            id="f-provider"
            value={filters.provider}
            onChange={(e) => setFilters({ ...filters, provider: e.target.value })}
          >
            <option value="all">All providers</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="f-orientation">Orientation</label>
          <select
            id="f-orientation"
            value={filters.orientation}
            onChange={(e) => setFilters({ ...filters, orientation: e.target.value as Orientation })}
          >
            <option value="any">Any</option>
            <option value="landscape">Landscape</option>
            <option value="portrait">Portrait</option>
            <option value="square">Square</option>
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="f-text">Filter by text or query</label>
          <input
            id="f-text"
            type="search"
            value={filters.text}
            placeholder="e.g. fur"
            onChange={(e) => setFilters({ ...filters, text: e.target.value })}
          />
        </div>
        {hiddenCount > 0 && (
          <label className="check" style={{ marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
            />
            Show {hiddenCount} hidden
          </label>
        )}
        {hiddenCount > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() =>
              backend
                .unhideAllResults(projectId)
                .then(() => setHidden(new Set()))
                .catch(reportError)
            }
          >
            Unhide all
          </button>
        )}
      </div>

      <div className="panel row" style={{ marginBottom: 16, padding: "10px 14px" }}>
        <span>
          {selected.size} selected for image analysis
          {selected.size > limit && (
            <strong style={{ color: "var(--warn)" }}> (batch limit is {limit})</strong>
          )}
        </span>
        <span className="spacer" />
        {selected.size > 0 && (
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        )}
        <button
          type="button"
          className="btn btn-sm"
          disabled={selected.size === 0 || selected.size > limit || analyzing}
          onClick={() => setAnalyzeOpen(true)}
          title="Analysis runs only on images you select, after you confirm"
        >
          {analyzing ? "Analyzing…" : "Analyze selected"}
        </button>
        {paid ? <PaidBadge /> : <FreeBadge label="Mock · free" />}
      </div>
      {analysisError && (
        <ErrorBanner message={analysisError} onDismiss={() => setAnalysisError(null)} />
      )}

      {running && hits.length === 0 && <SkeletonGrid />}

      {!running && hits.length === 0 && (
        <EmptyState title="No results">
          <p>Try broader or different queries on the Discover screen, or another search source.</p>
        </EmptyState>
      )}

      {hits.length > 0 && visible.length === 0 && (
        <EmptyState title="Nothing matches the filters">
          <button
            type="button"
            className="btn"
            onClick={() =>
              setFilters({ category: "all", provider: "all", orientation: "any", text: "" })
            }
          >
            Clear filters
          </button>
        </EmptyState>
      )}

      {groups.map(([categoryId, list]) => {
        const query = firstQueryOf(categoryId);
        return (
          <section
            key={categoryId}
            className="category-section"
            aria-label={categoryName(categoryId)}
          >
            <header>
              <h2>{categoryName(categoryId)}</h2>
              <span className="faint">{list.length}</span>
              <span className="spacer" />
              {query && (
                <span className="row faint" style={{ gap: 4 }}>
                  Open “{query}” on:
                  {WEB_SEARCH_SITES.map((site) => (
                    <button
                      key={site.id}
                      type="button"
                      className="btn btn-sm btn-ghost"
                      onClick={() => backend.openExternal(site.buildUrl(query)).catch(reportError)}
                      title={`Open a ${site.name} search in your browser (not scraped)`}
                    >
                      {site.name}
                    </button>
                  ))}
                </span>
              )}
            </header>
            <div className="masonry">
              {list.map((hit) => {
                const ref = savedByKey.get(hit.key);
                return (
                  <ResultCard
                    key={hit.key}
                    hit={hit}
                    categoryNames={hit.categories.map(categoryName)}
                    state={{
                      saved: Boolean(ref),
                      onBoard: Boolean(ref && boardRefIds.has(ref.id)),
                      busy: busy.has(hit.key),
                    }}
                    selected={selected.has(hit.key)}
                    analysis={analysis[hit.key]}
                    onToggleSelect={() => toggleSelect(hit.key)}
                    onOpen={() => onOpen(hit)}
                    onSave={() => onSave(hit)}
                    onAddToBoard={() => onAddToBoard(hit)}
                    onHide={() => onHide(hit)}
                  />
                );
              })}
            </div>
          </section>
        );
      })}

      {analyzeOpen && (
        <AnalyzeDialog
          hits={selectedHits}
          onCancel={() => setAnalyzeOpen(false)}
          onConfirm={({ forceRefresh }) => runSelectedAnalysis(forceRefresh)}
        />
      )}
    </section>
  );
}

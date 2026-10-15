import type { ReferenceAnalysis, SearchHit } from "../../lib/types";
import { displayHost, safeImageSrc } from "../../lib/url";

export type CardState = { saved: boolean; onBoard: boolean; busy: boolean };

type Props = {
  hit: SearchHit;
  categoryNames: string[];
  state: CardState;
  selected: boolean;
  analysis?: { analysis?: ReferenceAnalysis; error?: string; fromCache: boolean };
  onToggleSelect: () => void;
  onOpen: () => void;
  onSave: () => void;
  onAddToBoard: () => void;
  onHide: () => void;
};

export function ResultCard({
  hit,
  categoryNames,
  state,
  selected,
  analysis,
  onToggleSelect,
  onOpen,
  onSave,
  onAddToBoard,
  onHide,
}: Props) {
  const r = hit.result;
  const src = safeImageSrc(r.thumbnailUrl);
  const source = r.providerSource ? `${r.provider} · ${r.providerSource}` : r.provider;
  return (
    <article className={`result-card ${selected ? "is-selected" : ""}`} aria-label={r.title}>
      <div className="result-thumb">
        {src ? (
          <img
            src={src}
            alt={r.isDemo ? `Demo placeholder for "${r.title}"` : r.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            width={r.width}
            height={r.height}
            style={{ aspectRatio: r.width && r.height ? `${r.width} / ${r.height}` : undefined }}
          />
        ) : (
          <div className="thumb-missing">No preview available</div>
        )}
        {r.isDemo && <span className="badge badge-demo">Demo</span>}
        <label className="result-select" title="Select for image analysis">
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggleSelect}
            aria-label={`Select "${r.title}" for analysis`}
          />
          Select
        </label>
      </div>
      <div className="result-body">
        <h3 className="result-title">{r.title}</h3>
        <div className="result-meta">
          {r.creatorName && <div>by {r.creatorName}</div>}
          <div>
            {source}
            {!r.isDemo && ` · ${displayHost(r.sourceUrl)}`}
          </div>
          {r.licenseLabel && <div>{r.licenseLabel}</div>}
        </div>
        <div className="row" style={{ gap: 4 }}>
          {categoryNames.map((n) => (
            <span key={n} className="badge badge-neutral">
              {n}
            </span>
          ))}
          {hit.score !== null && (
            <span
              className="badge badge-neutral"
              title="Estimated from how many query words appear in the title and tags. The image itself was not inspected."
            >
              Text match ~{Math.round(hit.score * 100)}%
            </span>
          )}
        </div>
        {analysis?.analysis && (
          <div className="analysis">
            <strong>Analysis{analysis.fromCache ? " (cached)" : ""}:</strong>{" "}
            {analysis.analysis.summary}
            {analysis.analysis.palette?.length ? (
              <div>Palette: {analysis.analysis.palette.join(", ")}</div>
            ) : null}
            {analysis.analysis.lighting && <div>Lighting: {analysis.analysis.lighting}</div>}
            {analysis.analysis.relevanceExplanation && (
              <div>{analysis.analysis.relevanceExplanation}</div>
            )}
            <div className="faint">AI suggestions can be wrong.</div>
          </div>
        )}
        {analysis?.error && (
          <div className="analysis" style={{ color: "var(--danger)" }}>
            {analysis.error}
          </div>
        )}
        <div className="result-actions">
          <button
            type="button"
            className="btn btn-sm"
            onClick={onOpen}
            title={`Open the original page: ${r.sourceUrl}`}
          >
            Open source
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onAddToBoard}
            disabled={state.onBoard || state.busy}
          >
            {state.onBoard ? "On board" : "Add to board"}
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={onSave}
            disabled={state.saved || state.busy}
          >
            {state.saved ? "Saved" : "Save"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={onHide}
            title="Hide this result in this project"
          >
            Hide
          </button>
        </div>
      </div>
    </article>
  );
}

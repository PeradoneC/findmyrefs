import { useCallback, useEffect, useState } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { ErrorBanner, Modal } from "../../components/ui";
import { formatUsd } from "../../lib/models";
import type { UsageRecord } from "../../lib/types";

export function UsagePanel() {
  const { backend, aiStatus, settings, refreshAiStatus, notify } = useApp();
  const [records, setRecords] = useState<UsageRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(() => setReloadToken((t) => t + 1), []);
  const monthRequests = aiStatus?.month.requests;

  useEffect(() => {
    let alive = true;
    backend.listUsage().then(
      (list) => {
        if (!alive) return;
        setRecords(list);
        setError(null);
      },
      (err) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [backend, reloadToken, monthRequests]);

  async function clear() {
    try {
      await backend.clearUsage();
      setConfirmClear(false);
      notify("Local usage history cleared");
      load();
      await refreshAiStatus();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const month = aiStatus?.month;
  return (
    <div className="panel">
      <h2>Usage (this app, this computer)</h2>
      {error && <ErrorBanner message={error} onRetry={load} />}
      {month && settings && (
        <div className="row" style={{ gap: 28, marginBottom: 12 }}>
          <div className="stat">
            <strong>
              {month.requests} / {settings.monthlyRequestLimit}
            </strong>
            <span>paid requests in {month.month} (UTC)</span>
          </div>
          <div className="stat">
            <strong>
              ~{formatUsd(month.estimatedCostUsd)} / {formatUsd(settings.monthlySpendTargetUsd)}
            </strong>
            <span>estimated cost vs. local target</span>
          </div>
          {month.requestsWithoutCost > 0 && (
            <div className="stat">
              <strong>{month.requestsWithoutCost}</strong>
              <span>requests with cost unavailable</span>
            </div>
          )}
        </div>
      )}
      <p className="faint">
        Costs are estimates from token counts reported by the API and published prices (as of{" "}
        {aiStatus?.pricesAsOf ?? "—"}). They are not your bill. “Cost unavailable” means the API did
        not report usage or the model’s price is unknown.
      </p>
      {records && records.length === 0 && <p className="muted">No paid requests recorded.</p>}
      {records && records.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table className="usage-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Feature</th>
                <th>Model</th>
                <th>Images</th>
                <th>Tokens in / out</th>
                <th>Est. cost</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {records.slice(0, 100).map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.createdAt).toLocaleString()}</td>
                  <td>
                    {r.feature === "brief_analysis"
                      ? "Brief analysis"
                      : r.feature === "image_analysis"
                        ? "Image analysis"
                        : r.feature}
                  </td>
                  <td>{r.model}</td>
                  <td>{r.imageCount}</td>
                  <td>
                    {r.inputTokens !== null && r.outputTokens !== null
                      ? `${r.inputTokens} / ${r.outputTokens}`
                      : "—"}
                  </td>
                  <td>
                    {r.estimatedCostUsd !== null
                      ? `~${formatUsd(r.estimatedCostUsd)}`
                      : "Cost unavailable"}
                  </td>
                  <td>
                    {r.status === "ok" ? "OK" : `Error${r.errorCode ? ` (${r.errorCode})` : ""}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="row" style={{ marginTop: 12 }}>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          onClick={() => setConfirmClear(true)}
          disabled={!records?.length}
        >
          Clear usage history
        </button>
      </div>
      {confirmClear && (
        <Modal
          title="Clear usage history?"
          onClose={() => setConfirmClear(false)}
          actions={
            <>
              <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={clear}>
                Clear history
              </button>
            </>
          }
        >
          <p>
            This deletes the local usage log. The monthly request count and spending estimate used
            by the guardrails will restart from zero. Your actual API usage at Anthropic is not
            affected.
          </p>
        </Modal>
      )}
    </div>
  );
}

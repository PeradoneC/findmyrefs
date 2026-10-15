import { useEffect, useState } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { Banner, ErrorBanner, Modal } from "../../components/ui";
import { formatUsd, modelInfo } from "../../lib/models";
import type { SearchHit } from "../../lib/types";
import { planAnalysis, type AnalysisPlan } from "./imageAnalysis";

type Props = {
  hits: SearchHit[];
  onCancel: () => void;
  onConfirm: (opts: { forceRefresh: boolean }) => void;
};

/** Shows exactly what "Analyze selected" will do before anything is sent. */
export function AnalyzeDialog({ hits, onCancel, onConfirm }: Props) {
  const { backend, settings, aiStatus, updateSettings } = useApp();
  const [plan, setPlan] = useState<AnalysisPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [acknowledged, setAcknowledged] = useState(settings?.paidWarningAcknowledged ?? false);

  useEffect(() => {
    if (!settings) return;
    planAnalysis(backend, hits, settings).then(setPlan, (e) => setError(errorMessage(e)));
  }, [backend, hits, settings]);

  if (!settings) return null;
  const paid = plan?.provider === "anthropic";
  const sendCount = plan
    ? forceRefresh
      ? plan.toSend.length + plan.cachedKeys.length
      : plan.toSend.length
    : 0;
  const model = modelInfo(settings.anthropicModel);
  const paidBlocked = paid && sendCount > 0 && aiStatus && !aiStatus.paid.available;
  const canRun =
    plan !== null &&
    !plan.overLimit &&
    !paidBlocked &&
    (!paid || sendCount === 0 || acknowledged) &&
    plan.toSend.length + plan.cachedKeys.length > 0;

  async function confirm() {
    if (paid && sendCount > 0 && !settings?.paidWarningAcknowledged) {
      const next = await updateSettings({ paidWarningAcknowledged: true });
      if (!next?.paidWarningAcknowledged) return;
    }
    onConfirm({ forceRefresh });
  }

  return (
    <Modal
      title={paid ? "Analyze selected images (paid)" : "Analyze selected images (free demo)"}
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={confirm} disabled={!canRun}>
            {paid && sendCount > 0
              ? `Send ${sendCount} image${sendCount === 1 ? "" : "s"} to Anthropic`
              : "Run analysis"}
          </button>
        </>
      }
    >
      {error && <ErrorBanner message={error} />}
      {!plan && !error && <p className="muted">Checking cached results…</p>}
      {plan && (
        <div className="stack">
          <p style={{ margin: 0 }}>
            <strong>{hits.length}</strong> image{hits.length === 1 ? "" : "s"} selected (your batch
            limit is {plan.limit}).
          </p>
          {plan.overLimit && (
            <Banner kind="warn">
              Too many images selected. Deselect some, or raise the batch limit in Settings.
            </Banner>
          )}
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            <li>
              {plan.cachedKeys.length} already analyzed (cached
              {forceRefresh ? ", will be re-run" : ", no new request"})
            </li>
            <li>
              {sendCount} to{" "}
              {paid ? "send to the Anthropic API" : "analyze with the free mock analyzer"}
            </li>
            {plan.unsupported.length > 0 && (
              <li>
                {plan.unsupported.length} skipped: {plan.unsupported[0]?.reason}
              </li>
            )}
          </ul>
          {plan.cachedKeys.length > 0 && (
            <label className="check">
              <input
                type="checkbox"
                checked={forceRefresh}
                onChange={(e) => setForceRefresh(e.target.checked)}
              />
              Re-run cached analyses
            </label>
          )}
          {paid ? (
            <>
              <Banner kind="warn">
                <p>
                  Each image is one request to{" "}
                  <strong>{model?.label ?? settings.anthropicModel}</strong>, billed by Anthropic
                  separately from any Claude subscription. Only the provider’s thumbnail URL and the
                  result’s title are sent.
                </p>
                <p style={{ marginTop: 6 }}>
                  <strong>The cost cannot be estimated reliably before sending</strong>: image token
                  counts depend on how the provider processes each image.
                  {model &&
                    ` List price: $${model.inputPerMTok} input / $${model.outputPerMTok} output per million tokens.`}{" "}
                  Recorded estimates appear in Settings → Usage afterwards.
                </p>
                {aiStatus && (
                  <p style={{ marginTop: 6 }}>
                    This month: {aiStatus.month.requests} of {settings.monthlyRequestLimit}{" "}
                    requests, estimated {formatUsd(aiStatus.month.estimatedCostUsd)} of your{" "}
                    {formatUsd(settings.monthlySpendTargetUsd)} local target.
                  </p>
                )}
              </Banner>
              {paidBlocked && (
                <ErrorBanner
                  message={aiStatus?.paid.blockedReason ?? "Paid AI is not available."}
                />
              )}
              {!settings.paidWarningAcknowledged && sendCount > 0 && (
                <label className="check">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(e) => setAcknowledged(e.target.checked)}
                  />
                  I understand API usage is billed separately and local limits are not a provider
                  billing cap.
                </label>
              )}
            </>
          ) : (
            <Banner kind="demo">
              The mock analyzer is free and offline. It only compares metadata with your queries; it
              does not look at the image.
            </Banner>
          )}
        </div>
      )}
    </Modal>
  );
}

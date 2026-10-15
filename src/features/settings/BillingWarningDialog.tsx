import { Modal } from "../../components/ui";

/** Shown before the first paid API request (and whenever the user re-reads it). */
export function BillingWarningDialog({
  onAccept,
  onCancel,
}: {
  onAccept: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      title="Before your first paid AI request"
      onClose={onCancel}
      actions={
        <>
          <button type="button" className="btn" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={onAccept}>
            I understand, continue
          </button>
        </>
      }
    >
      <ul style={{ paddingLeft: 18, margin: 0 }} className="stack">
        <li>
          This app will call the <strong>Anthropic API</strong> with your API key. API usage is
          billed by Anthropic to your API account,{" "}
          <strong>separately from any Claude Pro or Max subscription</strong>. A Claude subscription
          does not include API credits unless your plan explicitly says so.
        </li>
        <li>
          Costs shown in this app are estimates from published per-token prices. They may differ
          from your bill.
        </li>
        <li>
          The monthly request limit and spending target in Settings are{" "}
          <strong>local safeguards</strong> in this app. They are not a billing cap enforced by
          Anthropic. Your Anthropic Console billing page is authoritative; set limits there too if
          you need a hard cap.
        </li>
        <li>
          You can turn on “Disable paid AI” in Settings at any time to stop all paid requests
          immediately.
        </li>
      </ul>
    </Modal>
  );
}

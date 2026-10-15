import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { Banner, ErrorBanner } from "../../components/ui";
import { ANTHROPIC_MODELS } from "../../lib/models";
import type { AppInfo, AppSettings, SearchProviderId } from "../../lib/types";
import { SEARCH_PROVIDER_OPTIONS } from "../search/providers";
import { BillingWarningDialog } from "./BillingWarningDialog";
import { PinterestPanel } from "./PinterestPanel";
import { UsagePanel } from "./UsagePanel";

function NumberSetting({
  id,
  label,
  hint,
  value,
  min,
  max,
  step = 1,
  onSave,
}: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onSave: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [invalid, setInvalid] = useState(false);
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setText(String(value));
  }
  function commit() {
    const n = Number(text);
    if (!Number.isFinite(n) || n < min || n > max || (step === 1 && !Number.isInteger(n))) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    if (n !== value) onSave(n);
  }
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        aria-invalid={invalid}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === "Enter" && commit()}
        style={{ maxWidth: 160 }}
      />
      {invalid && (
        <div className="field-hint" style={{ color: "var(--danger)" }}>
          Enter a value between {min} and {max}.
        </div>
      )}
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

export function SettingsScreen() {
  const { backend, settings, aiStatus, updateSettings, refreshAiStatus, notify } = useApp();
  const [key, setKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState(false);
  const [showNotice, setShowNotice] = useState(false);
  const [info, setInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    backend.getAppInfo().then(setInfo, () => undefined);
  }, [backend]);

  if (!settings) return <section className="screen">Loading settings…</section>;

  const set = (patch: Partial<AppSettings>) => void updateSettings(patch);
  const desktop = backend.kind === "desktop";
  const anthropic = settings.aiProvider === "anthropic";
  const limitBlocked =
    aiStatus?.paid.blockedCode === "request_limit" || aiStatus?.paid.blockedCode === "spend_target";
  const overrideActive = settings.limitOverrideMonth === aiStatus?.month.month;

  async function saveKey(e: FormEvent) {
    e.preventDefault();
    setKeyError(null);
    setSavingKey(true);
    try {
      await backend.setApiKey(key);
      notify(`API key saved to ${aiStatus?.secureStorage ?? "secure storage"}`);
    } catch (err) {
      setKeyError(errorMessage(err));
    } finally {
      setKey(""); // never keep the key in UI state
      setSavingKey(false);
      await refreshAiStatus();
    }
  }

  async function removeKey() {
    try {
      await backend.clearApiKey();
      notify("API key removed");
    } catch (err) {
      setKeyError(errorMessage(err));
    } finally {
      await refreshAiStatus();
    }
  }

  async function clearCache() {
    try {
      await backend.clearAnalysisCache();
      notify("Cached image analyses cleared");
    } catch (err) {
      notify(errorMessage(err), "error");
    }
  }

  return (
    <section className="screen" aria-labelledby="settings-title">
      <div className="screen-header">
        <div>
          <h1 id="settings-title">Settings</h1>
          <p>
            The app works fully without any API key. Paid AI is optional and off unless you turn it
            on here.
          </p>
        </div>
      </div>

      <div className="settings-grid">
        <div className="panel">
          <h2>AI provider</h2>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="visually-hidden">AI provider</legend>
            <label className="radio-option">
              <input
                type="radio"
                name="ai"
                checked={!anthropic}
                onChange={() => set({ aiProvider: "mock" })}
              />
              <span>
                <strong>Mock (free)</strong>
                <br />
                <span className="faint">
                  Offline, deterministic demo analysis. No network requests, no costs.
                </span>
              </span>
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="ai"
                checked={anthropic}
                onChange={() => set({ aiProvider: "anthropic" })}
              />
              <span>
                <strong>Anthropic API (usage billed separately)</strong>
                <br />
                <span className="faint">
                  Claude analyzes briefs and selected images. Requires your own API key.
                </span>
              </span>
            </label>
          </fieldset>
          <div className="row" style={{ marginTop: 6 }}>
            <strong>Status:</strong>
            {aiStatus?.paid.available ? (
              <span className="badge badge-paid">Paid AI ready ({aiStatus.model})</span>
            ) : (
              <span className="muted">{aiStatus?.paid.blockedReason ?? "…"}</span>
            )}
          </div>
          <label className="check" style={{ marginTop: 12 }}>
            <input
              type="checkbox"
              checked={settings.paidAiDisabled}
              onChange={(e) => set({ paidAiDisabled: e.target.checked })}
            />
            <strong>Disable paid AI</strong>
          </label>
          <div className="field-hint">
            When on, no paid API request is sent, whatever else is configured. Takes effect
            immediately.
          </div>
        </div>

        <div className="panel">
          <h2>Anthropic API setup</h2>
          <Banner kind="warn">
            Anthropic API usage is billed by Anthropic{" "}
            <strong>separately from Claude Pro/Max subscriptions</strong>. A Claude subscription
            does not give this app API access or credits unless your plan explicitly includes them.
          </Banner>
          <ol style={{ paddingLeft: 18, marginTop: 0 }} className="faint">
            <li>
              Create an API key in the Anthropic Console (console.anthropic.com → API keys) and set
              up billing there.
            </li>
            <li>
              Paste it below. It is stored in{" "}
              {desktop
                ? (aiStatus?.secureStorage ?? "the system credential store")
                : "the system credential store"}{" "}
              and never shown again.
            </li>
            <li>Select “Anthropic API” above and review the limits below.</li>
          </ol>
          {!desktop && (
            <Banner kind="info">
              API keys can only be configured in the desktop app. The browser preview never stores
              keys.
            </Banner>
          )}
          <form onSubmit={saveKey} className="row" style={{ alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <label htmlFor="api-key">API key</label>
              <input
                id="api-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={key}
                disabled={!desktop}
                placeholder={
                  aiStatus?.hasApiKey
                    ? "A key is stored. Paste a new one to replace it."
                    : "sk-ant-…"
                }
                onChange={(e) => setKey(e.target.value)}
              />
            </div>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={!desktop || !key.trim() || savingKey}
            >
              Save key
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={removeKey}
              disabled={!aiStatus?.hasApiKey}
            >
              Remove key
            </button>
          </form>
          <div className="faint" style={{ marginTop: 6 }}>
            Key stored: <strong>{aiStatus?.hasApiKey ? "yes" : "no"}</strong>
          </div>
          {keyError && <ErrorBanner message={keyError} onDismiss={() => setKeyError(null)} />}
          <div className="field" style={{ marginTop: 12 }}>
            <label htmlFor="model">Model</label>
            <select
              id="model"
              value={settings.anthropicModel}
              onChange={(e) => set({ anthropicModel: e.target.value })}
            >
              {ANTHROPIC_MODELS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label} — ${m.inputPerMTok} / ${m.outputPerMTok} per M tokens
                </option>
              ))}
            </select>
            <div className="field-hint">
              List prices (input / output, USD) as of {aiStatus?.pricesAsOf ?? "2026-10"}; check
              Anthropic’s pricing page for current rates.{" "}
              {ANTHROPIC_MODELS.find((m) => m.id === settings.anthropicModel)?.note}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setShowNotice(true)}
          >
            {settings.paidWarningAcknowledged
              ? "Re-read the billing notice"
              : "Read the billing notice"}
          </button>
        </div>

        <div className="panel">
          <h2>Spending guardrails</h2>
          <NumberSetting
            id="batch"
            label="Maximum images per analysis batch"
            value={settings.maxImagesPerBatch}
            min={1}
            max={20}
            hint="Images are analyzed only when you select them and confirm. Default: 3."
            onSave={(v) => set({ maxImagesPerBatch: v })}
          />
          <NumberSetting
            id="limit"
            label="Monthly request limit"
            value={settings.monthlyRequestLimit}
            min={0}
            max={100000}
            hint="Paid requests are blocked once this many have been sent this month (UTC)."
            onSave={(v) => set({ monthlyRequestLimit: v })}
          />
          <NumberSetting
            id="target"
            label="Local monthly spending target (USD)"
            value={settings.monthlySpendTargetUsd}
            min={0}
            max={100000}
            step={0.01}
            hint="Paid requests are blocked once the estimated cost reaches this amount."
            onSave={(v) => set({ monthlySpendTargetUsd: v })}
          />
          <Banner kind="info">
            These limits are enforced by this app on this computer. They are <strong>not</strong> a
            provider-side billing cap: estimates can differ from actual charges, and other apps
            using the same key are not counted. The Anthropic Console billing page is authoritative.
          </Banner>
          {limitBlocked && !overrideActive && (
            <div className="row">
              <span className="muted">A local limit has been reached.</span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => set({ limitOverrideMonth: aiStatus?.month.month ?? null })}
              >
                Override for this month
              </button>
            </div>
          )}
          {overrideActive && (
            <div className="row">
              <span className="badge badge-paid">
                Limits overridden for {settings.limitOverrideMonth}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => set({ limitOverrideMonth: null })}
              >
                Restore limits
              </button>
            </div>
          )}
        </div>

        <div className="panel">
          <h2>Search</h2>
          <div className="field">
            <label htmlFor="default-search">Search source</label>
            <select
              id="default-search"
              value={settings.searchProvider}
              onChange={(e) => set({ searchProvider: e.target.value as SearchProviderId })}
            >
              {SEARCH_PROVIDER_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <div className="field-hint">
              {SEARCH_PROVIDER_OPTIONS.find((o) => o.id === settings.searchProvider)?.description}
            </div>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.safeSearch}
              onChange={(e) => set({ safeSearch: e.target.checked })}
            />
            Safe search (exclude mature content where the provider supports it)
          </label>
          <p className="faint" style={{ marginTop: 10 }}>
            Pinterest can be searched through its official API once set up below. ArtStation, Google
            Images, Behance, DeviantArt and X are not searched directly: the Results screen offers
            buttons that open a prefilled search on those sites (and Pinterest) in your browser.
          </p>
        </div>

        <PinterestPanel />

        <UsagePanel />

        <div className="panel">
          <h2>Data & privacy</h2>
          <p className="faint">
            Projects, saved references (links and metadata, not image files), notes, board layouts,
            settings, usage history and cached analyses are stored locally
            {info ? ` in ${info.dbPath}` : ""}. Delete a project on the Projects screen to remove
            all of its data.
          </p>
          <button type="button" className="btn btn-sm" onClick={clearCache}>
            Clear cached image analyses
          </button>
          {info && (
            <p className="faint" style={{ marginTop: 10 }}>
              Version {info.version} · schema v{info.schemaVersion}
            </p>
          )}
        </div>
      </div>

      {showNotice && (
        <BillingWarningDialog
          onCancel={() => setShowNotice(false)}
          onAccept={() => {
            setShowNotice(false);
            set({ paidWarningAcknowledged: true });
          }}
        />
      )}
    </section>
  );
}

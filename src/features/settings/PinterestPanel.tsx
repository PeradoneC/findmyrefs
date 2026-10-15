import { useEffect, useState, type FormEvent } from "react";
import { errorMessage, useApp } from "../../app/AppContext";
import { Banner, ErrorBanner } from "../../components/ui";
import type { PinterestStatus } from "../../lib/types";
import { normalizePinterestResponse } from "../search/providers/pinterestProvider";

/** Setup for Pinterest's official keyword search (free, but needs Pinterest's approval). */
export function PinterestPanel() {
  const { backend, settings, updateSettings, notify } = useApp();
  const desktop = backend.kind === "desktop";
  const [status, setStatus] = useState<PinterestStatus | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [token, setToken] = useState("");
  const [country, setCountry] = useState(settings?.pinterestCountry ?? "US");
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    backend.getPinterestStatus().then(
      (s) => alive && setStatus(s),
      (err) => alive && setError(errorMessage(err)),
    );
    return () => {
      alive = false;
    };
  }, [backend, reloadToken]);

  async function saveToken(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await backend.setPinterestToken(token);
      notify(`Pinterest token saved to ${status?.secureStorage ?? "secure storage"}`);
      setTest(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setToken(""); // never keep the token in UI state
      setBusy(false);
      setReloadToken((t) => t + 1);
    }
  }

  async function removeToken() {
    try {
      await backend.clearPinterestToken();
      notify("Pinterest token removed");
      setTest(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setReloadToken((t) => t + 1);
    }
  }

  async function saveCountry() {
    const code = country.trim().toUpperCase();
    setCountry(code);
    if (code !== settings?.pinterestCountry) await updateSettings({ pinterestCountry: code });
  }

  async function testConnection() {
    setBusy(true);
    setTest(null);
    try {
      const body = await backend.pinterestSearch({ term: "art reference", limit: 5 });
      const { results } = normalizePinterestResponse(body);
      setTest({
        ok: true,
        message: `Connected. Pinterest keyword search is working (${results.length} test pins returned).`,
      });
    } catch (err) {
      setTest({ ok: false, message: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <h2>Pinterest</h2>
      <p className="faint">
        Searches Pinterest by keyword through Pinterest&apos;s <strong>official API</strong>. It is
        free, but Pinterest only allows keyword search for developer apps it has approved (the
        feature is in beta). This app never scrapes pinterest.com.
      </p>
      {!desktop && (
        <Banner kind="info">
          Pinterest can only be set up in the desktop app, which stores the token securely.
        </Banner>
      )}
      <ol style={{ paddingLeft: 18, marginTop: 0 }} className="faint">
        <li>
          Sign in at developers.pinterest.com with your Pinterest account and create an app (under
          My apps).
        </li>
        <li>
          Ask Pinterest for access to keyword search (&quot;search partner pins&quot;,{" "}
          <code>/v5/search/partner/pins</code>) through Pinterest&apos;s process for beta and
          restricted features. Pinterest decides; it can take time or be declined.
        </li>
        <li>
          Create an access token for your app with the <code>pins:read</code> and{" "}
          <code>boards:read</code> scopes, and paste it below. Tokens expire; if Pinterest later
          rejects it, create a new one.
        </li>
        <li>
          Press <strong>Test connection</strong>, then choose &quot;Pinterest&quot; as the search
          source on the Discover screen.
        </li>
      </ol>

      <form onSubmit={saveToken} className="row" style={{ alignItems: "flex-end" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label htmlFor="pinterest-token">Access token</label>
          <input
            id="pinterest-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            disabled={!desktop}
            placeholder={
              status?.hasToken ? "A token is stored. Paste a new one to replace it." : "pina_…"
            }
            onChange={(e) => setToken(e.target.value)}
          />
        </div>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!desktop || !token.trim() || busy}
        >
          Save token
        </button>
        <button
          type="button"
          className="btn btn-danger"
          onClick={removeToken}
          disabled={!status?.hasToken}
        >
          Remove token
        </button>
      </form>
      <div className="faint" style={{ marginTop: 6 }}>
        Token stored: <strong>{status?.hasToken ? "yes" : "no"}</strong>
        {desktop && status ? ` (in ${status.secureStorage})` : ""}
      </div>

      <div className="row" style={{ marginTop: 12, alignItems: "flex-end" }}>
        <div className="field" style={{ margin: 0 }}>
          <label htmlFor="pinterest-country">Country (2 letters)</label>
          <input
            id="pinterest-country"
            type="text"
            value={country}
            maxLength={2}
            style={{ width: 80, textTransform: "uppercase" }}
            onChange={(e) => setCountry(e.target.value)}
            onBlur={saveCountry}
          />
        </div>
        <button
          type="button"
          className="btn"
          onClick={testConnection}
          disabled={!desktop || !status?.hasToken || busy}
        >
          {busy ? "Testing…" : "Test connection"}
        </button>
      </div>
      <div className="field-hint">Pinterest needs a country for search results, e.g. US or TH.</div>

      {test &&
        (test.ok ? (
          <Banner kind="info">{test.message}</Banner>
        ) : (
          <ErrorBanner message={test.message} onDismiss={() => setTest(null)} />
        ))}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
    </div>
  );
}

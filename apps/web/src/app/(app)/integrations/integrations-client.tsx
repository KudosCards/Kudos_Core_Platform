"use client";

import { useEffect, useState, type FormEvent } from "react";
import type {
  AccountApiKey,
  CreatedApiKey,
  CrmConnection,
  CrmSyncResult,
} from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** Provider slug → the name we show. Falls back to a capitalised slug. */
function labelFor(provider: string): string {
  const known: Record<string, string> = { brevo: "Brevo", hubspot: "HubSpot" };
  return known[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

function formatDate(value: Date | string | null): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
    >
      {copied ? "Copied" : label}
    </button>
  );
}

/** The one live connector in Phase 2. HubSpot/GoHighLevel come with the OAuth lane. */
function BrevoConnector({
  connection,
  onChange,
}: {
  connection: CrmConnection | undefined;
  onChange: (next: CrmConnection | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [dobAttr, setDobAttr] = useState("");
  const [postcodeAttr, setPostcodeAttr] = useState("");
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrmSyncResult | null>(null);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!apiKey.trim()) {
      setError("Paste your Brevo API key");
      return;
    }
    setError(null);
    setBusy("connect");
    try {
      const fieldMapping: Record<string, string> = {};
      if (dobAttr.trim()) fieldMapping.dateOfBirth = dobAttr.trim();
      if (postcodeAttr.trim()) fieldMapping.addressPostcode = postcodeAttr.trim();
      const created = await clientApiFetch<CrmConnection>("/integrations/connections", {
        method: "POST",
        body: JSON.stringify({
          provider: "brevo",
          apiKey: apiKey.trim(),
          ...(Object.keys(fieldMapping).length > 0 && { fieldMapping }),
        }),
      });
      onChange(created);
      setApiKey("");
      setOpen(false);
    } catch (connectError) {
      setError(
        connectError instanceof ApiError ? connectError.message : "Could not connect to Brevo",
      );
    } finally {
      setBusy(null);
    }
  }

  async function sync() {
    setError(null);
    setResult(null);
    setBusy("sync");
    try {
      const syncResult = await clientApiFetch<CrmSyncResult>("/integrations/connections/brevo/sync", {
        method: "POST",
      });
      setResult(syncResult);
      if (connection) onChange({ ...connection, lastSyncedAt: new Date(), lastSyncStatus: "ok" });
    } catch (syncError) {
      setError(syncError instanceof ApiError ? syncError.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy("disconnect");
    try {
      await clientApiFetch("/integrations/connections/brevo", { method: "DELETE" });
      onChange(null);
      setResult(null);
    } catch (disconnectError) {
      setError(disconnectError instanceof ApiError ? disconnectError.message : "Could not disconnect");
    } finally {
      setBusy(null);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-semibold">Brevo</span>
          {connection && (
            <span className="ml-2 pill pill-positive">Connected</span>
          )}
        </div>
        {!connection && !open && (
          <button type="button" onClick={() => setOpen(true)} className="btn-accent">
            Connect
          </button>
        )}
        {connection && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void sync()}
              className="btn-accent"
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void disconnect()}
              className="btn-secondary"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}

      {connection && (
        <p className="text-xs text-muted">
          Last synced {formatDate(connection.lastSyncedAt)}
          {connection.lastSyncStatus && connection.lastSyncStatus !== "ok"
            ? ` · ${connection.lastSyncStatus}`
            : ""}{" "}
          · syncs automatically each night.
        </p>
      )}

      {result && (
        <p className="rounded-lg bg-[#e8f1ea] px-4 py-2 text-sm font-medium text-[#2f7d54]">
          Imported {result.created} new, {result.updated} updated
          {result.skipped > 0 ? `, ${result.skipped} skipped` : ""} (of {result.fetched} fetched).
        </p>
      )}

      {!connection && open && (
        <form onSubmit={(e) => void connect(e)} className="flex flex-col gap-3 border-t border-border pt-3">
          <label className="flex flex-col gap-1 text-sm">
            Brevo API key
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="xkeysib-…"
              className={inputClass}
              autoComplete="off"
            />
          </label>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted">Field mapping (optional)</summary>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Date-of-birth attribute</span>
                <input
                  value={dobAttr}
                  onChange={(e) => setDobAttr(e.target.value)}
                  placeholder="e.g. DOB"
                  className={inputClass}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Postcode attribute</span>
                <input
                  value={postcodeAttr}
                  onChange={(e) => setPostcodeAttr(e.target.value)}
                  placeholder="e.g. POSTCODE"
                  className={inputClass}
                />
              </label>
            </div>
            <p className="mt-1 text-xs text-muted">
              Name and email use Brevo&apos;s standard fields automatically. Set these only if you
              store a birthday or postcode in custom Brevo attributes.
            </p>
          </details>
          <div className="flex gap-2">
            <button type="submit" disabled={busy === "connect"} className="btn-accent">
              {busy === "connect" ? "Connecting…" : "Connect Brevo"}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/** HubSpot uses OAuth: no API key to paste — "Connect" bounces the user through
 * HubSpot's consent screen and back. The connected state mirrors Brevo's. */
function HubSpotConnector({
  connection,
  onChange,
}: {
  connection: CrmConnection | undefined;
  onChange: (next: CrmConnection | null) => void;
}) {
  const [busy, setBusy] = useState<null | "connect" | "sync" | "disconnect">(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CrmSyncResult | null>(null);

  async function connect() {
    setError(null);
    setBusy("connect");
    try {
      // The API builds HubSpot's consent URL (with a signed state); we redirect
      // the browser to it. HubSpot returns to the API callback, which lands us
      // back here with ?connected=hubspot.
      const { url } = await clientApiFetch<{ url: string }>("/integrations/oauth/hubspot/start");
      window.location.href = url;
    } catch (connectError) {
      setError(
        connectError instanceof ApiError ? connectError.message : "Could not start HubSpot connect",
      );
      setBusy(null);
    }
  }

  async function sync() {
    setError(null);
    setResult(null);
    setBusy("sync");
    try {
      const syncResult = await clientApiFetch<CrmSyncResult>(
        "/integrations/connections/hubspot/sync",
        { method: "POST" },
      );
      setResult(syncResult);
      if (connection) onChange({ ...connection, lastSyncedAt: new Date(), lastSyncStatus: "ok" });
    } catch (syncError) {
      setError(syncError instanceof ApiError ? syncError.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  }

  async function disconnect() {
    setError(null);
    setBusy("disconnect");
    try {
      await clientApiFetch("/integrations/connections/hubspot", { method: "DELETE" });
      onChange(null);
      setResult(null);
    } catch (disconnectError) {
      setError(
        disconnectError instanceof ApiError ? disconnectError.message : "Could not disconnect",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="font-semibold">HubSpot</span>
          {connection && <span className="ml-2 pill pill-positive">Connected</span>}
        </div>
        {!connection && (
          <button
            type="button"
            disabled={busy === "connect"}
            onClick={() => void connect()}
            className="btn-accent"
          >
            {busy === "connect" ? "Redirecting…" : "Connect"}
          </button>
        )}
        {connection && (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void sync()}
              className="btn-accent"
            >
              {busy === "sync" ? "Syncing…" : "Sync now"}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void disconnect()}
              className="btn-secondary"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm font-medium text-accent">{error}</p>}

      {!connection && (
        <p className="text-xs text-muted">
          Connect your HubSpot account to import contacts. You&apos;ll be sent to HubSpot to approve
          read-only access to your contacts — no password is shared with us.
        </p>
      )}

      {connection && (
        <p className="text-xs text-muted">
          Last synced {formatDate(connection.lastSyncedAt)}
          {connection.lastSyncStatus && connection.lastSyncStatus !== "ok"
            ? ` · ${connection.lastSyncStatus}`
            : ""}{" "}
          · syncs automatically each night.
        </p>
      )}

      {result && (
        <p className="rounded-lg bg-[#e8f1ea] px-4 py-2 text-sm font-medium text-[#2f7d54]">
          Imported {result.created} new, {result.updated} updated
          {result.skipped > 0 ? `, ${result.skipped} skipped` : ""} (of {result.fetched} fetched).
        </p>
      )}
    </div>
  );
}

export function IntegrationsClient({
  initialKeys,
  initialConnections,
  apiBaseUrl,
  connectedProvider,
  errorProvider,
}: {
  initialKeys: AccountApiKey[];
  initialConnections: CrmConnection[];
  apiBaseUrl: string;
  connectedProvider: string | null;
  errorProvider: string | null;
}) {
  const [keys, setKeys] = useState<AccountApiKey[]>(initialKeys);
  const [connections, setConnections] = useState<CrmConnection[]>(initialConnections);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  // The OAuth round-trip lands back here with ?connected=<provider> or
  // ?error=<provider>, read server-side and passed in — so the banner renders
  // identically on server and client (no hydration mismatch, no setState-in-effect).
  const [notice] = useState<{ tone: "ok" | "bad"; text: string } | null>(() => {
    if (connectedProvider) {
      return {
        tone: "ok",
        text: `${labelFor(connectedProvider)} connected — click “Sync now” to import your contacts.`,
      };
    }
    if (errorProvider) {
      return { tone: "bad", text: `We couldn't connect ${labelFor(errorProvider)}. Please try again.` };
    }
    return null;
  });

  const brevo = connections.find((c) => c.provider === "brevo");
  const hubspot = connections.find((c) => c.provider === "hubspot");

  function updateConnection(provider: string, next: CrmConnection | null) {
    setConnections((current) => {
      const others = current.filter((c) => c.provider !== provider);
      return next ? [...others, next] : others;
    });
  }

  // Once shown, strip the query flag from the URL bar so a refresh is clean.
  // Touches only the browser history (an external system), never React state.
  useEffect(() => {
    if ((connectedProvider || errorProvider) && typeof window !== "undefined") {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [connectedProvider, errorProvider]);

  const endpoint = `${apiBaseUrl.replace(/\/$/, "")}/integrations/contacts`;
  const sampleKey = newKey?.key ?? "YOUR_API_KEY";
  const curl = [
    `curl -X POST ${endpoint} \\`,
    `  -H "x-api-key: ${sampleKey}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"contacts":[{"externalId":"123","firstName":"Ada","lastName":"Lovelace","email":"ada@example.com","dateOfBirth":"2015-06-01"}]}'`,
  ].join("\n");

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!label.trim()) {
      setError("Give the key a label so you can recognise it later");
      return;
    }
    setError(null);
    setCreating(true);
    try {
      const created = await clientApiFetch<CreatedApiKey>("/integrations/api-keys", {
        method: "POST",
        body: JSON.stringify({ label: label.trim() }),
      });
      setNewKey(created);
      setKeys((current) => [created, ...current]);
      setLabel("");
    } catch (createError) {
      setError(createError instanceof ApiError ? createError.message : "Could not create the key");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    setError(null);
    setRevokingId(id);
    try {
      await clientApiFetch(`/integrations/api-keys/${id}`, { method: "DELETE" });
      setKeys((current) => current.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k)));
      if (newKey?.id === id) setNewKey(null);
    } catch (revokeError) {
      setError(revokeError instanceof ApiError ? revokeError.message : "Could not revoke the key");
    } finally {
      setRevokingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-muted">
          Bring recipients in from your CRM or any other system. Contacts you sync or push appear on
          the Recipients page tagged with their source.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {/* CRM connectors */}
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Connect a CRM</h2>
        {notice && (
          <p
            className={
              notice.tone === "ok"
                ? "rounded-lg bg-[#e8f1ea] px-4 py-2 text-sm font-medium text-[#2f7d54]"
                : "rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent"
            }
          >
            {notice.text}
          </p>
        )}
        <BrevoConnector connection={brevo} onChange={(next) => updateConnection("brevo", next)} />
        <HubSpotConnector connection={hubspot} onChange={(next) => updateConnection("hubspot", next)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="card flex flex-col gap-2 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="font-semibold">Zapier</span>
              <span className="pill pill-accent">Via API key</span>
            </div>
            <p className="text-xs text-muted">
              Connect Kudos to 6,000+ apps. Create an API key below, then add the{" "}
              <span className="font-medium">Kudos Cards</span> app in Zapier and paste the key to
              start importing contacts.
            </p>
          </div>
          <div className="card flex items-center justify-between gap-3 p-4">
            <span className="font-semibold">GoHighLevel</span>
            <span className="pill pill-muted">Coming soon</span>
          </div>
        </div>
      </div>

      {/* API keys */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">API keys</h2>
          <p className="text-sm text-muted">
            Prefer to push contacts yourself? Create a key to send them in from any system. The full
            key is shown once — store it somewhere safe.
          </p>
        </div>

        {newKey && (
          <div className="card flex flex-col gap-2 border-accent/30 bg-accent-soft/50 p-4">
            <p className="text-sm font-semibold text-accent">
              Here&apos;s your new key — copy it now, it won&apos;t be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-md border border-border bg-surface px-3 py-2 font-mono text-sm">
                {newKey.key}
              </code>
              <CopyButton text={newKey.key} />
            </div>
          </div>
        )}

        <form onSubmit={(e) => void createKey(e)} className="flex flex-wrap items-center gap-2">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label (e.g. Nightly sync)"
            maxLength={80}
            className="min-w-56 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
          />
          <button type="submit" disabled={creating} className="btn-accent">
            {creating ? "Creating…" : "Create key"}
          </button>
        </form>

        {keys.length > 0 && (
          <div className="card divide-y divide-border overflow-hidden">
            {keys.map((key) => {
              const revoked = key.revokedAt !== null;
              return (
                <div
                  key={key.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
                >
                  <div className="flex flex-col">
                    <span className="font-medium">{key.label}</span>
                    <span className="font-mono text-xs text-muted">{key.prefix}…</span>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted">
                    <span>Created {formatDate(key.createdAt)}</span>
                    <span>Last used {formatDate(key.lastUsedAt)}</span>
                    {revoked ? (
                      <span className="pill pill-muted">Revoked</span>
                    ) : (
                      <button
                        type="button"
                        disabled={revokingId === key.id}
                        onClick={() => void revoke(key.id)}
                        className="btn-secondary px-3 py-1.5 text-xs"
                      >
                        {revokingId === key.id ? "Revoking…" : "Revoke"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* How-to */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">Push contacts to your account</h2>
          <p className="text-sm text-muted">
            Send a <code className="font-mono text-xs">POST</code> to the endpoint below with your
            key. Re-sending a contact with the same{" "}
            <code className="font-mono text-xs">externalId</code> updates it instead of creating a
            duplicate.
          </p>
        </div>
        <div className="card flex items-center gap-2 p-3">
          <code className="min-w-0 flex-1 truncate font-mono text-sm">{endpoint}</code>
          <CopyButton text={endpoint} />
        </div>
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <span className="section-label">Example</span>
            <CopyButton text={curl} label="Copy curl" />
          </div>
          <pre className="overflow-x-auto p-4 font-mono text-xs leading-relaxed">{curl}</pre>
        </div>
      </div>
    </div>
  );
}

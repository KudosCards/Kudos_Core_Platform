"use client";

import { useState, type FormEvent } from "react";
import type { AccountApiKey, CreatedApiKey } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

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

export function IntegrationsClient({
  initialKeys,
  apiBaseUrl,
}: {
  initialKeys: AccountApiKey[];
  apiBaseUrl: string;
}) {
  const [keys, setKeys] = useState<AccountApiKey[]>(initialKeys);
  const [label, setLabel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState<CreatedApiKey | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

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
      setKeys((current) =>
        current.map((k) => (k.id === id ? { ...k, revokedAt: new Date() } : k)),
      );
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
          Bring recipients in from your CRM or any other system. Contacts you push appear on the
          Recipients page tagged with their source.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-accent-soft px-4 py-2 text-sm font-medium text-accent">{error}</p>
      )}

      {/* Connect-a-CRM lane — the managed connectors land in a later phase. */}
      <div className="grid gap-4 sm:grid-cols-3">
        {["Brevo", "HubSpot", "GoHighLevel"].map((name) => (
          <div key={name} className="card flex items-center justify-between gap-3 p-4">
            <span className="font-semibold">{name}</span>
            <span className="pill pill-muted">Coming soon</span>
          </div>
        ))}
      </div>

      {/* API keys */}
      <div className="flex flex-col gap-3">
        <div>
          <h2 className="font-semibold">API keys</h2>
          <p className="text-sm text-muted">
            Create a key to push contacts in from any system. The full key is shown once — store it
            somewhere safe.
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
            placeholder="Label (e.g. Brevo sync)"
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
            key. Re-sending a contact with the same <code className="font-mono text-xs">externalId</code>{" "}
            updates it instead of creating a duplicate.
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

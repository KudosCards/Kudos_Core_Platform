"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RecipientListSummary, SegmentSummary } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";
import { EMPTY_RULE, RuleBuilder, toDefinition, type RuleState } from "../rule-builder";

/**
 * Build a smart list. Until now the only way to get one was to save a copy of a
 * fixed suggestion under a new name. See docs/adr/0177.
 */
export function NewSmartListClient({ lists }: { lists: RecipientListSummary[] }) {
  const router = useRouter();
  const [rule, setRule] = useState<RuleState>(EMPTY_RULE);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const definition = toDefinition(rule);
  const trimmed = name.trim();

  async function save() {
    if (!definition || !trimmed) return;
    setSaving(true);
    setError(null);
    try {
      const created = await clientApiFetch<SegmentSummary>("/segments", {
        method: "POST",
        body: JSON.stringify({ name: trimmed, definition }),
      });
      router.push(`/lists/smart/${encodeURIComponent(created.key)}`);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the list");
      setSaving(false);
    }
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <div className="flex flex-col gap-1">
        <Link href="/lists" className="text-sm text-muted hover:underline">
          ← Lists
        </Link>
        <h1 className="text-3xl font-bold tracking-tight">New smart list</h1>
        <p className="text-sm text-muted">
          Set a rule once and the list keeps itself up to date — nobody has to remember to add
          people to it.
        </p>
      </div>

      {error && <p className="notice notice-danger">{error}</p>}

      <label className="flex max-w-sm flex-col gap-1.5">
        <span className="text-sm font-medium">List name</span>
        <input
          value={name}
          maxLength={80}
          onChange={(event) => setName(event.target.value)}
          placeholder="Birthdays next fortnight"
          className="rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
      </label>

      <RuleBuilder rule={rule} onChange={setRule} lists={lists} />

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <button
          type="button"
          onClick={() => void save()}
          disabled={!definition || !trimmed || saving}
          className="btn-accent disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save list"}
        </button>
        <Link href="/lists" className="btn-secondary">
          Cancel
        </Link>
        {!trimmed && <span className="text-xs text-muted">Give the list a name to save it.</span>}
      </div>
    </div>
  );
}

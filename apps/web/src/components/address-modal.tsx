"use client";

import type { Recipient } from "@kudos/shared-types";
import { ukPostcodeRegex } from "@kudos/shared-types";
import { useState, type FormEvent } from "react";
import { Modal } from "@/components/modal";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/**
 * Inline "add / edit a postal address" dialog. Patches the recipient in place
 * and hands the updated record back via `onSaved`, so a caller (e.g. bulk send)
 * can flip a contact from "no address" to mailable without navigating away from
 * its workflow. Mirrors the API's address rule (line 1 + town + a valid UK
 * postcode required) so the user gets a friendly message before the round-trip.
 *
 * The postcode field is deliberately isolated so a postcode-lookup/autocomplete
 * enhancement can slot in later without touching the rest of the flow.
 */
export function AddressModal({
  recipient,
  open,
  onClose,
  onSaved,
}: {
  recipient: Recipient;
  open: boolean;
  onClose: () => void;
  onSaved: (updated: Recipient) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const str = (key: string) => String(data.get(key) || "").trim();

    const addressLine1 = str("addressLine1");
    const addressCity = str("addressCity");
    const addressPostcode = str("addressPostcode");
    const addressLine2 = str("addressLine2");

    if (!addressLine1 || !addressCity || !addressPostcode) {
      setError("Address line 1, town/city and postcode are all needed to post a card.");
      return;
    }
    if (!ukPostcodeRegex.test(addressPostcode)) {
      setError("That doesn't look like a valid UK postcode.");
      return;
    }

    setSaving(true);
    try {
      const updated = await clientApiFetch<Recipient>(`/recipients/${recipient.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          addressLine1,
          ...(addressLine2 && { addressLine2 }),
          addressCity,
          addressPostcode,
        }),
      });
      onSaved(updated);
      onClose();
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save the address.");
    } finally {
      setSaving(false);
    }
  }

  const inputClass = "rounded-md border border-border bg-surface px-3 py-2.5 text-base sm:text-sm";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Address for ${recipient.firstName} ${recipient.lastName}`}
    >
      <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
        {error && (
          <p className="notice notice-danger">
            {error}
          </p>
        )}
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Address line 1</span>
          <input
            name="addressLine1"
            required
            autoComplete="address-line1"
            defaultValue={recipient.addressLine1 ?? ""}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Address line 2 (optional)</span>
          <input
            name="addressLine2"
            autoComplete="address-line2"
            defaultValue={recipient.addressLine2 ?? ""}
            className={inputClass}
          />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Town / city</span>
            <input
              name="addressCity"
              required
              autoComplete="address-level2"
              defaultValue={recipient.addressCity ?? ""}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-muted">Postcode</span>
            <input
              name="addressPostcode"
              required
              autoComplete="postal-code"
              autoCapitalize="characters"
              defaultValue={recipient.addressPostcode ?? ""}
              className={inputClass}
            />
          </label>
        </div>
        <div className="flex gap-2 pt-1">
          <button type="submit" disabled={saving} className="btn-accent flex-1">
            {saving ? "Saving…" : "Save address"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-sm hover:bg-foreground/[0.03]"
          >
            Cancel
          </button>
        </div>
      </form>
    </Modal>
  );
}

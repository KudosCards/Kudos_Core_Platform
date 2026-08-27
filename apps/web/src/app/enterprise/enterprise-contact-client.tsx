"use client";

import { useState, type FormEvent } from "react";
import { createEnterpriseEnquirySchema, type EnterpriseEnquiryAck } from "@kudos/shared-types";
import { ApiError } from "@/lib/api";
import { publicApiPost } from "@/lib/api.public";

const CORAL = "#ef5b52";

const fieldClass =
  "rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-900 outline-none focus:border-slate-400";

/**
 * The public Enterprise "Contact us" form. Unauthenticated — posts to the
 * `@Public()` /enterprise-enquiries endpoint via publicApiPost. Validates with
 * the shared zod schema first so the visitor gets inline feedback before the
 * round-trip. See docs/adr/0101-enterprise-plan-enquiries.md.
 */
export function EnterpriseContactForm() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    const parsed = createEnterpriseEnquirySchema.safeParse({
      name: String(data.get("name") ?? ""),
      email: String(data.get("email") ?? ""),
      organisation: String(data.get("organisation") ?? ""),
      phone: String(data.get("phone") ?? ""),
      teamSize: String(data.get("teamSize") ?? ""),
      message: String(data.get("message") ?? ""),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Please check the form and try again.");
      return;
    }
    setSubmitting(true);
    try {
      await publicApiPost<EnterpriseEnquiryAck>("/enterprise-enquiries", parsed.data);
      setDone(true);
    } catch (submitError) {
      setError(
        submitError instanceof ApiError
          ? submitError.message
          : "Something went wrong — please try again.",
      );
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-100">
        <div
          className="mx-auto flex h-12 w-12 items-center justify-center rounded-full text-white"
          style={{ backgroundColor: CORAL }}
        >
          ✓
        </div>
        <h2 className="mt-4 text-xl font-bold text-slate-900">Thanks — we&apos;ll be in touch</h2>
        <p className="mt-2 text-sm text-slate-600">
          Your enquiry has reached our team. We&apos;ll get back to you within one working day to
          talk through the right setup for your organisation.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="flex flex-col gap-4 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-100 sm:p-8"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Your name</span>
          <input name="name" required autoComplete="name" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Work email</span>
          <input name="email" type="email" required autoComplete="email" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">Organisation</span>
          <input name="organisation" required autoComplete="organization" className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-slate-700">
            Phone <span className="font-normal text-slate-400">(optional)</span>
          </span>
          <input name="phone" type="tel" autoComplete="tel" className={fieldClass} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">
          How many contacts? <span className="font-normal text-slate-400">(optional)</span>
        </span>
        <input
          name="teamSize"
          placeholder="e.g. 800 students across 3 sites"
          className={fieldClass}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium text-slate-700">What are you looking for?</span>
        <textarea
          name="message"
          required
          rows={4}
          placeholder="Tell us about your organisation and what you'd like Kudos to do for you."
          className={`${fieldClass} resize-y`}
        />
      </label>

      {error && (
        <p className="rounded-lg bg-rose-50 px-4 py-2 text-sm font-medium text-rose-700">{error}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="w-fit rounded-full px-6 py-3 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
        style={{ backgroundColor: CORAL }}
      >
        {submitting ? "Sending…" : "Send enquiry"}
      </button>
      <p className="text-xs text-slate-400">
        We&apos;ll only use your details to respond to this enquiry.
      </p>
    </form>
  );
}

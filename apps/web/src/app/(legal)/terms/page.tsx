import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { TERMS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms & Conditions — Kudos Cards",
  description: "The terms and conditions governing use of the Kudos Cards platform and services.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalDocument doc={TERMS} />;
}

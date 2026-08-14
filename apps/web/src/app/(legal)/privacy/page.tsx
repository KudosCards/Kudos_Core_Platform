import type { Metadata } from "next";
import { LegalDocument } from "@/components/legal-document";
import { PRIVACY } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Privacy Policy — Kudos Cards",
  description: "How Kudos Cards collects, uses, stores and shares personal information.",
};

export default function PrivacyPage() {
  return <LegalDocument doc={PRIVACY} />;
}

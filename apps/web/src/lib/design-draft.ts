import type { DesignDocument } from "@kudos/shared-types";

/**
 * The editor mirrors unsaved edits into localStorage (debounced) so a session
 * timeout, a crash, an accidental Back, or a failed save can never lose work —
 * on the next visit we offer to restore. Cleared once the design is saved to the
 * server. See docs/adr/0143.
 *
 * Extracted from the editor component so the failure modes can be tested
 * directly: the editor itself pulls in the Konva canvas and cannot be mounted in
 * jsdom, which is why `writeDraft` silently lying about success went unnoticed
 * (ADR 0182).
 */
const DRAFT_KEY_PREFIX = "kudos:design-draft:";

export const draftKey = (designId: string): string => `${DRAFT_KEY_PREFIX}${designId}`;

export interface DesignDraft {
  name: string;
  document: DesignDocument;
  /** When the local edit was captured (ms epoch). */
  ts: number;
}

/** Parse the stored draft for a design, tolerating absence, corruption, or a
 * browser that blocks storage (private mode) — always returns null rather than
 * throwing so the editor never breaks over a bad draft. */
export function readDraft(designId: string): DesignDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(designId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DesignDraft>;
    if (!parsed || typeof parsed.name !== "string" || typeof parsed.document !== "object") {
      return null;
    }
    return parsed as DesignDraft;
  } catch {
    return null;
  }
}

/**
 * Mirror an edit to this device. Returns whether the write actually landed.
 *
 * The return value is the whole point. A quota-full or storage-blocked browser
 * throws here, and the editor decides three things on the strength of this: the
 * "backed up on this device" chip, the beforeunload guard, and the in-app
 * "unsaved changes" confirm. Reporting success on a write that threw is how
 * work gets lost immediately after being called safe — so this never throws,
 * but it never claims to have succeeded either. See ADR 0182.
 */
export function writeDraft(designId: string, draft: DesignDraft): boolean {
  try {
    window.localStorage.setItem(draftKey(designId), JSON.stringify(draft));
    return true;
  } catch {
    // Storage full, blocked (private mode), or the property itself refused.
    // Non-fatal to the editor — but emphatically not a backup.
    return false;
  }
}

export function clearDraft(designId: string): void {
  try {
    window.localStorage.removeItem(draftKey(designId));
  } catch {
    /* ignore */
  }
}

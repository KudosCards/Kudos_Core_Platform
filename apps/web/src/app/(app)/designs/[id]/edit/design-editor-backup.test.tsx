import { fireEvent, render, screen, act } from "@testing-library/react";
import type { SavedDesign } from "@kudos/shared-types";
import { draftKey } from "@/lib/design-draft";
import { DesignEditorClient } from "./design-editor-client";

/**
 * What the editor tells a member about the safety of their unsaved work, and
 * what it does about leaving.
 *
 * The claim drives three things: the status chip, the `beforeunload` guard and
 * the in-app "unsaved changes" confirm. It used to be set whether or not the
 * localStorage write had actually landed, so a browser that refused storage got
 * told the work was safe and had both guards taken off it. See ADR 0182.
 */

jest.mock("@/lib/api.client", () => ({
  // Never resolves: the uploads-library fetch is irrelevant here, and letting it
  // settle would land a setState outside act().
  clientApiFetch: jest.fn(() => new Promise(() => {})),
}));
jest.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
// The Konva canvas is loaded through next/dynamic and has nothing to say about
// backups; stubbing it keeps the lazy-load state update out of the test.
jest.mock("./design-canvas", () => ({ DesignCanvas: () => null }));

const SAVED_DESIGN = {
  id: "design-1",
  name: "Nine years",
  cardSize: "a6",
  document: { pages: [{ name: "front", elements: [] }] },
} as unknown as SavedDesign;

function renderEditor() {
  return render(
    <DesignEditorClient savedDesign={SAVED_DESIGN} messagePages={[]} canAuthorMessagePages />,
  );
}

/** Type into the design-name field, then run out the 1s autosave debounce. */
function editAndSettle(value: string) {
  fireEvent.change(screen.getByLabelText("Design name"), { target: { value } });
  act(() => {
    jest.advanceTimersByTime(1500);
  });
}

function useStorage(stub: Partial<Storage>) {
  Object.defineProperty(window, "localStorage", {
    value: stub as Storage,
    configurable: true,
    writable: true,
  });
}

describe("the editor's backup claim", () => {
  let confirmSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("when the browser refuses to store the draft", () => {
    beforeEach(() => {
      useStorage({
        getItem: () => null,
        removeItem: () => undefined,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      });
    });

    it("does not claim the work is backed up", () => {
      renderEditor();
      editAndSettle("Ten years");

      expect(screen.queryByText(/backed up on this device/i)).not.toBeInTheDocument();
      expect(screen.getByText(/can.t back up on this device/i)).toBeInTheDocument();
    });

    it("keeps the in-app leave guard on", () => {
      renderEditor();
      editAndSettle("Ten years");

      fireEvent.click(screen.getByRole("link", { name: /back to designs/i }));
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    });
  });

  describe("when the draft is stored successfully", () => {
    beforeEach(() => {
      const store = new Map<string, string>();
      useStorage({
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      });
    });

    it("says so, and drops the leave guard as designed", () => {
      renderEditor();
      editAndSettle("Ten years");

      expect(screen.getByText(/backed up on this device/i)).toBeInTheDocument();

      // The whole reason the guard is conditional: once the work is restorable
      // on return, nagging on the way out is noise.
      fireEvent.click(screen.getByRole("link", { name: /back to designs/i }));
      expect(confirmSpy).not.toHaveBeenCalled();
    });

    it("stops claiming a backup once the draft has been discarded", () => {
      // The claim is derived by comparing the current edit against the last
      // snapshot that was mirrored. Clearing the draft empties the store but
      // used to leave that snapshot behind, so an edit matching it read as
      // backed up against storage holding nothing — chip on, leave guard off,
      // work unrecoverable. See ADR 0232.
      // A draft from a previous session, so the recovery banner (and its
      // Discard) is on screen while this session makes its own edits.
      window.localStorage.setItem(
        draftKey(SAVED_DESIGN.id),
        JSON.stringify({ name: "From yesterday", document: SAVED_DESIGN.document, ts: Date.now() }),
      );

      renderEditor();
      editAndSettle("Ten years");
      expect(screen.getByText(/backed up on this device/i)).toBeInTheDocument();

      // The recovery banner's Discard, which throws the stored draft away
      // without touching the edit in front of the member.
      fireEvent.click(screen.getByRole("button", { name: /^discard$/i }));

      expect(screen.queryByText(/backed up on this device/i)).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("link", { name: /back to designs/i }));
      expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("unsaved changes"));
    });
  });
});

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MERGE_FIELDS,
  MESSAGE_DRAFT_BRIEF_MAX_LENGTH,
  STANDING_ORDER_MAX_DESIGNS,
  STANDING_ORDER_MAX_MESSAGES,
  STANDING_ORDER_MESSAGE_MAX_LENGTH,
  cardCategoryLabel,
  catalogSaysBirthday,
  designTakesMessage,
  type CardDesign,
  type ContactReadiness,
  type DesignDocument,
  type MessageDrafts,
  type StandingOrderMessageSource,
  type SavedDesign,
  type StandingOrder,
  type StandingOrderBlocker,
  type WalletProjection,
  type WalletSummary,
} from "@kudos/shared-types";
import { AutoTopUpCard } from "@/components/auto-top-up-card";
import { SavedDesignThumb } from "@/components/saved-design-thumb";
import { TemplatePickerModal } from "@/components/template-picker-modal";
import { ApiError } from "@/lib/api";
import { clientApiFetch } from "@/lib/api.client";

/** A design in the account's library, as this page needs it. */
export interface DesignOption {
  id: string;
  name: string;
  document: DesignDocument;
  /** The catalog occasion behind it; null for the member's own artwork. */
  category: string | null;
}

/** A message in the pool, and whether the subscriber wrote it or kept a draft. */
interface PoolMessage {
  text: string;
  source: StandingOrderMessageSource;
}

interface ListOption {
  id: string;
  name: string;
  memberCount: number;
}

/**
 * Why a switched-on instruction is not running, said plainly.
 *
 * A `Record` keyed on the code rather than a lookup with a fallback, so the API
 * gaining a blocker fails the build here until somebody decides what a customer
 * should read. The `??` below covers only an API that is ahead of this deploy.
 */
const BLOCKER_TEXT: Record<StandingOrderBlocker, string> = {
  plan: "Your plan does not include automatic sending.",
  consent: "Nobody has agreed to how this works yet — read it below and tick the box.",
  empty_pool: "You need at least one card design and one message.",
  design_archived: "One of your chosen cards has been removed from your designs.",
  audience_gone:
    "The list you chose has been deleted, so we have stopped rather than send to everybody.",
  audience_unsupported:
    "This is pointed at a smart list. Smart lists change on their own, so we do not send from them — choose a list you pick by hand, or everybody.",
};

const UNKNOWN_BLOCKER = "Something is stopping this from running.";

/** The empty instruction a page with no saved order starts from. */
const EMPTY: StandingOrder = {
  id: null,
  enabled: false,
  audience: { kind: "all" },
  postageClass: "second_class",
  designs: [],
  messages: [],
  active: false,
  blockers: [],
  consent: null,
  consentStatement: [],
  consentVersion: 0,
  planAllows: false,
  messageDraftingAvailable: false,
  audienceGone: false,
};

/**
 * The page somebody hands their birthdays over on.
 *
 * Three steps rather than six equal boxes: who gets a card, what we send, and
 * how it is paid for and switched on. The order is the order of the decision,
 * and the weight follows it — a two-option audience is not as big a moment as
 * agreeing to unattended spending, and the first draft of this page gave them
 * the same box. See docs/adr/0262.
 */
export function ClickAndForgetClient({
  initialOrder,
  designs,
  lists,
  templates,
  wallet,
  projection,
  initialReadiness,
}: {
  initialOrder: StandingOrder | null;
  designs: DesignOption[];
  lists: ListOption[];
  templates: CardDesign[];
  wallet: WalletSummary | null;
  projection: WalletProjection | null;
  initialReadiness: ContactReadiness | null;
}) {
  const router = useRouter();
  /**
   * A failed read is not an empty instruction.
   *
   * `GET /standing-order` answers with a real empty one (`id: null`) for an
   * account that has never set this up, so null here means the read failed —
   * and rendering that as "nothing configured" put a live Save button over
   * somebody's real instruction, one press from replacing it with an empty,
   * switched-off one.
   */
  const unavailable = initialOrder === null;
  const [order, setOrder] = useState<StandingOrder>(initialOrder ?? EMPTY);
  const [library, setLibrary] = useState<DesignOption[]>(designs);
  const [enabled, setEnabled] = useState(order.enabled);
  /**
   * Which audience is selected, or `null` for "somebody has to choose".
   *
   * Null in exactly two cases, and both are ones where picking on the
   * subscriber's behalf would widen the instruction: the list it was aimed at
   * has been deleted, and a smart-list audience we will not act on. The old
   * default read `order.audience.kind`, which is `all` for both — so a page
   * showing thirty children yesterday showed "Everybody" ticked today, and one
   * press of Save made that true.
   */
  const [audienceKind, setAudienceKind] = useState<"all" | "list" | null>(
    order.audience.kind === "segment" || order.audienceGone ? null : order.audience.kind,
  );
  const [listId, setListId] = useState(
    order.audience.kind === "list" ? order.audience.listId : (lists[0]?.id ?? ""),
  );
  const [postageClass, setPostageClass] = useState(order.postageClass);
  const [chosen, setChosen] = useState<string[]>(order.designs.map((d) => d.savedDesignId));
  const [messages, setMessages] = useState<PoolMessage[]>(
    order.messages.length > 0
      ? order.messages.map((m) => ({ text: m.text, source: m.source }))
      : [{ text: "", source: "written" }],
  );
  const [brief, setBrief] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [drafts, setDrafts] = useState<string[] | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(order.consent?.current ?? false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** How many already-approved cards the last save handed over. See ADR 0272. */
  const [adopted, setAdopted] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [walletSummary, setWalletSummary] = useState(wallet);
  const [readiness, setReadiness] = useState(initialReadiness);
  const [countingAudience, setCountingAudience] = useState(false);
  const [creatingFrom, setCreatingFrom] = useState<string | null>(null);

  /**
   * What the chosen audience actually covers, kept in step with the choice.
   *
   * The number has to follow the radio buttons: somebody switching from
   * everybody to one list and still reading "26 contacts" has been told
   * something false about what they are about to switch on.
   */
  const audienceListId = audienceKind === "list" ? listId : null;
  const loadReadiness = useCallback(async (forList: string | null) => {
    setCountingAudience(true);
    try {
      setReadiness(
        await clientApiFetch<ContactReadiness>(
          forList ? `/recipients/readiness?listId=${forList}` : "/recipients/readiness",
        ),
      );
    } catch {
      // A count we could not fetch says nothing rather than something wrong.
      setReadiness(null);
    } finally {
      setCountingAudience(false);
    }
  }, []);

  const firstRender = useRef(true);
  useEffect(() => {
    // The server already counted the saved audience, so the arrival render is
    // not a reason to ask again.
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void loadReadiness(audienceListId);
  }, [audienceListId, loadReadiness]);

  const chosenDesigns = useMemo(
    () =>
      chosen
        .map((id) => library.find((design) => design.id === id))
        .filter((design): design is DesignOption => design !== undefined),
    [chosen, library],
  );

  /**
   * Chosen cards the catalog files under some other occasion.
   *
   * This instruction sends birthdays and only birthdays, and the pool accepts
   * any saved design — so without this a good-luck card goes out for somebody's
   * birthday, every year, in silence. Named rather than counted, because only
   * the subscriber can decide what to do about each one, and warned rather than
   * blocked, because there may be a reason. A design the catalog says nothing
   * about is left alone: `catalogSaysBirthday` returns null there, and null is
   * not "no".
   */
  const wrongOccasion = useMemo(
    () => chosenDesigns.filter((design) => catalogSaysBirthday(design.category) === false),
    [chosenDesigns],
  );

  /**
   * Chosen cards a message cannot be printed on, decided by running the real
   * placement rather than a second copy of its rule (ADR 0260).
   */
  const cannotTakeMessage = useMemo(
    () => chosenDesigns.filter((design) => !designTakesMessage(design.document)),
    [chosenDesigns],
  );

  /** A chosen design that has since been archived out of the library. The saved
   *  order still knows its name; the library no longer holds it. */
  const archived = order.designs.filter((design) => design.archived);

  const written = messages
    .map((message) => ({ ...message, text: message.text.trim() }))
    .filter((message) => message.text.length > 0);
  const pointedAtSmartList = order.audience.kind === "segment";

  /** Whether anything on screen differs from what is saved — so the save bar can
   *  say so rather than sitting there looking the same either way. */
  const dirty =
    enabled !== order.enabled ||
    postageClass !== order.postageClass ||
    agreed !== (order.consent?.current ?? false) ||
    audienceKind !==
      (order.audience.kind === "segment" || order.audienceGone ? null : order.audience.kind) ||
    (audienceKind === "list" &&
      listId !== (order.audience.kind === "list" ? order.audience.listId : "")) ||
    chosen.join("|") !== order.designs.map((d) => d.savedDesignId).join("|") ||
    written.map((m) => m.text).join("|") !== order.messages.map((m) => m.text).join("|");

  function toggleDesign(id: string) {
    setChosen((current) =>
      current.includes(id)
        ? current.filter((value) => value !== id)
        : current.length >= STANDING_ORDER_MAX_DESIGNS
          ? current
          : [...current, id],
    );
  }

  function setMessage(index: number, text: string) {
    setMessages((current) =>
      current.map((message, at) => (at === index ? { ...message, text } : message)),
    );
  }

  /**
   * Ask for suggestions.
   *
   * Nothing here is saved, and nothing replaces what is already written: the
   * drafts land in a list beside the pool and the subscriber decides one at a
   * time. A message they keep is recorded as `assisted`, which is not the same
   * promise as their own words (ADR 0263).
   */
  async function suggest() {
    setDraftError(null);
    setDrafting(true);
    try {
      const result = await clientApiFetch<MessageDrafts>("/standing-order/message-drafts", {
        method: "POST",
        body: JSON.stringify(brief.trim() ? { brief: brief.trim() } : {}),
      });
      const already = new Set(messages.map((message) => message.text.trim().toLowerCase()));
      setDrafts(result.drafts.filter((draft) => !already.has(draft.trim().toLowerCase())));
    } catch (error) {
      setDraftError(
        error instanceof ApiError ? error.message : "Could not write any suggestions just now",
      );
    } finally {
      setDrafting(false);
    }
  }

  function keepDraft(draft: string) {
    setMessages((current) => {
      const room = current.length < STANDING_ORDER_MAX_MESSAGES;
      if (!room) return current;
      // An empty first box is where somebody was about to type. Use it rather
      // than leaving a blank line above the message they just accepted.
      const blank = current.findIndex((message) => message.text.trim().length === 0);
      const kept: PoolMessage = { text: draft, source: "assisted" };
      return blank === -1
        ? [...current, kept]
        : current.map((message, at) => (at === blank ? kept : message));
    });
    setDrafts((current) => current?.filter((entry) => entry !== draft) ?? null);
  }

  /**
   * Make a design from a catalog template and put it straight in the pool.
   *
   * It lands chosen, because somebody who just picked a card out of the catalog
   * has already decided. The editor is one click away if they want to change the
   * words; this page no longer makes them go there and come back.
   */
  async function addFromTemplate(template: CardDesign) {
    setError(null);
    setCreatingFrom(template.id);
    try {
      const created = await clientApiFetch<SavedDesign>("/saved-designs", {
        method: "POST",
        body: JSON.stringify({ cardDesignId: template.id, name: template.name }),
      });
      setLibrary((current) => [
        {
          id: created.id,
          name: created.name,
          document: created.document,
          category: template.category,
        },
        ...current,
      ]);
      setChosen((current) =>
        current.length >= STANDING_ORDER_MAX_DESIGNS ? current : [...current, created.id],
      );
      setPickerOpen(false);
    } catch (createError) {
      setError(
        createError instanceof ApiError ? createError.message : "Could not add that card design",
      );
    } finally {
      setCreatingFrom(null);
    }
  }

  async function save() {
    setError(null);
    setSaved(false);

    if (unavailable) {
      setError("We could not load your settings, so there is nothing safe to save over. Refresh.");
      return;
    }

    if (enabled && chosen.length === 0) {
      setError("Choose at least one card design before switching this on");
      return;
    }
    if (enabled && written.length === 0) {
      setError("Write at least one message before switching this on");
      return;
    }
    if (audienceKind === null) {
      setError(
        order.audienceGone
          ? "The list this was sending to has been deleted — choose who gets a card before saving"
          : "Choose who gets a card before saving — a smart list is not something we send from",
      );
      return;
    }
    if (audienceKind === "list" && !listId) {
      setError("Choose a contact list, or send to everybody");
      return;
    }

    setSaving(true);
    try {
      const next = await clientApiFetch<StandingOrder>("/standing-order", {
        method: "PUT",
        body: JSON.stringify({
          enabled,
          audience: audienceKind === "list" ? { kind: "list", listId } : { kind: "all" },
          postageClass,
          savedDesignIds: chosen,
          messages: written.map((message) => ({ text: message.text, source: message.source })),
          agreeToConsent: agreed,
        }),
      });
      setOrder(next);
      // Transient: the API returns it only on the save that adopted, and a
      // later read never carries it. Kept so the confirmation can name the
      // number rather than leaving somebody to discover it on another screen.
      setAdopted(next.adopted ?? 0);
      setMessages(
        next.messages.length > 0
          ? next.messages.map((m) => ({ text: m.text, source: m.source }))
          : [{ text: "", source: "written" }],
      );
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof ApiError ? saveError.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 pb-28">
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight">Click & forget</h1>
          <p className="text-muted">
            Choose your contacts, your cards and your messages once. We send a card for every
            birthday after that, paid from your wallet, without asking you each time.
          </p>
        </div>
        <StatusStrip order={order} />
      </header>

      {!order.planAllows && (
        <div className="notice notice-info flex flex-wrap items-center justify-between gap-3">
          <span>
            Click & forget is on Pro and above. Set it up here and it will start as soon as you
            upgrade.
          </span>
          <Link href="/billing" className="btn-accent shrink-0">
            See plans
          </Link>
        </div>
      )}

      {order.enabled && order.blockers.length > 0 && (
        <div className="notice notice-warning flex flex-col gap-1">
          <strong>This is switched on, but not running.</strong>
          <ul className="list-disc pl-5">
            {order.blockers.map((blocker) => (
              <li key={blocker}>{BLOCKER_TEXT[blocker] ?? UNKNOWN_BLOCKER}</li>
            ))}
          </ul>
        </div>
      )}

      {unavailable && (
        <p className="notice notice-danger">
          <strong>We could not load your settings.</strong> Nothing here is your saved instruction,
          and saving is switched off so it cannot be written over. Refresh the page to try again.
        </p>
      )}

      {error && <p className="notice notice-danger">{error}</p>}

      <Step n={1} title="Who gets a card">
        {pointedAtSmartList && (
          <p className="notice notice-warning">
            This is currently pointed at a smart list. Smart lists change on their own, so we do not
            send from them — choose one of the options below and save.
          </p>
        )}
        {order.audienceGone && (
          <p className="notice notice-warning">
            The list this was sending to has been deleted. We have not moved it to everybody on your
            behalf — choose who gets a card below and save.
          </p>
        )}
        <div className="flex flex-col gap-3">
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="audience"
              checked={audienceKind === "all"}
              onChange={() => setAudienceKind("all")}
              className="mt-1 size-4 accent-accent"
            />
            <span>
              <span className="font-medium">Everybody</span>
              <br />
              <span className="text-muted">Every contact with a birthday on record.</span>
            </span>
          </label>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="radio"
              name="audience"
              checked={audienceKind === "list"}
              onChange={() => setAudienceKind("list")}
              disabled={lists.length === 0}
              className="mt-1 size-4 accent-accent"
            />
            <span>
              <span className="font-medium">One of my lists</span>
              <br />
              <span className="text-muted">
                {lists.length === 0
                  ? "You have no lists yet — make one on the Lists page."
                  : "A list you pick by hand, so you always know who is on it."}
              </span>
            </span>
          </label>
          {audienceKind === "list" && lists.length > 0 && (
            <select
              value={listId}
              onChange={(e) => setListId(e.target.value)}
              aria-label="Contact list"
              className="max-w-sm rounded-md border border-border bg-surface px-3 py-2 text-sm"
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name} ({list.memberCount})
                </option>
              ))}
            </select>
          )}
          <Coverage readiness={readiness} counting={countingAudience} />
        </div>
      </Step>

      <Step n={2} title="What we send">
        <div className="flex flex-col gap-8">
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="font-semibold">Cards we can send</h3>
                <p className="text-sm text-muted">
                  {chosen.length === 0
                    ? `Pick as many as you like, up to ${STANDING_ORDER_MAX_DESIGNS}.`
                    : `${chosen.length} of ${STANDING_ORDER_MAX_DESIGNS} chosen.`}{" "}
                  We choose one for each person, and nobody gets the same card two years running.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={templates.length === 0 || chosen.length >= STANDING_ORDER_MAX_DESIGNS}
                className="btn-secondary shrink-0"
              >
                Add a card
              </button>
            </div>

            {archived.length > 0 && (
              <p className="notice notice-warning">
                <strong>
                  {archived.length === 1
                    ? "One of your cards has been removed from your designs."
                    : `${archived.length} of your cards have been removed from your designs.`}
                </strong>{" "}
                {archived.map((design) => design.name).join(", ")} — untick{" "}
                {archived.length === 1 ? "it" : "them"} and save, or nothing will send.
              </p>
            )}

            {wrongOccasion.length > 0 && (
              <p className="notice notice-warning">
                <strong>
                  {wrongOccasion.length === 1
                    ? "One of your cards is not a birthday card."
                    : `${wrongOccasion.length} of your cards are not birthday cards.`}
                </strong>{" "}
                {wrongOccasion
                  .map((design) => `${design.name} (${cardCategoryLabel(design.category ?? "")})`)
                  .join(", ")}{" "}
                — this only ever sends birthdays, so{" "}
                {wrongOccasion.length === 1 ? "it will be posted" : "they will be posted"} for
                somebody’s birthday.
              </p>
            )}

            {library.length === 0 ? (
              <p className="text-sm text-muted">
                You have no saved designs yet — add one from the catalog above, or{" "}
                <Link href="/designs" className="font-medium text-accent hover:underline">
                  make your own
                </Link>
                .
              </p>
            ) : (
              <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {library.map((design) => {
                  const picked = chosen.includes(design.id);
                  const full = !picked && chosen.length >= STANDING_ORDER_MAX_DESIGNS;
                  return (
                    <li key={design.id}>
                      <button
                        type="button"
                        onClick={() => toggleDesign(design.id)}
                        aria-pressed={picked}
                        disabled={full}
                        className={`flex w-full flex-col gap-2 rounded-xl border-2 p-2 text-left transition-colors disabled:opacity-40 ${
                          picked
                            ? "border-accent bg-accent-soft"
                            : "border-border bg-surface hover:border-foreground/20"
                        }`}
                      >
                        <SavedDesignThumb document={design.document} />
                        <span className="flex items-start gap-1.5">
                          <span
                            aria-hidden
                            className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${
                              picked ? "bg-accent" : "bg-foreground/15"
                            }`}
                          >
                            {picked ? "✓" : ""}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-xs font-medium">
                            {design.name}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h3 className="font-semibold">What the cards say</h3>
              <p className="text-sm text-muted">
                Up to {STANDING_ORDER_MAX_MESSAGES} messages, and we vary them. Anywhere you put a
                merge field, we fill in that person’s own details.
              </p>
            </div>

            {cannotTakeMessage.length > 0 && (
              <p className="notice notice-warning">
                <strong>
                  {cannotTakeMessage.length === 1
                    ? "One of your cards will not use these."
                    : `${cannotTakeMessage.length} of your cards will not use these.`}
                </strong>{" "}
                {cannotTakeMessage.map((design) => design.name).join(", ")} already{" "}
                {cannotTakeMessage.length === 1 ? "has" : "have"} more than one block of text
                inside, so we cannot tell which one is the message. Those cards go out with the
                words already on them.
              </p>
            )}

            <div className="flex flex-col gap-3">
              {messages.map((message, index) => (
                <MessageField
                  key={index}
                  index={index}
                  value={message.text}
                  onChange={(next) => setMessage(index, next)}
                  onRemove={
                    messages.length > 1
                      ? () => setMessages((current) => current.filter((_, at) => at !== index))
                      : null
                  }
                />
              ))}
            </div>

            {messages.length < STANDING_ORDER_MAX_MESSAGES && (
              <button
                type="button"
                onClick={() =>
                  setMessages((current) => [...current, { text: "", source: "written" }])
                }
                className="btn-secondary self-start"
              >
                Add another message
              </button>
            )}

            {order.messageDraftingAvailable && (
              <SuggestMessages
                brief={brief}
                onBrief={setBrief}
                busy={drafting}
                drafts={drafts}
                error={draftError}
                full={messages.length >= STANDING_ORDER_MAX_MESSAGES}
                onSuggest={() => void suggest()}
                onKeep={keepDraft}
                onDismiss={(draft) =>
                  setDrafts((current) => current?.filter((entry) => entry !== draft) ?? null)
                }
              />
            )}
          </section>
        </div>
      </Step>

      <Step n={3} title="How it is paid for, and switching it on">
        <div className="flex flex-col gap-8">
          <Money summary={walletSummary} projection={projection} onSaved={setWalletSummary} />

          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">Postage</h3>
            <div className="flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="postage"
                  checked={postageClass === "second_class"}
                  onChange={() => setPostageClass("second_class")}
                  className="size-4 accent-accent"
                />
                Second class
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="postage"
                  checked={postageClass === "first_class"}
                  onChange={() => setPostageClass("first_class")}
                  className="size-4 accent-accent"
                />
                First class
              </label>
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">What you are agreeing to</h3>
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted">
              {order.consentStatement.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={agreed}
                onChange={(e) => setAgreed(e.target.checked)}
                className="mt-1 size-4 accent-accent"
              />
              <span className="font-medium">I have read this and I agree.</span>
            </label>
            {order.consent && !order.consent.current && (
              <p className="text-sm text-muted">
                You agreed to an earlier version of this. We have changed how it works, so please
                read it again and tick the box.
              </p>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h3 className="font-semibold">Send these cards for me</h3>
            <label className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                disabled={!order.planAllows || !agreed}
                className="mt-1 size-4 accent-accent"
              />
              <span>
                <span className="font-medium">Yes, send them without asking me</span>
                <br />
                <span className="text-muted">
                  {!order.planAllows
                    ? "Available on Pro and above."
                    : !agreed
                      ? "Tick the box above first."
                      : "We will send a card for every birthday, paid from your wallet."}
                </span>
              </span>
            </label>
          </section>
        </div>
      </Step>

      <SaveBar
        disabled={unavailable}
        dirty={dirty}
        saving={saving}
        saved={saved && !error}
        activeAfterSave={order.active}
        adopted={adopted}
        onSave={() => void save()}
      />

      <TemplatePickerModal
        templates={templates}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(template) => void addFromTemplate(template)}
        busyTemplateId={creatingFrom}
        title="Add a birthday card"
        description="Pick a card to add to the ones we can send. You can change the words on it afterwards."
      />

      {chosenDesigns.length > 0 && (
        <p className="text-sm text-muted">
          Want to change the words on one of these?{" "}
          <button
            type="button"
            onClick={() => router.push("/designs")}
            className="font-medium text-accent hover:underline"
          >
            Open your designs
          </button>
          .
        </p>
      )}
    </div>
  );
}

/**
 * A dispatch date as "14 October", from whatever the caller actually has.
 *
 * `Date | string` on purpose, and not because the type is wrong: `apiFetch`
 * casts its response rather than parsing it, so every date in a payload is a
 * string at runtime however it is declared. The page parses the projection at
 * the boundary now, and this is the belt to that braces — the version without
 * it threw inside the render, and only for the subscribers whose balance was
 * short.
 */
function dispatchDay(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-GB", { day: "numeric", month: "long" });
}

/** £12.34, and £12 when the pennies are zero — the wallet page's own shape. */
function pounds(minor: number): string {
  return `£${(minor / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * What this instruction actually covers, in contacts.
 *
 * Three numbers rather than one, because the gap between them is the useful
 * part: a hundred contacts of whom sixty have a birthday on file and fifty have
 * somewhere to post to is a very different thing from a hundred cards a year,
 * and the difference is what somebody would otherwise discover one skip notice
 * at a time.
 *
 * The same definition of "postable" the contacts page and the dashboard use —
 * `readinessForAudience` shares it rather than counting again (ADR 0264).
 */
function Coverage({
  readiness,
  counting,
}: {
  readiness: ContactReadiness | null;
  counting: boolean;
}) {
  if (counting) {
    return <p className="text-sm text-muted">Counting…</p>;
  }
  if (!readiness) {
    // Better to say nothing than to say a number we could not fetch.
    return null;
  }
  if (readiness.total === 0) {
    return (
      <p className="notice notice-info text-sm">
        There are no contacts here yet.{" "}
        <Link href="/recipients" className="font-medium text-accent hover:underline">
          Add some
        </Link>{" "}
        and this will start covering them.
      </p>
    );
  }

  const noBirthday = readiness.total - readiness.withDateOfBirth;
  const noAddress = readiness.withDateOfBirth - readiness.sendable;

  return (
    <div className="flex flex-col gap-1 rounded-lg bg-foreground/[0.03] p-3 text-sm">
      <p>
        <strong>
          {readiness.sendable} of {readiness.total}
        </strong>{" "}
        {readiness.total === 1 ? "contact" : "contacts"} will get a card.
      </p>
      {(noBirthday > 0 || noAddress > 0) && (
        <p className="text-muted">
          {noBirthday > 0 && (
            <>
              {noBirthday} {noBirthday === 1 ? "has" : "have"} no birthday on file
              {noAddress > 0 ? ", and " : "."}
            </>
          )}
          {noAddress > 0 && (
            <>
              {noAddress} {noAddress === 1 ? "has" : "have"} no postal address
              {noBirthday > 0 ? "." : "."}
            </>
          )}{" "}
          <Link href="/recipients" className="font-medium text-accent hover:underline">
            Fill those in
          </Link>
          .
        </p>
      )}
    </div>
  );
}

/**
 * The balance, how far it reaches, and the way to keep it topped up.
 *
 * Here rather than behind a link to the wallet, because the sentence that
 * creates the worry is three inches below this one: "if your balance will not
 * cover a card, we tell you rather than send it". A link is a second page and a
 * lost thought.
 *
 * The projection is the 9am watch's own (ADR 0255) — "covers the next 6 of 9"
 * rather than a threshold, because a threshold answers a question nobody asked.
 */
function Money({
  summary,
  projection,
  onSaved,
}: {
  summary: WalletSummary | null;
  projection: WalletProjection | null;
  onSaved: (next: WalletSummary) => void;
}) {
  if (!summary) return null;

  const shortfall = projection?.firstShortfall ?? null;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="font-semibold">Paying for the cards</h3>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
        <span>
          Your wallet holds <strong>{pounds(summary.balanceMinor)}</strong>.
        </span>
        {projection && projection.cardsTotal > 0 && (
          <span className={shortfall ? "text-warning" : "text-muted"}>
            {shortfall
              ? `That covers the next ${projection.cardsCovered} of ${projection.cardsTotal} cards — ${shortfall.recipientName}'s, on ${dispatchDay(shortfall.dispatchDate)}, is the first it will not reach.`
              : `That covers all ${projection.cardsTotal} ${projection.cardsTotal === 1 ? "card" : "cards"} already approved for the next month.`}
          </span>
        )}
        {projection && projection.cardsTotal === 0 && (
          <span className="text-muted">Nothing is approved to go out yet.</span>
        )}
        <Link href="/wallet" className="font-medium text-accent hover:underline">
          Top up
        </Link>
      </div>
      <AutoTopUpCard
        settings={summary.autoTopUp}
        onSaved={onSaved}
        saveLabel="Save top-up settings"
      />
    </section>
  );
}

/**
 * Suggestions from a model, and the decision to keep one.
 *
 * Three things this does not do, each on purpose. It does not write into the
 * pool — a draft sits beside it until somebody picks it, because a card goes
 * out in their name and not ours. It does not replace anything they have
 * already written. And it does not save: the pool is still saved by the same
 * button as everything else on this page.
 *
 * The brief is the only free text that leaves the platform. Nothing about a
 * contact is sent — a drafted message is a template with {firstName} in it,
 * filled in at print weeks later. See ADR 0263.
 */
function SuggestMessages({
  brief,
  onBrief,
  busy,
  drafts,
  error,
  full,
  onSuggest,
  onKeep,
  onDismiss,
}: {
  brief: string;
  onBrief: (next: string) => void;
  busy: boolean;
  drafts: string[] | null;
  error: string | null;
  full: boolean;
  onSuggest: () => void;
  onKeep: (draft: string) => void;
  onDismiss: (draft: string) => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border p-4">
      <div className="flex flex-col gap-1">
        <h4 className="text-sm font-semibold">Stuck for words?</h4>
        <p className="text-xs text-muted">
          We can suggest a few. Nothing is sent about your contacts, and nothing is added until you
          pick it.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={brief}
          onChange={(e) => onBrief(e.target.value)}
          maxLength={MESSAGE_DRAFT_BRIEF_MAX_LENGTH}
          aria-label="What should they sound like?"
          placeholder="Warm, a bit funny — we are a tuition centre"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={onSuggest}
          disabled={busy || full}
          className="btn-secondary shrink-0"
        >
          {busy ? "Writing…" : "Suggest messages"}
        </button>
      </div>
      {full && (
        <p className="text-xs text-muted">
          Your pool is full at {STANDING_ORDER_MAX_MESSAGES} — remove one to make room.
        </p>
      )}
      {error && <p className="notice notice-danger text-sm">{error}</p>}
      {drafts !== null && drafts.length === 0 && !busy && (
        <p className="text-xs text-muted">Nothing new that time — try again, or change the note.</p>
      )}
      {drafts !== null && drafts.length > 0 && (
        <ul className="flex flex-col gap-2">
          {drafts.map((draft) => (
            <li
              key={draft}
              className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-foreground/[0.03] p-3"
            >
              <span className="min-w-0 flex-1 text-sm">{draft}</span>
              <span className="flex shrink-0 gap-2">
                <button
                  type="button"
                  onClick={() => onKeep(draft)}
                  disabled={full}
                  className="rounded-full border border-accent px-3 py-1 text-xs font-medium text-accent disabled:opacity-40"
                >
                  Keep
                </button>
                <button
                  type="button"
                  onClick={() => onDismiss(draft)}
                  aria-label={`Discard: ${draft}`}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted"
                >
                  No
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A numbered step. The same shell the get-started page uses, because they are
 *  the same idea: a thing with an order, where you are somewhere in it. */
function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-3">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-bold text-white">
          {n}
        </span>
        <h2 className="text-lg font-semibold">{title}</h2>
      </div>
      <div className="sm:pl-11">{children}</div>
    </section>
  );
}

/**
 * One message, with the merge fields the design editor offers.
 *
 * The same `MERGE_FIELDS` list, so the two places a subscriber writes text for
 * a card cannot offer different tokens — and the caret is put back after an
 * insert, because a select that dumps text at the end and steals the focus is
 * worse than typing the braces by hand.
 */
function MessageField({
  index,
  value,
  onChange,
  onRemove,
}: {
  index: number;
  value: string;
  onChange: (next: string) => void;
  onRemove: (() => void) | null;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  function insert(token: string) {
    const textarea = ref.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + token + value.slice(end);
    if (next.length > STANDING_ORDER_MESSAGE_MAX_LENGTH) return;
    onChange(next);
    // After the controlled value re-renders, put the caret just past what was
    // inserted so typing carries on where the eye already is.
    requestAnimationFrame(() => {
      const caret = start + token.length;
      textarea?.focus();
      textarea?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3">
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        maxLength={STANDING_ORDER_MESSAGE_MAX_LENGTH}
        rows={2}
        aria-label={`Message ${index + 1}`}
        placeholder="Happy birthday {firstName} — hope it is a good one."
        className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm"
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => insert("{firstName}")}
          className="rounded-full border border-border px-3 py-1 text-xs font-medium hover:bg-foreground/[0.03]"
        >
          + First name
        </button>
        <select
          aria-label={`Insert a merge field into message ${index + 1}`}
          value=""
          onChange={(e) => {
            if (e.target.value) insert(e.target.value);
          }}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs"
        >
          <option value="">More fields…</option>
          {MERGE_FIELDS.filter((field) => field.token !== "{firstName}").map((field) => (
            <option key={field.token} value={field.token}>
              {field.label}
            </option>
          ))}
        </select>
        <span className="text-xs text-muted">
          {value.length}/{STANDING_ORDER_MESSAGE_MAX_LENGTH}
        </span>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove message ${index + 1}`}
            className="ml-auto text-xs font-medium text-muted hover:text-danger"
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}

/** Save, where the thumb already is on a phone and in sight on a long page. */
function SaveBar({
  dirty,
  saving,
  saved,
  activeAfterSave,
  adopted,
  disabled,
  onSave,
}: {
  dirty: boolean;
  saving: boolean;
  saved: boolean;
  activeAfterSave: boolean;
  /** Cards already approved that this save handed to the instruction. */
  adopted: number;
  /** The instruction could not be read, so there is nothing safe to save over. */
  disabled: boolean;
  onSave: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 backdrop-blur md:left-64">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-3">
        <span className="text-sm text-muted">
          {disabled
            ? "Saving is off until your settings load."
            : dirty
              ? "You have unsaved changes."
              : saved
                ? activeAfterSave
                  ? adopted > 0
                    ? // Said out loud because it is a change to cards they had
                      // already dealt with, and the alternative is discovering
                      // it on another screen.
                      `Saved. We will take it from here, including ${adopted} card${adopted === 1 ? "" : "s"} you had already approved.`
                    : "Saved. We will take it from here."
                  : "Saved."
                : "Everything here is saved."}
        </span>
        <button type="button" onClick={onSave} disabled={saving || disabled} className="btn-accent">
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}

/** Running, off, or on-but-stopped — said in one line at the top. */
function StatusStrip({ order }: { order: StandingOrder }) {
  if (order.active) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-success-soft px-4 py-3 text-sm font-medium text-success">
        <span aria-hidden className="size-2 rounded-full bg-success" />
        Running. We are sending these cards for you.
      </p>
    );
  }
  if (order.enabled) {
    return (
      <p className="flex items-center gap-2 rounded-lg bg-warning-soft px-4 py-3 text-sm font-medium text-warning">
        <span aria-hidden className="size-2 rounded-full bg-warning" />
        Switched on, but not running yet.
      </p>
    );
  }
  return (
    <p className="flex items-center gap-2 rounded-lg bg-foreground/[0.04] px-4 py-3 text-sm text-muted">
      <span aria-hidden className="size-2 rounded-full bg-muted" />
      Not switched on. Nothing is sent until you turn it on below.
    </p>
  );
}

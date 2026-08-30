import { BadRequestException } from "@nestjs/common";
import { sendNowDispatchDate } from "@kudos/shared-types";
import { resolveSendSchedule } from "./send-schedule.util";

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * The same-day cut-off (15:00 UK) decides whether a card ordered now catches
 * today's Royal Mail collection or tomorrow's. It is a question about the time
 * of day — so asking it of a value that has had its time truncated away can only
 * ever get one answer. See ADR 0184.
 *
 * All dates below are September 2026: the 15th is a Tuesday, the 19th a
 * Saturday. London is on BST, so 15:00 UTC is 16:00 local — after the cut-off.
 */
describe("resolveSendSchedule", () => {
  const BEFORE_CUTOFF = new Date("2026-09-15T08:00:00Z"); // Tue 09:00 London
  const AFTER_CUTOFF = new Date("2026-09-15T15:00:00Z"); // Tue 16:00 London
  const LATE_EVENING = new Date("2026-09-15T21:00:00Z"); // Tue 22:00 London

  describe("send now", () => {
    it("posts today before the cut-off", () => {
      const { dispatchDate, scheduled } = resolveSendSchedule(
        undefined,
        "first_class",
        BEFORE_CUTOFF,
      );
      expect(isoDay(dispatchDate)).toBe("2026-09-15");
      expect(scheduled).toBe(false);
    });

    it("posts the next working day after the cut-off", () => {
      const { dispatchDate } = resolveSendSchedule(undefined, "first_class", AFTER_CUTOFF);
      expect(isoDay(dispatchDate)).toBe("2026-09-16");
    });
  });

  describe("a scheduled arrive-by date", () => {
    /** The soonest arrive-by the caller should be able to book, per the shared
     * engine — the same value the web date picker offers. */
    function soonestBookable(now: Date): string {
      // 5 working days forward from the day a card ordered *now* actually posts.
      const posts = sendNowDispatchDate(now);
      let d = new Date(posts);
      let left = 5;
      while (left > 0) {
        d = new Date(d.getTime() + 86_400_000);
        const day = d.getUTCDay();
        if (day !== 0 && day !== 6) left -= 1;
      }
      return isoDay(d);
    }

    it("accepts the soonest date the picker offers, before the cut-off", () => {
      const target = soonestBookable(BEFORE_CUTOFF);
      expect(target).toBe("2026-09-22");
      const { dispatchDate, scheduled } = resolveSendSchedule(target, "first_class", BEFORE_CUTOFF);
      expect(scheduled).toBe(true);
      // Posts today, which is still achievable — we are before the cut-off.
      expect(isoDay(dispatchDate)).toBe("2026-09-15");
    });

    /**
     * The defect. At 16:00 the day's collection has gone, so nothing can post
     * today — yet an arrive-by of 22 Sep computes a post-by date of 15 Sep and
     * was accepted, landing in the ops queue as due today for a collection that
     * had already left. The web picker, which passes the real clock, offered
     * 23 Sep: the two disagreed by a working day.
     */
    it("refuses a date whose post-by day has already gone, after the cut-off", () => {
      expect(() => resolveSendSchedule("2026-09-22", "first_class", AFTER_CUTOFF)).toThrow(
        BadRequestException,
      );
    });

    it("names the soonest date it will actually accept, after the cut-off", () => {
      // The refusal has to agree with the picker, or the sender is bounced onto
      // a date that gets refused in turn.
      expect(soonestBookable(AFTER_CUTOFF)).toBe("2026-09-23");
      try {
        resolveSendSchedule("2026-09-22", "first_class", AFTER_CUTOFF);
        throw new Error("expected a rejection");
      } catch (error) {
        expect((error as BadRequestException).message).toContain("2026-09-23");
      }
    });

    it("accepts the next day along, which posts tomorrow", () => {
      const { dispatchDate, scheduled } = resolveSendSchedule(
        "2026-09-23",
        "first_class",
        AFTER_CUTOFF,
      );
      expect(scheduled).toBe(true);
      expect(isoDay(dispatchDate)).toBe("2026-09-16");
    });

    it("holds late in the evening too, not just at the cut-off hour", () => {
      expect(() => resolveSendSchedule("2026-09-22", "first_class", LATE_EVENING)).toThrow(
        BadRequestException,
      );
    });

    it("still rejects a date beyond the scheduling horizon", () => {
      expect(() => resolveSendSchedule("2030-01-01", "first_class", BEFORE_CUTOFF)).toThrow(
        /too far ahead/,
      );
    });

    it("still rejects an unparseable date", () => {
      expect(() => resolveSendSchedule("not-a-date", "first_class", BEFORE_CUTOFF)).toThrow(
        /Invalid delivery date/,
      );
    });
  });
});

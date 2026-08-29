/**
 * The clock every scheduled job runs on.
 *
 * Kudos is a UK business: cards are printed and posted from a UK site, the
 * send-by SLA is counted in UK working days, and every "run at 6am" in this
 * codebase means six in the morning to the person whose birthdays it is
 * preparing. The container runs UTC, so without pinning, half the year those
 * jobs drift an hour and the drift arrives unannounced on the last Sunday in
 * March and again in October.
 *
 * Two jobs pinned this and ten did not, which is the worst of both: someone had
 * already decided the clock mattered, and the decision only reached a sixth of
 * the schedule. It is declared once here and every dated job refers to it, so
 * there is nothing to remember and nothing to keep in sync.
 *
 * Interval jobs — "every five minutes", "every hour at :35" — are deliberately
 * exempt: an interval is the same length in every timezone, so pinning one
 * would imply a decision that isn't being made. `cron-timezone.spec.ts` holds
 * that line for both cases.
 */
export const PLATFORM_TIME_ZONE = "Europe/London";

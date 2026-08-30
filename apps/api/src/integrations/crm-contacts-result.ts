/**
 * What a CRM contacts fetch hands back.
 *
 * Every provider client caps its paging loop so one enormous account can't hold
 * a nightly sync open forever. That cap is fine; stopping at it *quietly* is
 * not. A portal with more contacts than the cap allows used to import the first
 * slice and record `lastSyncStatus: "ok"`, so nobody ever learned that the rest
 * of their address book never arrived. `truncated` is how the client says "there
 * was more" — the service turns it into a partial status the customer can see.
 */
export interface CrmContactsResult<TContact> {
  contacts: TContact[];
  /** True when the paging loop stopped at its safety cap with more to read. */
  truncated: boolean;
}

"use client";

import { createContext, useContext } from "react";
import type { PlatformAdminRole } from "@kudos/shared-types";

/**
 * The signed-in operator's role, for the ops UI.
 *
 * The shell already fetches `/admin/me` to decide whether this person is an
 * operator at all, so the role is in hand before any page renders — no panel
 * needs to ask again. See ADR 0040: super admin manages the operator team and
 * platform settings; `ops` is the schema default and the role every invited
 * operator starts on.
 *
 * This gates what is *shown*, never what is *allowed*. The server's
 * `SuperAdminGuard` is the authority and is pinned by
 * `admin-mutations-guarded.spec.ts`; nothing here can grant anything, and a
 * hand-crafted request is refused exactly as before.
 */
const OpsRoleContext = createContext<PlatformAdminRole | null>(null);

export function OpsRoleProvider({
  role,
  children,
}: {
  role: PlatformAdminRole;
  children: React.ReactNode;
}) {
  return <OpsRoleContext.Provider value={role}>{children}</OpsRoleContext.Provider>;
}

/**
 * Whether this operator is a super admin.
 *
 * Fails closed. A component rendered outside the provider gets `false` rather
 * than throwing or defaulting to true: a permission gate that unlocks itself
 * when its context goes missing is worse than one that is occasionally too
 * strict, and "too strict" here costs an operator one 403-free click they
 * couldn't have made anyway.
 */
export function useIsSuperAdmin(): boolean {
  return useContext(OpsRoleContext) === "super_admin";
}

/**
 * A control an `ops` operator has no business seeing at all — a button whose
 * whole purpose is the action it performs, so there is nothing left to read
 * once it is inert.
 */
export function SuperAdminOnly({ children }: { children: React.ReactNode }) {
  return useIsSuperAdmin() ? <>{children}</> : null;
}

/**
 * A settings panel an `ops` operator may read but not change.
 *
 * Seeing the configuration is an operator's job — the API's read routes are
 * deliberately unrestricted for exactly that reason — so the panel stays and
 * only its controls go inert. `fieldset[disabled]` does that natively for every
 * input, select and button inside it, by the DOM rather than by each panel
 * remembering to thread a flag through its own markup. `display: contents`
 * keeps the fieldset out of the panel's flex layout; it has no bearing on the
 * disabling, which is a DOM relationship rather than a visual one.
 */
export function SuperAdminEditable({ children }: { children: React.ReactNode }) {
  const isSuper = useIsSuperAdmin();
  return (
    <>
      {!isSuper && (
        <p className="text-xs text-muted">
          Super admins only — you can see this setting, but not change it.
        </p>
      )}
      <fieldset disabled={!isSuper} className="contents">
        {children}
      </fieldset>
    </>
  );
}

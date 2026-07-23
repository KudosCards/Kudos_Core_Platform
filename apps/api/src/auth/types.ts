import type { MembershipRole } from "@prisma/client";

/** Populated by JwtAuthGuard from a verified Supabase-issued JWT. */
export interface AuthenticatedUser {
  id: string;
  email: string | null;
}

/** Populated by MembershipGuard once the user's account/role is resolved. */
export interface CurrentMembershipContext {
  accountId: string;
  role: MembershipRole;
  /** The acting Supabase Auth user id — needed for per-user state (e.g. the
   * notification inbox's read/unread, which is scoped to the individual). */
  userId: string;
}

/** Populated by PlatformAdminGuard for internal ops (print/post) staff. */
export interface PlatformAdminContext {
  userId: string;
}

/** Populated by ApiKeyGuard for the inbound integrations endpoint. */
export interface ApiKeyContext {
  accountId: string;
  keyId: string;
}

declare module "express" {
  interface Request {
    authUser?: AuthenticatedUser;
    membership?: CurrentMembershipContext;
    platformAdmin?: PlatformAdminContext;
    apiKey?: ApiKeyContext;
  }
}

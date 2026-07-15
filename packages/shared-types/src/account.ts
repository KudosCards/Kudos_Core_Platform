import { z } from "zod";
import { accountTypeSchema, membershipRoleSchema } from "./enums";

export const accountSchema = z.object({
  id: z.string().uuid(),
  type: accountTypeSchema,
  name: z.string().min(1).max(200),
  stripeCustomerId: z.string().nullable(),
  planId: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type Account = z.infer<typeof accountSchema>;

export const createAccountInputSchema = z.object({
  type: accountTypeSchema,
  name: z.string().min(1).max(200),
});
export type CreateAccountInput = z.infer<typeof createAccountInputSchema>;

export const membershipSchema = z.object({
  id: z.string().uuid(),
  accountId: z.string().uuid(),
  userId: z.string().uuid(),
  role: membershipRoleSchema,
  createdAt: z.coerce.date(),
});
export type Membership = z.infer<typeof membershipSchema>;

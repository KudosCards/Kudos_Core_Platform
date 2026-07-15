import { z } from "zod";
import { fulfillmentJobStatusSchema } from "./enums";

/**
 * v1 fulfillment is an internal ops queue (manual print/post). This shape
 * is intentionally provider-agnostic so a real print-API vendor (e.g.
 * Stannp, Cloudprinter) can be plugged in later without changing callers.
 */
export const fulfillmentJobSchema = z.object({
  id: z.string().uuid(),
  orderRecipientId: z.string().uuid(),
  status: fulfillmentJobStatusSchema,
  assignedToUserId: z.string().uuid().nullable(),
  printedAt: z.coerce.date().nullable(),
  postedAt: z.coerce.date().nullable(),
  deliveredAt: z.coerce.date().nullable(),
  trackingReference: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type FulfillmentJob = z.infer<typeof fulfillmentJobSchema>;

export interface FulfillmentProvider {
  submit(job: FulfillmentJob): Promise<{ providerReference: string }>;
  getStatus(providerReference: string): Promise<FulfillmentJobStatusUpdate>;
}

export interface FulfillmentJobStatusUpdate {
  status: z.infer<typeof fulfillmentJobStatusSchema>;
  occurredAt: Date;
}

import type { PrismaService } from "../prisma/prisma.service";
import { ClickAndDropService } from "./click-and-drop.service";
import type { ClickAndDropClient } from "./click-and-drop-client";

/**
 * The sweep hands Royal Mail a card within five minutes of payment. A card
 * addressed to somewhere they already sent back is one we are not going to post,
 * so it has no business in their queue.
 *
 * Skipped rather than errored: nothing is wrong with the card. It imports itself
 * on a later sweep once the address is put right.
 * See docs/returned-address-hold-plan.md.
 */

const RETURNED = { shippingAddressLine1: "12 High Street", shippingAddressPostcode: "HU8 9DJ" };

function job(id: string, recipientId: string, line1: string, postcode: string) {
  return {
    id,
    clickAndDropOrderId: null,
    orderRecipient: {
      recipientId,
      shippingAddressLine1: line1,
      shippingAddressLine2: null,
      shippingAddressCity: "Kingston upon Hull",
      shippingAddressPostcode: postcode,
      shippingAddressCountry: "GB",
      postageClass: "second_class",
      priceMinor: 250,
      recipient: { firstName: "Freddie", lastName: "Farrow" },
      batchOrder: { orderNumber: 1025, createdAt: new Date("2026-09-11T10:50:00Z") },
    },
  };
}

function makeService(
  jobs: ReturnType<typeof job>[],
  returnedFor: { recipientId: string }[],
): { service: ClickAndDropService; createOrder: jest.Mock } {
  const createOrder = jest
    .fn()
    .mockResolvedValue({ orderIdentifier: "RM-1", orderReference: "ORD-1025" });
  const prisma = {
    fulfillmentJob: {
      findMany: jest.fn().mockResolvedValue(jobs),
      update: jest.fn().mockResolvedValue(undefined),
    },
    returnCase: {
      findMany: jest
        .fn()
        .mockResolvedValue(
          returnedFor.map((r) => ({ recipientId: r.recipientId, orderRecipient: RETURNED })),
        ),
    },
  } as unknown as PrismaService;
  const client = { enabled: true, createOrder } as unknown as ClickAndDropClient;
  return { service: new ClickAndDropService(prisma, client), createOrder };
}

describe("Click & Drop sweep — an address that came back", () => {
  it("does not hand Royal Mail a card we will not post", async () => {
    const held = job("j1", "r1", "12 High Street", "HU8 9DJ");
    const { service, createOrder } = makeService([held], [{ recipientId: "r1" }]);

    const result = await service.sweep();

    expect(createOrder).not.toHaveBeenCalled();
    expect(result).toEqual({ imported: 0, failed: 0 });
  });

  it("still imports the same contact's card at a different address", async () => {
    // The falsifying case: a contact who has moved has cards at the new address,
    // and those are exactly the ones that must go.
    const moved = job("j2", "r1", "4 Mill Lane", "HU5 2QR");
    const { service, createOrder } = makeService([moved], [{ recipientId: "r1" }]);

    const result = await service.sweep();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);
  });

  it("imports normally when nothing has ever come back", async () => {
    const ordinary = job("j3", "r2", "12 High Street", "HU8 9DJ");
    const { service, createOrder } = makeService([ordinary], []);

    await service.sweep();

    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("holds only the contact whose card came back", async () => {
    // Same address, different contact — a household one pupil has moved out of.
    const held = job("j4", "r1", "12 High Street", "HU8 9DJ");
    const sibling = job("j5", "r2", "12 High Street", "HU8 9DJ");
    const { service, createOrder } = makeService([held, sibling], [{ recipientId: "r1" }]);

    const result = await service.sweep();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(result.imported).toBe(1);
  });
});

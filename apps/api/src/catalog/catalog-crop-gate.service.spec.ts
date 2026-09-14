import type { PlatformSettingsService } from "../billing/platform-settings.service";
import { CatalogCropGateService } from "./catalog-crop-gate.service";

/**
 * The refusal the crop plan reserved for the sync, and then deferred until
 * there was evidence.
 *
 * The evidence arrived: 207 of 217 designs are 2:3 on a 1:1.4095 card. So the
 * gate has to exist — and it has to start open, because closing it today would
 * reject 95% of the catalog and empty the library.
 * See docs/card-artwork-shape-plan.md, Phase 5.
 */
function makeService(stored: string | null): {
  gate: CatalogCropGateService;
  set: jest.Mock;
} {
  const set = jest.fn().mockResolvedValue(undefined);
  const settings = {
    get: jest.fn().mockResolvedValue(stored),
    set,
  } as unknown as PlatformSettingsService;
  return { gate: new CatalogCropGateService(settings), set };
}

describe("CatalogCropGateService — the gate state", () => {
  it("is off when nothing has been stored", async () => {
    // The catalog is 95% cropped today. A gate that defaulted closed would
    // empty the library on the next sync.
    expect(await makeService(null).gate.isEnabled()).toBe(false);
  });

  it("is off when the stored value is not a boolean", async () => {
    // Off is the safe direction in every ambiguous case: a wrongly-open gate
    // costs one cropped card, a wrongly-closed one costs the catalog.
    expect(await makeService("yes").gate.isEnabled()).toBe(false);
    expect(await makeService("").gate.isEnabled()).toBe(false);
  });

  it("is on only when it has actually been switched on", async () => {
    expect(await makeService("true").gate.isEnabled()).toBe(true);
    expect(await makeService("false").gate.isEnabled()).toBe(false);
  });

  it("persists the switch", async () => {
    const { gate, set } = makeService(null);
    await gate.setEnabled(true);
    expect(set).toHaveBeenCalledWith("catalog_reject_cropped_artwork", "true");
    await gate.setEnabled(false);
    expect(set).toHaveBeenCalledWith("catalog_reject_cropped_artwork", "false");
  });
});

describe("CatalogCropGateService — what it refuses", () => {
  const { gate } = makeService(null);
  const TWO_THREE = { width: 1000, height: 1500 };

  it("lets everything through while the gate is open", () => {
    expect(gate.refusalReason(TWO_THREE, false)).toBeNull();
    expect(gate.refusalReason({ width: 1000, height: 1000 }, false)).toBeNull();
  });

  it("refuses the 6% the catalog is actually losing, not just heavy crops", () => {
    // The discriminator that matters. Nothing in the catalog is `heavy` — a
    // heavy-only gate would let back in precisely the thing it exists to stop.
    const reason = gate.refusalReason(TWO_THREE, true);
    expect(reason).toContain("6% of its height");
    // Named in full, so an operator can act without opening the file.
    expect(reason).toContain("1000 × 1500");
    expect(reason).toContain("1240 × 1748");
  });

  it("admits artwork at the size it asks for", () => {
    // Or the gate could never be satisfied, and closing it would be a trap.
    expect(gate.refusalReason({ width: 1240, height: 1748 }, true)).toBeNull();
  });

  it("says which way a landscape source is being cut", () => {
    expect(gate.refusalReason({ width: 1500, height: 1000 }, true)).toContain("of its width");
  });
});

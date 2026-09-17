import { BadRequestException } from "@nestjs/common";
import { DEFAULT_PRINT_PROFILE } from "@kudos/shared-types";
import { PrintProfileService } from "./print-profile.service";
import {
  PLATFORM_SETTING_KEYS,
  type PlatformSettingsService,
} from "../billing/platform-settings.service";

/**
 * The print profile describes the printer, so a bad row in it must never be the
 * reason ops cannot print today's cards. See docs/card-print-quality-plan.md
 * (P4) and ADR 0249.
 */
describe("PrintProfileService", () => {
  const get = jest.fn<Promise<string | null>, [string]>();
  const set = jest.fn<Promise<void>, [string, string]>();
  const settings = { get, set } as unknown as PlatformSettingsService;
  const service = new PrintProfileService(settings);

  beforeEach(() => {
    get.mockReset();
    set.mockReset();
    jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => jest.restoreAllMocks());

  it("uses the bundled default when nothing is stored", async () => {
    get.mockResolvedValue(null);
    await expect(service.getProfile()).resolves.toEqual(DEFAULT_PRINT_PROFILE);
  });

  it("returns a stored profile", async () => {
    get.mockResolvedValue(
      JSON.stringify({ layout: "face-per-page", borderlessOverhangMm: 2.5, backFooter: "print" }),
    );
    await expect(service.getProfile()).resolves.toEqual({
      layout: "face-per-page",
      borderlessOverhangMm: 2.5,
      backFooter: "print",
    });
  });

  it("falls back rather than throwing when the stored value is not JSON", async () => {
    // A hand-edited settings row must not take the print queue down with it.
    get.mockResolvedValue("folded-sheet");
    await expect(service.getProfile()).resolves.toEqual(DEFAULT_PRINT_PROFILE);
  });

  it("falls back when the stored JSON is not a profile", async () => {
    get.mockResolvedValue(JSON.stringify({ layout: "2-up", borderlessOverhangMm: 400 }));
    await expect(service.getProfile()).resolves.toEqual(DEFAULT_PRINT_PROFILE);
  });

  it("persists a valid profile as JSON under the print-profile key", async () => {
    const profile = {
      layout: "folded-sheet" as const,
      borderlessOverhangMm: 2.5,
      backFooter: "print" as const,
    };

    await expect(service.setProfile(profile)).resolves.toEqual(profile);
    expect(set).toHaveBeenCalledWith(PLATFORM_SETTING_KEYS.printProfile, JSON.stringify(profile));
  });

  it("stores the rounded figure, not the one that was typed", async () => {
    // What is written has to be what the engine will use, or the panel shows one
    // number and the cards come out compensated for another.
    const saved = await service.setProfile({
      layout: "folded-sheet",
      borderlessOverhangMm: 2.9,
      backFooter: "reserved",
    });

    expect(saved.borderlessOverhangMm).toBe(3);
    expect(set.mock.calls[0]![1]).toContain('"borderlessOverhangMm":3');
  });

  it("rejects an invalid profile without writing anything", async () => {
    await expect(
      service.setProfile({ layout: "2-up", borderlessOverhangMm: 0, backFooter: "reserved" }),
    ).rejects.toThrow(BadRequestException);
    expect(set).not.toHaveBeenCalled();
  });

  it("rejects an overhang no calibration sheet could show", async () => {
    await expect(
      service.setProfile({
        layout: "folded-sheet",
        borderlessOverhangMm: 40,
        backFooter: "reserved",
      }),
    ).rejects.toThrow(BadRequestException);
    expect(set).not.toHaveBeenCalled();
  });

  it("offers the bundled default for a reset", () => {
    expect(service.getHouseDefaultProfile()).toEqual(DEFAULT_PRINT_PROFILE);
  });
});

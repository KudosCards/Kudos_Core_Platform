import { existsSync } from "node:fs";
import { EDITOR_FONTS } from "@kudos/shared-types";
import { resolveFace } from "./fonts";

describe("resolveFace", () => {
  it("maps a web font's bold+italic to its real vendored variant", () => {
    const face = resolveFace("Montserrat", true, true);
    expect(face.id).toBe("Montserrat-BoldItalic");
    expect(face.file).toBeDefined();
    expect(existsSync(face.file!)).toBe(true);
    expect(face.synthesizeBold).toBe(false);
    expect(face.synthesizeItalic).toBe(false);
  });

  it("maps Georgia to the embedded Gelasio substitute", () => {
    const face = resolveFace("Georgia", false, false);
    expect(face.id).toBe("Gelasio-Regular");
    expect(existsSync(face.file!)).toBe(true);
  });

  it("synthesises italic for a face with no italic axis (Dancing Script)", () => {
    const face = resolveFace("Dancing Script", false, true);
    expect(face.id).toBe("DancingScript-Regular");
    expect(face.synthesizeItalic).toBe(true);
    expect(face.synthesizeBold).toBe(false);
  });

  it("synthesises bold+italic for a single-weight display face (Pacifico)", () => {
    const face = resolveFace("Pacifico", true, true);
    expect(face.id).toBe("Pacifico-Regular");
    expect(face.synthesizeBold).toBe(true);
    expect(face.synthesizeItalic).toBe(true);
  });

  it("maps the system stacks to PDF built-in families", () => {
    expect(resolveFace("Helvetica", true, false).builtin).toBe("Helvetica-Bold");
    expect(resolveFace("Times New Roman", false, true).builtin).toBe("Times-Italic");
    expect(resolveFace("Courier New", true, true).builtin).toBe("Courier-BoldOblique");
  });

  it("falls back to a system sans for an unknown family", () => {
    expect(resolveFace("Some Legacy Font", false, false).builtin).toBe("Helvetica");
  });

  it("has a vendored regular file for every embedded editor font", () => {
    const embeddedKeys = EDITOR_FONTS.filter((f) => f.webFont).map((f) => f.key);
    for (const key of embeddedKeys) {
      const face = resolveFace(key, false, false);
      expect(face.file).toBeDefined();
      expect(existsSync(face.file!)).toBe(true);
    }
  });
});

import { describe, it, expect } from "vitest";
import { classifySegment } from "./segments.js";

describe("classifySegment", () => {
  it("hr", () => expect(classifySegment({ id:1, type:"hr", sourceHash:"h" }).kind).toBe("hr"));
  it("rawUnsupported -> original english", () => {
    const r = classifySegment({ id:1, type:"rawUnsupported", sourceHash:"h", enMarkdown:"code" });
    expect(r).toEqual({ kind:"original", md:"code" });
  });
  it("empty zh translatable -> original english (no double render)", () => {
    const r = classifySegment({ id:1, type:"paragraph", sourceHash:"h", enMarkdown:"note", zhMarkdown:"  " });
    expect(r).toEqual({ kind:"original", md:"note" });
  });
  it("translated -> zh + en", () => {
    const r = classifySegment({ id:1, type:"paragraph", sourceHash:"h", enMarkdown:"E", zhMarkdown:"中" });
    expect(r).toEqual({ kind:"translated", zh:"中", en:"E" });
  });
});

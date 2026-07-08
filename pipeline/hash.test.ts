import { describe, it, expect } from "vitest";
import { hashText } from "./hash.js";

describe("hashText", () => {
  it("is deterministic and 64 hex chars", () => {
    const h = hashText("Hello world");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashText("Hello world")).toBe(h);
  });

  it("ignores leading/trailing and collapsed whitespace", () => {
    expect(hashText("  Hello   world ")).toBe(hashText("Hello world"));
  });

  it("differs for different content", () => {
    expect(hashText("a")).not.toBe(hashText("b"));
  });
});

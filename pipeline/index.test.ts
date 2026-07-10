import { describe, it, expect } from "vitest";
import { exitCodeFor } from "./index.js";

// Per-article failures are swallowed into a counter, so this predicate is the
// only thing standing between a partially failed run and a green exit.
describe("exitCodeFor", () => {
  it("succeeds when nothing failed", () => {
    expect(exitCodeFor(0)).toBe(0);
  });

  it("fails when any article failed", () => {
    expect(exitCodeFor(1)).toBe(1);
    expect(exitCodeFor(227)).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { exitCodeFor, parseArgs } from "./index.js";

describe("parseArgs", () => {
  it("parses documented --only and --limit forms", () => {
    const args = parseArgs(["--only=earn,greatwork", "--limit=10"]);
    expect(args.only).toEqual(new Set(["earn", "greatwork"]));
    expect(args.limit).toBe(10);
  });

  it("preserves an explicit zero limit instead of treating it as unlimited", () => {
    expect(parseArgs(["--limit=0"]).limit).toBe(0);
  });

  it.each(["--limit=", "--limit=nope", "--limit=-1", "--limit=1.5"])(
    "rejects invalid limit argument %s",
    (arg) => expect(() => parseArgs([arg])).toThrow(/limit/i),
  );

  it.each(["--only", "--only=", "--only=earn,"])(
    "rejects an empty or malformed only argument %s",
    (arg) => expect(() => parseArgs([arg])).toThrow(/only/i),
  );
});

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

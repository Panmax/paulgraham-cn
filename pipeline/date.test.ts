import { describe, it, expect } from "vitest";
import { parsePublishedAt } from "./date.js";

describe("parsePublishedAt", () => {
  it("parses 'July 2023'", () => {
    expect(parsePublishedAt("July 2023")).toBe("2023-07-01");
  });
  it("parses when date is embedded in a longer string", () => {
    expect(parsePublishedAt("June 2026\n\nWhen I was young")).toBe("2026-06-01");
  });
  it("parses single-digit month zero-padded", () => {
    expect(parsePublishedAt("March 2024")).toBe("2024-03-01");
  });
  it("returns null when no month/year present", () => {
    expect(parsePublishedAt("Some intro text")).toBeNull();
  });
});

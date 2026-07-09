import { describe, it, expect } from "vitest";
import { parsePublishedAt, parseLeadingDate } from "./date.js";

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

describe("parseLeadingDate", () => {
  it("parses a leading 'Month YYYY' byline", () => {
    expect(parseLeadingDate("May 2001  *(I wrote this.)*")).toEqual({
      dateText: "May 2001",
      publishedAt: "2001-05-01",
    });
  });
  it("parses a bare leading year byline to January 1st", () => {
    expect(parseLeadingDate("1993  *(This essay is from On Lisp.)*")).toEqual({
      dateText: "1993",
      publishedAt: "1993-01-01",
    });
  });
  it("does not match a month/year buried mid-sentence", () => {
    expect(parseLeadingDate("I visited in September 2004 once.")).toBeNull();
  });
  it("does not match a bare number that is not a plausible year", () => {
    expect(parseLeadingDate("6500 lines of code later")).toBeNull();
    expect(parseLeadingDate("100 startups applied")).toBeNull();
  });
  it("does not treat a year embedded in prose as a byline", () => {
    expect(parseLeadingDate("Programming languages are old.")).toBeNull();
  });
});

import { describe, it, expect } from "vitest";
import { renderMarkdown } from "./markdown.js";

describe("renderMarkdown", () => {
  it("renders links and emphasis", async () => {
    const html = await renderMarkdown("see [YC](https://ycombinator.com) and *this*");
    expect(html).toContain('href="https://ycombinator.com"');
    expect(html).toContain("<em>this</em>");
  });
  it("strips raw HTML", async () => {
    const html = await renderMarkdown("hello <script>alert(1)</script> world");
    expect(html).not.toContain("<script>");
  });
  it("strips javascript: links", async () => {
    const html = await renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toContain("javascript:");
  });
});

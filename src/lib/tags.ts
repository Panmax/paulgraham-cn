import { z } from "zod";
import tagsData from "../../content/tags.json";
import { TAGS, type TagId } from "../../shared/tags.js";

// Parsed at module load, so a malformed `content/tags.json` fails the build
// rather than silently producing tag pages with missing members.
const AssignmentsSchema = z.object({
  articles: z.record(z.string(), z.array(z.string()).min(1).max(3)),
});

export const assignments: Record<string, string[]> = AssignmentsSchema.parse(tagsData).articles;

export function tagsFor(slug: string): TagId[] {
  return (assignments[slug] ?? []) as TagId[];
}

export function slugsWithTag(tagId: string): string[] {
  return Object.entries(assignments)
    .filter(([, tags]) => tags.includes(tagId))
    .map(([slug]) => slug);
}

export function countWithTag(tagId: string): number {
  return slugsWithTag(tagId).length;
}

export { TAGS };

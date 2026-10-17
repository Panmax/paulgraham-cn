import { z } from "zod";
import data from "../../content/summaries.json";

// Parsed at module load, so a malformed file fails the build rather than
// silently dropping the standfirst from every article that has one.
const SummariesSchema = z.object({
  summaries: z.record(z.string(), z.string().min(1)),
});

const summaries: Record<string, string> = SummariesSchema.parse(data).summaries;

export function summaryFor(slug: string): string | undefined {
  return summaries[slug];
}

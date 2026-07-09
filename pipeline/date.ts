const MONTHS: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

export function parsePublishedAt(dateText: string): string | null {
  const m = dateText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{4})\b/i);
  if (!m) return null;
  const month = MONTHS[m[1].toLowerCase()];
  return `${m[2]}-${month}-01`;
}

const MONTH_NAMES =
  "January|February|March|April|May|June|July|August|September|October|November|December";
// A "Month YYYY" byline anchored at the very start of a paragraph.
const LEADING_MONTH_YEAR = new RegExp(`^(${MONTH_NAMES})\\s+(\\d{4})\\b`, "i");
// A bare-year byline ("1993"), used by a few of the oldest essays. Constrained
// to a plausible essay-era range so a stray leading number ("6500 lines...",
// "100 startups...") is never mistaken for a publication year.
const LEADING_YEAR = /^(\d{4})\b/;

/**
 * Extract a byline date from the START of a paragraph. Handles both the common
 * "Month YYYY" form and the bare-year form ("1993") used by a few early essays.
 * Bare years map to January 1st. Returns null when the paragraph does not open
 * with a date, so a month/year (or number) buried in prose is never taken as
 * the byline.
 */
export function parseLeadingDate(
  md: string,
): { dateText: string; publishedAt: string } | null {
  const monthMatch = md.match(LEADING_MONTH_YEAR);
  if (monthMatch) {
    const month = MONTHS[monthMatch[1].toLowerCase()];
    return { dateText: `${monthMatch[1]} ${monthMatch[2]}`, publishedAt: `${monthMatch[2]}-${month}-01` };
  }
  const yearMatch = md.match(LEADING_YEAR);
  if (yearMatch) {
    const year = Number(yearMatch[1]);
    if (year >= 1980 && year <= 2100) {
      return { dateText: yearMatch[1], publishedAt: `${yearMatch[1]}-01-01` };
    }
  }
  return null;
}

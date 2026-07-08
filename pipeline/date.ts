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

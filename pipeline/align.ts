// pipeline/align.ts
import { distance } from "fastest-levenshtein";
import type { Segment } from "../shared/article-schema.js";
import type { ParsedSegment } from "./parse-article.js";

export type Disposition = "unchanged" | "changed" | "new";
export type AlignedSegment = { segment: Segment; disposition: Disposition };

const SIMILARITY_THRESHOLD = 0.5;

function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  const d = distance(a, b);
  return 1 - d / Math.max(a.length, b.length, 1);
}

// Longest common subsequence over sourceHash, returning matched index pairs.
function lcsPairs(oldHashes: string[], newHashes: string[]): Array<[number, number]> {
  const m = oldHashes.length, n = newHashes.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = oldHashes[i] === newHashes[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (oldHashes[i] === newHashes[j]) { pairs.push([i, j]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return pairs;
}

export function alignSegments(
  oldSegments: Segment[],
  parsed: ParsedSegment[],
): { aligned: AlignedSegment[]; nextId: number } {
  let nextId = oldSegments.reduce((max, s) => Math.max(max, s.id), 0) + 1;
  const oldHashes = oldSegments.map((s) => s.sourceHash);
  const newHashes = parsed.map((s) => s.sourceHash);

  const anchors = lcsPairs(oldHashes, newHashes); // increasing in both indices
  const aligned: AlignedSegment[] = new Array(parsed.length);

  // Fill anchored (unchanged) positions.
  for (const [oi, nj] of anchors) {
    const old = oldSegments[oi];
    const p = parsed[nj];
    aligned[nj] = {
      segment: { ...old, type: p.type, enMarkdown: p.enMarkdown, sourceHash: p.sourceHash },
      disposition: "unchanged",
    };
  }

  // Walk the gaps between consecutive anchors (with sentinels at both ends).
  // Similarity matching is confined to each gap so a similar/duplicate segment
  // in a different region can never steal an id and overwrite the wrong
  // segment's human translation.
  const bounded: Array<[number, number]> = [
    [-1, -1], ...anchors, [oldSegments.length, parsed.length],
  ];
  for (let k = 0; k < bounded.length - 1; k++) {
    const [oiA, njA] = bounded[k];
    const [oiB, njB] = bounded[k + 1];
    const gapOld: number[] = [];
    for (let oi = oiA + 1; oi < oiB; oi++) gapOld.push(oi);
    const claimed = new Set<number>();

    for (let nj = njA + 1; nj < njB; nj++) {
      const p = parsed[nj];
      let best = -1, bestScore = 0;
      for (const oi of gapOld) {
        if (claimed.has(oi)) continue;
        const score = similarity(p.enMarkdown ?? "", oldSegments[oi].enMarkdown ?? "");
        if (score > bestScore) { bestScore = score; best = oi; }
      }
      if (best >= 0 && bestScore >= SIMILARITY_THRESHOLD) {
        claimed.add(best);
        aligned[nj] = {
          segment: {
            id: oldSegments[best].id,
            type: p.type,
            sourceHash: p.sourceHash,
            enMarkdown: p.enMarkdown,
            zhMarkdown: undefined,
          },
          disposition: "changed",
        };
      } else {
        aligned[nj] = {
          segment: { id: nextId++, type: p.type, sourceHash: p.sourceHash, enMarkdown: p.enMarkdown, zhMarkdown: undefined },
          disposition: "new",
        };
      }
    }
  }
  // gapOld indices left unclaimed correspond to deleted old segments (omitted).

  return { aligned, nextId };
}

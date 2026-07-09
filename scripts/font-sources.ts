import { join } from "node:path";

export const CSS_ZH_FAMILY = "PGCN Song";   // custom name — avoids OFL reserved name "Source"
export const ASSETS_FONT_DIR = join(process.cwd(), "assets", "fonts");

// Pinned Source Han Serif SC (OTF), 2.003R.
export const RAW_FONTS = {
  regular: { file: "SourceHanSerifSC-Regular.otf", sha256: "78aa7a328fd974df2d688c8a9fd74a33d8334dfa84ab24d9d11efb2ffc464117" },
  bold:    { file: "SourceHanSerifSC-Bold.otf",    sha256: "706b8c0de2deff6cbc0c87e2cdedfd33a78b7ffd76cebb4549012f197ba611fe" },
} as const;
export type Weight = keyof typeof RAW_FONTS;

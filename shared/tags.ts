/**
 * The tag vocabulary. Paul Graham's own site has no categories — his index is a
 * flat reverse-chronological list — so these are editorial judgement, not a
 * structure recovered from the source.
 *
 * The vocabulary is code, the assignments are data (`content/tags.json`): the
 * tagger builds its prompt from this list, the site builds its chip order and
 * labels from it, and `hint` is both the prompt's definition and the tag page's
 * one-line description. One place, so the two can never drift apart.
 */
export const TAGS = [
  { id: "startups", zh: "创业", en: "Startups",
    hint: "创业公司、早期决策、增长、创始人、团队、创业点子" },
  { id: "fundraising", zh: "融资投资", en: "Fundraising",
    hint: "融资、风投、天使投资、估值、投资人关系" },
  { id: "programming", zh: "编程", en: "Programming",
    hint: "编程语言、Lisp、代码、黑客文化、软件工程" },
  { id: "thinking", zh: "思考方法", en: "Thinking",
    hint: "如何思考、判断力、独立、发现新想法、异议与共识" },
  { id: "writing", zh: "写作", en: "Writing",
    hint: "写作、用词、文章、演讲、阅读" },
  { id: "money", zh: "财富经济", en: "Money",
    hint: "财富、收入、不平等、税收、经济制度" },
  { id: "society", zh: "社会观察", en: "Society",
    hint: "文化、政治、媒体、时尚、公共议题" },
  { id: "work", zh: "工作生活", en: "Work & Life",
    hint: "职业选择、做事的动力、拖延、时间、家庭、人生选择" },
  { id: "education", zh: "教育成长", en: "Education",
    hint: "大学、中学、教育制度、成长与资质" },
  { id: "cities", zh: "城市地点", en: "Cities",
    hint: "城市、地区、硅谷、创业中心、地点对人的影响" },
  { id: "design", zh: "设计品味", en: "Design",
    hint: "设计、品味、产品、美感、好与坏的标准" },
] as const;

export type TagId = (typeof TAGS)[number]["id"];

export const TAG_IDS: readonly string[] = TAGS.map((t) => t.id);

export function tagById(id: string): (typeof TAGS)[number] | undefined {
  return TAGS.find((t) => t.id === id);
}

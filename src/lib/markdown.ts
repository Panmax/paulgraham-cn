import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkCjkFriendly from "remark-cjk-friendly";
import remarkRehype from "remark-rehype";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeStringify from "rehype-stringify";

const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
};

interface MarkdownNode {
  type?: string;
  url?: string;
  children?: MarkdownNode[];
}

interface PreferTranslatedLinksOptions {
  translatedSlugs: ReadonlySet<string>;
}

export function preferTranslatedArticleUrl(
  href: string,
  translatedSlugs: ReadonlySet<string>,
): string {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return href;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    (url.hostname !== "paulgraham.com" && url.hostname !== "www.paulgraham.com")
  ) {
    return href;
  }

  const match = /^\/([^/]+)\.html$/i.exec(url.pathname);
  if (!match) return href;

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    return href;
  }
  if (!translatedSlugs.has(slug)) return href;

  return `/${slug}.html${url.search}${url.hash}`;
}

function remarkPreferTranslatedLinks(options: PreferTranslatedLinksOptions) {
  return (tree: MarkdownNode) => {
    const visit = (node: MarkdownNode) => {
      if (node.type === "link" && typeof node.url === "string") {
        node.url = preferTranslatedArticleUrl(node.url, options.translatedSlugs);
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

export function createMarkdownRenderer(translatedSlugs: ReadonlySet<string> = new Set()) {
  const processor = unified()
    .use(remarkParse)
    // CommonMark's flanking rules treat CJK punctuation as punctuation, so
    // `的*《书名》*` never opens an emphasis run and renders as literal
    // asterisks. This makes the rules CJK-aware.
    .use(remarkCjkFriendly)
    .use(remarkPreferTranslatedLinks, { translatedSlugs })
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeSanitize, sanitizeSchema)
    .use(rehypeStringify);

  return async (md: string): Promise<string> => {
    const file = await processor.process(md);
    return String(file);
  };
}

const renderDefaultMarkdown = createMarkdownRenderer();

export async function renderMarkdown(md: string): Promise<string> {
  return renderDefaultMarkdown(md);
}

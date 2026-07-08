import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";
import { ArticleSchema } from "../shared/article-schema.js";

const articles = defineCollection({
  loader: glob({ pattern: "*.json", base: "content/articles" }),
  schema: ArticleSchema,
});

export const collections = { articles };

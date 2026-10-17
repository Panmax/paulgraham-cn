import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://paulgraham-cn.com",
  build: { format: "file" }, // emit /earn.html not /earn/index.html
  integrations: [sitemap()],
});

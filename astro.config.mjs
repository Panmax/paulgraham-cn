import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://paulgraham-cn.com",
  build: { format: "file" }, // emit /earn.html not /earn/index.html
});

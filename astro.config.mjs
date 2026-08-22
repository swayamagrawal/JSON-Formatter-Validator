import { defineConfig } from "astro/config";
import preact from "@astrojs/preact";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://quietjson.com", // QuietJSON — final domain
  integrations: [
    preact(),
    sitemap({
      filter: (page) =>
        !page.includes("/404") &&
        !page.includes("/500"),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
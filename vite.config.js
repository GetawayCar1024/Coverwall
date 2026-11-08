import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths, so the build works at the site root
  // and under a GitHub Pages project path alike.
  base: "./",
  build: {
    target: "es2022"
  }
});

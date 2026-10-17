import { defineConfig } from "vite";

// base を相対にしておくと dist/ をどこに置いても動く（GitHub Pages などのサブパスでも可）
export default defineConfig({
  base: "./",
  server: { host: true },
});

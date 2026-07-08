import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages project site
  base: process.env.GITHUB_PAGES === "true" ? "/foxys-premium-upscaling/" : "/",
  worker: {
    format: "es",
  },
  optimizeDeps: {
    include: [
      "@websr/websr",
      "upscaler",
      "@tensorflow/tfjs",
      "@upscalerjs/esrgan-thick",
    ],
  },
  build: {
    target: "es2022",
    sourcemap: true,
    chunkSizeWarningLimit: 2000,
    commonjsOptions: {
      include: [/node_modules/],
      transformMixedEsModules: true,
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});

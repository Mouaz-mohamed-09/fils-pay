import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    // apps/web already owns 5173.
    port: 5174,
    // Same-origin proxy to the API; see apps/web/vite.config.ts.
    proxy: {
      "/v1": { target: process.env.API_PROXY_TARGET ?? "http://localhost:3000", changeOrigin: true },
    },
  },
});

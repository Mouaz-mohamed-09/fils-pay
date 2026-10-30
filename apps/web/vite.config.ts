import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // The API registers no CORS handling, so a cross-origin, cookie-carrying
    // call from :5173 to :3000 is blocked by the browser. Proxying /v1 keeps
    // the dashboard same-origin (set VITE_API_BASE_URL="" to use it).
    proxy: {
      "/v1": { target: process.env.API_PROXY_TARGET ?? "http://localhost:3000", changeOrigin: true },
    },
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Built into the backend, which serves it at http://127.0.0.1:3000/admin (same origin as the API).
// In development (npm run dev:admin) Vite proxies /api to the backend, so cookies still work.
export default defineConfig({
  base: "/admin/",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    strictPort: true,
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  build: {
    outDir: fileURLToPath(new URL("../backend/public/admin", import.meta.url)),
    emptyOutDir: true,
  },
});

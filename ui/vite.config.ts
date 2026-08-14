import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Anchor and web3.js expect a couple of node globals in the browser; the
// rest of the polyfilling (Buffer, process) happens in src/polyfills.ts.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
  },
  define: {
    global: "globalThis",
    "process.env": {},
  },
  optimizeDeps: {
    esbuildOptions: {
      define: { global: "globalThis" },
    },
  },
});

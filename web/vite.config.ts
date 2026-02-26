import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/hunt": "http://localhost:5000",
      "/stream": "http://localhost:5000",
      "/health": "http://localhost:5000",
      "/health-all": "http://localhost:5000",
      "/ping": "http://localhost:5000",
      "/reports": "http://localhost:5000",
      "/report": "http://localhost:5000",
      "/reputation": "http://localhost:5000",
      "/autopilot": "http://localhost:5000",
      "/memory": "http://localhost:5000",
      "/telegram": "http://localhost:5000",
      "/circuits": "http://localhost:5000",
      "/live": "http://localhost:5000",
      "/settlement": "http://localhost:5000",
      "/registry": "http://localhost:5000",
      "/logo.svg": "http://localhost:5000",
    },
  },
  build: { outDir: "dist" },
});

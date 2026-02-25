import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// tsx binary (installed as devDependency)
const tsx = join(__dirname, "node_modules", ".bin", "tsx");

interface ServiceDef {
  name: string;
  file: string;
  port: string;
}

const services: ServiceDef[] = [
  { name: "sentiment",  file: "services/sentiment.ts",  port: process.env["PORT_SENTIMENT"]  ?? "4001" },
  { name: "polymarket", file: "services/polymarket.ts", port: process.env["PORT_POLYMARKET"] ?? "4002" },
  { name: "defi",       file: "services/defi.ts",       port: process.env["PORT_DEFI"]       ?? "4003" },
  { name: "hunter",     file: "agent/hunter.ts",        port: process.env["PORT_AGENT"]      ?? "5000" },
];

console.log("\n  ⚡  AlphaClaw — starting all services\n");

for (const svc of services) {
  const child = spawn(tsx, [join(__dirname, svc.file)], { stdio: "inherit" });

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`  ✗  [${svc.name}] exited with code ${code}`);
    }
  });

  child.on("error", (err) => {
    console.error(`  ✗  [${svc.name}] error: ${err.message}`);
  });
}

console.log("  Services starting on:");
console.log("    4001 — Sentiment Analysis");
console.log("    4002 — Polymarket Scanner");
console.log("    4003 — DeFi Scanner");
console.log("    5000 — AlphaClaw Hunter (dashboard + API)");
console.log("\n  Open http://localhost:5000 in your browser");
console.log("  Run  tsx demo.ts  to test the full payment flow\n");

import { spawn, type ChildProcess } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { SERVICE_DEFS } from "./config/services.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, "..");

// tsx binary (installed as devDependency)
const tsx = join(projectRoot, "node_modules", ".bin", "tsx");

const serviceOrder = ["sentiment", "polymarket", "defi", "news", "whale", "hunter"] as const;

console.log("\n  ⚡  AlphaClaw — starting all services\n");

// Track child processes for cleanup
const children: ChildProcess[] = [];

for (const key of serviceOrder) {
  const svc = SERVICE_DEFS[key]!;
  const child = spawn(tsx, [join(projectRoot, svc.entryFile)], { stdio: "inherit" });
  children.push(child);

  child.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`  ✗  [${svc.key}] exited with code ${code}`);
    }
  });

  child.on("error", (err) => {
    console.error(`  ✗  [${svc.key}] error: ${err.message}`);
  });
}

console.log("  Services starting on:");
console.log("    4001 — Sentiment Analysis      ($0.001)");
console.log("    4002 — Polymarket Scanner      ($0.020)");
console.log("    4003 — DeFi Scanner            ($0.015)");
console.log("    4004 — News Agent              ($0.001)");
console.log("    4005 — Whale Agent             ($0.002)");
console.log("    5000 — AlphaClaw Coordinator   ($0.050 buy / $0.010 sell)");
console.log("\n  Open http://localhost:5000 in your browser");
console.log("  Run  tsx demo.ts  to test the full payment flow\n");

// Graceful shutdown: forward signal to all children, then exit
function shutdown(signal: NodeJS.Signals): void {
  console.log(`\n  Received ${signal} — stopping all services...`);
  for (const child of children) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
  // Give children time to exit, then force
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) {
        child.kill("SIGKILL");
      }
    }
    process.exit(0);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));

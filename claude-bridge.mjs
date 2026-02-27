#!/usr/bin/env node
/**
 * AlphaClaw Claude Bridge
 * Local HTTP server that proxies Anthropic API calls through the claude CLI.
 * Listens on port 5010, accepts POST /v1/messages in Anthropic API format.
 */

import { createServer } from "http";
import { spawn } from "child_process";

const PORT = 5010;
const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

function runClaude(prompt, maxTokens = 1024) {
  return new Promise((resolve, reject) => {
    const args = ["--print", "--output-format", "text", "--model", MODEL];
    const proc = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200)}`));
      } else {
        resolve(stdout.trim());
      }
    });

    proc.on("error", reject);

    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

function buildPromptFromMessages(messages) {
  // Convert Anthropic messages array to a single prompt string
  return messages
    .map((m) => {
      const role = m.role === "user" ? "Human" : "Assistant";
      const content = Array.isArray(m.content)
        ? m.content.map((c) => (c.type === "text" ? c.text : "")).join("")
        : m.content || "";
      return `${role}: ${content}`;
    })
    .join("\n\n");
}

const server = createServer(async (req, res) => {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, anthropic-version, x-api-key");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/v1/messages") {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found. Use POST /v1/messages" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    try {
      const payload = JSON.parse(body);
      const messages = payload.messages || [];
      const maxTokens = payload.max_tokens || 1024;

      if (!messages.length) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "messages required" }));
        return;
      }

      const prompt = buildPromptFromMessages(messages);
      const text = await runClaude(prompt, maxTokens);

      // Return in Anthropic API format
      const response = {
        id: `msg_bridge_${Date.now()}`,
        type: "message",
        role: "assistant",
        content: [{ type: "text", text }],
        model: MODEL,
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: text.length },
      };

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(response));
    } catch (err) {
      console.error("[bridge] error:", err.message);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[claude-bridge] listening on http://localhost:${PORT}`);
  console.log(`[claude-bridge] model: ${MODEL}`);
  console.log(`[claude-bridge] endpoint: POST /v1/messages`);
});

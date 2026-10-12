// server.js — static file server + repo analysis API. No dependencies.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { analyzeRepoDir, parseRepoUrl } from "./analyzer.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(root, "public");
const PORT = Number(process.env.PORT) || 3000;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(body);
}

function serveStatic(req, res) {
  const rel = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const file = path.normalize(path.join(pub, rel));
  if (!file.startsWith(pub) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, JSON.stringify({ error: "Not found." }));
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] ?? "application/octet-stream");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > 10_000) return reject(new Error("Body too large."));
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function analyzeUrl(repoInput) {
  const { owner, repo, url } = parseRepoUrl(repoInput);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "learn-the-code-"));
  try {
    execFileSync("git", ["clone", "--depth", "1", url, tmp], { timeout: 120_000, stdio: "pipe" });
    let branch = "HEAD";
    try {
      branch = execFileSync("git", ["-C", tmp, "rev-parse", "--abbrev-ref", "HEAD"], { encoding: "utf8" }).trim();
    } catch { /* keep HEAD */ }
    return analyzeRepoDir(tmp, { owner, repo, url, branch });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/health") {
      return send(res, 200, JSON.stringify({ ok: true }));
    }

    if (req.method === "GET" && url.pathname === "/api/example") {
      const data = fs.readFileSync(path.join(root, "data", "livedocs.json"), "utf8");
      return send(res, 200, data);
    }

    if ((req.method === "GET" || req.method === "POST") && url.pathname === "/api/analyze") {
      let repoInput = url.searchParams.get("repo");
      if (req.method === "POST") {
        try {
          repoInput = JSON.parse((await readBody(req)) || "{}").repo ?? repoInput;
        } catch {
          return send(res, 400, JSON.stringify({ error: "Invalid JSON body. Send { \"repo\": \"https://github.com/owner/repo\" }." }));
        }
      }
      try {
        const report = await analyzeUrl(repoInput);
        return send(res, 200, JSON.stringify(report));
      } catch (err) {
        const raw = String(err?.message ?? err);
        let msg = raw;
        let status = 500;
        if (/valid|supported|look like|Missing/i.test(raw)) {
          msg = raw; status = 400;
        } else if (/Repository not found|not found|authentication|permission denied|unable to access/i.test(raw)) {
          msg = "Repo not found. Check the URL — only public repos work.";
          status = 422;
        } else {
          msg = "Analysis failed. The repo may be too large or temporarily unreachable.";
        }
        return send(res, status, JSON.stringify({ error: msg.slice(0, 300) }));
      }
    }

    if (req.method === "GET") return serveStatic(req, res);
    return send(res, 405, JSON.stringify({ error: "Method not allowed." }));
  } catch (err) {
    send(res, 500, JSON.stringify({ error: "Server error." }));
  }
});

server.listen(PORT, () => console.log(`learn-the-code up at http://localhost:${PORT}`));

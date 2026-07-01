import { createServer } from "node:http";
import { get } from "node:https";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const appRoot = process.env.TAG_GALLERY_APP_ROOT ? resolve(process.env.TAG_GALLERY_APP_ROOT) : root;
const serverRoot = resolve(root);
const inferredPortableRoot = basename(serverRoot).toLowerCase() === "app" ? dirname(serverRoot) : null;
const shutdownFlagDirs = [...new Set([appRoot, inferredPortableRoot].filter(Boolean).map((dir) => resolve(dir)))];
const logFile = resolve(appRoot, "tag-gallery.log");
const packageFiles = [...new Set([serverRoot, appRoot, inferredPortableRoot].filter(Boolean).map((dir) => resolve(dir, "package.json")))];
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5188);

async function getAppInfo() {
  for (const packageFile of packageFiles) {
    try {
      const packageText = await readFile(packageFile, "utf8");
      const packageJson = JSON.parse(packageText);
      return {
        name: packageJson.name || "tag-gallery",
        version: packageJson.version || "0.0.0",
      };
    } catch {}
  }

  return { name: "tag-gallery", version: "0.0.0" };
}

async function log(message, level = "info") {
  const line = `[${new Date().toISOString()}] [${level}] ${message}`;
  console[level === "error" ? "error" : "log"](line);
  try {
    await appendFile(logFile, `${line}\n`, "utf8");
  } catch {}
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function compareVersions(left, right) {
  const normalize = (value) => String(value || "").replace(/^v/i, "").split(/[.-]/).map((part) => Number.parseInt(part, 10));
  const leftParts = normalize(left);
  const rightParts = normalize(right);
  const hasNumericVersion = leftParts.every(Number.isFinite) && rightParts.every(Number.isFinite);

  if (!hasNumericVersion) {
    return String(left || "").replace(/^v/i, "") === String(right || "").replace(/^v/i, "") ? 0 : 1;
  }

  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

function fetchJson(url) {
  return new Promise((resolvePromise, reject) => {
    const request = get(url, {
      headers: {
        "Accept": "application/vnd.github+json",
        "User-Agent": "TagGallery-update-check",
      },
      timeout: 8000,
    }, (githubResponse) => {
      let body = "";
      githubResponse.setEncoding("utf8");
      githubResponse.on("data", (chunk) => {
        body += chunk;
      });
      githubResponse.on("end", () => {
        if (githubResponse.statusCode < 200 || githubResponse.statusCode >= 300) {
          reject(new Error(`GitHub returned ${githubResponse.statusCode}`));
          return;
        }
        try {
          resolvePromise(JSON.parse(body));
        } catch (error) {
          reject(error);
        }
      });
    });

    request.on("timeout", () => {
      request.destroy(new Error("GitHub request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

async function checkGitHubUpdate(repo, currentVersion) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error("Invalid repository");
  }
  const release = await fetchJson(`https://api.github.com/repos/${repo}/releases/latest`);
  const latestVersion = String(release.tag_name || "").trim();
  return {
    currentVersion,
    latestVersion,
    hasUpdate: latestVersion ? compareVersions(latestVersion, currentVersion) > 0 : false,
    htmlUrl: release.html_url || `https://github.com/${repo}/releases`,
  };
}

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".svg", "image/svg+xml"],
]);

function getTargetPath(requestUrl) {
  const url = new URL(requestUrl, `http://${host}:${port}`);
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" || !extname(pathname) ? "/index.html" : pathname;
  const target = resolve(serverRoot, `.${requestedPath}`);
  const relativeTarget = relative(serverRoot, target);

  if (relativeTarget.startsWith("..") || isAbsolute(relativeTarget)) {
    return null;
  }

  return target;
}

async function writeShutdownFlags() {
  const timestamp = `${Date.now()}`;
  const writes = shutdownFlagDirs.map((dir) => writeFile(resolve(dir, "shutdown-window.flag"), timestamp, "utf8"));
  await Promise.allSettled(writes);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "GET" && url.pathname === "/api/app-info") {
    sendJson(response, 200, { ok: true, ...(await getAppInfo()) });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/update-check") {
    try {
      const repo = url.searchParams.get("repo") || "";
      const version = url.searchParams.get("version") || "0.0.0";
      const result = await checkGitHubUpdate(repo, version);
      await log(`GitHub update check completed: ${repo} ${version} -> ${result.latestVersion || "none"}`);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      await log(`GitHub update check failed: ${error.message}`, "error");
      sendJson(response, 502, { ok: false, error: "GitHub update check failed" });
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/shutdown") {
    await log("Shutdown requested from app window");
    await writeShutdownFlags();

    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    response.end(JSON.stringify({ ok: true }));

    setTimeout(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 700).unref();
    }, 120).unref();
    return;
  }

  const target = getTargetPath(request.url || "/");

  if (!target) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(target).toLowerCase()) || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  log(`TagGallery: http://${host}:${port}/`);
});

server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    log(`端口 ${port} 已被占用，请检查是否已有实例在运行`, "error");
  } else {
    log(`服务器错误: ${error.message}`, "error");
  }
  process.exit(1);
});

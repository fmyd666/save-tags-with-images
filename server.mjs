import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const appRoot = process.env.TAG_GALLERY_APP_ROOT ? resolve(process.env.TAG_GALLERY_APP_ROOT) : root;
const shutdownFlag = resolve(appRoot, "shutdown-window.flag");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 5188);

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
  const target = resolve(root, `.${requestedPath}`);

  if (!target.startsWith(resolve(root))) {
    return null;
  }

  return target;
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${host}:${port}`);

  if (request.method === "POST" && url.pathname === "/shutdown") {
    try {
      await writeFile(shutdownFlag, `${Date.now()}`, "utf8");
    } catch {
      // The browser can still close itself even if the monitor flag cannot be written.
    }

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
  console.log(`用图片保存tag: http://${host}:${port}/`);
});

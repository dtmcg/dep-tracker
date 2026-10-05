import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import { schedule, type StorageAdapter, type StorageDescriptor } from "@dep-tracker/domain";

export interface AppOptions {
  /** Storage adapters by kind. */
  adapters: Partial<Record<StorageDescriptor["kind"], StorageAdapter>>;
  /** Folder holding the built web app; omitted in API-only tests. */
  staticDir?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be JSON");
  }
}

function parseDescriptor(body: unknown): StorageDescriptor {
  const storage = (body as { storage?: unknown } | null)?.storage as Partial<StorageDescriptor> | undefined;
  if (!storage || typeof storage.kind !== "string") throw new HttpError(422, "Body must include storage.kind");
  if (typeof storage.path !== "string" || !storage.path.trim()) throw new HttpError(422, "Body must include storage.path");
  return { kind: storage.kind, path: storage.path.trim() } as StorageDescriptor;
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL, options: AppOptions): Promise<void> {
  if (req.method === "GET" && url.pathname === "/api/health") return sendJson(res, 200, { ok: true });

  if (req.method === "POST" && url.pathname === "/api/projects/open") {
    const descriptor = parseDescriptor(await readJson(req));
    const adapter = options.adapters[descriptor.kind];
    if (!adapter) throw new HttpError(422, `Storage kind "${descriptor.kind}" is not supported yet`);
    let loaded;
    try {
      loaded = await adapter.load(descriptor);
    } catch (error) {
      throw new HttpError(422, (error as Error).message);
    }
    return sendJson(res, 200, { ...loaded, storage: descriptor, schedule: schedule(loaded.project) });
  }

  throw new HttpError(404, `No route for ${req.method} ${url.pathname}`);
}

async function serveStatic(res: ServerResponse, url: URL, staticDir: string): Promise<void> {
  const root = path.resolve(staticDir);
  let relative: string;
  try {
    relative = decodeURIComponent(url.pathname);
  } catch {
    throw new HttpError(400, "Bad path");
  }
  const target = path.resolve(root, "." + (relative === "/" ? "/index.html" : relative));
  if (target !== root && !target.startsWith(root + path.sep)) throw new HttpError(404, "Not found");

  let file = target;
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) {
    // Unknown non-asset paths fall back to the single-page app
    if (path.extname(relative)) throw new HttpError(404, "Not found");
    file = path.join(root, "index.html");
  }
  const body = await readFile(file).catch(() => {
    throw new HttpError(404, "Not found");
  });
  res.writeHead(200, { "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream" });
  res.end(body);
}

export function createApp(options: AppOptions): Server {
  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url, options);
      if (req.method === "GET" && options.staticDir) return await serveStatic(res, url, options.staticDir);
      throw new HttpError(404, "Not found");
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) console.error(error);
      if (!res.headersSent) sendJson(res, status, { error: (error as Error).message });
      else res.end();
    }
  });
}

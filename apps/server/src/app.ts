import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import path from "node:path";
import {
  applyCommands,
  type Command,
  CommandError,
  type LoadedProject,
  newId,
  type Project,
  ProjectExistsError,
  schedule,
  type StorageAdapter,
  type StorageDescriptor,
  VersionConflictError,
} from "@dep-tracker/domain";

export interface AppOptions {
  /** Storage adapters by kind. */
  adapters: Partial<Record<StorageDescriptor["kind"], StorageAdapter>>;
  /** Folder holding the built web app; omitted in API-only tests. */
  staticDir?: string;
  /** Per-launch secret every API call must carry (NFR-5). */
  token: string;
}

export const TOKEN_HEADER = "x-dep-tracker-token";

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

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object") throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object");
  }
}

function parseDescriptor(value: unknown): StorageDescriptor {
  const storage = value as Partial<StorageDescriptor> | undefined;
  if (!storage || typeof storage.kind !== "string") throw new HttpError(422, "Body must include storage.kind");
  if (typeof storage.path !== "string" || !storage.path.trim()) throw new HttpError(422, "Body must include storage.path");
  return { ...storage, path: storage.path.trim() } as StorageDescriptor;
}

/** Map domain and storage errors to HTTP statuses. */
function toHttp(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof VersionConflictError || error instanceof ProjectExistsError) return new HttpError(409, error.message);
  return new HttpError(422, (error as Error).message);
}

interface OpenProject {
  descriptor: StorageDescriptor;
  adapter: StorageAdapter;
}

export function createApp(options: AppOptions): Server {
  /** Projects opened in this server session, by project id. */
  const registry = new Map<string, OpenProject>();

  const adapterFor = (descriptor: StorageDescriptor): StorageAdapter => {
    const adapter = options.adapters[descriptor.kind];
    if (!adapter) throw new HttpError(422, `Storage kind "${descriptor.kind}" is not supported yet`);
    return adapter;
  };

  const opened = (descriptor: StorageDescriptor, loaded: LoadedProject) => {
    registry.set(loaded.project.id, { descriptor, adapter: adapterFor(descriptor) });
    return { storage: descriptor, ...loaded, schedule: schedule(loaded.project) };
  };

  const registered = (id: string): OpenProject => {
    const entry = registry.get(id);
    if (!entry) throw new HttpError(404, `Project "${id}" is not open. Open it from the start screen first.`);
    return entry;
  };

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const route = `${req.method} ${url.pathname}`;
    if (route === "GET /api/health") return sendJson(res, 200, { ok: true });
    if (req.headers[TOKEN_HEADER] !== options.token) throw new HttpError(401, "Missing or wrong API token");

    if (route === "POST /api/projects/open") {
      const descriptor = parseDescriptor((await readJson(req)).storage);
      const adapter = adapterFor(descriptor);
      const loaded = await adapter.load(descriptor).catch((e) => Promise.reject(toHttp(e)));
      return sendJson(res, 200, opened(descriptor, loaded));
    }

    if (route === "POST /api/projects") {
      const body = await readJson(req);
      const descriptor = parseDescriptor(body.storage);
      const adapter = adapterFor(descriptor);
      const root = (body.root ?? {}) as { title?: unknown; workTime?: unknown };
      const start = typeof body.start === "string" ? Date.parse(body.start) : NaN;
      if (typeof body.name !== "string" || !body.name.trim()) throw new HttpError(422, "A project needs a name");
      if (Number.isNaN(start)) throw new HttpError(422, "A project needs a valid start date-time");
      const rootId = newId();
      let project: Project = {
        id: newId().replace(/^n/, "p"),
        name: body.name.trim(),
        start: new Date(start).toISOString(),
        rootId,
        nodes: [],
        edges: [],
      };
      try {
        project = applyCommands(project, [
          {
            type: "addNode",
            node: { id: rootId, title: String(root.title ?? ""), workTime: String(root.workTime ?? ""), labels: [], description: "", links: [] },
          },
        ]);
        const version = await adapter.create(descriptor, project);
        return sendJson(res, 201, opened(descriptor, { project, version }));
      } catch (error) {
        throw toHttp(error);
      }
    }

    if (route === "POST /api/projects/import") {
      const body = await readJson(req);
      const source = parseDescriptor(body.source);
      const target = parseDescriptor(body.target);
      try {
        const { project } = await adapterFor(source).load(source);
        const version = await adapterFor(target).create(target, project);
        return sendJson(res, 201, opened(target, { project, version }));
      } catch (error) {
        throw toHttp(error);
      }
    }

    const match = /^\/api\/projects\/([^/]+)(\/commands|\/version|\/export)?$/.exec(url.pathname);
    if (match) {
      const id = decodeURIComponent(match[1]!);
      const { descriptor, adapter } = registered(id);
      try {
        if (req.method === "GET" && !match[2]) return sendJson(res, 200, opened(descriptor, await adapter.load(descriptor)));
        if (req.method === "GET" && match[2] === "/version") return sendJson(res, 200, { version: await adapter.version(descriptor) });
        if (req.method === "POST" && match[2] === "/export") {
          // Writes a copy; the open project stays where it is.
          const target = parseDescriptor((await readJson(req)).storage);
          const { project } = await adapter.load(descriptor);
          const version = await adapterFor(target).create(target, project);
          return sendJson(res, 201, { storage: target, version });
        }
        if (req.method === "POST" && match[2] === "/commands") {
          const body = await readJson(req);
          if (typeof body.expectedVersion !== "string" || !Array.isArray(body.commands)) {
            throw new HttpError(422, "Body must include expectedVersion and commands");
          }
          const current = await adapter.load(descriptor);
          if (current.version !== body.expectedVersion) throw new VersionConflictError();
          const project = applyCommands(current.project, body.commands as Command[]);
          const version = await adapter.save(descriptor, project, current.version);
          return sendJson(res, 200, opened(descriptor, { project, version }));
        }
      } catch (error) {
        if (error instanceof CommandError) throw new HttpError(422, error.message);
        throw toHttp(error);
      }
    }

    throw new HttpError(404, `No route for ${route}`);
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
    let body: Buffer | string = await readFile(file).catch(() => {
      throw new HttpError(404, "Not found");
    });
    if (path.basename(file) === "index.html") {
      body = body
        .toString("utf8")
        .replace("</head>", `<meta name="dep-tracker-token" content="${options.token}"></head>`);
    }
    res.writeHead(200, {
      "content-type": CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(body);
  }

  return createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
      if (req.method === "GET" && options.staticDir) return await serveStatic(res, url, options.staticDir);
      throw new HttpError(404, "Not found");
    } catch (error) {
      const http = error instanceof HttpError ? error : null;
      if (!http) console.error(error);
      if (!res.headersSent) sendJson(res, http?.status ?? 500, { error: (error as Error).message });
      else res.end();
    }
  });
}

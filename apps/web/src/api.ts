import type { LoadedProject, Schedule, StorageDescriptor } from "@dep-tracker/domain";

export interface OpenedProject extends LoadedProject {
  storage: StorageDescriptor;
  schedule: Schedule;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(url: string, init: RequestInit, fetchFn: typeof fetch): Promise<T> {
  let res: Response;
  try {
    res = await fetchFn(url, init);
  } catch {
    throw new ApiError("Could not reach the dep-tracker server. Is it running?", 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export function openProject(storage: StorageDescriptor, fetchFn: typeof fetch = fetch): Promise<OpenedProject> {
  return request<OpenedProject>(
    "/api/projects/open",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ storage }) },
    fetchFn,
  );
}

/** Small fetch wrapper for our /api routes. Returns data, or the route's `{ error: { code, message } }`. */
export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method: init.method ?? "GET",
      headers: init.body === undefined ? undefined : { "content-type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      credentials: "same-origin",
    });
    if (res.status === 204) return { ok: true, data: undefined as T };
    const json = (await res.json().catch(() => null)) as { error?: { code: string; message: string } } | null;
    if (!res.ok || json?.error) {
      return { ok: false, code: json?.error?.code ?? "internal_error", message: json?.error?.message ?? "Something went wrong. Try again." };
    }
    return { ok: true, data: json as T };
  } catch {
    return { ok: false, code: "network", message: "Couldn't reach Mendwell. Check your connection and try again." };
  }
}

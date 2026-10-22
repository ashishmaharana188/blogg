/**
 * Remove the retired Set Breakdown option from the exercise metric controls,
 * including configurations saved before this option was retired. Keep this
 * compatibility layer scoped to the three public/admin exercise metric APIs.
 */
const guard = window as Window & { __bloggExerciseMetricFilterInstalled?: boolean };

if (!guard.__bloggExerciseMetricFilterInstalled) {
  guard.__bloggExerciseMetricFilterInstalled = true;
  const nativeFetch = window.fetch.bind(window);

  const getRequestUrl = (input: RequestInfo | URL): URL => {
    const raw = typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
    return new URL(raw, window.location.href);
  };

  const isExerciseConfigPath = (pathname: string) =>
    pathname.replace(/\/+$/, "").endsWith("/api/health/exercises/admin/config");
  const isExercisePublicPath = (pathname: string) =>
    pathname.replace(/\/+$/, "").endsWith("/api/health/exercises/public");
  const isExerciseAggregatePath = (pathname: string) =>
    pathname.replace(/\/+$/, "").endsWith("/api/health/exercises/public-aggregate");

  function removeLegacySets(payload: Record<string, unknown>): boolean {
    let changed = false;
    if (Array.isArray(payload.selectedMetrics)) {
      const filtered = payload.selectedMetrics.filter((id) => id !== "sets");
      if (filtered.length !== payload.selectedMetrics.length) {
        payload.selectedMetrics = filtered;
        changed = true;
      }
    }
    if (Array.isArray(payload.availableMetrics)) {
      const filtered = payload.availableMetrics.filter((metric) => {
        return !(metric && typeof metric === "object" &&
          (metric as { id?: unknown }).id === "sets");
      });
      if (filtered.length !== payload.availableMetrics.length) {
        payload.availableMetrics = filtered;
        changed = true;
      }
    }
    if (payload.aggregates && typeof payload.aggregates === "object") {
      const aggregates = payload.aggregates as Record<string, unknown>;
      if (Object.prototype.hasOwnProperty.call(aggregates, "sets")) {
        delete aggregates.sets;
        changed = true;
      }
    }
    for (const key of ["latestSession", "recentSessions"]) {
      const candidate = payload[key];
      const sessions = Array.isArray(candidate) ? candidate : candidate ? [candidate] : [];
      for (const session of sessions) {
        if (!session || typeof session !== "object") continue;
        const values = (session as { values?: unknown }).values;
        if (values && typeof values === "object" &&
          Object.prototype.hasOwnProperty.call(values, "sets")) {
          delete (values as Record<string, unknown>).sets;
          changed = true;
        }
      }
    }
    return changed;
  }

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let url: URL | null = null;
    try {
      url = getRequestUrl(input);
    } catch {
      // Leave unusual RequestInfo inputs unchanged.
    }

    let requestInit = init;
    if (url && isExerciseConfigPath(url.pathname)) {
      const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
      if (method === "PUT" && typeof init?.body === "string") {
        try {
          const body = JSON.parse(init.body) as Record<string, unknown>;
          if (Array.isArray(body.selectedMetrics)) {
            requestInit = {
              ...init,
              body: JSON.stringify({
                ...body,
                selectedMetrics: body.selectedMetrics.filter((id) => id !== "sets"),
              }),
            };
          }
        } catch {
          // Let the original request report malformed JSON normally.
        }
      }
    }

    const response = await nativeFetch(input, requestInit);
    if (!url || !response.ok) return response;
    if (!isExerciseConfigPath(url.pathname) &&
        !isExercisePublicPath(url.pathname) &&
        !isExerciseAggregatePath(url.pathname)) return response;

    let payload: unknown;
    try {
      payload = await response.clone().json();
    } catch {
      return response;
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response;
    if (!removeLegacySets(payload as Record<string, unknown>)) return response;

    const headers = new Headers(response.headers);
    headers.delete("content-encoding");
    headers.delete("content-length");
    headers.delete("transfer-encoding");
    return new Response(JSON.stringify(payload), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  };
}

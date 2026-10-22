import { API_BASE_URL } from "../../../services/apiBase";

type PublicReadOptions = {
  /** Skip the admin-session lookup and legacy-note repair for public readers. */
  publicReadOnly?: boolean;
  /** Retry temporary failures while a sleeping hosted backend starts. */
  retryTransientErrors?: boolean;
};

const isRetryableStartupStatus = (status: number) =>
  status === 408 || status === 429 || status >= 500;

/**
 * Retry transient network/5xx failures with bounded exponential backoff.
 * Render free services can take close to a minute to wake up after inactivity.
 * Permanent 4xx responses are returned immediately instead of being retried.
 */
async function fetchWithStartupRetry(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const maxAttempts = 10;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response | null = null;
    try {
      response = await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) throw error;
    }

    if (response) {
      if (
        response.ok ||
        !isRetryableStartupStatus(response.status) ||
        attempt === maxAttempts - 1
      ) {
        return response;
      }
      try {
        await response.body?.cancel();
      } catch {
        // Ignore body cleanup errors; the next attempt is the important part.
      }
    }

    if (attempt < maxAttempts - 1) {
      const delayMs = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise<void>((resolve) => window.setTimeout(resolve, delayMs));
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new Error("The backend is still starting. Please try again.");
}

export async function createStack(payload: {
  stack_name: string;
  stack_id: string;
}) {
  const response = await fetch(`${API_BASE_URL}/stack/stackCreate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not create stack (${response.status})`);
  const result = await response.json();
  return result.stack;
}

export async function createGroup(payload: {
  group_name: string;
  stack_id: string;
  group_id?: string;
}) {
  const response = await fetch(`${API_BASE_URL}/group/groupCreate`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(`Could not create folder (${response.status})`);
  const result = await response.json();
  return result.group ?? result.stack;
}

export async function fetchStackAndGroup(options: PublicReadOptions = {}) {
  // Automatic legacy-note repair is a data mutation, so only run it in the
  // administrator's browser session. Public share/reader routes are read-only
  // and skip this extra API round trip while the backend is waking up.
  if (!options.publicReadOnly) {
    try {
      const sessionResponse = await fetch(`${API_BASE_URL}/api/auth/me`, { credentials: "include" });
      if (sessionResponse.ok) {
        const session = await sessionResponse.json();
        if (session.isAdmin === true || session.user?.isAdmin === true) {
          const repairResponse = await fetch(
            `${API_BASE_URL}/canvas/folderView/repairUngroupedNotes`,
            { credentials: "include" },
          );
          if (!repairResponse.ok) {
            throw new Error(`Could not repair ungrouped notes (${repairResponse.status})`);
          }
        }
      }
    } catch (error) {
      // If session lookup fails, still allow public data viewing; do not attempt
      // the mutating repair without a confirmed administrator session.
      if (error instanceof Error && error.message.startsWith("Could not repair")) throw error;
    }
  }

  const url = `${API_BASE_URL}/stackAndGroup`;
  const response = options.retryTransientErrors
    ? await fetchWithStartupRetry(url)
    : await fetch(url);
  if (!response.ok) throw new Error(`Could not load Folder view (${response.status})`);
  return response.json();
}

export async function renameStackRequest(payload: {
  stack_id: string;
  stack_name: string;
}) {
  const response = await fetch(`${API_BASE_URL}/canvas/stack/stackRename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not rename stack");
  return response.json();
}

export async function renameGroupRequest(payload: {
  group_id: string;
  group_name: string;
}) {
  const response = await fetch(`${API_BASE_URL}/canvas/group/groupRename`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not rename stack");
  return response.json();
}

export async function deleteStackRequest(payload: { stack_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/stack/stackDelete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete stack");
}

export async function deleteGroupRequest(payload: { group_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/group/groupDelete`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not delete folder");
}

export async function fetchBloggByGroupRequest(payload: { group_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/fetchBloggByGroup`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Could not get notes");
  const result = await response.json();
  return result.bloggs ?? [];
}

export async function fetchBloggByIdRequest(
  payload: { blogg_id: string },
  options: Pick<PublicReadOptions, "retryTransientErrors"> = {},
) {
  const url = `${API_BASE_URL}/canvas/blogg/fetchBloggById`;
  const init: RequestInit = {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
  const response = options.retryTransientErrors
    ? await fetchWithStartupRetry(url, init)
    : await fetch(url, init);
  if (!response.ok) throw new Error(`Could not fetch note (${response.status})`);
  const result = await response.json();
  return result.bloggs;
}

export async function deleteBloggRequest(payload: { blogg_id: string }) {
  const response = await fetch(`${API_BASE_URL}/canvas/blogg/deleteBlogg`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || `Could not delete note (${response.status})`);
  }
  return result;
}

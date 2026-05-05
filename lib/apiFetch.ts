function endpointLabel(url: string): string {
  try {
    const path = url.startsWith("http") ? new URL(url).pathname : url.split("?")[0];
    return path || url;
  } catch {
    return url;
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const endpoint = endpointLabel(url);

  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`Network error contacting ${endpoint} — check your connection and try again.`);
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      return undefined as T;
    }
  }

  // Build a non-empty error message. Trim and validate every candidate so we
  // never throw an Error with an empty/whitespace-only message.
  let detail = "";
  try {
    const data = await res.json();
    if (typeof data?.error === "string" && data.error.trim()) {
      detail = data.error.trim();
    } else if (typeof data?.message === "string" && data.message.trim()) {
      detail = data.message.trim();
    }
  } catch {
    try {
      const text = await res.text();
      if (text && text.trim() && !text.trim().startsWith("<")) {
        detail = text.trim();
      }
    } catch {
      // ignore
    }
  }

  const message = detail
    ? `${detail} (${endpoint} ${res.status})`
    : `${endpoint} returned ${res.status}`;
  throw new Error(message);
}

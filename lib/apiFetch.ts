export async function apiFetch<T = unknown>(
  url: string,
  init?: RequestInit
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Network error — check your connection and try again.");
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    try {
      return (await res.json()) as T;
    } catch {
      return undefined as T;
    }
  }

  let message = `Request failed (${res.status})`;
  try {
    const data = await res.json();
    if (data?.error && typeof data.error === "string") {
      message = data.error;
    } else if (data?.message && typeof data.message === "string") {
      message = data.message;
    }
  } catch {
    try {
      const text = await res.text();
      if (text) message = text;
    } catch {
      // keep fallback
    }
  }
  throw new Error(message);
}

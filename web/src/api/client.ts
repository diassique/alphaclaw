const BASE = "";

function withJsonAccept(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  return { ...init, headers };
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, withJsonAccept(init));
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export async function apiRaw(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${BASE}${path}`, withJsonAccept(init));
}

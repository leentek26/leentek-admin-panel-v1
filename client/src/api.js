// Lightweight fetch wrapper — keeps access token in memory and auto-refreshes once.

let accessToken = null;
let refreshPromise = null;

export function setAccessToken(t) {
  accessToken = t;
}
export function getAccessToken() {
  return accessToken;
}

async function refresh() {
  if (refreshPromise) return refreshPromise;
  refreshPromise = fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'include',
  })
    .then(async (r) => {
      if (!r.ok) throw new Error('refresh failed');
      const data = await r.json();
      accessToken = data.accessToken;
      return data.accessToken;
    })
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

export async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let res = await fetch(path, { ...opts, headers, credentials: 'include' });

  if (res.status === 401 && !opts._retried) {
    try {
      await refresh();
      return api(path, { ...opts, _retried: true });
    } catch {
      throw new Error('unauthorized');
    }
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body) });
export const put = (p, body) => api(p, { method: 'PUT', body: JSON.stringify(body) });
export const del = (p) => api(p, { method: 'DELETE' });

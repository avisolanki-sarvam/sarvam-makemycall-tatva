import { API_BASE_URL } from '../constants/api';
import { useAuthStore } from '../stores/authStore';

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE';

interface RequestOptions {
  body?: any;
  auth?: boolean;
}

async function parseResponse(response: Response): Promise<{ data: any; raw: string }> {
  // Some error responses (e.g. FastAPI 500 "Internal Server Error", proxy
  // 502s, CORS preflight failures) return non-JSON. response.json() throws
  // on those with an opaque "Unexpected character" SyntaxError. Read text
  // first and try to parse — fall back to a usable string.
  const raw = await response.text();
  if (!raw) return { data: null, raw: '' };
  try {
    return { data: JSON.parse(raw), raw };
  } catch {
    return { data: null, raw };
  }
}

function extractError(parsed: { data: any; raw: string }, status: number): string {
  // FastAPI uses { detail: ... }, Express used { error: ... }. Cover both.
  const d = parsed.data;
  if (d && typeof d === 'object') {
    if (typeof d.detail === 'string') return d.detail;
    if (Array.isArray(d.detail)) return d.detail.map((x: any) => x?.msg ?? JSON.stringify(x)).join(', ');
    if (typeof d.error === 'string') return d.error;
    if (typeof d.message === 'string') return d.message;
  }
  if (parsed.raw) return parsed.raw.slice(0, 200);
  return `Request failed (${status})`;
}

async function request<T>(method: Method, path: string, options: RequestOptions = {}): Promise<T> {
  const { body, auth = true } = options;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (auth) {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const parsed = await parseResponse(response);

  if (!response.ok) {
    // Try to refresh token on 401
    if (response.status === 401 && auth) {
      const refreshed = await tryRefreshToken();
      if (refreshed) {
        // Retry the request with new token
        headers['Authorization'] = `Bearer ${useAuthStore.getState().accessToken}`;
        const retry = await fetch(`${API_BASE_URL}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const retryParsed = await parseResponse(retry);
        if (!retry.ok) throw new Error(extractError(retryParsed, retry.status));
        return retryParsed.data as T;
      }
      // Refresh failed — log out
      useAuthStore.getState().logout();
    }
    throw new Error(extractError(parsed, response.status));
  }

  return parsed.data as T;
}

async function tryRefreshToken(): Promise<boolean> {
  const { refreshToken } = useAuthStore.getState();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${API_BASE_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    });
    const data = await res.json();
    if (res.ok && data.accessToken) {
      useAuthStore.getState().setAccessToken(data.accessToken);
      return true;
    }
  } catch {}
  return false;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => request<T>('GET', path, options),
  post: <T>(path: string, body?: any, options?: RequestOptions) =>
    request<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: any, options?: RequestOptions) =>
    request<T>('PUT', path, { ...options, body }),
  delete: <T>(path: string, options?: RequestOptions) => request<T>('DELETE', path, options),
};

// Standard backend response envelope (v2): { success, data, warnings, errors }.
// readEnvelope normalises the shape so call sites don't have to repeat the
// "is errors[0]?.hint here, or message, or just nothing?" dance.
export function readEnvelope<T = any>(
  res: any,
): { ok: boolean; data?: T; hint?: string; warnings?: any[] } {
  if (!res || typeof res !== 'object') return { ok: false, hint: 'Unexpected response.' };
  return {
    ok: !!res.success,
    data: res.data,
    hint: res.errors?.[0]?.hint || res.errors?.[0]?.message,
    warnings: res.warnings,
  };
}

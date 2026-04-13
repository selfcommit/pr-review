const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const AUTH_BASE = `${SUPABASE_URL}/functions/v1/github-auth`;

const SESSION_KEY = 'session_token';
const USER_CACHE_KEY = 'github_user';

export function getSessionToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
  localStorage.removeItem(USER_CACHE_KEY);
}

export function getCachedUser(): { id: number; login: string; name: string; avatar_url: string } | null {
  const raw = localStorage.getItem(USER_CACHE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setCachedUser(user: { id: number; login: string; name: string; avatar_url: string }): void {
  localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
}

function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function apiGet<T>(path: string): Promise<T> {
  const resp = await fetch(`${AUTH_BASE}/${path}`, {
    headers: authHeaders(),
  });
  if (resp.status === 401) {
    clearSession();
    window.location.href = '/';
    throw new Error('Session expired');
  }
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data;
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  const resp = await fetch(`${AUTH_BASE}/${path}`, {
    method: 'POST',
    headers: authHeaders(),
    body: body ? JSON.stringify(body) : undefined,
  });
  if (resp.status === 401) {
    clearSession();
    window.location.href = '/';
    throw new Error('Session expired');
  }
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(data.error || `Request failed (${resp.status})`);
  }
  return data;
}

export async function validateSession(): Promise<boolean> {
  const token = getSessionToken();
  if (!token) return false;
  try {
    await apiGet('session');
    return true;
  } catch {
    return false;
  }
}

export async function logout(): Promise<void> {
  try {
    await apiPost('logout');
  } catch {
    // Ignore errors during logout
  }
  clearSession();
}

export async function revokeGrant(): Promise<void> {
  await apiPost('revoke-grant');
  clearSession();
}

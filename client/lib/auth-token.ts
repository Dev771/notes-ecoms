const KEY = 'notes_auth_token';

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(KEY);
}

export function setAuthToken(token: string): void {
  window.localStorage.setItem(KEY, token);
}

export function clearAuthToken(): void {
  window.localStorage.removeItem(KEY);
}

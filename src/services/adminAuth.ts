// Admin auth — soft gate to keep warehouse workers out of management screens.
//
// This is NOT real security. The password is stored on the client side and
// can be read by anyone with browser dev tools. It's a UX gate, not a security
// boundary. If real protection is needed, swap in Microsoft Entra ID auth
// scoped to an "Admins" security group.
//
// Default password is "loadout-admin" — change it via the admin password
// management screen on first launch.

const ADMIN_PASSWORD_KEY = 'loadout.admin.password';
const ADMIN_SESSION_KEY = 'loadout.admin.session';

const DEFAULT_PASSWORD = 'loadout-admin';

// Session lasts until tab close, then must re-enter
const SESSION_TTL_MINUTES = 30;

export function getAdminPassword(): string {
  return localStorage.getItem(ADMIN_PASSWORD_KEY) || DEFAULT_PASSWORD;
}

export function setAdminPassword(newPassword: string): void {
  localStorage.setItem(ADMIN_PASSWORD_KEY, newPassword);
}

export function isAdminPasswordCustomized(): boolean {
  return localStorage.getItem(ADMIN_PASSWORD_KEY) !== null;
}

export function tryAdminLogin(attemptedPassword: string): boolean {
  if (attemptedPassword === getAdminPassword()) {
    sessionStorage.setItem(
      ADMIN_SESSION_KEY,
      JSON.stringify({ authenticatedAt: new Date().toISOString() })
    );
    return true;
  }
  return false;
}

export function isAdminAuthenticated(): boolean {
  const raw = sessionStorage.getItem(ADMIN_SESSION_KEY);
  if (!raw) return false;
  try {
    const { authenticatedAt } = JSON.parse(raw);
    const elapsed = (Date.now() - new Date(authenticatedAt).getTime()) / 1000 / 60;
    return elapsed < SESSION_TTL_MINUTES;
  } catch {
    return false;
  }
}

export function adminLogout(): void {
  sessionStorage.removeItem(ADMIN_SESSION_KEY);
}

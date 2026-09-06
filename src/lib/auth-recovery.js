export const PASSWORD_RECOVERY_MODE = 'password-recovery';
export const PASSWORD_RECOVERY_STORAGE_KEY = 'my-assets:password-recovery-requested-at';
export const PASSWORD_RECOVERY_PATH = '/reset-password';

const PASSWORD_RECOVERY_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export function urlHasPasswordRecoveryIntent(href) {
  try {
    const url = new URL(href);
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    return (
      url.pathname.replace(/\/+$/, '') === PASSWORD_RECOVERY_PATH
      || url.searchParams.get('mode') === PASSWORD_RECOVERY_MODE
      || url.searchParams.get('type') === 'recovery'
      || hashParams.get('type') === 'recovery'
    );
  } catch {
    return false;
  }
}

export function hasPendingPasswordRecovery(storage, now = Date.now()) {
  try {
    const requestedAt = Number(storage?.getItem(PASSWORD_RECOVERY_STORAGE_KEY));
    const age = now - requestedAt;
    if (!requestedAt || !Number.isFinite(age) || age < 0 || age > PASSWORD_RECOVERY_MAX_AGE_MS) {
      storage?.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markPasswordRecoveryPending(storage, now = Date.now()) {
  try {
    storage?.setItem(PASSWORD_RECOVERY_STORAGE_KEY, String(now));
  } catch {
    // URL detection and the Supabase PASSWORD_RECOVERY event remain available.
  }
}

export function clearPasswordRecoveryPending(storage) {
  try {
    storage?.removeItem(PASSWORD_RECOVERY_STORAGE_KEY);
  } catch {
    // Storage can be unavailable in strict privacy modes.
  }
}

export function removePasswordRecoveryMode(href) {
  try {
    const url = new URL(href);
    if (url.pathname.replace(/\/+$/, '') === PASSWORD_RECOVERY_PATH) url.pathname = '/';
    url.searchParams.delete('mode');
    if (url.searchParams.get('type') === 'recovery') url.searchParams.delete('type');
    const hashParams = new URLSearchParams(url.hash.replace(/^#/, ''));
    if (hashParams.get('type') === 'recovery') url.hash = '';
    return url.toString();
  } catch {
    return href;
  }
}

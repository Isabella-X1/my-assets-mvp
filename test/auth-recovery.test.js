import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PASSWORD_RECOVERY_STORAGE_KEY,
  clearPasswordRecoveryPending,
  hasPendingPasswordRecovery,
  markPasswordRecoveryPending,
  removePasswordRecoveryMode,
  urlHasPasswordRecoveryIntent,
} from '../src/lib/auth-recovery.js';

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('password recovery intent is captured from the callback before auth clears it', () => {
  assert.equal(urlHasPasswordRecoveryIntent('http://127.0.0.1:5173/#access_token=x&type=recovery'), true);
  assert.equal(urlHasPasswordRecoveryIntent('http://127.0.0.1:5173/?type=recovery'), true);
  assert.equal(urlHasPasswordRecoveryIntent('http://127.0.0.1:5173/?mode=password-recovery'), true);
  assert.equal(urlHasPasswordRecoveryIntent('http://127.0.0.1:5173/reset-password'), true);
  assert.equal(urlHasPasswordRecoveryIntent('http://127.0.0.1:5173/'), false);
});

test('a recent recovery request survives a new tab but expires automatically', () => {
  const storage = memoryStorage();
  const requestedAt = 1_800_000_000_000;
  markPasswordRecoveryPending(storage, requestedAt);
  assert.equal(storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY), String(requestedAt));
  assert.equal(hasPendingPasswordRecovery(storage, requestedAt + 60_000), true);
  assert.equal(hasPendingPasswordRecovery(storage, requestedAt + 3 * 60 * 60 * 1000), false);
  assert.equal(storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY), null);
});

test('recovery state can be cleared after updating the password', () => {
  const storage = memoryStorage();
  markPasswordRecoveryPending(storage, 1_800_000_000_000);
  clearPasswordRecoveryPending(storage);
  assert.equal(storage.getItem(PASSWORD_RECOVERY_STORAGE_KEY), null);
  assert.equal(
    removePasswordRecoveryMode('http://127.0.0.1:5173/?mode=password-recovery&source=email'),
    'http://127.0.0.1:5173/?source=email',
  );
  assert.equal(
    removePasswordRecoveryMode('http://127.0.0.1:5173/reset-password?type=recovery#type=recovery&access_token=x'),
    'http://127.0.0.1:5173/',
  );
});

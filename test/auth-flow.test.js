import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isAuthenticationError,
  shouldClearRecoveryOnAuthEvent,
  updatePasswordAndEndLocalSession,
} from '../src/lib/auth-flow.js';

test('password change succeeds, signs out, and clears local state in order', async () => {
  const calls = [];
  const password = 'example-password';

  const result = await updatePasswordAndEndLocalSession({
    password,
    updatePassword: async (value) => calls.push(['updatePassword', value]),
    signOut: async () => calls.push(['signOut']),
    clearLocalState: () => calls.push(['clearLocalState']),
  });

  assert.deepEqual(calls, [
    ['updatePassword', password],
    ['signOut'],
    ['clearLocalState'],
  ]);
  assert.equal(result.signOutError, null);
});

test('a failed password update preserves the recovery session for retry', async () => {
  const calls = [];
  const updateError = new Error('update failed');

  await assert.rejects(
    updatePasswordAndEndLocalSession({
      password: 'example-password',
      updatePassword: async () => {
        calls.push('updatePassword');
        throw updateError;
      },
      signOut: async () => calls.push('signOut'),
      clearLocalState: () => calls.push('clearLocalState'),
    }),
    updateError,
  );

  assert.deepEqual(calls, ['updatePassword']);
});

test('a sign-out error does not misreport a successful password change', async () => {
  const calls = [];
  const signOutError = new Error('sign out failed');

  const result = await updatePasswordAndEndLocalSession({
    password: 'example-password',
    updatePassword: async () => calls.push('updatePassword'),
    signOut: async () => {
      calls.push('signOut');
      throw signOutError;
    },
    clearLocalState: () => calls.push('clearLocalState'),
  });

  assert.deepEqual(calls, ['updatePassword', 'signOut', 'clearLocalState']);
  assert.equal(result.signOutError, signOutError);
});

test('only a post-initialization sign-out event clears recovery intent', () => {
  assert.equal(shouldClearRecoveryOnAuthEvent('SIGNED_OUT', false), true);
  assert.equal(shouldClearRecoveryOnAuthEvent('SIGNED_OUT', true), false);
  assert.equal(shouldClearRecoveryOnAuthEvent('INITIAL_SESSION', false), false);
  assert.equal(shouldClearRecoveryOnAuthEvent('PASSWORD_RECOVERY', false), false);
});

test('authentication failures are distinguished from ordinary data errors', () => {
  assert.equal(isAuthenticationError({ status: 401, message: 'request failed' }), true);
  assert.equal(isAuthenticationError({ code: 'PGRST301', message: 'JWT expired' }), true);
  assert.equal(isAuthenticationError(new Error('Auth session missing')), true);
  assert.equal(isAuthenticationError(new Error('duplicate key value')), false);
  assert.equal(isAuthenticationError({ status: 500, message: 'database unavailable' }), false);
});

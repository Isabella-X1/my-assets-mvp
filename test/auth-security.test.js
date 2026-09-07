import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [backendSource, appSource, gitignore, envExample, authConfig] = await Promise.all([
  readFile(new URL('../src/lib/supabase.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../.gitignore', import.meta.url), 'utf8'),
  readFile(new URL('../.env.example', import.meta.url), 'utf8'),
  readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
]);

test('browser auth persists and refreshes the current session', () => {
  assert.match(backendSource, /persistSession:\s*true/);
  assert.match(backendSource, /autoRefreshToken:\s*true/);
  assert.match(backendSource, /detectSessionInUrl:\s*true/);
  assert.match(backendSource, /signInWithPassword/);
  assert.match(backendSource, /onAuthStateChange/);
});

test('sign out only closes the current device session', () => {
  assert.match(backendSource, /signOut\(\{\s*scope:\s*'local'\s*\}\)/);
});

test('unauthenticated visitors are gated by the login screen', () => {
  assert.match(appSource, /state\.session\s*\?\s*renderShell\(\)\s*:\s*renderLogin\(\)/);
  assert.doesNotMatch(appSource, /signUp\s*\(/);
});

test('an authenticated recovery session has a direct password-change fallback', () => {
  assert.match(appSource, /data-action="change-password"/);
  assert.match(appSource, /action === 'change-password'[\s\S]*state\.recoveryMode = true/);
  assert.match(appSource, /password-recovery-form[\s\S]*backend\.updatePassword/);
});

test('only public Supabase browser configuration is documented', () => {
  assert.match(gitignore, /^\.env$/m);
  assert.match(envExample, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(envExample, /service_role|sb_secret_|JWT_SECRET|DATABASE_URL/i);
});

test('auth redirect configuration uses production while retaining local preview origins', () => {
  assert.match(authConfig, /site_url\s*=\s*"https:\/\/isabella-my-assets\.netlify\.app"/);
  assert.match(authConfig, /additional_redirect_urls\s*=\s*\[[^\]]*https:\/\/isabella-my-assets\.netlify\.app/);
  assert.match(authConfig, /https:\/\/isabella-my-assets\.netlify\.app\/reset-password/);
  assert.match(authConfig, /additional_redirect_urls\s*=\s*\[[^\]]*http:\/\/127\.0\.0\.1:5173/);
  assert.match(authConfig, /http:\/\/127\.0\.0\.1:5173\/reset-password/);
});

test('auth listener is registered before the one-time initial session is read', () => {
  const initSource = appSource.slice(appSource.indexOf('async function init()'));
  assert.ok(initSource.indexOf('backend.onAuthStateChange') < initSource.indexOf('await backend.getSession()'));
});

test('public registration is disabled while the email provider stays enabled', () => {
  const signupFlags = [...authConfig.matchAll(/^enable_signup\s*=\s*(true|false)$/gm)];
  assert.equal(signupFlags.length, 2);
  assert.deepEqual(signupFlags.map((match) => match[1]), ['false', 'true']);
});

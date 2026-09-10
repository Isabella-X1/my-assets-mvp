import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, manifestText, serviceWorker, appSource, appStyles, netlifyConfig, icon192, icon512] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/manifest.webmanifest', import.meta.url), 'utf8'),
  readFile(new URL('../src/service-worker.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../netlify.toml', import.meta.url), 'utf8'),
  readFile(new URL('../public/icons/icon-192.png', import.meta.url)),
  readFile(new URL('../public/icons/icon-512.png', import.meta.url)),
]);

const manifest = JSON.parse(manifestText);

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

test('manifest defines an installable standalone app with valid local icons', () => {
  assert.match(html, /rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="apple-touch-icon" href="\/icons\/icon-192\.png"/);
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.icons.length, 2);
  assert.deepEqual(pngDimensions(icon192), { width: 192, height: 192 });
  assert.deepEqual(pngDimensions(icon512), { width: 512, height: 512 });
  assert.ok(manifest.icons.every((icon) => icon.purpose.includes('maskable')));
});

test('service worker precaches only the static shell and claims first-install clients', () => {
  assert.match(serviceWorker, /precacheAndRoute\(self\.__WB_MANIFEST\)/);
  assert.match(serviceWorker, /cleanupOutdatedCaches\(\)/);
  assert.match(serviceWorker, /clientsClaim\(\)/);
  assert.match(serviceWorker, /createHandlerBoundToURL\('index\.html'\)/);
  assert.ok(serviceWorker.includes('rest\\/v1'));
  assert.ok(serviceWorker.includes('auth\\/v1'));
  assert.doesNotMatch(serviceWorker, /CacheFirst|NetworkFirst|StaleWhileRevalidate/);
});

test('app registers the worker with uncached update checks and handles installation', () => {
  assert.match(appSource, /serviceWorker\.register\('\/service-worker\.js',[\s\S]*updateViaCache:\s*'none'/);
  assert.match(appSource, /beforeinstallprompt/);
  assert.match(appSource, /appinstalled/);
  assert.match(appSource, /请点 Safari 分享按钮/);
});

test('an offline cold start gates private data instead of rendering a false zero balance', () => {
  assert.match(appSource, /const page = state\.dataLoaded \?[\s\S]*: renderDataGate\(\)/);
  assert.match(appSource, /offline:\s*\['暂时无法读取',[\s\S]*不会用 0 元代替尚未读取的数据/);
  assert.match(appSource, /if \(!state\.online\) \{[\s\S]*if \(!state\.dataLoaded\) \{[\s\S]*state\.dataStatus = 'offline'/);
});

test('sync indicator never reports a successful state while offline or after an error', () => {
  assert.match(appSource, /if \(!state\.online\) return \{ className: 'offline', label: '当前离线' \}/);
  assert.match(appSource, /if \(state\.dataError\) return \{ className: 'error', label: '同步失败' \}/);
  assert.match(appSource, /if \(!state\.lastSyncedAt\) return \{ className: 'idle', label: '尚未同步' \}/);
  assert.doesNotMatch(appStyles, /\.sync-state span\s*\{\s*display:\s*none/);
});

test('deployment keeps entry metadata fresh and fingerprints long-lived assets', () => {
  assert.match(netlifyConfig, /for = "\/service-worker\.js"[\s\S]*Cache-Control = "no-cache"/);
  assert.match(netlifyConfig, /for = "\/index\.html"[\s\S]*Cache-Control = "no-cache"/);
  assert.match(netlifyConfig, /for = "\/manifest\.webmanifest"[\s\S]*Cache-Control = "no-cache"/);
  assert.match(netlifyConfig, /for = "\/assets\/\*"[\s\S]*immutable/);
});

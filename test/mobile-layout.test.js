import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [html, styles, bootStyles, appSource] = await Promise.all([
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/boot.css', import.meta.url), 'utf8'),
  readFile(new URL('../src/main.js', import.meta.url), 'utf8'),
]);

test('mobile page uses the real viewport without a simulated phone shell', () => {
  assert.match(html, /viewport-fit=cover/);
  assert.doesNotMatch(html, /class=["'][^"']*(?:phone|notch|fake-status)/i);
  assert.match(styles, /100dvh/);
  assert.match(styles, /safe-area-inset-top/);
  assert.match(styles, /safe-area-inset-bottom/);
  assert.match(bootStyles, /safe-area-inset-left/);
});

test('mobile forms remain usable with iOS zoom and the virtual keyboard', () => {
  assert.match(styles, /\.field input,[\s\S]*font-size:\s*16px/);
  assert.match(styles, /scroll-margin-block:\s*88px 132px/);
  assert.match(styles, /:has\(input:focus, select:focus, textarea:focus\) \.bottom-nav/);
  assert.match(styles, /@media \(max-height:\s*700px\)/);
});

test('portfolio return and asset annual rates use unambiguous labels', () => {
  assert.match(appSource, /<span>累计收益率<\/span>/);
  assert.match(appSource, /\['return', '按年化收益率'\]/);
  assert.doesNotMatch(appSource, /<span>收益率<\/span>/);
});

test('modal validation errors render inside the active top-layer dialog', () => {
  assert.match(appSource, /dialog\[open\] \[data-dialog-toast\]/);
  assert.equal((appSource.match(/data-dialog-toast/g) || []).length, 3);
});

test('a pending dialog mutation cannot be closed and reused by another record', () => {
  assert.match(appSource, /function setDialogBusy[\s\S]*toggleAttribute\('inert', busy\)/);
  assert.match(appSource, /addEventListener\('cancel'[\s\S]*event\.preventDefault\(\)/);
  assert.match(appSource, /function closeClosestDialog[\s\S]*hasAttribute\('data-busy'\)[\s\S]*dialog\.close\(\)/);
  assert.match(appSource, /operationGuard\.reset\(\)/);
  assert.match(appSource, /operationGuard\.finish\(operationKey, operationToken\)/);
});

test('timeout readback keeps every mutation form locked without replaying writes', () => {
  const busyFunction = appSource.match(/function setDialogBusy[\s\S]*?\n}\n\nfunction formValues/)?.[0] || '';
  assert.match(busyFunction, /if \(!form\) return/);
  assert.doesNotMatch(busyFunction, /if \(!dialog\) return/);
  assert.match(appSource, /mutateWithReadback\(/);
  assert.match(appSource, /正在核对云端结果…/);
  assert.match(appSource, /Object\.freeze\(assetPayload\(form\)\)/);
  assert.match(appSource, /Object\.freeze\(accountPayload\(form\)\)/);
});

test('a stale asset dialog reports a friendly deletion conflict', () => {
  assert.match(appSource, /if \(!asset\) throw new Error\('资产不存在、已被删除或无权操作/);
});

test('form routing does not read the browser-shadowable form.id property', () => {
  assert.doesNotMatch(appSource, /form\.id/);
  assert.match(appSource, /const formId = formIdentifier\(form\)/);
  assert.match(appSource, /finally \{[\s\S]*setButtonBusy\(submitButton, false\)/);
});

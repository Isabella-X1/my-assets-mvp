import assert from 'node:assert/strict';
import test from 'node:test';

import {
  csvCell,
  daysUntil,
  escapeHtml,
  formatMoney,
  formatPercent,
  isValidDateInput,
  parseLocalDate,
  toMoney,
  toNumber,
} from '../src/lib/formatters.js';

test('money input parser accepts grouped values and rejects invalid values', () => {
  assert.equal(toNumber('200,000.50'), 200000.5);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('not-a-number'), null);
  assert.equal(toNumber('Infinity'), null);
  assert.equal(toNumber('   '), null);
  assert.equal(toNumber(','), null);
});

test('money parser enforces valid grouping and at most two decimals', () => {
  assert.equal(toMoney('200,000.50'), 200000.5);
  assert.equal(toMoney('1,2'), null);
  assert.equal(toMoney('10.123'), null);
  assert.equal(toMoney('  '), null);
});

test('percentage values use percentage points', () => {
  assert.equal(formatPercent(3.05), '3.05%');
  assert.equal(formatPercent(null), '—');
});

test('large BigInt cent totals are formatted without losing a cent', () => {
  assert.equal(formatMoney(9_099_999_999_999_909n), '¥90,999,999,999,999.09');
  assert.equal(formatMoney(-1n), '-¥0.01');
});

test('HTML and CSV output escape user-controlled content', () => {
  assert.equal(escapeHtml('<script>"x"</script>'), '&lt;script&gt;&quot;x&quot;&lt;/script&gt;');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
  assert.equal(csvCell('=HYPERLINK("https://example.com")'), '"\'=HYPERLINK(""https://example.com"")"');
  assert.equal(csvCell('第一行\r第二行'), '"第一行\r第二行"');
});

test('local date parsing does not shift the calendar day', () => {
  const parsed = parseLocalDate('2030-02-03');
  assert.equal(parsed.getFullYear(), 2030);
  assert.equal(parsed.getMonth(), 1);
  assert.equal(parsed.getDate(), 3);
  assert.equal(isValidDateInput('2028-02-29'), true);
  assert.equal(isValidDateInput('2025-02-29'), false);
  assert.equal(parseLocalDate('2025-02-30'), null);
});

test('daysUntil is based on the local calendar day', () => {
  const today = new Date();
  const offset = today.getTimezoneOffset();
  const localToday = new Date(today.getTime() - offset * 60000).toISOString().slice(0, 10);
  assert.equal(daysUntil(localToday), 0);
});

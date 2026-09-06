import assert from 'node:assert/strict';
import test from 'node:test';

import { maturityCounts, maturityStatus, sortByUpcomingMaturity } from '../src/lib/maturity.js';

const today = new Date(2030, 1, 3, 12);
const asset = (maturityDate, reminderDays = 7) => ({
  maturity_date: maturityDate,
  reminder_days: reminderDays,
});

test('maturity status distinguishes missing, expired, today, urgent, and future dates', () => {
  assert.equal(maturityStatus(asset(null), today), 'none');
  assert.equal(maturityStatus(asset('2030-02-02'), today), 'expired');
  assert.equal(maturityStatus(asset('2030-02-03', 0), today), 'urgent');
  assert.equal(maturityStatus(asset('2030-02-10'), today), 'urgent');
  assert.equal(maturityStatus(asset('2030-02-11'), today), 'future');
});

test('upcoming dates sort before history and expired dates stay newest first', () => {
  const records = [
    { name: '较早过期', ...asset('2030-01-01') },
    { name: '较远未来', ...asset('2030-03-01') },
    { name: '最近未来', ...asset('2030-02-04') },
    { name: '最近过期', ...asset('2030-02-02') },
  ];

  records.sort((a, b) => sortByUpcomingMaturity(a, b, today));
  assert.deepEqual(records.map((record) => record.name), [
    '最近未来',
    '较远未来',
    '最近过期',
    '较早过期',
  ]);
});

test('reminder counts exclude distant and dateless assets', () => {
  assert.deepEqual(maturityCounts([
    asset(null),
    asset('2030-02-02'),
    asset('2030-02-03', 0),
    asset('2030-02-10'),
    asset('2030-02-11'),
  ], today), { urgent: 2, expired: 1 });
});

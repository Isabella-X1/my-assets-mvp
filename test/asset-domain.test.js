import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountOptionLabel,
  accountQualifierLabel,
  accountSecondaryLabel,
  assetsWithoutKnownAccount,
  compareMoney,
  normalizeAccountInput,
  normalizeAssetInput,
  moneyTotalsBy,
  moneyToCents,
  portfolioTotals,
  sumMoney,
  upsertById,
} from '../src/lib/asset-domain.js';

test('same-name account options remain distinguishable while retaining their UUID values', () => {
  const accounts = [
    { id: '10000000-0000-4000-8000-000000000001', name: '家庭账户', type: '银行账户' },
    { id: '10000000-0000-4000-8000-000000000002', name: '家庭账户', type: '银行账户' },
  ];

  const first = accountOptionLabel(accounts[0], accounts);
  const second = accountOptionLabel(accounts[1], accounts);

  assert.notEqual(first, second);
  assert.match(first, /编号 000001/);
  assert.match(second, /编号 000002/);
});

test('account labels include useful institution and suffix context', () => {
  const account = {
    id: 'account-a',
    name: '工资卡',
    type: '银行账户',
    institution: '招商银行',
    last_four: '8899',
  };

  assert.equal(accountOptionLabel(account, [account]), '工资卡 · 招商银行 · 尾号 8899');
  assert.equal(accountQualifierLabel(account, [account]), '招商银行 · 尾号 8899');
  assert.equal(accountSecondaryLabel(account, 2), '银行账户 · 招商银行 · 尾号 8899 · 2 项资产');
});

test('same-name accounts use human context before falling back to a UUID suffix', () => {
  const accounts = [
    { id: '10000000-0000-4000-8000-000000000001', name: '同名账户', institution: '银行A', last_four: '1001' },
    { id: '10000000-0000-4000-8000-000000000002', name: '同名账户', institution: '银行B', last_four: '2002' },
  ];

  assert.equal(accountQualifierLabel(accounts[0], accounts), '银行A · 尾号 1001');
  assert.doesNotMatch(accountOptionLabel(accounts[0], accounts), /编号/);
});

function validAsset(overrides = {}) {
  return {
    account_id: 'account-a',
    name: '测试资产',
    type: '现金',
    principal: '0.01',
    current_value: '1000000000000.00',
    annual_rate: '10000',
    start_date: '2028-02-29',
    maturity_date: '2028-02-29',
    reminder_days: '365',
    notes: '',
    ...overrides,
  };
}

test('asset input accepts documented numeric and calendar boundaries', () => {
  const result = normalizeAssetInput(validAsset());
  assert.equal(result.principal, 0.01);
  assert.equal(result.current_value, 1_000_000_000_000);
  assert.equal(result.annual_rate, 10000);
  assert.equal(result.reminder_days, 365);
  assert.equal(result.maturity_date, '2028-02-29');
});

test('asset input rejects invalid money, rates, reminder fractions, and dates', () => {
  for (const [overrides, pattern] of [
    [{ principal: '-1' }, /投入本金/],
    [{ current_value: '1.001' }, /当前金额/],
    [{ current_value: '1000000000000.01' }, /一万亿元/],
    [{ annual_rate: '10000.01' }, /年化收益率/],
    [{ annual_rate: '3,05' }, /年化收益率/],
    [{ annual_rate: '3.1234567' }, /最多保留 6 位小数/],
    [{ annual_rate: 'not-a-rate' }, /年化收益率/],
    [{ reminder_days: '7.5' }, /整数/],
    [{ reminder_days: '1,2' }, /整数/],
    [{ reminder_days: '366' }, /整数/],
    [{ start_date: '2025-02-30' }, /起息日/],
    [{ start_date: '2028-03-01', maturity_date: '2028-02-29' }, /不能早于/],
  ]) {
    assert.throws(() => normalizeAssetInput(validAsset(overrides)), pattern);
  }
});

test('account input trims optional values and validates the four-digit suffix', () => {
  const result = normalizeAccountInput({
    name: ' 工资卡 ',
    type: '银行账户',
    currency: 'CNY',
    institution: ' 招商银行 ',
    last_four: ' 8899 ',
    notes: ' 日常使用 ',
  });

  assert.deepEqual(result, {
    name: '工资卡',
    type: '银行账户',
    currency: 'CNY',
    institution: '招商银行',
    last_four: '8899',
    notes: '日常使用',
  });
  assert.throws(() => normalizeAccountInput({ name: '账户', type: '银行账户', last_four: '123' }), /4 位数字/);
});

test('portfolio money is summed in cents without common floating-point drift', () => {
  assert.equal(sumMoney([0.1, 0.2]), 30n);
  assert.deepEqual(portfolioTotals([
    { principal: 100.1, current_value: 110.2 },
    { principal: 200.2, current_value: 220.4 },
  ]), {
    principal: 30030n,
    current: 33060n,
    gain: 3030n,
    rate: 10.08991,
  });
});

test('portfolio sums remain exact beyond Number.MAX_SAFE_INTEGER cents', () => {
  const values = Array.from({ length: 91 }, () => '999999999999.99');
  assert.equal(sumMoney(values), 9_099_999_999_999_909n);
  assert.equal(moneyToCents('999999999999.99'), 99_999_999_999_999n);
  assert.equal(compareMoney(9_099_999_999_999_909n, 9_099_999_999_999_908n), 1);
});

test('moving an asset changes account subtotals without changing portfolio totals', () => {
  const assets = [
    { id: 'asset-a', account_id: 'account-a', principal: 100, current_value: 120 },
    { id: 'asset-b', account_id: 'account-b', principal: 50, current_value: 60 },
  ];
  const before = portfolioTotals(assets);
  const beforeAccounts = moneyTotalsBy(assets, 'account_id');
  const moved = assets.map((asset) => asset.id === 'asset-a' ? { ...asset, account_id: 'account-b' } : asset);
  const afterAccounts = moneyTotalsBy(moved, 'account_id');

  assert.deepEqual(portfolioTotals(moved), before);
  assert.equal(beforeAccounts.get('account-a'), 12000n);
  assert.equal(beforeAccounts.get('account-b'), 6000n);
  assert.equal(afterAccounts.get('account-a'), undefined);
  assert.equal(afterAccounts.get('account-b'), 18000n);
});

test('assets from a temporarily missing account remain discoverable', () => {
  const accounts = [{ id: 'account-a' }];
  const assets = [
    { id: 'asset-a', account_id: 'account-a' },
    { id: 'asset-b', account_id: 'account-not-yet-read' },
  ];

  assert.deepEqual(assetsWithoutKnownAccount(accounts, assets), [assets[1]]);
});

test('stable UUID retries replace local records instead of duplicating them', () => {
  const original = [{ id: 'record-a', name: '旧名称' }, { id: 'record-b', name: '保留' }];
  const retried = { id: 'record-a', name: '新名称' };

  assert.deepEqual(upsertById(original, retried), [original[1], retried]);
  assert.deepEqual(upsertById(original, retried, { prepend: true }), [retried, original[1]]);
});

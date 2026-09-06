import { isValidDateInput, toMoney } from './formatters.js';

export const MAX_MONEY = 1_000_000_000_000;

const text = (value) => String(value ?? '');
const trimmed = (value) => text(value).trim();

export function moneyToCents(value) {
  if (typeof value === 'bigint') return value;
  let normalized;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0n;
    normalized = value.toFixed(2);
  } else {
    normalized = trimmed(value || '0');
  }

  const match = normalized.match(/^(-?)(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return 0n;
  const cents = (BigInt(match[2]) * 100n) + BigInt((match[3] || '').padEnd(2, '0'));
  return match[1] ? -cents : cents;
}

export function sumMoney(values) {
  return values.reduce((total, value) => total + moneyToCents(value), 0n);
}

export function portfolioTotals(assets) {
  const current = sumMoney(assets.map((asset) => asset.current_value));
  const principal = sumMoney(assets.map((asset) => asset.principal));
  const gain = current - principal;
  const rate = principal > 0n
    ? Number((gain * 100_000_000n) / principal) / 1_000_000
    : 0;
  return { current, principal, gain, rate };
}

export function moneyTotalsBy(assets, field) {
  const grouped = new Map();
  for (const asset of assets) {
    const key = asset[field] ?? '';
    grouped.set(key, sumMoney([grouped.get(key) || 0, asset.current_value]));
  }
  return grouped;
}

export function moneyDifference(left, right) {
  return moneyToCents(left) - moneyToCents(right);
}

export function compareMoney(left, right) {
  const leftCents = moneyToCents(left);
  const rightCents = moneyToCents(right);
  if (leftCents === rightCents) return 0;
  return leftCents < rightCents ? -1 : 1;
}

export function percentageOf(part, total) {
  const partCents = moneyToCents(part);
  const totalCents = moneyToCents(total);
  if (totalCents === 0n) return 0;
  return Number((partCents * 100_000_000n) / totalCents) / 1_000_000;
}

export function assetsWithoutKnownAccount(accounts, assets) {
  const knownIds = new Set(accounts.map((account) => account.id));
  return assets.filter((asset) => !knownIds.has(asset.account_id));
}

export function upsertById(records, saved, { prepend = false } = {}) {
  const remaining = records.filter((record) => record.id !== saved.id);
  return prepend ? [saved, ...remaining] : [...remaining, saved];
}

export function normalizeAssetInput(raw) {
  const name = trimmed(raw.name);
  const type = trimmed(raw.type);
  const accountId = trimmed(raw.account_id);
  const principal = toMoney(raw.principal);
  const currentValue = toMoney(raw.current_value);
  const annualRateText = trimmed(raw.annual_rate);
  const reminderDaysText = trimmed(raw.reminder_days);
  let annualRate = null;
  if (annualRateText) {
    if (!/^(?:\d+(?:\.\d{1,6})?|\.\d{1,6})$/.test(annualRateText)) throw new Error('请输入有效的年化收益率，最多保留 6 位小数。');
    annualRate = Number(annualRateText);
  }
  if (!/^\d+$/.test(reminderDaysText)) throw new Error('提醒天数需要填写 0 到 365 之间的整数。');
  const reminderDays = Number(reminderDaysText);
  const startDate = trimmed(raw.start_date);
  const maturityDate = trimmed(raw.maturity_date);
  const notes = trimmed(raw.notes);

  if (!name) throw new Error('请填写资产名称。');
  if (name.length > 60) throw new Error('资产名称不能超过 60 个字符。');
  if (!type) throw new Error('请选择资产类型。');
  if (type.length > 50) throw new Error('资产类型不能超过 50 个字符。');
  if (!accountId) throw new Error('请选择所属账户。');
  if (principal === null || principal < 0) throw new Error('请输入有效的投入本金。');
  if (currentValue === null || currentValue < 0) throw new Error('请输入有效的当前金额。');
  if (principal > MAX_MONEY || currentValue > MAX_MONEY) throw new Error('单笔金额不能超过一万亿元。');
  if (annualRate !== null && (annualRate < 0 || annualRate > 10000)) throw new Error('请输入有效的年化收益率。');
  if (reminderDays === null || !Number.isInteger(reminderDays) || reminderDays < 0 || reminderDays > 365) {
    throw new Error('提醒天数需要填写 0 到 365 之间的整数。');
  }
  if (startDate && !isValidDateInput(startDate)) throw new Error('请输入有效的起息日。');
  if (maturityDate && !isValidDateInput(maturityDate)) throw new Error('请输入有效的到期日。');
  if (startDate && maturityDate && maturityDate < startDate) throw new Error('到期日不能早于起息日。');
  if (notes.length > 500) throw new Error('资产备注不能超过 500 个字符。');

  return {
    account_id: accountId,
    name,
    type,
    principal,
    current_value: currentValue,
    annual_rate: annualRate,
    start_date: startDate || null,
    maturity_date: maturityDate || null,
    reminder_days: reminderDays,
    notes: notes || null,
  };
}

export function normalizeAccountInput(raw) {
  const name = trimmed(raw.name);
  const type = trimmed(raw.type);
  const currency = trimmed(raw.currency) || 'CNY';
  const institution = trimmed(raw.institution);
  const lastFour = trimmed(raw.last_four);
  const notes = trimmed(raw.notes);

  if (!name) throw new Error('请填写账户名称。');
  if (name.length > 40) throw new Error('账户名称不能超过 40 个字符。');
  if (!type) throw new Error('请选择账户类型。');
  if (type.length > 50) throw new Error('账户类型不能超过 50 个字符。');
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error('请输入有效的三位币种代码。');
  if (institution.length > 60) throw new Error('机构名称不能超过 60 个字符。');
  if (lastFour && !/^\d{4}$/.test(lastFour)) throw new Error('账户末四位需要填写 4 位数字。');
  if (notes.length > 300) throw new Error('账户备注不能超过 300 个字符。');

  return {
    name,
    type,
    currency,
    institution: institution || null,
    last_four: lastFour || null,
    notes: notes || null,
  };
}

export function accountQualifierLabel(account, allAccounts = []) {
  const details = [];
  if (account.institution && account.institution !== account.name) details.push(account.institution);
  if (account.last_four) details.push(`尾号 ${account.last_four}`);

  const duplicateIdentityCount = allAccounts.filter((item) => (
    item.name === account.name
    && (item.institution || '') === (account.institution || '')
    && (item.last_four || '') === (account.last_four || '')
  )).length;
  if (duplicateIdentityCount > 1) details.push(`编号 ${String(account.id).slice(-6)}`);

  return details.join(' · ');
}

export function accountOptionLabel(account, allAccounts = []) {
  const qualifier = accountQualifierLabel(account, allAccounts);

  return qualifier ? `${account.name} · ${qualifier}` : account.name;
}

export function accountSecondaryLabel(account, assetCount) {
  return [
    account.type || '账户',
    account.institution && account.institution !== account.name ? account.institution : null,
    account.last_four ? `尾号 ${account.last_four}` : null,
    `${assetCount} 项资产`,
  ].filter(Boolean).join(' · ');
}

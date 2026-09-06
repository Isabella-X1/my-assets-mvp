const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const compactMoneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
  notation: 'compact',
  maximumFractionDigits: 1,
});

const groupedIntegerFormatter = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 0,
});

function formatMoneyCents(cents, compact) {
  if (compact) {
    const maximumSafeCents = BigInt(Number.MAX_SAFE_INTEGER);
    if (cents >= -maximumSafeCents && cents <= maximumSafeCents) {
      return compactMoneyFormatter.format(Number(cents) / 100);
    }
    return compactMoneyFormatter.format(cents / 100n);
  }

  const negative = cents < 0n;
  const absolute = negative ? -cents : cents;
  const units = absolute / 100n;
  const fraction = String(absolute % 100n).padStart(2, '0');
  return `${negative ? '-' : ''}¥${groupedIntegerFormatter.format(units)}.${fraction}`;
}

export function formatMoney(value, compact = false) {
  if (typeof value === 'bigint') return formatMoneyCents(value, compact);
  const number = Number(value || 0);
  return (compact ? compactMoneyFormatter : moneyFormatter).format(Number.isFinite(number) ? number : 0);
}

export function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toFixed(2)}%` : '—';
}

export function formatDate(value, fallback = '未设置') {
  if (!value) return fallback;
  const date = parseLocalDate(value);
  if (!date) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function isValidDateInput(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day
  );
}

export function parseLocalDate(value) {
  if (!isValidDateInput(value)) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function daysUntil(value, today = new Date()) {
  const target = parseLocalDate(value);
  if (!target) return null;
  today = new Date(today);
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86400000);
}

export function maturityLabel(value) {
  const days = daysUntil(value);
  if (days === null) return '无到期日';
  if (days < 0) return `已到期 ${Math.abs(days)} 天`;
  if (days === 0) return '今天到期';
  if (days === 1) return '明天到期';
  return `${days} 天后到期`;
}

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character]);
}

export function toNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const normalized = String(value).trim().replace(/,/g, '');
  if (!normalized || !/^-?(?:\d+(?:\.\d+)?|\.\d+)$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

export function toMoney(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(raw)) return null;
  const number = Number(raw.replaceAll(',', ''));
  return Number.isFinite(number) ? number : null;
}

export function csvCell(value) {
  const string = String(value ?? '');
  const safe = /^\s*[=+\-@]/.test(string) ? `'${string}` : string;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function localDateInputValue(date = new Date()) {
  const offset = date.getTimezoneOffset();
  return new Date(date.getTime() - offset * 60000).toISOString().slice(0, 10);
}

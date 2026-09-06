import { daysUntil } from './formatters.js';

export function maturityStatus(asset, today = new Date()) {
  const days = daysUntil(asset?.maturity_date, today);
  if (days === null) return 'none';
  if (days < 0) return 'expired';
  return days <= Number(asset?.reminder_days ?? 0) ? 'urgent' : 'future';
}

export function sortByUpcomingMaturity(a, b, today = new Date()) {
  const aDays = daysUntil(a?.maturity_date, today);
  const bDays = daysUntil(b?.maturity_date, today);
  const aFuture = aDays !== null && aDays >= 0;
  const bFuture = bDays !== null && bDays >= 0;
  if (aFuture !== bFuture) return aFuture ? -1 : 1;
  if (aFuture) return aDays - bDays;
  if (aDays === null || bDays === null) return aDays === null ? 1 : -1;
  return bDays - aDays;
}

export function maturityCounts(assets, today = new Date()) {
  return assets.reduce((counts, asset) => {
    const status = maturityStatus(asset, today);
    if (status === 'urgent') counts.urgent += 1;
    if (status === 'expired') counts.expired += 1;
    return counts;
  }, { urgent: 0, expired: 0 });
}

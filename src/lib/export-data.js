import { accountOptionLabel } from './asset-domain.js';
import { csvCell } from './formatters.js';

export const CSV_COLUMNS = [
  '资产名称',
  '资产类型',
  '所属账户',
  '投入本金',
  '当前金额',
  '年化收益率%',
  '起息日',
  '到期日',
  '提前提醒天数',
  '备注',
];

export function createCompleteBackup({ accounts, assets, snapshots, exportedAt = new Date() }) {
  const exportedDate = exportedAt instanceof Date ? exportedAt : new Date(exportedAt);
  if (Number.isNaN(exportedDate.getTime())) throw new Error('备份时间无效。');
  return {
    exported_at: exportedDate.toISOString(),
    version: 1,
    accounts,
    assets,
    asset_snapshots: snapshots,
  };
}

export function createAssetsCsv(assets, accounts) {
  const rows = assets.map((asset) => {
    const account = accounts.find((item) => item.id === asset.account_id);
    return [
      asset.name,
      asset.type,
      account ? accountOptionLabel(account, accounts) : '',
      asset.principal,
      asset.current_value,
      asset.annual_rate ?? '',
      asset.start_date ?? '',
      asset.maturity_date ?? '',
      asset.reminder_days,
      asset.notes ?? '',
    ];
  });
  return `\uFEFF${[CSV_COLUMNS, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
}

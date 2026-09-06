const clone = (value) => structuredClone(value);
const id = (prefix) => `${prefix}-${crypto.randomUUID()}`;

function initialDemoData() {
  const now = new Date();
  const isoDate = (daysFromNow) => {
    const date = new Date(now);
    date.setDate(date.getDate() + daysFromNow);
    return date.toISOString().slice(0, 10);
  };
  const accounts = [
    { id: 'demo-account-1', name: '招商银行', type: '银行账户', institution: '招商银行', last_four: '8899', currency: 'CNY', notes: '', is_archived: false, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: 'demo-account-2', name: '长期投资', type: '投资账户', institution: '', last_four: '', currency: 'CNY', notes: '', is_archived: false, created_at: now.toISOString(), updated_at: now.toISOString() },
  ];
  const assets = [
    { id: 'demo-asset-1', account_id: 'demo-account-1', name: '三年期大额存单', type: '定期存款', principal: 200000, current_value: 206100, annual_rate: 3.05, start_date: isoDate(-365), maturity_date: isoDate(28), reminder_days: 7, notes: '', is_archived: false, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: 'demo-asset-2', account_id: 'demo-account-2', name: '宽基指数基金', type: '基金', principal: 120000, current_value: 132580.42, annual_rate: 6.72, start_date: isoDate(-420), maturity_date: null, reminder_days: 7, notes: '长期持有', is_archived: false, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: 'demo-asset-3', account_id: 'demo-account-1', name: '活期余额', type: '现金', principal: 28678, current_value: 28678, annual_rate: 0.2, start_date: isoDate(-90), maturity_date: null, reminder_days: 7, notes: '', is_archived: false, created_at: now.toISOString(), updated_at: now.toISOString() },
  ];
  const snapshots = assets.map((asset, index) => ({
    id: `demo-snapshot-${index + 1}`,
    asset_id: asset.id,
    recorded_on: now.toISOString().slice(0, 10),
    value: asset.current_value,
    principal: asset.principal,
    notes: null,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }));
  return { accounts, assets, snapshots };
}

export function createDemoBackend() {
  let { accounts, assets, snapshots } = initialDemoData();

  return {
    mode: 'demo',
    isConfigured: true,
    async getSession() {
      return { user: { id: 'demo-user', email: 'preview@example.com' } };
    },
    onAuthStateChange() {
      return () => {};
    },
    async signIn() {
      return { user: { id: 'demo-user', email: 'preview@example.com' } };
    },
    async requestPasswordReset() {},
    async updatePassword() {},
    async signOut() {},
    async listAccounts() {
      return clone(accounts);
    },
    async listAssets() {
      return clone(assets);
    },
    async listSnapshots() {
      return clone(snapshots);
    },
    async getAccountById(recordId) {
      return clone(accounts.find((record) => record.id === recordId) || null);
    },
    async getAssetById(recordId) {
      return clone(assets.find((record) => record.id === recordId) || null);
    },
    async createAccount(payload, _ownerId, recordId = id('account')) {
      const existing = accounts.find((record) => record.id === recordId);
      const record = {
        ...existing,
        ...payload,
        id: recordId,
        is_archived: false,
        created_at: existing?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      accounts = existing
        ? accounts.map((item) => item.id === recordId ? record : item)
        : [...accounts, record];
      return clone(record);
    },
    async updateAccount(recordId, payload) {
      if (!accounts.some((record) => record.id === recordId)) throw new Error('账户不存在、已被删除或无权操作，请刷新后重试。');
      accounts = accounts.map((record) => record.id === recordId ? { ...record, ...payload, updated_at: new Date().toISOString() } : record);
      return clone(accounts.find((record) => record.id === recordId));
    },
    async deleteAccount(recordId) {
      if (assets.some((asset) => asset.account_id === recordId)) throw new Error('该账户下仍有资产，请先移动或删除相关资产。');
      if (!accounts.some((record) => record.id === recordId)) throw new Error('账户不存在、已被删除或无权操作，请刷新后重试。');
      accounts = accounts.filter((record) => record.id !== recordId);
    },
    async createAsset(payload, _ownerId, recordId = id('asset')) {
      const previous = assets.find((record) => record.id === recordId);
      const record = {
        ...previous,
        ...payload,
        id: recordId,
        is_archived: false,
        created_at: previous?.created_at || new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      assets = previous
        ? assets.map((item) => item.id === recordId ? record : item)
        : [record, ...assets];
      if (!previous || previous.principal !== record.principal || previous.current_value !== record.current_value) {
        snapshots = [{ id: id('snapshot'), asset_id: record.id, recorded_on: new Date().toISOString().slice(0, 10), value: record.current_value, principal: record.principal, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...snapshots];
      }
      return clone(record);
    },
    async updateAsset(recordId, payload) {
      const previous = assets.find((record) => record.id === recordId);
      if (!previous) throw new Error('资产不存在、已被删除或无权操作，请刷新后重试。');
      assets = assets.map((record) => record.id === recordId ? { ...record, ...payload, updated_at: new Date().toISOString() } : record);
      const updated = assets.find((record) => record.id === recordId);
      if (previous && (previous.principal !== updated.principal || previous.current_value !== updated.current_value)) {
        snapshots = [{ id: id('snapshot'), asset_id: updated.id, recorded_on: new Date().toISOString().slice(0, 10), value: updated.current_value, principal: updated.principal, notes: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }, ...snapshots];
      }
      return clone(updated);
    },
    async deleteAsset(recordId) {
      if (!assets.some((record) => record.id === recordId)) throw new Error('资产不存在、已被删除或无权操作，请刷新后重试。');
      assets = assets.filter((record) => record.id !== recordId);
      snapshots = snapshots.filter((record) => record.asset_id !== recordId);
    },
  };
}

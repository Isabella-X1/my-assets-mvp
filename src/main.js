import './styles.css';
import { createDemoBackend } from './lib/demo-data.js';
import { createSupabaseBackend } from './lib/supabase.js';
import {
  isAuthenticationError,
  shouldClearRecoveryOnAuthEvent,
  updatePasswordAndEndLocalSession,
} from './lib/auth-flow.js';
import { createMutationContextTracker } from './lib/mutation-context.js';
import { mutateWithReadback } from './lib/mutation-reconciliation.js';
import { createOperationGuard, requireOnline } from './lib/operation-guard.js';
import { beginDataSync, canExportCompleteBackup, canExportCurrentData } from './lib/sync-results.js';
import { createAssetsCsv, createCompleteBackup } from './lib/export-data.js';
import { maturityCounts, maturityStatus, sortByUpcomingMaturity } from './lib/maturity.js';
import {
  formIdentifier,
  submissionOperationKey,
  tracksUnsavedChanges,
} from './lib/form-identity.js';
import {
  accountOptionLabel,
  accountQualifierLabel,
  accountSecondaryLabel,
  assetsWithoutKnownAccount,
  compareMoney,
  moneyDifference,
  percentageOf,
  portfolioTotals,
  sumMoney,
  normalizeAccountInput,
  normalizeAssetInput,
  upsertById,
} from './lib/asset-domain.js';
import {
  clearPasswordRecoveryPending,
  hasPendingPasswordRecovery,
  markPasswordRecoveryPending,
  removePasswordRecoveryMode,
  urlHasPasswordRecoveryIntent,
} from './lib/auth-recovery.js';
import {
  daysUntil,
  escapeHtml,
  formatDate,
  formatMoney,
  formatPercent,
  localDateInputValue,
  maturityLabel,
} from './lib/formatters.js';

const app = document.querySelector('#app');
// Capture recovery intent before the Supabase client consumes and clears the
// access-token fragment from the callback URL.
const initialRecoveryMode = (
  urlHasPasswordRecoveryIntent(window.location.href)
  || hasPendingPasswordRecovery(window.localStorage)
);
const useDemoData = import.meta.env.DEV && import.meta.env.VITE_DEMO_MODE === 'true';
const backend = useDemoData ? createDemoBackend() : createSupabaseBackend();
const tabs = [
  { id: 'overview', label: '总览', icon: '⌂' },
  { id: 'assets', label: '资产', icon: '▤' },
  { id: 'add', label: '记一笔', icon: '＋', primary: true },
  { id: 'reminders', label: '到期', icon: '◷' },
  { id: 'profile', label: '我的', icon: '◎' },
];

const state = {
  session: null,
  accounts: [],
  assets: [],
  snapshots: [],
  activeTab: 'overview',
  assetView: 'account',
  loading: true,
  syncing: false,
  syncQueued: false,
  lastSyncedAt: null,
  online: navigator.onLine,
  recoveryMode: initialRecoveryMode,
  dataLoaded: false,
  dataStatus: 'idle',
  dataError: null,
  snapshotError: null,
  snapshotStatus: 'idle',
  formDirty: false,
  renderPending: false,
};

let toastTimer;
let installPrompt;
let syncGeneration = 0;
const mutationContexts = createMutationContextTracker();
const operationGuard = createOperationGuard();

function accountById(id) {
  return state.accounts.find((account) => account.id === id);
}

function totals() {
  return portfolioTotals(state.assets);
}

function typeColor(type) {
  const palette = {
    '定期存款': '#ff9500',
    '活期存款': '#ffd60a',
    '现金': '#ffd60a',
    '基金': '#5ac8fa',
    '股票': '#bf5af2',
    '债券': '#64d2ff',
    '保险': '#30d158',
    '其他': '#8e8e93',
  };
  return palette[type] || '#ff9f0a';
}

function groupBy(items, key) {
  return items.reduce((groups, item) => {
    const name = key(item) || '未分类';
    if (!groups[name]) groups[name] = [];
    groups[name].push(item);
    return groups;
  }, {});
}

function updatedTime() {
  if (!state.lastSyncedAt) return '尚未同步';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(state.lastSyncedAt);
}

function invalidateSync() {
  syncGeneration += 1;
  state.syncing = false;
  state.syncQueued = false;
}

function clearUserData() {
  mutationContexts.invalidate();
  operationGuard.reset();
  invalidateSync();
  state.accounts = [];
  state.assets = [];
  state.snapshots = [];
  state.dataLoaded = false;
  state.dataStatus = 'idle';
  state.dataError = null;
  state.snapshotError = null;
  state.snapshotStatus = 'idle';
  state.lastSyncedAt = null;
  state.formDirty = false;
  state.renderPending = false;
}

function captureMutationContext() {
  return mutationContexts.capture(state.session?.user?.id);
}

function isMutationContextCurrent(context) {
  return mutationContexts.isCurrent(context, state.session?.user?.id);
}

function clearPasswordRecoveryState() {
  clearPasswordRecoveryPending(window.localStorage);
  const cleanUrl = removePasswordRecoveryMode(window.location.href);
  if (cleanUrl !== window.location.href) {
    window.history.replaceState(window.history.state, '', cleanUrl);
  }
}

function hasTransientUi() {
  return state.formDirty || Boolean(document.querySelector('dialog[open]'));
}

function updateLiveStatus() {
  const syncState = document.querySelector('.sync-state');
  if (syncState) {
    const dot = syncState.querySelector('i');
    const label = syncState.querySelector('span');
    dot?.classList.toggle('syncing', state.syncing);
    if (label) label.textContent = state.syncing ? '正在同步' : `上次同步 ${updatedTime()}`;
  }
  document.querySelectorAll('[data-action="refresh"]').forEach((button) => {
    button.disabled = state.syncing || !state.online;
  });
}

function renderOrDefer() {
  if (hasTransientUi()) {
    state.renderPending = true;
    updateLiveStatus();
    return;
  }
  state.renderPending = false;
  render();
}

function focusPageHeading() {
  requestAnimationFrame(() => {
    const heading = document.querySelector('.page h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1');
    heading.focus({ preventScroll: true });
  });
}

function emptyState(title, description, action = '') {
  return `
    <div class="empty-state">
      <div class="empty-symbol">◇</div>
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      ${action}
    </div>
  `;
}

function renderConfigScreen() {
  return `
    <main class="center-screen">
      <section class="auth-card setup-card">
        <div class="brand-mark">资</div>
        <p class="eyebrow">MY ASSETS · SETUP</p>
        <h1>还差一步即可连接数据</h1>
        <p class="auth-copy">应用界面已经就绪。请在部署环境中配置 Supabase 项目地址和公开匿名密钥，然后重新构建。</p>
        <div class="setup-list">
          <code>VITE_SUPABASE_URL</code>
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code>
        </div>
        <p class="fine-print">数据库初始化脚本位于 <code>supabase/migrations</code>。不要把 secret/service role 管理密钥放进网页。</p>
      </section>
    </main>
  `;
}

function renderLogin() {
  return `
    <main class="center-screen auth-screen">
      <section class="auth-card">
        <div class="brand-mark">资</div>
        <p class="eyebrow">PRIVATE ASSET LEDGER</p>
        <h1>欢迎回来</h1>
        <p class="auth-copy">登录后查看你的账户、资产和到期安排。</p>
        <form id="login-form" class="auth-form">
          <label class="field">
            <span>邮箱</span>
            <input type="email" name="email" autocomplete="username" required placeholder="name@example.com" />
          </label>
          <label class="field">
            <span>密码</span>
            <input type="password" name="password" autocomplete="current-password" minlength="8" required placeholder="请输入密码" />
          </label>
          <button class="button primary full" type="submit">安全登录</button>
          <button class="text-button" type="button" data-action="reset-password">忘记密码</button>
        </form>
        <p class="fine-print">当前为邀请制，不开放公开注册。</p>
      </section>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    </main>
  `;
}

function renderPasswordRecovery() {
  return `
    <main class="center-screen auth-screen">
      <section class="auth-card">
        <div class="brand-mark">资</div>
        <p class="eyebrow">SECURE ACCOUNT</p>
        <h1>设置新密码</h1>
        <p class="auth-copy">请输入至少 8 位的新密码。保存后将返回登录页，请用新密码重新登录。</p>
        <form id="password-recovery-form" class="auth-form">
          <label class="field">
            <span>新密码</span>
            <input type="password" name="password" autocomplete="new-password" minlength="8" required />
          </label>
          <label class="field">
            <span>确认新密码</span>
            <input type="password" name="password_confirm" autocomplete="new-password" minlength="8" required />
          </label>
          <button class="button primary full" type="submit">保存新密码</button>
          <button class="text-button" type="button" data-action="cancel-password-change">暂不修改</button>
        </form>
      </section>
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    </main>
  `;
}

function renderOverview() {
  const summary = totals();
  const types = Object.entries(groupBy(state.assets, (asset) => asset.type))
    .map(([name, assets]) => ({ name, total: sumMoney(assets.map((asset) => asset.current_value)), count: assets.length }))
    .sort((a, b) => compareMoney(b.total, a.total));
  const maturities = state.assets
    .filter((asset) => asset.maturity_date)
    .sort(sortByUpcomingMaturity)
    .slice(0, 3);
  const recent = [...state.assets]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 3);

  return `
    <section class="page" aria-labelledby="overview-title">
      <div class="page-intro">
        <div>
          <p class="eyebrow">MY ASSETS</p>
          <h1 id="overview-title">资产总览</h1>
        </div>
        <button class="icon-button sync-button" type="button" data-action="refresh" aria-label="刷新数据" ${state.syncing ? 'disabled' : ''}>↻</button>
      </div>

      <article class="hero-card">
        <div class="hero-topline">
          <span>当前总资产</span>
          <span class="privacy-chip">仅你可见</span>
        </div>
        <div class="hero-value">${formatMoney(summary.current)}</div>
        <div class="hero-metrics">
          <div><span>累计收益</span><strong class="${summary.gain >= 0 ? 'positive' : 'negative'}">${summary.gain >= 0 ? '+' : ''}${formatMoney(summary.gain)}</strong></div>
          <div><span>累计收益率</span><strong class="${summary.rate >= 0 ? 'positive' : 'negative'}">${summary.rate >= 0 ? '+' : ''}${formatPercent(summary.rate)}</strong></div>
          <div><span>资产项目</span><strong>${state.assets.length}</strong></div>
        </div>
      </article>

      ${state.assets.length === 0 ? emptyState('从第一笔资产开始', '录入后，总额、分类和到期安排会自动计算。', '<button class="button primary" data-tab-target="add">添加资产</button>') : `
        <div class="section-heading">
          <div><p class="eyebrow">ALLOCATION</p><h2>资产分布</h2></div>
          <button class="text-button" data-tab-target="assets">查看全部</button>
        </div>
        <article class="panel allocation-panel">
          ${types.map((type) => {
            const percentage = summary.current > 0n ? percentageOf(type.total, summary.current) : 0;
            return `
              <div class="allocation-row">
                <div class="allocation-label"><span class="color-dot" style="--dot:${typeColor(type.name)}"></span><span>${escapeHtml(type.name)}</span><small>${type.count} 项</small></div>
                <div class="allocation-value"><strong>${formatMoney(type.total, true)}</strong><span>${percentage.toFixed(1)}%</span></div>
                <div class="allocation-track"><i style="width:${Math.min(100, percentage)}%;--bar:${typeColor(type.name)}"></i></div>
              </div>
            `;
          }).join('')}
        </article>
      `}

      <div class="section-heading">
        <div><p class="eyebrow">MATURITY</p><h2>近期到期</h2></div>
        <button class="text-button" data-tab-target="reminders">到期日历</button>
      </div>
      <article class="panel compact-list">
        ${maturities.length ? maturities.map(renderMaturityRow).join('') : '<p class="inline-empty">当前没有设置到期日的资产</p>'}
      </article>

      <div class="section-heading">
        <div><p class="eyebrow">RECENT</p><h2>最近录入</h2></div>
      </div>
      <article class="panel compact-list">
        ${recent.length ? recent.map(renderAssetRow).join('') : '<p class="inline-empty">尚未录入资产</p>'}
      </article>
    </section>
  `;
}

function renderMaturityRow(asset) {
  const days = daysUntil(asset.maturity_date);
  const urgent = days !== null && days <= asset.reminder_days;
  return `
    <button class="list-row asset-row" type="button" data-action="edit-asset" data-id="${asset.id}">
      <span class="type-mark" style="--mark:${typeColor(asset.type)}">${escapeHtml(asset.type.slice(0, 1))}</span>
      <span class="row-main"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(accountById(asset.account_id)?.name || '未关联账户')} · ${formatDate(asset.maturity_date)}</small></span>
      <span class="row-side"><strong>${formatMoney(asset.current_value, true)}</strong><small class="${urgent ? 'warning' : ''}">${maturityLabel(asset.maturity_date)}</small></span>
    </button>
  `;
}

function renderAssetRow(asset) {
  const gain = moneyDifference(asset.current_value, asset.principal);
  const account = accountById(asset.account_id);
  const accountLabel = account ? accountOptionLabel(account, state.accounts) : '未关联账户';
  return `
    <button class="list-row asset-row" type="button" data-action="edit-asset" data-id="${asset.id}">
      <span class="type-mark" style="--mark:${typeColor(asset.type)}">${escapeHtml(asset.type.slice(0, 1))}</span>
      <span class="row-main"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(accountLabel)} · ${escapeHtml(asset.type)}</small></span>
      <span class="row-side"><strong>${formatMoney(asset.current_value, true)}</strong><small class="${gain >= 0 ? 'positive' : 'negative'}">${gain >= 0 ? '+' : ''}${formatMoney(gain, true)}</small></span>
    </button>
  `;
}

function renderAssets() {
  const controls = `
    <div class="segmented" role="group" aria-label="资产排列方式">
      ${[
        ['account', '按账户'],
        ['type', '按类型'],
        ['return', '按年化收益率'],
      ].map(([id, label]) => `<button type="button" data-asset-view="${id}" class="${state.assetView === id ? 'active' : ''}" aria-pressed="${state.assetView === id}">${label}</button>`).join('')}
    </div>
  `;

  let content = '';
  if (!state.assets.length) {
    content = emptyState('还没有资产', '添加第一笔记录后会在这里显示。', '<button class="button primary" data-tab-target="add">添加资产</button>');
  } else if (state.assetView === 'account') {
    const accountGroups = state.accounts.map((account) => {
      const assets = state.assets.filter((asset) => asset.account_id === account.id);
      const subtotal = sumMoney(assets.map((asset) => asset.current_value));
      const qualifier = accountQualifierLabel(account, state.accounts);
      return `
        <article class="asset-group">
          <div class="group-heading">
            <div><p>${escapeHtml(account.type || '账户')}</p><h2>${escapeHtml(account.name)}</h2>${qualifier ? `<small class="group-identity">${escapeHtml(qualifier)}</small>` : ''}</div>
            <div><span>${assets.length} 项</span><strong>${formatMoney(subtotal)}</strong></div>
          </div>
          <div class="panel compact-list">${assets.length ? assets.map(renderAssetRow).join('') : '<p class="inline-empty">这个账户暂时没有资产</p>'}</div>
        </article>
      `;
    }).join('');
    const unmatchedAssets = assetsWithoutKnownAccount(state.accounts, state.assets);
    const unmatchedGroup = unmatchedAssets.length ? `
      <article class="asset-group">
        <div class="group-heading">
          <div><p>SYNCING ACCOUNT</p><h2>账户信息同步中</h2></div>
          <div><span>${unmatchedAssets.length} 项</span><strong>${formatMoney(sumMoney(unmatchedAssets.map((asset) => asset.current_value)))}</strong></div>
        </div>
        <div class="panel compact-list">${unmatchedAssets.map(renderAssetRow).join('')}</div>
      </article>
    ` : '';
    content = accountGroups + unmatchedGroup;
  } else if (state.assetView === 'type') {
    content = Object.entries(groupBy(state.assets, (asset) => asset.type))
      .sort(([, a], [, b]) => compareMoney(
        sumMoney(b.map((item) => item.current_value)),
        sumMoney(a.map((item) => item.current_value)),
      ))
      .map(([type, assets]) => `
        <article class="asset-group">
          <div class="group-heading">
            <div><p>ASSET TYPE</p><h2>${escapeHtml(type)}</h2></div>
            <div><span>${assets.length} 项</span><strong>${formatMoney(sumMoney(assets.map((asset) => asset.current_value)))}</strong></div>
          </div>
          <div class="panel compact-list">${assets.map(renderAssetRow).join('')}</div>
        </article>
      `).join('');
  } else {
    content = `<article class="panel compact-list rank-list">${[...state.assets]
      .sort((a, b) => Number(b.annual_rate ?? -Infinity) - Number(a.annual_rate ?? -Infinity))
      .map((asset, index) => `
        <button class="list-row asset-row" type="button" data-action="edit-asset" data-id="${asset.id}">
          <span class="rank">${String(index + 1).padStart(2, '0')}</span>
          <span class="row-main"><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(accountById(asset.account_id)?.name || '未关联账户')}</small></span>
          <span class="row-side"><strong>${formatPercent(asset.annual_rate)}</strong><small>${formatMoney(asset.current_value, true)}</small></span>
        </button>
      `).join('')}</article>`;
  }

  return `
    <section class="page" aria-labelledby="assets-title">
      <div class="page-intro">
        <div><p class="eyebrow">HOLDINGS</p><h1 id="assets-title">我的资产</h1></div>
        <button class="button small" type="button" data-tab-target="add">＋ 添加</button>
      </div>
      ${controls}
      ${content}
    </section>
  `;
}

function accountOptions(selectedId = '') {
  return state.accounts.map((account) => `<option value="${account.id}" ${account.id === selectedId ? 'selected' : ''}>${escapeHtml(accountOptionLabel(account, state.accounts))}</option>`).join('');
}

function newRecordId() {
  return crypto.randomUUID();
}

function typeOptions(selected = '') {
  return ['定期存款', '活期存款', '现金', '基金', '股票', '债券', '保险', '其他']
    .map((type) => `<option value="${type}" ${type === selected ? 'selected' : ''}>${type}</option>`)
    .join('');
}

function renderAdd() {
  const noAccounts = state.accounts.length === 0;
  return `
    <section class="page" aria-labelledby="add-title">
      <div class="page-intro">
        <div><p class="eyebrow">NEW RECORD</p><h1 id="add-title">记一笔资产</h1></div>
      </div>
      ${noAccounts ? `
        <article class="callout"><strong>先创建一个账户</strong><p>资产需要归属到银行、投资或其他账户。</p><button class="button primary" type="button" data-action="new-account">创建账户</button></article>
      ` : `
        <form id="asset-create-form" class="form-panel">
          <input type="hidden" name="record_id" value="${newRecordId()}" />
          <div class="form-section-title"><span>01</span><div><strong>基本信息</strong><small>带 * 的项目为必填</small></div></div>
          <label class="field"><span>资产名称 *</span><input name="name" required maxlength="60" placeholder="例如：三年期大额存单" /></label>
          <div class="form-grid">
            <label class="field"><span>资产类型 *</span><select name="type" required>${typeOptions('定期存款')}</select></label>
            <label class="field"><span>所属账户 *</span><select name="account_id" required>${accountOptions()}</select></label>
          </div>
          <div class="form-section-title"><span>02</span><div><strong>金额与收益</strong><small>金额单位为人民币元</small></div></div>
          <div class="form-grid">
            <label class="field"><span>投入本金 *</span><input name="principal" required inputmode="decimal" placeholder="200000.00" /></label>
            <label class="field"><span>当前金额 *</span><input name="current_value" required inputmode="decimal" placeholder="206100.00" /></label>
          </div>
          <label class="field"><span>年化收益率（%）</span><input name="annual_rate" inputmode="decimal" placeholder="3.05" /></label>
          <div class="form-section-title"><span>03</span><div><strong>日期与提醒</strong><small>到期信息可选填</small></div></div>
          <div class="form-grid">
            <label class="field"><span>起息日</span><input name="start_date" type="date" value="${localDateInputValue()}" /></label>
            <label class="field"><span>到期日</span><input name="maturity_date" type="date" /></label>
          </div>
          <label class="field"><span>提前提醒天数</span><input name="reminder_days" type="number" min="0" max="365" value="7" /></label>
          <label class="field"><span>备注</span><textarea name="notes" maxlength="500" rows="3" placeholder="选填，不要记录网银密码等敏感信息"></textarea></label>
          <button class="button primary full" type="submit">保存资产</button>
        </form>
      `}
    </section>
  `;
}

function renderReminders() {
  const dated = state.assets
    .filter((asset) => asset.maturity_date)
    .sort(sortByUpcomingMaturity);
  const { urgent: urgentCount, expired: expiredCount } = maturityCounts(dated);

  return `
    <section class="page" aria-labelledby="reminders-title">
      <div class="page-intro">
        <div><p class="eyebrow">MATURITY</p><h1 id="reminders-title">到期安排</h1></div>
        <span class="count-badge">${urgentCount} 项近期到期</span>
      </div>
      <article class="callout quiet">
        <strong>应用内提醒已启用</strong>
        <p>这里会根据资产到期日和提前提醒天数自动计算。${expiredCount ? `另有 ${expiredCount} 项已经到期。` : ''}第一版暂不发送系统推送。</p>
      </article>
      <div class="timeline">
        ${dated.length ? dated.map((asset) => {
          const status = maturityStatus(asset);
          return `
            <button class="timeline-item ${status}" type="button" data-action="edit-asset" data-id="${asset.id}">
              <span class="timeline-date"><strong>${String(new Date(`${asset.maturity_date}T00:00:00`).getDate()).padStart(2, '0')}</strong><small>${new Intl.DateTimeFormat('zh-CN', { month: 'short' }).format(new Date(`${asset.maturity_date}T00:00:00`))}</small></span>
              <span class="timeline-line"><i></i></span>
              <span class="timeline-card"><span><strong>${escapeHtml(asset.name)}</strong><small>${escapeHtml(accountById(asset.account_id)?.name || '')}</small></span><span><strong>${formatMoney(asset.current_value, true)}</strong><small>${maturityLabel(asset.maturity_date)}</small></span></span>
            </button>
          `;
        }).join('') : emptyState('暂无到期安排', '编辑资产并设置到期日后，会自动出现在这里。')}
      </div>
    </section>
  `;
}

function renderProfile() {
  return `
    <section class="page" aria-labelledby="profile-title">
      <div class="page-intro">
        <div><p class="eyebrow">PROFILE & DATA</p><h1 id="profile-title">我的</h1></div>
      </div>
      <article class="profile-card">
        <span class="avatar">${escapeHtml((state.session?.user?.email || '我').slice(0, 1).toUpperCase())}</span>
        <div><strong>${escapeHtml(state.session?.user?.email || '')}</strong><small>私人账户 · ${backend.mode === 'demo' ? '预览模式' : '云端同步'}</small></div>
        <span class="status-dot ${state.online ? '' : 'offline'}">${state.online ? '在线' : '离线'}</span>
      </article>

      <div class="section-heading"><div><p class="eyebrow">ACCOUNTS</p><h2>账户管理</h2></div><button class="text-button" type="button" data-action="new-account">＋ 添加账户</button></div>
      <article class="panel compact-list">
        ${state.accounts.length ? state.accounts.map((account) => {
          const assets = state.assets.filter((asset) => asset.account_id === account.id);
          return `
            <div class="list-row account-row">
              <span class="type-mark">账</span>
              <span class="row-main"><strong>${escapeHtml(account.name)}</strong><small>${escapeHtml(accountSecondaryLabel(account, assets.length))}</small></span>
              <span class="row-side"><strong>${formatMoney(sumMoney(assets.map((asset) => asset.current_value)), true)}</strong><span class="row-actions"><button type="button" data-action="edit-account" data-id="${account.id}">编辑</button><button type="button" class="danger-link" data-action="delete-account" data-id="${account.id}">删除</button></span></span>
            </div>
          `;
        }).join('') : '<p class="inline-empty">尚未创建账户</p>'}
      </article>

      <div class="section-heading"><div><p class="eyebrow">DATA SAFETY</p><h2>数据与备份</h2></div></div>
      <article class="settings-list">
        <button type="button" data-action="change-password"><span><strong>修改登录密码</strong><small>设置新的 PWA 登录密码</small></span><i>›</i></button>
        <button type="button" data-action="refresh"><span><strong>立即同步</strong><small>上次同步 ${updatedTime()}</small></span><i>↻</i></button>
        <button type="button" data-action="export-csv"><span><strong>导出 CSV</strong><small>适合用 Excel 打开</small></span><i>↓</i></button>
        <button type="button" data-action="export-json"><span><strong>导出完整备份</strong><small>包含账户、资产和历史记录</small></span><i>↓</i></button>
        <button type="button" data-action="install"><span><strong>安装到手机桌面</strong><small>以独立应用方式打开</small></span><i>＋</i></button>
      </article>

      <button class="button secondary full logout-button" type="button" data-action="sign-out">退出登录</button>
      <p class="privacy-note">请勿在备注中记录银行卡密码、短信验证码或身份证号码。</p>
    </section>
  `;
}

function renderAccountDialog() {
  return `
    <dialog id="account-dialog" class="sheet-dialog" aria-labelledby="account-dialog-title">
      <form id="account-form" method="dialog" class="dialog-card">
        <header><div><p class="eyebrow">ACCOUNT</p><h2 id="account-dialog-title">添加账户</h2></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="关闭">×</button></header>
        <input type="hidden" name="id" />
        <input type="hidden" name="record_id" />
        <label class="field"><span>账户名称 *</span><input name="name" required maxlength="40" placeholder="例如：招商银行" /></label>
        <div class="form-grid">
          <label class="field"><span>账户类型 *</span><select name="type" required><option>银行账户</option><option>投资账户</option><option>现金账户</option><option>保险账户</option><option>其他账户</option></select></label>
          <label class="field"><span>币种</span><select name="currency"><option value="CNY">人民币 CNY</option></select></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>机构名称</span><input name="institution" maxlength="60" placeholder="选填" /></label>
          <label class="field"><span>末四位</span><input name="last_four" maxlength="4" inputmode="numeric" pattern="[0-9]{4}" placeholder="选填，需填 4 位" /></label>
        </div>
        <label class="field"><span>备注</span><textarea name="notes" maxlength="300" rows="2" placeholder="选填"></textarea></label>
        <button class="button primary full" type="submit">保存账户</button>
      </form>
      <div class="toast" data-dialog-toast role="status" aria-live="polite"></div>
    </dialog>
  `;
}

function renderAssetDialog() {
  return `
    <dialog id="asset-dialog" class="sheet-dialog" aria-labelledby="asset-dialog-title">
      <form id="asset-edit-form" method="dialog" class="dialog-card">
        <header><div><p class="eyebrow">EDIT ASSET</p><h2 id="asset-dialog-title">编辑资产</h2></div><button type="button" class="dialog-close" data-action="close-dialog" aria-label="关闭">×</button></header>
        <input type="hidden" name="id" />
        <label class="field"><span>资产名称 *</span><input name="name" required maxlength="60" /></label>
        <div class="form-grid">
          <label class="field"><span>资产类型 *</span><select name="type" required>${typeOptions()}</select></label>
          <label class="field"><span>所属账户 *</span><select name="account_id" required>${accountOptions()}</select></label>
        </div>
        <div class="form-grid">
          <label class="field"><span>投入本金 *</span><input name="principal" required inputmode="decimal" /></label>
          <label class="field"><span>当前金额 *</span><input name="current_value" required inputmode="decimal" /></label>
        </div>
        <label class="field"><span>年化收益率（%）</span><input name="annual_rate" inputmode="decimal" /></label>
        <div class="form-grid">
          <label class="field"><span>起息日</span><input name="start_date" type="date" /></label>
          <label class="field"><span>到期日</span><input name="maturity_date" type="date" /></label>
        </div>
        <label class="field"><span>提前提醒天数</span><input name="reminder_days" type="number" min="0" max="365" /></label>
        <label class="field"><span>备注</span><textarea name="notes" maxlength="500" rows="2"></textarea></label>
        <div class="dialog-actions"><button class="button danger" type="button" data-action="delete-asset">删除资产</button><button class="button primary" type="submit">保存修改</button></div>
      </form>
      <div class="toast" data-dialog-toast role="status" aria-live="polite"></div>
    </dialog>
  `;
}

function renderDataGate() {
  const copy = {
    loading: ['正在读取资产', '正在从云端安全读取你的账户和资产。'],
    offline: ['暂时无法读取', '当前设备离线。首次加载需要联网，应用不会用 0 元代替尚未读取的数据。'],
    error: ['资产读取失败', state.dataError || '无法连接数据服务，请稍后重试。'],
    idle: ['准备同步', '正在准备读取你的私人数据。'],
  }[state.dataStatus] || ['暂时无法读取', '请稍后重试。'];

  return `
    <section class="page data-gate" aria-labelledby="data-gate-title">
      <div class="empty-symbol">${state.dataStatus === 'loading' ? '↻' : '◇'}</div>
      <p class="eyebrow">PRIVATE DATA</p>
      <h1 id="data-gate-title">${escapeHtml(copy[0])}</h1>
      <p>${escapeHtml(copy[1])}</p>
      <div class="gate-actions">
        <button class="button primary" type="button" data-action="refresh" ${!state.online || state.syncing ? 'disabled' : ''}>重新读取</button>
        <button class="button secondary" type="button" data-action="sign-out">退出登录</button>
      </div>
    </section>
  `;
}

function renderStatusBanner() {
  if (!state.online) return '<div class="network-banner">当前离线，修改功能暂不可用</div>';
  if (backend.mode === 'demo') return '<div class="demo-banner">本地预览数据 · 不会保存</div>';
  return '';
}

function renderShell() {
  const statusBanner = renderStatusBanner();
  const page = state.dataLoaded ? {
    overview: renderOverview,
    assets: renderAssets,
    add: renderAdd,
    reminders: renderReminders,
    profile: renderProfile,
  }[state.activeTab]() : renderDataGate();

  return `
    <div class="app-shell${statusBanner ? ' has-status-banner' : ''}">
      ${statusBanner}
      <header class="app-header">
        <a class="wordmark" href="#" data-tab-target="overview" aria-label="返回资产总览"><span>资</span><strong>我的资产</strong></a>
        <div class="sync-state"><i class="${state.syncing ? 'syncing' : ''}"></i><span>${state.syncing ? '正在同步' : `上次同步 ${updatedTime()}`}</span></div>
      </header>
      <main class="app-main">${page}</main>
      ${state.dataLoaded ? `<nav class="bottom-nav" aria-label="主要导航">
        ${tabs.map((tab) => `
          <button type="button" data-tab-target="${tab.id}" class="${state.activeTab === tab.id ? 'active' : ''} ${tab.primary ? 'primary-tab' : ''}" aria-current="${state.activeTab === tab.id ? 'page' : 'false'}">
            <span class="nav-icon">${tab.icon}</span><span>${tab.label}</span>
          </button>
        `).join('')}
      </nav>` : ''}
      ${renderAccountDialog()}
      ${renderAssetDialog()}
      <div id="toast" class="toast" role="status" aria-live="polite"></div>
    </div>
  `;
}

function render() {
  if (state.loading) {
    app.innerHTML = '<div class="boot-screen"><div class="boot-mark">资</div><p>正在读取你的资产…</p></div>';
    return;
  }
  if (!backend.isConfigured) {
    app.innerHTML = renderConfigScreen();
    return;
  }
  if (state.recoveryMode && state.session) {
    app.innerHTML = renderPasswordRecovery();
    return;
  }
  app.innerHTML = state.session ? renderShell() : renderLogin();
}

function showToast(message, tone = 'default') {
  const toast = document.querySelector('dialog[open] [data-dialog-toast]') || document.querySelector('#toast');
  if (!toast) return;
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.dataset.tone = tone;
  toast.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
  toast.classList.add('show');
  toastTimer = setTimeout(() => toast.classList.remove('show'), tone === 'error' ? 6000 : 3200);
}

function friendlyError(error) {
  const message = error?.message || String(error || '未知错误');
  if (isAuthenticationError(error)) return '登录状态已过期，请重新登录。';
  if (/invalid login credentials/i.test(message)) return '邮箱或密码不正确。';
  if (/failed to fetch|networkerror|load failed/i.test(message)) return '网络连接失败，请稍后重试。';
  if (/violates foreign key|still referenced/i.test(message)) return '该账户下仍有资产，请先移动或删除相关资产。';
  if (/row-level security/i.test(message)) return '当前账户没有执行此操作的权限。';
  return message;
}

function handleAuthenticationFailure(error) {
  if (!isAuthenticationError(error)) return false;
  state.session = null;
  state.recoveryMode = false;
  clearPasswordRecoveryState();
  clearUserData();
  render();
  void backend.signOut().catch(() => {});
  queueMicrotask(() => showToast('登录状态已过期，请重新登录。', 'error'));
  return true;
}

async function syncData({ announce = false } = {}) {
  const userId = state.session?.user?.id;
  if (!userId) return;
  if (!state.online) {
    if (!state.dataLoaded) {
      state.dataStatus = 'offline';
      renderOrDefer();
    }
    return;
  }
  if (state.syncing) {
    state.syncQueued = true;
    return;
  }

  const generation = ++syncGeneration;
  state.syncing = true;
  state.dataError = null;
  if (!state.dataLoaded) {
    state.dataStatus = 'loading';
    renderOrDefer();
  } else {
    updateLiveStatus();
  }

  try {
    const requests = beginDataSync(backend, userId);
    const { accounts, assets } = await requests.core;
    if (generation !== syncGeneration || state.session?.user?.id !== userId) return;
    state.accounts = accounts;
    state.assets = assets;
    state.snapshotError = null;
    state.snapshotStatus = 'loading';
    state.dataLoaded = true;
    state.dataStatus = 'ready';
    state.lastSyncedAt = new Date();
    void syncSnapshots(requests.snapshots, { userId, generation });
    if (announce) queueMicrotask(() => showToast('账户与资产已同步', 'success'));
  } catch (error) {
    if (generation !== syncGeneration || state.session?.user?.id !== userId) return;
    state.dataError = friendlyError(error);
    state.dataStatus = state.dataLoaded ? 'ready' : 'error';
    queueMicrotask(() => showToast(state.dataError, 'error'));
  } finally {
    const isCurrentRequest = generation === syncGeneration && state.session?.user?.id === userId;
    if (isCurrentRequest) {
      state.syncing = false;
      const shouldRepeat = state.syncQueued;
      state.syncQueued = false;
      renderOrDefer();
      if (shouldRepeat) queueMicrotask(() => syncData());
    }
  }
}

async function syncSnapshots(snapshotResultPromise, { userId, generation }) {
  const result = await snapshotResultPromise;
  if (generation !== syncGeneration || state.session?.user?.id !== userId) return;

  if (result.status === 'fulfilled') {
    state.snapshots = result.value;
    state.snapshotError = null;
    state.snapshotStatus = 'ready';
  } else {
    state.snapshotError = friendlyError(result.reason);
    state.snapshotStatus = 'error';
    queueMicrotask(() => showToast('账户和资产已读取，但历史记录暂未同步。', 'error'));
  }
  renderOrDefer();
}

function setButtonBusy(button, busy, label = '处理中…') {
  if (!button) return;
  if (busy) {
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.textContent = label;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.originalLabel || button.textContent;
    button.disabled = false;
    delete button.dataset.originalLabel;
  }
}

function setDialogBusy(form, busy) {
  if (!form) return;
  const dialog = form?.closest('dialog');
  dialog?.toggleAttribute('data-busy', busy);
  form.toggleAttribute('inert', busy);
  if (busy) form.setAttribute('aria-busy', 'true');
  else form.removeAttribute('aria-busy');
}

function formValues(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function assetPayload(form) {
  return normalizeAssetInput(formValues(form));
}

function accountPayload(form) {
  return normalizeAccountInput(formValues(form));
}

function trackDialog(dialog) {
  state.formDirty = false;
  const preventBusyCancel = (event) => {
    if (!dialog.hasAttribute('data-busy')) return;
    event.preventDefault();
    showToast('操作正在进行，请稍候。');
  };
  dialog.addEventListener('cancel', preventBusyCancel);
  dialog.addEventListener('close', () => {
    dialog.removeEventListener('cancel', preventBusyCancel);
    state.formDirty = false;
    if (state.renderPending) render();
  }, { once: true });
}

function openAccountDialog(id = '') {
  const dialog = document.querySelector('#account-dialog');
  const form = dialog?.querySelector('form');
  if (!dialog || !form) return;
  form.reset();
  form.elements.id.value = id;
  form.elements.record_id.value = id ? '' : newRecordId();
  document.querySelector('#account-dialog-title').textContent = id ? '编辑账户' : '添加账户';
  if (id) {
    const account = accountById(id);
    if (!account) return;
    for (const field of ['name', 'type', 'currency', 'institution', 'last_four', 'notes']) {
      if (form.elements[field]) form.elements[field].value = account[field] ?? '';
    }
  }
  trackDialog(dialog);
  dialog.showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

function openAssetDialog(id) {
  const asset = state.assets.find((record) => record.id === id);
  const dialog = document.querySelector('#asset-dialog');
  const form = dialog?.querySelector('form');
  if (!asset || !dialog || !form) return;
  form.reset();
  for (const field of ['id', 'name', 'type', 'account_id', 'principal', 'current_value', 'annual_rate', 'start_date', 'maturity_date', 'reminder_days', 'notes']) {
    if (form.elements[field]) form.elements[field].value = asset[field] ?? '';
  }
  trackDialog(dialog);
  dialog.showModal();
  requestAnimationFrame(() => form.elements.name.focus());
}

function closeClosestDialog(target) {
  const dialog = target.closest('dialog');
  if (!dialog) return;
  if (dialog.hasAttribute('data-busy')) {
    showToast('操作正在进行，请稍候。');
    return;
  }
  dialog.close();
}

function downloadFile(filename, contents, type) {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportJson() {
  if (!canExportCompleteBackup(state)) {
    const message = state.snapshotStatus === 'error' || state.dataError
      ? '云端数据尚未完整同步，暂不能导出完整备份。'
      : '历史记录正在同步，请稍后再导出。';
    showToast(message, 'error');
    return;
  }
  const payload = createCompleteBackup({
    accounts: state.accounts,
    assets: state.assets,
    snapshots: state.snapshots,
  });
  downloadFile(`我的资产备份-${localDateInputValue()}.json`, JSON.stringify(payload, null, 2), 'application/json;charset=utf-8');
  showToast('完整备份已导出', 'success');
}

function exportCsv() {
  if (!canExportCurrentData(state)) {
    showToast('账户与资产正在同步或读取失败，暂不能导出 CSV。', 'error');
    return;
  }
  const csv = createAssetsCsv(state.assets, state.accounts);
  downloadFile(`我的资产-${localDateInputValue()}.csv`, csv, 'text/csv;charset=utf-8');
  showToast('CSV 已导出', 'success');
}

async function handleInstall() {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
  showToast(isIos ? '请点 Safari 分享按钮，再选择“添加到主屏幕”。' : '请使用浏览器菜单中的“安装应用”或“添加到主屏幕”。');
}

async function handleClick(event) {
  const tabButton = event.target.closest('[data-tab-target]');
  if (tabButton) {
    event.preventDefault();
    const nextTab = tabButton.dataset.tabTarget;
    if (state.formDirty && state.activeTab === 'add' && nextTab !== 'add') {
      if (!window.confirm('当前填写的内容尚未保存，确定离开吗？')) return;
      state.formDirty = false;
    }
    state.activeTab = nextTab;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    render();
    focusPageHeading();
    return;
  }

  const viewButton = event.target.closest('[data-asset-view]');
  if (viewButton) {
    state.assetView = viewButton.dataset.assetView;
    render();
    return;
  }

  const actionButton = event.target.closest('[data-action]');
  if (!actionButton) return;
  const { action, id } = actionButton.dataset;

  let mutationContext = null;
  let operationKey = null;
  let operationToken = null;
  let pendingDialogForm = null;
  try {
    if (action === 'refresh') await syncData({ announce: true });
    if (action === 'new-account') openAccountDialog();
    if (action === 'edit-account') openAccountDialog(id);
    if (action === 'edit-asset') openAssetDialog(id);
    if (action === 'close-dialog') closeClosestDialog(actionButton);
    if (action === 'export-json') exportJson();
    if (action === 'export-csv') exportCsv();
    if (action === 'install') await handleInstall();
    if (action === 'change-password') {
      state.recoveryMode = true;
      markPasswordRecoveryPending(window.localStorage);
      window.history.replaceState(window.history.state, '', '/reset-password');
      render();
      requestAnimationFrame(() => document.querySelector('#password-recovery-form input')?.focus());
    }
    if (action === 'cancel-password-change') {
      state.recoveryMode = false;
      clearPasswordRecoveryState();
      render();
      if (state.session && !state.dataLoaded) void syncData();
    }
    if (action === 'sign-out') {
      setButtonBusy(actionButton, true, '正在退出…');
      await backend.signOut();
      state.session = null;
      state.recoveryMode = false;
      clearPasswordRecoveryState();
      clearUserData();
      render();
    }
    if (action === 'reset-password') {
      const email = document.querySelector('#login-form input[name="email"]')?.value.trim();
      if (!email) throw new Error('请先填写邮箱地址。');
      setButtonBusy(actionButton, true, '正在发送…');
      markPasswordRecoveryPending(window.localStorage);
      try {
        await backend.requestPasswordReset(email);
      } catch (error) {
        clearPasswordRecoveryPending(window.localStorage);
        throw error;
      }
      showToast('重置邮件已发送，请检查邮箱。', 'success');
      setButtonBusy(actionButton, false);
    }
    if (action === 'delete-account') {
      requireOnline(state.online);
      const account = accountById(id);
      if (!account) throw new Error('账户不存在、已被删除或无权操作，请刷新后重试。');
      const assetCount = state.assets.filter((asset) => asset.account_id === id).length;
      if (assetCount) throw new Error(`“${account?.name || '该账户'}”下还有 ${assetCount} 项资产，请先移动或删除。`);
      if (!window.confirm(`确定删除账户“${account?.name || ''}”吗？`)) return;
      operationKey = `account:${id}`;
      operationToken = operationGuard.tryStart(operationKey);
      if (!operationToken) return;
      mutationContext = captureMutationContext();
      setButtonBusy(actionButton, true);
      const deletion = await mutateWithReadback({
        operation: 'delete',
        id,
        ownerId: mutationContext.userId,
        targetKnown: true,
        write: () => backend.deleteAccount(id, mutationContext.userId),
        read: () => backend.getAccountById(id, mutationContext.userId),
        isContextCurrent: () => isMutationContextCurrent(mutationContext),
        onVerifying: () => setButtonBusy(actionButton, true, '正在核对云端结果…'),
      });
      if (!isMutationContextCurrent(mutationContext)) return;
      invalidateSync();
      state.accounts = state.accounts.filter((record) => record.id !== id);
      render();
      void syncData();
      queueMicrotask(() => showToast(deletion.recovered ? '响应超时，但已确认账户删除成功' : '账户已删除', 'success'));
    }
    if (action === 'delete-asset') {
      requireOnline(state.online);
      const form = actionButton.closest('form');
      const asset = state.assets.find((record) => record.id === form.elements.id.value);
      if (!asset) throw new Error('资产不存在、已被删除或无权操作，请刷新后重试。');
      if (!window.confirm(`确定删除资产“${asset?.name || ''}”吗？`)) return;
      operationKey = `asset:${asset.id}`;
      operationToken = operationGuard.tryStart(operationKey);
      if (!operationToken) return;
      mutationContext = captureMutationContext();
      setButtonBusy(actionButton, true);
      pendingDialogForm = form;
      setDialogBusy(form, true);
      const deletion = await mutateWithReadback({
        operation: 'delete',
        id: asset.id,
        ownerId: mutationContext.userId,
        targetKnown: true,
        write: () => backend.deleteAsset(asset.id, mutationContext.userId),
        read: () => backend.getAssetById(asset.id, mutationContext.userId),
        isContextCurrent: () => isMutationContextCurrent(mutationContext),
        onVerifying: () => setButtonBusy(actionButton, true, '正在核对云端结果…'),
      });
      if (!isMutationContextCurrent(mutationContext)) return;
      invalidateSync();
      state.assets = state.assets.filter((record) => record.id !== asset.id);
      state.snapshots = state.snapshots.filter((record) => record.asset_id !== asset.id);
      state.formDirty = false;
      form.closest('dialog').close();
      render();
      void syncData();
      queueMicrotask(() => showToast(deletion.recovered ? '响应超时，但已确认资产删除成功' : '资产已删除', 'success'));
    }
  } catch (error) {
    if (mutationContext && !isMutationContextCurrent(mutationContext)) return;
    if (handleAuthenticationFailure(error)) return;
    setButtonBusy(actionButton, false);
    showToast(friendlyError(error), 'error');
  } finally {
    setDialogBusy(pendingDialogForm, false);
    if (operationKey && operationToken) operationGuard.finish(operationKey, operationToken);
  }
}

async function handleSubmit(event) {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;
  event.preventDefault();
  const formId = formIdentifier(form);
  const submitButton = form.querySelector('[type="submit"]');
  const operationKey = submissionOperationKey(form);
  const operationToken = operationGuard.tryStart(operationKey);
  if (!operationToken) return;

  let mutationContext = null;
  try {
    setButtonBusy(submitButton, true);
    setDialogBusy(form, true);
    if (formId === 'login-form') {
      const values = formValues(form);
      const session = await backend.signIn(values.email.trim(), values.password);
      const changedUser = session?.user?.id !== state.session?.user?.id;
      if (changedUser) clearUserData();
      state.session = session;
      state.recoveryMode = false;
      clearPasswordRecoveryState();
      state.loading = false;
      state.dataStatus = state.online ? 'loading' : 'offline';
      render();
      await syncData();
      return;
    }
    if (formId === 'password-recovery-form') {
      const values = formValues(form);
      if (values.password !== values.password_confirm) throw new Error('两次输入的密码不一致。');
      const { signOutError } = await updatePasswordAndEndLocalSession({
        password: values.password,
        updatePassword: (password) => backend.updatePassword(password),
        signOut: () => backend.signOut(),
        clearLocalState: () => {
          state.recoveryMode = false;
          clearPasswordRecoveryState();
          state.session = null;
          clearUserData();
          render();
        },
      });
      const message = signOutError
        ? '密码已更新，但自动退出确认失败。若刷新后仍为登录状态，请再次退出。'
        : '密码已更新，请使用新密码登录。';
      queueMicrotask(() => showToast(message, signOutError ? 'error' : 'success'));
      return;
    }
    requireOnline(state.online);
    if (formId === 'asset-create-form') {
      const payload = Object.freeze(assetPayload(form));
      const recordId = form.elements.record_id.value;
      mutationContext = captureMutationContext();
      const outcome = await mutateWithReadback({
        operation: 'create',
        id: recordId,
        ownerId: mutationContext.userId,
        expectedPayload: payload,
        write: () => backend.createAsset(payload, mutationContext.userId, recordId),
        read: () => backend.getAssetById(recordId, mutationContext.userId),
        isContextCurrent: () => isMutationContextCurrent(mutationContext),
        onVerifying: () => setButtonBusy(submitButton, true, '正在核对云端结果…'),
      });
      const created = outcome.value;
      if (!isMutationContextCurrent(mutationContext)) return;
      invalidateSync();
      state.assets = upsertById(state.assets, created, { prepend: true });
      state.formDirty = false;
      state.activeTab = 'assets';
      render();
      void syncData();
      queueMicrotask(() => showToast(outcome.recovered ? '响应超时，但已确认资产保存成功' : '资产已保存', 'success'));
      return;
    }
    if (formId === 'asset-edit-form') {
      const id = form.elements.id.value;
      const payload = Object.freeze(assetPayload(form));
      mutationContext = captureMutationContext();
      const outcome = await mutateWithReadback({
        operation: 'update',
        id,
        ownerId: mutationContext.userId,
        expectedPayload: payload,
        write: () => backend.updateAsset(id, payload, mutationContext.userId),
        read: () => backend.getAssetById(id, mutationContext.userId),
        isContextCurrent: () => isMutationContextCurrent(mutationContext),
        onVerifying: () => setButtonBusy(submitButton, true, '正在核对云端结果…'),
      });
      const updated = outcome.value;
      if (!isMutationContextCurrent(mutationContext)) return;
      invalidateSync();
      state.assets = state.assets.map((asset) => asset.id === id ? updated : asset);
      state.formDirty = false;
      form.closest('dialog').close();
      render();
      void syncData();
      queueMicrotask(() => showToast(outcome.recovered ? '响应超时，但已确认资产更新成功' : '资产已更新', 'success'));
      return;
    }
    if (formId === 'account-form') {
      const id = form.elements.id.value;
      const recordId = id || form.elements.record_id.value;
      const payload = Object.freeze(accountPayload(form));
      mutationContext = captureMutationContext();
      const outcome = await mutateWithReadback({
        operation: id ? 'update' : 'create',
        id: recordId,
        ownerId: mutationContext.userId,
        expectedPayload: payload,
        write: () => id
          ? backend.updateAccount(id, payload, mutationContext.userId)
          : backend.createAccount(payload, mutationContext.userId, recordId),
        read: () => backend.getAccountById(recordId, mutationContext.userId),
        isContextCurrent: () => isMutationContextCurrent(mutationContext),
        onVerifying: () => setButtonBusy(submitButton, true, '正在核对云端结果…'),
      });
      const saved = outcome.value;
      if (!isMutationContextCurrent(mutationContext)) return;
      invalidateSync();
      state.accounts = id
        ? state.accounts.map((account) => account.id === id ? saved : account)
        : upsertById(state.accounts, saved);
      state.formDirty = false;
      form.closest('dialog').close();
      render();
      void syncData();
      const successMessage = id ? '账户已更新' : '账户已创建';
      const recoveredMessage = id ? '响应超时，但已确认账户更新成功' : '响应超时，但已确认账户创建成功';
      queueMicrotask(() => showToast(outcome.recovered ? recoveredMessage : successMessage, 'success'));
    }
  } catch (error) {
    if (mutationContext && !isMutationContextCurrent(mutationContext)) return;
    if (handleAuthenticationFailure(error)) return;
    showToast(friendlyError(error), 'error');
  } finally {
    setButtonBusy(submitButton, false);
    setDialogBusy(form, false);
    operationGuard.finish(operationKey, operationToken);
  }
}

function handleFormInput(event) {
  const form = event.target.closest('form');
  if (tracksUnsavedChanges(form)) {
    state.formDirty = true;
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return;
  window.addEventListener('load', async () => {
    try {
      const registration = await navigator.serviceWorker.register('/service-worker.js', {
        updateViaCache: 'none',
      });
      registration.addEventListener('updatefound', () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('发现新版本，重新打开应用后生效。');
          }
        });
      });
    } catch {
      // PWA installation remains optional; an unavailable service worker must not block the app.
    }
  });
}

async function init() {
  app.addEventListener('click', handleClick);
  app.addEventListener('submit', handleSubmit);
  app.addEventListener('input', handleFormInput);
  app.addEventListener('change', handleFormInput);
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    showToast('已安装到桌面', 'success');
  });
  window.addEventListener('online', () => {
    state.online = true;
    if (state.session) syncData({ announce: true });
    else renderOrDefer();
  });
  window.addEventListener('offline', () => {
    state.online = false;
    if (!state.dataLoaded) state.dataStatus = 'offline';
    renderOrDefer();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.session && state.online) syncData();
  });
  registerServiceWorker();

  if (!backend.isConfigured) {
    state.loading = false;
    render();
    return;
  }

  let authInitializing = true;
  try {
    backend.onAuthStateChange((event, session) => {
      const previousUserId = state.session?.user?.id;
      const nextUserId = session?.user?.id;
      const changedUser = previousUserId !== nextUserId;
      state.session = session;
      if (event === 'PASSWORD_RECOVERY') {
        state.recoveryMode = true;
        markPasswordRecoveryPending(window.localStorage);
      }
      if (shouldClearRecoveryOnAuthEvent(event, authInitializing)) {
        state.recoveryMode = false;
        clearPasswordRecoveryState();
      }
      if (!session) state.recoveryMode = false;
      if (changedUser) clearUserData();
      if (authInitializing) return;
      if (!session) {
        render();
      } else if (event === 'PASSWORD_RECOVERY') {
        render();
      } else if (changedUser) {
        state.dataStatus = state.online ? 'loading' : 'offline';
        render();
        syncData();
      } else {
        updateLiveStatus();
      }
    });
    state.session = await backend.getSession();
  } catch (error) {
    queueMicrotask(() => showToast(friendlyError(error), 'error'));
  } finally {
    authInitializing = false;
    state.loading = false;
    render();
  }

  if (state.session && !state.recoveryMode) await syncData();
}
init();

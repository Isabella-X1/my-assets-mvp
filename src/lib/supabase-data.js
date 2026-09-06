const ACCOUNT_FIELDS = [
  'name',
  'type',
  'institution',
  'last_four',
  'currency',
  'notes',
  'is_archived',
];

const ASSET_FIELDS = [
  'account_id',
  'name',
  'type',
  'principal',
  'current_value',
  'annual_rate',
  'start_date',
  'maturity_date',
  'reminder_days',
  'notes',
  'is_archived',
];

const ACCOUNT_READ_FIELDS = ['id', 'owner_id', ...ACCOUNT_FIELDS, 'created_at', 'updated_at'].join(',');
const ASSET_READ_FIELDS = ['id', 'owner_id', ...ASSET_FIELDS, 'created_at', 'updated_at'].join(',');

export const DEFAULT_DATA_REQUEST_TIMEOUT_MS = 15_000;
export const DEFAULT_MUTATION_VERIFICATION_TIMEOUT_MS = 5_000;

function dataRequestTimeoutError(kind) {
  const message = kind === 'mutation'
    ? '云端请求超时，操作结果暂未确认。请先刷新核对；若数据未变化，再重新提交。'
    : '云端读取超时，请检查网络后重新读取。';
  const error = new Error(message);
  error.code = 'DATA_REQUEST_TIMEOUT';
  return error;
}

async function executeDataRequest(query, timeoutMs, kind) {
  const controller = new AbortController();
  let timerId;
  const timeout = new Promise((_, reject) => {
    timerId = setTimeout(() => {
      controller.abort();
      reject(dataRequestTimeoutError(kind));
    }, timeoutMs);
  });

  try {
    const request = typeof query?.abortSignal === 'function'
      ? query.abortSignal(controller.signal)
      : query;
    return await Promise.race([Promise.resolve(request), timeout]);
  } catch (error) {
    if (controller.signal.aborted && error?.code !== 'DATA_REQUEST_TIMEOUT') {
      throw dataRequestTimeoutError(kind);
    }
    throw error;
  } finally {
    clearTimeout(timerId);
  }
}

function assertResult(result) {
  if (result.error) throw result.error;
  return result.data;
}

function requireOwnerId(ownerId) {
  if (!ownerId) throw new Error('登录状态已失效，请重新登录。');
  return ownerId;
}

function pickFields(payload, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(payload || {}, field))
      .map((field) => [field, payload[field]]),
  );
}

function requireMutationRow(record, label) {
  if (!record) throw new Error(`${label}不存在、已被删除或无权操作，请刷新后重试。`);
  return record;
}

function cleanAsset(record) {
  if (!record) return record;
  return {
    ...record,
    principal: record.principal === null ? null : Number(record.principal),
    current_value: record.current_value === null ? null : Number(record.current_value),
    annual_rate: record.annual_rate === null ? null : Number(record.annual_rate),
  };
}

function cleanSnapshot(record) {
  if (!record) return record;
  return {
    ...record,
    value: record.value === null ? null : Number(record.value),
    principal: record.principal === null ? null : Number(record.principal),
  };
}

export function createSupabaseDataBackend(
  client,
  {
    requestTimeoutMs = DEFAULT_DATA_REQUEST_TIMEOUT_MS,
    verificationTimeoutMs = Math.min(requestTimeoutMs, DEFAULT_MUTATION_VERIFICATION_TIMEOUT_MS),
  } = {},
) {
  const execute = (query, kind = 'read') => executeDataRequest(query, requestTimeoutMs, kind);
  const executeVerification = (query) => executeDataRequest(query, verificationTimeoutMs, 'read');

  return {
    async listAccounts(ownerId) {
      const data = assertResult(await execute(client
        .from('accounts')
        .select('*')
        .eq('owner_id', requireOwnerId(ownerId))
        .eq('is_archived', false)
        .order('created_at', { ascending: true })));
      return data;
    },
    async listAssets(ownerId) {
      const data = assertResult(await execute(client
        .from('assets')
        .select('*')
        .eq('owner_id', requireOwnerId(ownerId))
        .eq('is_archived', false)
        .order('created_at', { ascending: false })));
      return data.map(cleanAsset);
    },
    async listSnapshots(ownerId) {
      const data = assertResult(await execute(client
        .from('asset_snapshots')
        .select('*')
        .eq('owner_id', requireOwnerId(ownerId))
        .order('recorded_on', { ascending: false })
        .order('created_at', { ascending: false })));
      return data.map(cleanSnapshot);
    },
    async getAccountById(id, ownerId) {
      return assertResult(await executeVerification(client
        .from('accounts')
        .select(ACCOUNT_READ_FIELDS)
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .maybeSingle()));
    },
    async getAssetById(id, ownerId) {
      const data = assertResult(await executeVerification(client
        .from('assets')
        .select(ASSET_READ_FIELDS)
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .maybeSingle()));
      return cleanAsset(data);
    },
    async createAccount(payload, ownerId, recordId = null) {
      const record = {
        ...pickFields(payload, ACCOUNT_FIELDS),
        owner_id: requireOwnerId(ownerId),
      };
      if (recordId) record.id = recordId;
      const query = recordId
        ? client.from('accounts').upsert(record, { onConflict: 'id' })
        : client.from('accounts').insert(record);
      const data = assertResult(await execute(query.select().single(), 'mutation'));
      return data;
    },
    async updateAccount(id, payload, ownerId) {
      const data = assertResult(await execute(client
        .from('accounts')
        .update(pickFields(payload, ACCOUNT_FIELDS))
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .select()
        .maybeSingle(), 'mutation'));
      return requireMutationRow(data, '账户');
    },
    async deleteAccount(id, ownerId) {
      const data = assertResult(await execute(client
        .from('accounts')
        .delete()
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .select('id')
        .maybeSingle(), 'mutation'));
      return requireMutationRow(data, '账户').id;
    },
    async createAsset(payload, ownerId, recordId = null) {
      const record = {
        ...pickFields(payload, ASSET_FIELDS),
        owner_id: requireOwnerId(ownerId),
      };
      if (recordId) record.id = recordId;
      const query = recordId
        ? client.from('assets').upsert(record, { onConflict: 'id' })
        : client.from('assets').insert(record);
      const data = assertResult(await execute(query.select().single(), 'mutation'));
      return cleanAsset(data);
    },
    async updateAsset(id, payload, ownerId) {
      const data = assertResult(await execute(client
        .from('assets')
        .update(pickFields(payload, ASSET_FIELDS))
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .select()
        .maybeSingle(), 'mutation'));
      return cleanAsset(requireMutationRow(data, '资产'));
    },
    async deleteAsset(id, ownerId) {
      const data = assertResult(await execute(client
        .from('assets')
        .delete()
        .eq('id', id)
        .eq('owner_id', requireOwnerId(ownerId))
        .select('id')
        .maybeSingle(), 'mutation'));
      return requireMutationRow(data, '资产').id;
    },
  };
}

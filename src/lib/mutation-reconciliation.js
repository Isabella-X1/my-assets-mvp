import { isAuthenticationError } from './auth-flow.js';

export const MUTATION_UNCONFIRMED = 'MUTATION_UNCONFIRMED';

function unconfirmedMutationError(cause) {
  const error = new Error('云端响应超时，自动核对后结果仍未确认。系统没有自动重试写入，请先刷新页面；若数据未变化，再重新提交。');
  error.code = MUTATION_UNCONFIRMED;
  error.cause = cause;
  return error;
}

function valuesMatch(actual, expected) {
  if (expected === null || expected === undefined) return actual === expected;
  if (typeof expected === 'number') {
    return typeof actual === 'number' && Number.isFinite(actual) && actual === expected;
  }
  return Object.is(actual, expected);
}

export function recordMatchesExpected(record, { id, ownerId, expectedPayload }) {
  if (!record || record.id !== id || record.owner_id !== ownerId || record.is_archived !== false) return false;
  return Object.entries(expectedPayload || {}).every(([field, expected]) => (
    expected === undefined || valuesMatch(record[field], expected)
  ));
}

export async function mutateWithReadback({
  operation,
  id,
  ownerId,
  expectedPayload = null,
  targetKnown = true,
  write,
  read,
  isContextCurrent,
  onVerifying = () => {},
}) {
  try {
    return { value: await write(), recovered: false };
  } catch (error) {
    if (error?.code !== 'DATA_REQUEST_TIMEOUT') throw error;
    if (!isContextCurrent()) throw error;

    onVerifying();
    let record;
    try {
      record = await read();
    } catch (readError) {
      if (isAuthenticationError(readError)) throw readError;
      throw unconfirmedMutationError(readError);
    }

    if (!isContextCurrent()) throw error;
    const confirmed = operation === 'delete'
      ? targetKnown && record === null
      : recordMatchesExpected(record, { id, ownerId, expectedPayload });

    if (!confirmed) throw unconfirmedMutationError(error);
    return {
      value: operation === 'delete' ? id : record,
      recovered: true,
    };
  }
}

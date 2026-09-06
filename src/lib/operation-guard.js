export function createOperationGuard() {
  const active = new Map();

  return {
    tryStart(key) {
      if (!key || active.has(key)) return null;
      const token = Symbol(key);
      active.set(key, token);
      return token;
    },
    finish(key, token) {
      if (!token || active.get(key) !== token) return false;
      active.delete(key);
      return true;
    },
    isActive(key) {
      return active.has(key);
    },
    reset() {
      active.clear();
    },
  };
}

export function requireOnline(isOnline) {
  if (!isOnline) throw new Error('当前离线，联网后再操作。');
}

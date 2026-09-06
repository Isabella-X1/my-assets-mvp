export function createMutationContextTracker() {
  let generation = 0;

  return {
    capture(userId) {
      if (!userId) throw new Error('登录状态已失效，请重新登录。');
      return Object.freeze({ userId, generation });
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(context, currentUserId) {
      return Boolean(
        context
        && context.userId === currentUserId
        && context.generation === generation
      );
    },
  };
}

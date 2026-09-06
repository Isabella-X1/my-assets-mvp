export async function updatePasswordAndEndLocalSession({
  password,
  updatePassword,
  signOut,
  clearLocalState,
}) {
  await updatePassword(password);

  let signOutError = null;
  try {
    await signOut();
  } catch (error) {
    signOutError = error;
  }

  clearLocalState();
  return { signOutError };
}

export function shouldClearRecoveryOnAuthEvent(event, authInitializing) {
  return !authInitializing && event === 'SIGNED_OUT';
}

export function isAuthenticationError(error) {
  const status = Number(error?.status);
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  return (
    status === 401
    || ['401', 'pgrst301', 'refresh_token_not_found', 'session_not_found'].includes(code)
    || /jwt.*(expired|invalid)|invalid jwt|auth session missing|not authenticated|refresh token.*(invalid|missing)/i.test(message)
  );
}

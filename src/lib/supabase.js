import { createClient } from '@supabase/supabase-js';
import { createSupabaseDataBackend } from './supabase-data.js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const publishableKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
  || import.meta.env.VITE_SUPABASE_ANON_KEY
)?.trim();

function assertResult(result) {
  if (result.error) throw result.error;
  return result.data;
}

export function createSupabaseBackend() {
  if (
    !url
    || !publishableKey
    || url.includes('your-project')
    || publishableKey === 'your-publishable-key'
    || publishableKey === 'your-anon-key'
  ) {
    return { mode: 'supabase', isConfigured: false };
  }

  const client = createClient(url, publishableKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
  const dataBackend = createSupabaseDataBackend(client);

  return {
    mode: 'supabase',
    isConfigured: true,
    ...dataBackend,
    async getSession() {
      const data = assertResult(await client.auth.getSession());
      return data.session;
    },
    onAuthStateChange(callback) {
      const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
      return () => data.subscription.unsubscribe();
    },
    async signIn(email, password) {
      const data = assertResult(await client.auth.signInWithPassword({ email, password }));
      return data.session;
    },
    async requestPasswordReset(email) {
      const redirectTo = new URL('/reset-password', window.location.origin).toString();
      assertResult(await client.auth.resetPasswordForEmail(email, { redirectTo }));
    },
    async updatePassword(password) {
      assertResult(await client.auth.updateUser({ password }));
    },
    async signOut() {
      // Keep sessions on the user's other devices active. A separate
      // "sign out everywhere" action can use the global scope later.
      assertResult(await client.auth.signOut({ scope: 'local' }));
    },
  };
}

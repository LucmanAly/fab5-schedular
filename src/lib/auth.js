// Admin login (round 3) — thin wrapper over @supabase/auth-js. Only the auth
// piece uses a real client library: token refresh (multi-tab races, wake-
// from-sleep, rotating refresh tokens) is exactly the kind of thing worth not
// re-solving by hand for a single-admin tool where a subtle bug means
// "silently logged out mid-save". Everything else (stores/workers/weeks) still
// goes through the hand-rolled sb() PostgREST wrapper in supabase.js.
import { AuthClient } from '@supabase/auth-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const authEnabled = Boolean(URL && KEY);

export const auth = authEnabled
  ? new AuthClient({
      url: `${URL}/auth/v1`,
      headers: { apikey: KEY },
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // no OAuth redirect flow here, and avoids
      // any chance of colliding with this app's own ?view=TOKEN query param.
      storageKey: 'shiftboard-auth',
    })
  : null;

export async function getAccessToken() {
  if (!auth) return null;
  const { data } = await auth.getSession();
  return data?.session?.access_token || null;
}

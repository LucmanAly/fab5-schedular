// Public build: local-only, no backend. Nothing here ever reads env vars,
// opens a network connection, or can be pointed at anyone's database.

export const enabled = false;

export function getLastError() {
  return null;
}
export function diagnostics() {
  return { hasUrl: false, url: '(none)', hasKey: false, keyType: 'none' };
}
export async function testConnection() {
  return { ok: false, message: 'This build has no cloud backend — everything stays in this browser tab.' };
}

export async function loadSetup() {
  return { config: null, stores: [], workers: [] };
}
export async function saveSetup() {}
export async function listWeeks() {
  return [];
}
export async function saveWeek() {}
export async function loadWeek() {
  return null;
}

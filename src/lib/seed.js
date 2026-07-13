// Default seed setup (§9) — the same 9 stores and 16 workers as the INSERTs
// in supabase-setup.sql. Used when the app starts with an empty setup: with
// no cloud configured it becomes the initial local state, and on a fresh
// (empty) database it is pushed up once automatically. The admin can still
// add, edit, or remove any of it through Settings like hand-entered data.

const STORE_DEFAULTS = {
  shift_mode: 'default',
  weekday_open: '08:00',
  weekday_close: '22:00',
  weekend_open: '09:00',
  weekend_close: '22:00',
};

export function seedStores() {
  return [
    [1, 'Ridge Ave'],
    [2, '2nd Street'],
    [3, '4th Street'],
    [4, '5th Street'],
    [5, '7th Street'],
    [6, '9th Street'],
    [7, '10th Street'],
    [8, '14th Street'],
    [9, 'Smoke Shop'],
  ].map(([id, name]) => ({ id, name, ...STORE_DEFAULTS }));
}

export function seedWorkers() {
  // [id, name, ordered store links (1st link first), main_store_id]
  return [
    [1, 'Luqman', [1, 2, 4], 1],
    [2, 'Amir', [1, 5, 6], null],
    [3, 'Abdul', [2, 3, 4], 2],
    [4, 'Fouad', [2, 3, 5, 1], null],
    [5, 'Karim', [3, 2, 4], 3],
    [6, 'Saqib', [4, 3, 5], 4],
    [7, 'Taha', [4, 5], null],
    [8, 'Mo', [5, 4, 6], 5],
    [9, 'Waj', [5, 6], null],
    [10, 'Afsar', [6, 5, 7], 6],
    [11, 'Mansour', [6, 7, 8], null],
    [12, 'Mushahid', [7, 6, 8], 7],
    [13, 'Salman', [7, 8, 9], null],
    [14, 'Sidaqat', [8, 7, 9], 8],
    [15, 'Johnny', [9, 8], 9],
    [16, 'Jash', [9], null],
  ].map(([id, name, store_ids, main_store_id]) => ({
    id,
    name,
    store_ids,
    main_store_id,
    max_workdays: 5,
  }));
}

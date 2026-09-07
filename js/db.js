/**
 * db.js
 * Persistence for the (potentially large) accounts dataset.
 *
 * IndexedDB is used by default because it scales comfortably to thousands
 * of records and survives page reloads / browser restarts. If IndexedDB is
 * unavailable (older browsers, some locked-down/private-browsing modes),
 * the module transparently falls back to a single localStorage entry so
 * the app still works — just with a lower practical size ceiling.
 *
 * The rest of the app never needs to know which backend is active; it just
 * calls FLM.db.getAll() / putMany() / clear() and awaits the promises.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});

  const DB_NAME = 'follow-list-manager';
  const DB_VERSION = 1;
  const STORE_NAME = 'accounts';
  const FALLBACK_KEY = 'flm_accounts_fallback_v1';

  let idb = null; // open IDBDatabase instance, or null if using fallback
  let mode = null; // 'idb' | 'localStorage'

  function openIndexedDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }
      let request;
      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        reject(err);
        return;
      }
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };
      request.onsuccess = (event) => resolve(event.target.result);
      request.onerror = () => reject(request.error || new Error('Could not open the local database.'));
      request.onblocked = () => reject(new Error('The local database is blocked by another open tab.'));
    });
  }

  /* ------------------------------- localStorage fallback ---------------- */

  function fallbackReadAll() {
    try {
      const raw = window.localStorage.getItem(FALLBACK_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (_err) {
      return [];
    }
  }

  function fallbackWriteAll(list) {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(list));
  }

  function fallbackPutMany(records) {
    const all = fallbackReadAll();
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const rec of records) byId.set(rec.id, rec);
    fallbackWriteAll(Array.from(byId.values()));
  }

  function fallbackClear() {
    window.localStorage.removeItem(FALLBACK_KEY);
  }

  /* ------------------------------- IndexedDB backend --------------------- */

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read saved accounts.'));
    });
  }

  function idbPutMany(records) {
    if (!records.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const rec of records) store.put(rec);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save changes locally.'));
      tx.onabort = () => reject(tx.error || new Error('Saving changes was aborted.'));
    });
  }

  function idbClear() {
    return new Promise((resolve, reject) => {
      const tx = idb.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear saved data.'));
    });
  }

  /* ------------------------------- Public API ----------------------------- */

  async function init() {
    try {
      idb = await openIndexedDb();
      mode = 'idb';
    } catch (err) {
      console.warn('[FLM] Falling back to localStorage for storage:', err && err.message);
      idb = null;
      mode = 'localStorage';
    }
    return mode;
  }

  function getAll() {
    if (mode === 'idb') return idbGetAll();
    return Promise.resolve(fallbackReadAll());
  }

  function putMany(records) {
    if (mode === 'idb') return idbPutMany(records);
    fallbackPutMany(records);
    return Promise.resolve();
  }

  function put(record) {
    return putMany([record]);
  }

  function clear() {
    if (mode === 'idb') return idbClear();
    fallbackClear();
    return Promise.resolve();
  }

  FLM.db = {
    init,
    getAll,
    put,
    putMany,
    clear,
    getMode: () => mode,
  };
})();

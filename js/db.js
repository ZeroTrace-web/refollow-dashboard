/**
 * db.js
 * Local persistence with IndexedDB as the primary backend and localStorage
 * as a fallback. All IndexedDB operations have timeouts so a browser that
 * stalls IndexedDB can never leave the application waiting forever.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const DB_NAME = 'follow-list-manager';
  const DB_VERSION = 1;
  const STORE_NAME = 'accounts';
  const FALLBACK_KEY = 'flm_accounts_fallback_v1';
  const IDB_OPEN_TIMEOUT = 5000;
  const IDB_OPERATION_TIMEOUT = 5000;

  let idb = null;
  let mode = null; // 'idb' | 'localStorage'

  function withTimeout(promise, ms, message) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message || 'Storage operation timed out.')), ms);
      Promise.resolve(promise).then(
        (value) => { clearTimeout(timer); resolve(value); },
        (error) => { clearTimeout(timer); reject(error); }
      );
    });
  }

  function openIndexedDb() {
    return new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is not available in this browser.'));
        return;
      }

      let request;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        fn(value);
      };

      try {
        request = window.indexedDB.open(DB_NAME, DB_VERSION);
      } catch (err) {
        finish(reject, err);
        return;
      }

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
      };

      request.onsuccess = (event) => {
        const database = event.target.result;
        if (settled) {
          // If the timeout already won, do not leave a late connection open.
          try { database.close(); } catch (_err) {}
          return;
        }
        finish(resolve, database);
      };
      request.onerror = () => finish(reject, request.error || new Error('Could not open the local database.'));
      request.onblocked = () => finish(reject, new Error('The local database is blocked by another open tab.'));
    });
  }

  /* localStorage fallback */

  function fallbackReadAll() {
    try {
      const raw = window.localStorage.getItem(FALLBACK_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[FLM] Could not read localStorage fallback:', err);
      return [];
    }
  }

  function fallbackWriteAll(list) {
    window.localStorage.setItem(FALLBACK_KEY, JSON.stringify(list));
  }

  function fallbackPutMany(records) {
    const all = fallbackReadAll();
    const byId = new Map(all.map((record) => [record.id, record]));
    records.forEach((record) => byId.set(record.id, record));
    fallbackWriteAll(Array.from(byId.values()));
  }

  function fallbackClear() {
    window.localStorage.removeItem(FALLBACK_KEY);
  }

  function switchToFallback(reason) {
    console.warn('[FLM] Switching to localStorage fallback:', reason && reason.message ? reason.message : reason);
    if (idb) {
      try { idb.close(); } catch (_err) {}
    }
    idb = null;
    mode = 'localStorage';
  }

  /* IndexedDB backend */

  function idbGetAll() {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = idb.transaction(STORE_NAME, 'readonly');
      } catch (err) {
        reject(err);
        return;
      }
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read saved accounts.'));
      tx.onabort = () => reject(tx.error || new Error('Reading saved accounts was aborted.'));
    });
  }

  function idbPutMany(records) {
    if (!records.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = idb.transaction(STORE_NAME, 'readwrite');
      } catch (err) {
        reject(err);
        return;
      }
      const store = tx.objectStore(STORE_NAME);
      records.forEach((record) => store.put(record));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save changes locally.'));
      tx.onabort = () => reject(tx.error || new Error('Saving changes was aborted.'));
    });
  }

  function idbClear() {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = idb.transaction(STORE_NAME, 'readwrite');
      } catch (err) {
        reject(err);
        return;
      }
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear saved data.'));
      tx.onabort = () => reject(tx.error || new Error('Clearing saved data was aborted.'));
    });
  }

  /* Public API */

  async function init() {
    try {
      idb = await withTimeout(
        openIndexedDb(),
        IDB_OPEN_TIMEOUT,
        'IndexedDB took too long to start.'
      );
      mode = 'idb';
    } catch (err) {
      switchToFallback(err);
    }
    return mode;
  }

  async function getAll() {
    if (mode !== 'idb') return fallbackReadAll();

    try {
      return await withTimeout(
        idbGetAll(),
        IDB_OPERATION_TIMEOUT,
        'Reading IndexedDB took too long.'
      );
    } catch (err) {
      switchToFallback(err);
      return fallbackReadAll();
    }
  }

  async function putMany(records) {
    if (mode !== 'idb') {
      fallbackPutMany(records);
      return;
    }
    try {
      await withTimeout(
        idbPutMany(records),
        IDB_OPERATION_TIMEOUT,
        'Saving to IndexedDB took too long.'
      );
    } catch (err) {
      switchToFallback(err);
      fallbackPutMany(records);
    }
  }

  function put(record) {
    return putMany([record]);
  }

  async function clear() {
    if (mode !== 'idb') {
      fallbackClear();
      return;
    }
    try {
      await withTimeout(
        idbClear(),
        IDB_OPERATION_TIMEOUT,
        'Clearing IndexedDB took too long.'
      );
    } catch (err) {
      switchToFallback(err);
      fallbackClear();
    }
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

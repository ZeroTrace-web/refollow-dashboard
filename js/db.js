/**
 * db.js
 * Reliable local persistence using IndexedDB as the primary backend and
 * localStorage as a fallback when IndexedDB cannot be opened at all.
 *
 * Important consistency rule:
 * - We only switch from IndexedDB to localStorage during initialization or
 *   before any successful IndexedDB session exists.
 * - If an individual IndexedDB write/clear operation fails or times out, we
 *   retry instead of silently switching stores. This prevents split-brain
 *   data where old records remain in IndexedDB while new records are written
 *   somewhere else.
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
  const MAX_RETRIES = 1;

  let idb = null;
  let mode = null; // 'idb' | 'localStorage'

  function timeoutPromise(ms, message) {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  async function withTimeout(promise, ms, message) {
    return Promise.race([promise, timeoutPromise(ms, message)]);
  }

  function closeDatabase(database) {
    if (!database) return;
    try { database.close(); } catch (_err) {}
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
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(
        () => finish(reject, new Error('IndexedDB took too long to start.')),
        IDB_OPEN_TIMEOUT
      );

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
          closeDatabase(database);
          return;
        }
        database.onversionchange = () => closeDatabase(database);
        database.onclose = () => {
          if (idb === database) {
            idb = null;
            // Do not silently switch to a second storage backend after an
            // IndexedDB session has already existed. That can create split
            // brain data. The next operation will try to reopen IndexedDB.
            if (mode === 'idb') mode = null;
          }
        };
        finish(resolve, database);
      };

      request.onerror = () => finish(
        reject,
        request.error || new Error('Could not open the local database.')
      );

      request.onblocked = () => finish(
        reject,
        new Error('The local database is blocked by another open tab.')
      );
    });
  }

  function fallbackReadAll() {
    try {
      const raw = window.localStorage.getItem(FALLBACK_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
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
    for (const record of records) byId.set(record.id, record);
    fallbackWriteAll(Array.from(byId.values()));
  }

  function fallbackClear() {
    window.localStorage.removeItem(FALLBACK_KEY);
  }

  function switchToFallback(reason) {
    console.warn(
      '[FLM] Using localStorage fallback:',
      reason && reason.message ? reason.message : reason
    );
    closeDatabase(idb);
    idb = null;
    mode = 'localStorage';
  }

  function idbGetAll(database) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(STORE_NAME, 'readonly');
      } catch (err) {
        reject(err);
        return;
      }

      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(
        request.error || new Error('Could not read saved accounts.')
      );
      tx.onabort = () => reject(
        tx.error || new Error('Reading saved accounts was aborted.')
      );
    });
  }

  function idbPutMany(database, records) {
    if (!records.length) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(STORE_NAME, 'readwrite');
      } catch (err) {
        reject(err);
        return;
      }

      const store = tx.objectStore(STORE_NAME);
      for (const record of records) store.put(record);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(
        tx.error || new Error('Could not save changes locally.')
      );
      tx.onabort = () => reject(
        tx.error || new Error('Saving changes was aborted.')
      );
    });
  }

  function idbClear(database) {
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = database.transaction(STORE_NAME, 'readwrite');
      } catch (err) {
        reject(err);
        return;
      }

      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(
        tx.error || new Error('Could not clear saved data.')
      );
      tx.onabort = () => reject(
        tx.error || new Error('Clearing saved data was aborted.')
      );
    });
  }

  async function reopenIndexedDb() {
    closeDatabase(idb);
    idb = null;
    const fresh = await openIndexedDb();
    idb = fresh;
    mode = 'idb';
    return fresh;
  }

  async function ensureReady() {
    if (!mode) await init();
    return mode;
  }

  async function init() {
    if (mode) return mode;
    try {
      idb = await openIndexedDb();
      mode = 'idb';
    } catch (err) {
      switchToFallback(err);
    }
    return mode;
  }

  async function getAll() {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) return fallbackReadAll();

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const database = idb;
      if (!database) break;
      try {
        return await withTimeout(
          idbGetAll(database),
          IDB_OPERATION_TIMEOUT,
          'Reading IndexedDB took too long.'
        );
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try {
            await reopenIndexedDb();
          } catch (reopenErr) {
            lastError = reopenErr;
            break;
          }
        }
      }
    }

    // IndexedDB is the established source of truth when this session has
    // already opened it successfully. Never silently replace it with an empty
    // localStorage store after a read failure.
    throw lastError || new Error('Could not read saved accounts locally.');
  }

  async function putMany(records) {
    if (!Array.isArray(records) || records.length === 0) return;
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) {
      fallbackPutMany(records);
      return;
    }

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await withTimeout(
          idbPutMany(idb, records),
          IDB_OPERATION_TIMEOUT,
          'Saving to IndexedDB took too long.'
        );
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try {
            await reopenIndexedDb();
          } catch (reopenErr) {
            lastError = reopenErr;
            break;
          }
        }
      }
    }

    // Do NOT switch stores after a timed-out/failed write because the original
    // IndexedDB transaction may have committed after our timeout. Throwing is
    // safer than creating two competing sources of truth.
    throw lastError || new Error('Could not save changes locally.');
  }

  function put(record) {
    return putMany([record]);
  }

  async function clear() {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) {
      fallbackClear();
      return;
    }

    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await withTimeout(
          idbClear(idb),
          IDB_OPERATION_TIMEOUT,
          'Clearing IndexedDB took too long.'
        );
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try {
            await reopenIndexedDb();
          } catch (reopenErr) {
            lastError = reopenErr;
            break;
          }
        }
      }
    }

    // Never silently clear a different store after IndexedDB failed.
    throw lastError || new Error('Could not clear saved data.');
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

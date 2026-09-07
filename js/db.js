/**
 * db.js
 * Reliable local persistence using IndexedDB as the primary backend and
 * localStorage as a fallback when IndexedDB cannot be opened.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const DB_NAME = 'follow-list-manager';
  const DB_VERSION = 2;
  const STORE_NAME = 'accounts';
  const META_STORE = 'meta';
  const HISTORY_KEY = 'history';
  const FALLBACK_KEY = 'flm_accounts_fallback_v1';
  const FALLBACK_META_KEY = 'flm_meta_fallback_v1';
  const IDB_OPEN_TIMEOUT = 5000;
  const IDB_OPERATION_TIMEOUT = 5000;
  const MAX_RETRIES = 1;

  let idb = null;
  let mode = null;

  function timeoutPromise(ms, message) {
    return new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms));
  }
  function withTimeout(promise, ms, message) {
    let timerId;
    const timeout = new Promise((_, reject) => {
      timerId = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([Promise.resolve(promise), timeout])
      .finally(() => clearTimeout(timerId));
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
      let timer;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      timer = setTimeout(() => finish(reject, new Error('IndexedDB took too long to start.')), IDB_OPEN_TIMEOUT);

      try { request = window.indexedDB.open(DB_NAME, DB_VERSION); }
      catch (err) { finish(reject, err); return; }

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('url', 'url', { unique: false });
          store.createIndex('status', 'status', { unique: false });
        }
        if (!database.objectStoreNames.contains(META_STORE)) {
          database.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };
      request.onsuccess = (event) => {
        const database = event.target.result;
        if (settled) { closeDatabase(database); return; }
        database.onversionchange = () => closeDatabase(database);
        database.onclose = () => {
          if (idb === database) { idb = null; if (mode === 'idb') mode = null; }
        };
        finish(resolve, database);
      };
      request.onerror = () => finish(reject, request.error || new Error('Could not open the local database.'));
      request.onblocked = () => finish(reject, new Error('The local database is blocked by another open tab.'));
    });
  }

  function fallbackReadAll() {
    try {
      const raw = localStorage.getItem(FALLBACK_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.warn('[FLM] localStorage accounts read failed:', err);
      return [];
    }
  }
  function fallbackWriteAll(list) {
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(list));
  }
  function fallbackPutMany(records) {
    const all = fallbackReadAll();
    const byId = new Map(all.map((r) => [r.id, r]));
    for (const record of records) {
      if (record && record.id != null) byId.set(String(record.id), record);
    }
    fallbackWriteAll([...byId.values()]);
  }
  function fallbackClear() {
    localStorage.removeItem(FALLBACK_KEY);
    localStorage.removeItem(FALLBACK_META_KEY);
  }

  function fallbackReadMeta() {
    try {
      const raw = localStorage.getItem(FALLBACK_META_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_err) { return {}; }
  }
  function fallbackWriteMeta(meta) {
    localStorage.setItem(FALLBACK_META_KEY, JSON.stringify(meta));
  }
  function fallbackGetMeta(key, fallback = null) {
    const meta = fallbackReadMeta();
    return Object.prototype.hasOwnProperty.call(meta, key) ? meta[key] : fallback;
  }
  function fallbackSetMeta(key, value) {
    const meta = fallbackReadMeta();
    meta[key] = value;
    fallbackWriteMeta(meta);
  }

  function switchToFallback(reason) {
    console.warn('[FLM] Using localStorage fallback:', reason && reason.message ? reason.message : reason);
    closeDatabase(idb); idb = null; mode = 'localStorage';
  }

  function idbGetAll(database) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(STORE_NAME, 'readonly'); }
      catch (err) { reject(err); return; }
      const request = tx.objectStore(STORE_NAME).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('Could not read saved accounts.'));
      tx.onabort = () => reject(tx.error || new Error('Reading saved accounts was aborted.'));
    });
  }
  function idbPutMany(database, records) {
    if (!records.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(STORE_NAME, 'readwrite'); }
      catch (err) { reject(err); return; }
      const store = tx.objectStore(STORE_NAME);
      records.forEach((r) => store.put(r));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save changes locally.'));
      tx.onabort = () => reject(tx.error || new Error('Saving changes was aborted.'));
    });
  }
  function idbClear(database) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(STORE_NAME, 'readwrite'); }
      catch (err) { reject(err); return; }
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not clear saved data.'));
      tx.onabort = () => reject(tx.error || new Error('Clearing saved data was aborted.'));
    });
  }
  function idbGetMeta(database, key) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(META_STORE, 'readonly'); }
      catch (err) { reject(err); return; }
      const req = tx.objectStore(META_STORE).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error || new Error('Could not read local metadata.'));
      tx.onabort = () => reject(tx.error || new Error('Reading metadata was aborted.'));
    });
  }
  function idbSetMeta(database, key, value) {
    return new Promise((resolve, reject) => {
      let tx;
      try { tx = database.transaction(META_STORE, 'readwrite'); }
      catch (err) { reject(err); return; }
      tx.objectStore(META_STORE).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('Could not save local metadata.'));
      tx.onabort = () => reject(tx.error || new Error('Saving metadata was aborted.'));
    });
  }

  async function reopenIndexedDb() {
    closeDatabase(idb); idb = null;
    const fresh = await openIndexedDb(); idb = fresh; mode = 'idb'; return fresh;
  }
  async function ensureReady() {
    if (!mode) await init();
    return mode;
  }
  async function init() {
    if (mode) return mode;
    try { idb = await openIndexedDb(); mode = 'idb'; }
    catch (err) { switchToFallback(err); }
    return mode;
  }

  async function getAll() {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) return fallbackReadAll();
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await withTimeout(idbGetAll(idb), IDB_OPERATION_TIMEOUT, 'Reading IndexedDB took too long.');
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try { await reopenIndexedDb(); } catch (reopenErr) { lastError = reopenErr; break; }
        }
      }
    }
    throw lastError || new Error('Could not read saved accounts locally.');
  }

  async function putMany(records) {
    if (!Array.isArray(records) || !records.length) return;
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) { fallbackPutMany(records); return; }
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await withTimeout(idbPutMany(idb, records), IDB_OPERATION_TIMEOUT, 'Saving to IndexedDB took too long.');
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try { await reopenIndexedDb(); } catch (reopenErr) { lastError = reopenErr; break; }
        }
      }
    }
    throw lastError || new Error('Could not save changes locally.');
  }
  function put(record) { return putMany([record]); }

  async function clear() {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) { fallbackClear(); return; }
    let lastError = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await withTimeout(idbClear(idb), IDB_OPERATION_TIMEOUT, 'Clearing IndexedDB took too long.');
        return;
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES) {
          try { await reopenIndexedDb(); } catch (reopenErr) { lastError = reopenErr; break; }
        }
      }
    }
    throw lastError || new Error('Could not clear saved data.');
  }

  async function getMeta(key, fallback = null) {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) return fallbackGetMeta(key, fallback);
    try { return await withTimeout(idbGetMeta(idb, key), IDB_OPERATION_TIMEOUT, 'Reading metadata took too long.'); }
    catch (err) { console.warn('[FLM] Metadata read failed:', err); return fallback; }
  }
  async function setMeta(key, value) {
    const currentMode = await ensureReady();
    if (currentMode !== 'idb' || !idb) { fallbackSetMeta(key, value); return; }
    try { await withTimeout(idbSetMeta(idb, key, value), IDB_OPERATION_TIMEOUT, 'Saving metadata took too long.'); }
    catch (err) { console.warn('[FLM] Metadata save failed:', err); throw err; }
  }
  async function addHistory(entry) {
    const history = (await getMeta(HISTORY_KEY, [])) || [];
    const next = Array.isArray(history) ? history.slice(0, 49) : [];
    next.unshift({ id: FLM.utils.generateId(), at: Date.now(), ...entry });
    await setMeta(HISTORY_KEY, next);
  }
  async function getHistory() {
    const history = await getMeta(HISTORY_KEY, []);
    return Array.isArray(history) ? history : [];
  }
  async function clearHistory() { await setMeta(HISTORY_KEY, []); }

  FLM.db = {
    init, getAll, put, putMany, clear, getMode: () => mode,
    getMeta, setMeta, addHistory, getHistory, clearHistory,
  };
})();

/**
 * app.js
 * Wires together storage (db.js), parsing (importer.js), notifications
 * (toast.js) and rendering (render.js) into the working application.
 *
 * State lives entirely in memory while the app is open; every mutation is
 * written through to storage before the in-memory copy is updated, so the
 * UI and the saved data can never drift apart even if a save fails.
 */
(function () {
  'use strict';

  const FLM = window.FLM;
  const { utils, db, importer, toast, render, modal, settings, STATUS_LABELS } = FLM;
  const {
    el,
    normalizeUrlKey,
    formatNumber,
    formatDateForFilename,
    debounce,
    downloadJSON,
    readFileAsText,
    nextPaint,
  } = utils;

  /* ----------------------------------------------------------------------
   * State
   * -------------------------------------------------------------------- */

  /** @type {object[]} full in-memory dataset, source of truth for the UI */
  let accounts = [];
  /** @type {Map<string, object>} id -> account, kept in sync with `accounts` */
  const accountsById = new Map();
  /** @type {Set<string>} ids currently selected for bulk actions */
  const selection = new Set();

  const state = {
    autoMarkFollowedOnOpen: settings.get('autoMarkFollowedOnOpen', true) !== false,
    filter: settings.get('filter', 'all'),
    sort: settings.get('sort', 'newest'),
    view: settings.get('view', 'comfortable'),
    layout: settings.get('layout', 'cards'),
    tagFilter: settings.get('tagFilter', ''),
    focusList: false,
    lastOpenedId: null,
    search: '',
    currentPage: 1,
    pageSize: 50,
  };

  // Old or malformed saved preferences should never be able to break rendering.
  const VALID_FILTERS = new Set(['all', 'not-followed', 'followed', 'skipped']);
  const VALID_VIEWS = new Set(['compact', 'comfortable', 'large']);
  const VALID_LAYOUTS = new Set(['cards', 'table']);
  const VALID_SORTS = new Set(['newest', 'oldest', 'name-asc', 'name-desc', 'updated']);
  if (!VALID_FILTERS.has(state.filter)) state.filter = 'all';
  if (!VALID_VIEWS.has(state.view)) state.view = 'comfortable';
  if (!VALID_LAYOUTS.has(state.layout)) state.layout = 'cards';
  if (typeof state.tagFilter !== 'string') state.tagFilter = '';
  if (!VALID_SORTS.has(state.sort)) state.sort = 'newest';
  if (typeof state.autoMarkFollowedOnOpen !== 'boolean') state.autoMarkFollowedOnOpen = true;

  let visibleList = []; // accounts after filter + search + sort, in display order
  let pagedList = []; // current page of visible accounts
  let counts = { all: 0, 'not-followed': 0, followed: 0, skipped: 0 };
  let deferredInstallPrompt = null;

  const SORTERS = {
    newest: (a, b) => b.createdAt - a.createdAt,
    oldest: (a, b) => a.createdAt - b.createdAt,
    'name-asc': (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    'name-desc': (a, b) => b.name.localeCompare(a.name, undefined, { sensitivity: 'base' }),
    updated: (a, b) => b.updatedAt - a.updatedAt,
  };

  /* ----------------------------------------------------------------------
   * DOM references
   * -------------------------------------------------------------------- */

  const $ = (id) => document.getElementById(id);

  const dom = {
    btnAbout: $('btnAbout'),
    btnHistory: $('btnHistory'),
    btnSettings: $('btnSettings'),
    btnInstall: $('btnInstall'),
    btnAboutInline: $('btnAboutInline'),
    btnViewToggle: $('btnViewToggle'),
    btnViewSmaller: $('btnViewSmaller'),
    btnViewLarger: $('btnViewLarger'),
    btnFocusList: $('btnFocusList'),
    btnExitFocusList: $('btnExitFocusList'),
    btnTheme: $('btnTheme'),
    iconThemeSun: $('iconThemeSun'),
    btnCommand: $('btnCommand'),
    commandBackdrop: $('commandBackdrop'),
    commandPalette: $('commandPalette'),
    btnCloseCommand: $('btnCloseCommand'),
    commandInput: $('commandInput'),
    commandList: $('commandList'),
    iconThemeMoon: $('iconThemeMoon'),

    btnImportHtml: $('btnImportHtml'),
    fileImportHtml: $('fileImportHtml'),
    btnOpenNext: $('btnOpenNext'),
     btnTriage: $('btnTriage'),
     btnResume: $('btnResume'),
    btnExport: $('btnExport'),
    btnExportCsv: $('btnExportCsv'),
    btnExportHtml: $('btnExportHtml'),
    btnImportBackup: $('btnImportBackup'),
    fileImportBackup: $('fileImportBackup'),
    btnReset: $('btnReset'),

    statTotal: $('statTotal'),
    statNotFollowed: $('statNotFollowed'),
    statFollowed: $('statFollowed'),
    statSkipped: $('statSkipped'),
    progressBar: $('progressBar'),
    progressBarFill: $('progressBarFill'),
    progressPct: $('progressPct'),

    filterTabs: $('filterTabs'),
    countAll: $('countAll'),
    countNotFollowed: $('countNotFollowed'),
    countFollowed: $('countFollowed'),
    countSkipped: $('countSkipped'),
    tagFilter: $('tagFilter'),
    btnLayoutCards: $('btnLayoutCards'),
    btnLayoutTable: $('btnLayoutTable'),

    searchInput: $('searchInput'),
    sortSelect: $('sortSelect'),

    bulkBar: $('bulkBar'),
    bulkCount: $('bulkCount'),
    btnClearSelection: $('btnClearSelection'),
    btnBulkTag: $('btnBulkTag'),

    selectAllVisible: $('selectAllVisible'),
    listHeaderHint: $('listHeaderHint'),

    listViewport: $('listViewport'),
    listSizer: $('listSizer'),
    listRows: $('listRows'),
    tableWrap: $('tableWrap'),
    tableRows: $('tableRows'),
    emptyState: $('emptyState'),
    emptyStateText: $('emptyStateText'),
    emptyStateAction: $('emptyStateAction'),
    listFootnote: $('listFootnote'),
    pagination: $('pagination'),
    btnPrevPage: $('btnPrevPage'),
    btnNextPage: $('btnNextPage'),
    pageInfo: $('pageInfo'),

    importProgress: $('importProgress'),
    importProgressText: $('importProgressText'),
     triageBackdrop: $('triageBackdrop'), triageTitle: $('triageTitle'), triageCounter: $('triageCounter'), triageName: $('triageName'), triageUrl: $('triageUrl'), triageStatus: $('triageStatus'), triageOpen: $('triageOpen'), triageFollow: $('triageFollow'), triageSkip: $('triageSkip'), triagePrev: $('triagePrev'), triageNext: $('triageNext'), triageClose: $('triageClose'),
  };

  function normalizeLoadedAccounts(loaded) {
    const now = Date.now();
    const byUrl = new Map();

    if (!Array.isArray(loaded)) return [];

    for (const raw of loaded) {
      if (!raw || typeof raw !== 'object') continue;

      let url;
      try {
        url = new URL(String(raw.url || ''));
      } catch (_err) {
        continue;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;

      const status = VALID_FILTERS.has(raw.status) && raw.status !== 'all'
        ? raw.status
        : 'not-followed';
      const createdAt = normalizeTimestamp(raw.createdAt, now);
      const updatedAt = normalizeTimestamp(raw.updatedAt, createdAt);
      const id = String(raw.id || '').trim() || FLM.utils.generateId();

      const account = {
        id,
        name: FLM.utils.sanitizeName(raw.name) || url.href,
        url: url.href,
        status,
        tags: Array.isArray(raw.tags) ? [...new Set(raw.tags.map((t) => FLM.utils.sanitizeName(t)).filter(Boolean).slice(0, 20))] : [],
        createdAt,
        updatedAt,
      };

      const key = normalizeUrlKey(account.url);
      const previous = byUrl.get(key);
      if (!previous || account.updatedAt >= previous.updatedAt) byUrl.set(key, account);
    }

    const result = Array.from(byUrl.values());
    const uniqueIds = new Set();
    return result.map((account) => {
      let id = account.id;
      while (uniqueIds.has(id)) id = FLM.utils.generateId();
      uniqueIds.add(id);
      return { ...account, id };
    });
  }

  /* ----------------------------------------------------------------------
   * Derived state + rendering
   * -------------------------------------------------------------------- */

  function recomputeDerived() {
    counts = { all: accounts.length, 'not-followed': 0, followed: 0, skipped: 0 };
    for (const a of accounts) {
      if (Object.prototype.hasOwnProperty.call(counts, a.status)) counts[a.status]++;
    }

    let list = accounts;
    if (state.filter !== 'all') list = list.filter((a) => a.status === state.filter);
    if (state.tagFilter) list = list.filter((a) => Array.isArray(a.tags) && a.tags.includes(state.tagFilter));
    if (state.search) {
      const q = state.search;
      list = list.filter((a) =>
        String(a.name || '').toLowerCase().includes(q) ||
        String(a.url || '').toLowerCase().includes(q)
      );
    }
    visibleList = list.slice().sort(SORTERS[state.sort] || SORTERS.newest);
    const totalPages = Math.max(1, Math.ceil(visibleList.length / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    if (state.currentPage < 1) state.currentPage = 1;
    const start = (state.currentPage - 1) * state.pageSize;
    pagedList = visibleList.slice(start, start + state.pageSize);

    // Selection should only refer to accounts that are currently visible.
    // This prevents bulk actions from silently affecting accounts hidden by
    // a filter/search after a status change.
    const visibleIds = new Set(visibleList.map((a) => a.id));
    for (const id of selection) {
      if (!accountsById.has(id) || !visibleIds.has(id)) selection.delete(id);
    }
  }

  function renderStats() {
    dom.statTotal.textContent = formatNumber(counts.all);
    dom.statNotFollowed.textContent = formatNumber(counts['not-followed']);
    dom.statFollowed.textContent = formatNumber(counts.followed);
    dom.statSkipped.textContent = formatNumber(counts.skipped);

    const pct = counts.all > 0 ? Math.round((counts.followed / counts.all) * 100) : 0;
    dom.progressBarFill.style.width = `${pct}%`;
    dom.progressBar.setAttribute('aria-valuenow', String(pct));
    dom.progressPct.textContent = `${pct}%`;
  }

  function renderTagFilter() {
    const tags = [...new Set(accounts.flatMap((a) => Array.isArray(a.tags) ? a.tags : []))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    const current = state.tagFilter;
    dom.tagFilter.replaceChildren();
    const all = document.createElement('option');
    all.value = ''; all.textContent = 'All tags'; dom.tagFilter.appendChild(all);
    tags.forEach((tag) => {
      const opt = document.createElement('option');
      opt.value = tag; opt.textContent = tag; dom.tagFilter.appendChild(opt);
    });
    state.tagFilter = tags.includes(current) ? current : '';
    dom.tagFilter.value = state.tagFilter;
  }

  function renderFilterCounts() {
    dom.countAll.textContent = formatNumber(counts.all);
    dom.countNotFollowed.textContent = formatNumber(counts['not-followed']);
    dom.countFollowed.textContent = formatNumber(counts.followed);
    dom.countSkipped.textContent = formatNumber(counts.skipped);

    dom.filterTabs.querySelectorAll('.filter-tab').forEach((tab) => {
      const active = tab.dataset.filter === state.filter;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderEmptyState() {
    const hasAny = accounts.length > 0;
    const hasVisible = visibleList.length > 0;
    dom.emptyState.hidden = hasVisible;
    dom.listViewport.classList.toggle('is-empty', !hasVisible);

    if (hasVisible) return;

    if (!hasAny) {
      dom.emptyStateText.textContent = 'No accounts imported yet. Import your following-list HTML file to get started.';
      dom.emptyStateAction.hidden = false;
    } else if (state.search) {
      dom.emptyStateText.textContent = 'No accounts match your search.';
      dom.emptyStateAction.hidden = true;
    } else {
      dom.emptyStateText.textContent = 'No accounts match this filter.';
      dom.emptyStateAction.hidden = true;
    }
  }

  function renderSelectionUi() {
    const visibleIds = pagedList.map((a) => a.id);
    const selectedVisible = visibleIds.filter((id) => selection.has(id));
    dom.selectAllVisible.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    dom.selectAllVisible.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;

    dom.bulkBar.hidden = selection.size === 0;
    dom.bulkCount.textContent = `${formatNumber(selection.size)} selected`;
  }

  function renderListMeta() {
    if (!visibleList.length) {
      dom.listHeaderHint.textContent = '';
      dom.pagination.hidden = true;
      return;
    }
    const start = (state.currentPage - 1) * state.pageSize + 1;
    const end = Math.min(state.currentPage * state.pageSize, visibleList.length);
    const totalPages = Math.ceil(visibleList.length / state.pageSize);
    dom.listHeaderHint.textContent = `Showing ${formatNumber(start)}–${formatNumber(end)} of ${formatNumber(visibleList.length)}`;
    dom.pagination.hidden = totalPages <= 1;
    dom.pageInfo.textContent = `Page ${state.currentPage} of ${totalPages}`;
    dom.btnPrevPage.disabled = state.currentPage <= 1;
    dom.btnNextPage.disabled = state.currentPage >= totalPages;
  }

  function renderRow(index, total) {
    const account = pagedList[index];
    return render.createRowElement(account, { index, total, offset: (state.currentPage - 1) * state.pageSize, selected: selection.has(account.id) });
  }
  function renderTableRow(index, total) {
    const account = pagedList[index];
    return render.createTableElement(account, { index, total, selected: selection.has(account.id) });
  }

  let virtualList = null;

  function renderList() {
    if (state.layout === 'table') {
      dom.listRows.hidden = true;
      dom.tableWrap.hidden = false;
      dom.tableRows.replaceChildren(...pagedList.map((a, i) => renderTableRow(i, pagedList.length)));
    } else {
      dom.listRows.hidden = false;
      dom.tableWrap.hidden = true;
      virtualList.refresh();
    }
  }

  function renderAll() {
    recomputeDerived();
    renderStats();
    renderFilterCounts();
    renderTagFilter();
    renderEmptyState();
    renderSelectionUi();
    renderListMeta();
    renderOpenNextAvailability();
    renderList();
  }

  function renderResumeAvailability() {
    const a = state.lastOpenedId ? accountsById.get(state.lastOpenedId) : null;
    dom.btnResume.hidden = !a;
    dom.btnResume.title = a ? `Resume ${a.name}` : 'No saved last-opened account';
  }

  function renderOpenNextAvailability() {
    const hasNotFollowed = counts['not-followed'] > 0;
    dom.btnOpenNext.disabled = !hasNotFollowed;
    dom.btnOpenNext.title = hasNotFollowed
      ? 'Open the next not-followed profile'
      : "You're all caught up — no not-followed accounts left";
  }

  /* ----------------------------------------------------------------------
   * Mutations (persist-first, so memory and storage never disagree)
   * -------------------------------------------------------------------- */

  async function applyStatusChange(ids, newStatus, opts) {
    opts = opts || {};
    const now = Date.now();
    const targets = ids.map((id) => accountsById.get(id)).filter((a) => a && a.status !== newStatus);
    if (!targets.length) return true;

    const prev = targets.map((a) => ({ id: a.id, status: a.status }));
    const updated = targets.map((a) => ({ ...a, status: newStatus, updatedAt: now }));

    try {
      await db.putMany(updated);
    } catch (err) {
      console.error('[FLM] Failed to save status change:', err);
      toast.show("Couldn't save that change — your browser storage may be full or unavailable.", { type: 'error' });
      return false;
    }

    updated.forEach((u) => Object.assign(accountsById.get(u.id), u));
    renderAll();
    flashRows(updated.map((u) => u.id));

    if (!opts.silent) {
      const label = STATUS_LABELS[newStatus];
      const message =
        opts.message ||
        (targets.length === 1 ? `Account marked as ${label}.` : `${formatNumber(targets.length)} accounts marked as ${label}.`);
      toast.show(message, {
        type: 'success',
        actionLabel: 'Undo',
        onAction: () => undoStatusChange(prev),
      });
    }
    return true;
  }

  async function undoStatusChange(prev) {
    const now = Date.now();
    const prevStatusById = new Map(prev.map((p) => [p.id, p.status]));
    const restored = prev
      .map((p) => accountsById.get(p.id))
      .filter(Boolean)
      .map((a) => ({ ...a, status: prevStatusById.get(a.id), updatedAt: now }));
    try {
      await db.putMany(restored);
    } catch (err) {
      console.error('[FLM] Failed to undo:', err);
      toast.show("Couldn't undo that change.", { type: 'error' });
      return;
    }
    restored.forEach((r) => Object.assign(accountsById.get(r.id), r));
    renderAll();
    flashRows(restored.map((r) => r.id));
    toast.show('Undone.', { type: 'info' });
  }

  /** Briefly highlights rows (if currently rendered) after a status change. */
  function flashRows(ids) {
    requestAnimationFrame(() => {
      const wanted = new Set(ids);
      Array.from(dom.listRows.children).forEach((rowEl) => {
        if (!wanted.has(rowEl.dataset.id)) return;
        rowEl.classList.add('just-changed');
        setTimeout(() => rowEl.classList.remove('just-changed'), 650);
      });
    });
  }

  /**
   * Opens a profile in a new tab and marks it followed.
   *
   * Important ordering detail: window.open() is called synchronously,
   * before any awaited work, because browsers tie "was this popup
   * triggered by a genuine user click?" to the current call stack. If we
   * awaited the database write first, the tab-open would very likely be
   * blocked as an unsolicited popup. So: open first, then persist.
   */
  async function openProfileAndMarkFollowed(id) {
    const account = accountsById.get(id);
    if (!account) return;
    const wasAlreadyFollowed = account.status === 'followed';
    saveLastOpened(id);

    // Open synchronously while this event still has a user-gesture context.
    // Whether opening also marks the account as followed is controlled by
    // the user's local Settings preference.
    let win = null;
    try {
      win = window.open(account.url, '_blank');
      if (win) {
        try { win.opener = null; } catch (_err) {}
      }
    } catch (err) {
      console.warn('[FLM] Profile window could not be opened:', err);
    }

    if (state.autoMarkFollowedOnOpen && !wasAlreadyFollowed) {
      const saved = await applyStatusChange(
        [id],
        'followed',
        { message: 'Opened profile — marked as followed.' }
      );
      if (!saved) return;
    }

    if (!win) {
      const suffix = state.autoMarkFollowedOnOpen && !wasAlreadyFollowed ? ' Marked as followed.' : '';
      toast.show(
        `Profile could not be opened in a new tab.${suffix}`,
        { type: 'warning', duration: 5000 }
      );
    } else if (state.autoMarkFollowedOnOpen && !wasAlreadyFollowed) {
      toast.show('Profile opened and marked as followed.', { type: 'success', duration: 2500 });
    } else {
      toast.show('Profile opened.', { type: 'info', duration: 2000 });
    }
  }

  async function openNextProfile() {
    const ordered = accounts.slice().sort(SORTERS[state.sort] || SORTERS.newest);
    const queue = ordered.filter((a) => a.status === 'not-followed');
    if (!queue.length) {
      toast.show("You're all caught up — no not-followed accounts left.", { type: 'info' });
      return;
    }

    let next = queue[0];
    if (!state.autoMarkFollowedOnOpen && state.lastOpenedId) {
      const lastIndex = ordered.findIndex((a) => a.id === state.lastOpenedId);
      if (lastIndex >= 0) {
        next =
          ordered.slice(lastIndex + 1).find((a) => a.status === 'not-followed') ||
          ordered.slice(0, lastIndex).find((a) => a.status === 'not-followed') ||
          queue[0];
      }
    }
    await openProfileAndMarkFollowed(next.id);
  }

  /* ----------------------------------------------------------------------
   * Import: following-list HTML
   * -------------------------------------------------------------------- */

  function existingKeySet() {
    const keys = new Set();
    for (const a of accounts) keys.add(normalizeUrlKey(a.url));
    return keys;
  }

  async function handleImportAnyFile(file) {
    if (!file) return;
    dom.importProgress.hidden = false;
    dom.importProgressText.textContent = `Reading ${file.name}…`;
    await nextPaint();

    let parsed;
    try {
      parsed = await importer.parseAnyFile(file, existingKeySet());
    } catch (err) {
      dom.importProgress.hidden = true;
      console.error('[FLM] Import failed:', err);
      toast.show(err.message || `Couldn't import "${file.name}".`, { type: 'error' });
      return;
    }

    dom.importProgressText.textContent = 'Saving profile links…';
    await nextPaint();

    const result = parsed.result;
    try {
      if (!result || !Array.isArray(result.accountsToAdd) || result.accountsToAdd.length === 0) {
        const bits = ['No new profile links found.'];
        if (result && result.duplicateCount) bits.push(`${formatNumber(result.duplicateCount)} duplicates were ignored.`);
        if (result && result.invalidCount) bits.push(`${formatNumber(result.invalidCount)} invalid links were skipped.`);
        toast.show(bits.join(' '), { type: 'info' });
        return;
      }

      try {
        await db.putMany(result.accountsToAdd);
      } catch (err) {
        console.error('[FLM] Failed to save imported accounts:', err);
        toast.show("Couldn't save the imported accounts — your browser storage may be full.", { type: 'error' });
        return;
      }
    } finally {
      // Every import path, including "no new links", must clear the progress indicator.
      dom.importProgress.hidden = true;
    }

    for (const acc of result.accountsToAdd) {
      accounts.push(acc);
      accountsById.set(acc.id, acc);
    }

    state.currentPage = 1;
    selection.clear();
    renderAll();

    const parts = [`Imported ${formatNumber(result.accountsToAdd.length)} new profile links.`];
    if (result.duplicateCount > 0) parts.push(`${formatNumber(result.duplicateCount)} duplicates were ignored.`);
    if (result.invalidCount > 0) parts.push(`${formatNumber(result.invalidCount)} invalid links were skipped.`);
    try {
      await db.addHistory({ kind: 'import', files: [file.name], added: result.accountsToAdd.length, duplicates: result.duplicateCount || 0, invalid: result.invalidCount || 0, totalAfter: accounts.length, urls: result.accountsToAdd.map((a) => normalizeUrlKey(a.url)).slice(0, 50000) });
    } catch (err) { console.warn('[FLM] Could not record import history:', err); }
    toast.show(parts.join(' '), { type: 'success' });
  }

  /* ----------------------------------------------------------------------
   * Import: JSON backup
   * -------------------------------------------------------------------- */

  async function handleImportBackupFile(file) {
    if (!file) return;
    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      toast.show("Couldn't read that file.", { type: 'error' });
      return;
    }

    let result;
    try {
      result = importer.parseBackupJson(text, existingKeySet());
    } catch (err) {
      toast.show(err.message || "That backup file couldn't be read.", { type: 'error' });
      return;
    }

    if (result.accountsToAdd.length === 0) {
      const bits = ['No new accounts to restore.'];
      if (result.duplicateCount) bits.push(`${formatNumber(result.duplicateCount)} already existed.`);
      if (result.invalidCount) bits.push(`${formatNumber(result.invalidCount)} entries were invalid.`);
      toast.show(bits.join(' '), { type: 'info' });
      return;
    }

    try {
      await db.putMany(result.accountsToAdd);
    } catch (err) {
      console.error('[FLM] Failed to save restored accounts:', err);
      toast.show("Couldn't save the restored accounts — your browser storage may be full.", { type: 'error' });
      return;
    }

    for (const acc of result.accountsToAdd) {
      accounts.push(acc);
      accountsById.set(acc.id, acc);
    }
    renderAll();

    const parts = [`Restored ${formatNumber(result.accountsToAdd.length)} accounts.`];
    if (result.duplicateCount) parts.push(`${formatNumber(result.duplicateCount)} duplicates were skipped.`);
    if (result.invalidCount) parts.push(`${formatNumber(result.invalidCount)} entries were invalid and skipped.`);
    try { await db.addHistory({ kind: 'restore', files: [file.name], added: result.accountsToAdd.length, duplicates: result.duplicateCount || 0, invalid: result.invalidCount || 0, totalAfter: accounts.length, urls: result.accountsToAdd.map((a) => normalizeUrlKey(a.url)).slice(0, 50000) }); } catch (err) { console.warn('[FLM] Could not record restore history:', err); }
     toast.show(parts.join(' '), { type: 'success' });
  }


  function csvCell(value) {
    const s = String(value ?? '');
    return `"${s.replace(/"/g, '""')}"`;
  }
  function handleExportCsv() {
    if (!accounts.length) { toast.show('There is nothing to export yet.', { type: 'info' }); return; }
    const lines = [['Name', 'URL', 'Status', 'Tags', 'Created', 'Updated'].map(csvCell).join(',')];
    accounts.forEach((a) => lines.push([
      a.name, a.url, a.status, (a.tags || []).join('; '),
      new Date(a.createdAt).toISOString(), new Date(a.updatedAt).toISOString()
    ].map(csvCell).join(',')));
    const blob = new Blob([lines.join('\\r\\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `follow-list-${formatDateForFilename(new Date())}.csv`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.show('CSV exported successfully.', { type: 'success' });
  }

  function handleExportHtml() {
    if (!accounts.length) { toast.show('There is nothing to export yet.', { type: 'info' }); return; }
    const rows = accounts.map((a) =>
      `<tr><td>${escapeHtml(a.name)}</td><td><a href="${escapeHtml(a.url)}">${escapeHtml(a.url)}</a></td><td>${escapeHtml(STATUS_LABELS[a.status] || a.status)}</td><td>${(a.tags || []).map(escapeHtml).join(', ')}</td></tr>`
    ).join('');
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Follow List Report</title><style>body{font:14px system-ui;padding:24px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border:1px solid #ddd;text-align:left}th{background:#f3f4f6}</style></head><body><h1>Follow List Report</h1><p>Generated ${new Date().toLocaleString()}</p><table><thead><tr><th>Name</th><th>URL</th><th>Status</th><th>Tags</th></tr></thead><tbody>${rows}</tbody></table></body></html>`;
    const blob = new Blob([doc], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob); const link = document.createElement('a');
    link.href = url; link.download = `follow-list-report-${formatDateForFilename(new Date())}.html`;
    document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast.show('HTML report exported.', { type: 'success' });
  }
  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;'}[c]));
  }

  /* ----------------------------------------------------------------------
   * Export
   * -------------------------------------------------------------------- */

  function handleExport() {
    if (accounts.length === 0) {
      toast.show('There is nothing to export yet.', { type: 'info' });
      return;
    }
    const payload = {
      app: 'Follow List Manager',
      version: 1,
      exportedAt: new Date().toISOString(),
      accountCount: accounts.length,
      accounts: accounts.map((a) => ({
        id: a.id,
        name: a.name,
        url: a.url,
        status: a.status,
        tags: Array.isArray(a.tags) ? [...a.tags] : [],
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      })),
    };
    const filename = `follow-list-backup-${formatDateForFilename(new Date())}.json`;
    try {
      downloadJSON(filename, payload);
      toast.show('Backup exported successfully.', { type: 'success' });
    } catch (err) {
      console.error('[FLM] Export failed:', err);
      toast.show("Couldn't export a backup.", { type: 'error' });
    }
  }

  /* ----------------------------------------------------------------------
   * Reset
   * -------------------------------------------------------------------- */

  function handleReset() {
    modal.open({
      title: 'Delete all accounts?',
      bodyNodes: [
        el('p', {
          text: 'Are you sure you want to delete all accounts and saved progress? Make sure you have exported a backup first.',
        }),
      ],
      actions: [
        { label: 'Cancel', variant: 'secondary', autofocus: true },
        {
          label: 'Delete everything',
          variant: 'danger',
          onClick: async () => {
            try {
              await db.clear();
              if (typeof db.clearHistory === 'function') await db.clearHistory();
            } catch (err) {
              console.error('[FLM] Reset failed:', err);
              toast.show("Couldn't clear saved data.", { type: 'error' });
              return;
            }
            accounts = [];
            accountsById.clear();
            selection.clear();
            renderAll();
            toast.show('All accounts and progress have been deleted.', { type: 'success' });
          },
        },
      ],
    });
  }

  /* ----------------------------------------------------------------------
   * About / privacy modal
   * -------------------------------------------------------------------- */

  function openAboutModal() {
    const mode = db.getMode();
    const storageLine =
      mode === 'localStorage'
        ? "This browser doesn't support IndexedDB, so accounts are saved in local storage instead. That works the same way, just with a lower size ceiling."
        : 'Your accounts and their statuses are saved on this device using IndexedDB.';

    modal.open({
      title: 'Privacy & how this works',
      bodyNodes: [
        el('p', {
          text: 'Follow List Manager runs entirely in this browser tab. Nothing you import is uploaded anywhere — there is no server, no account, and no analytics.',
        }),
        el('p', { text: storageLine + ' Clearing this browser\u2019s site data for this page will erase it, so export a backup if you want a copy you can keep.' }),
        el('p', {
          text: 'Clicking "Open Profile" opens the link in a new tab. When Auto-Mark is enabled it also marks the account as followed; when Auto-Mark is disabled, the status stays unchanged until you update it manually. This app cannot see or confirm what happens on the other site.',
        }),
      ],
      actions: [{ label: 'Got it', variant: 'primary', autofocus: true }],
    });
  }

  function openSettingsModal() {
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = state.autoMarkFollowedOnOpen;
    checkbox.id = 'autoMarkFollowedOnOpen';
    checkbox.setAttribute('aria-describedby', 'autoMarkFollowedOnOpenHint');

    const option = document.createElement('div');
    option.className = 'settings-option';
    option.appendChild(checkbox);

    const copy = document.createElement('div');
    copy.className = 'settings-option__copy';

    const title = document.createElement('span');
    title.className = 'settings-option__title';
    title.textContent = 'Automatically mark as Followed when opening a profile';

    const hint = document.createElement('span');
    hint.className = 'settings-option__hint';
    hint.id = 'autoMarkFollowedOnOpenHint';
    hint.textContent = 'When enabled, Open Profile marks the account as Followed immediately. When disabled, opening a profile only opens the link and leaves its status unchanged.';

    copy.append(title, hint);
    option.appendChild(copy);

    const note = el('p', {
      text: 'This only controls the local tracker. The app cannot verify what happens on the external social-media site.',
    });
    note.className = 'settings-option__hint';

    modal.open({
      title: 'Settings',
      bodyNodes: [option, note],
      actions: [{ label: 'Done', variant: 'primary', autofocus: true }],
    });

    checkbox.addEventListener('change', () => {
      state.autoMarkFollowedOnOpen = checkbox.checked;
      settings.set('autoMarkFollowedOnOpen', state.autoMarkFollowedOnOpen);
      toast.show(
        state.autoMarkFollowedOnOpen
          ? 'Open Profile will now mark accounts as followed.'
          : 'Open Profile will no longer change account status.',
        { type: 'success', duration: 2500 }
      );
    });

    setTimeout(() => checkbox.focus(), 0);
  }

  function applyLayout(layout) {
    state.layout = VALID_LAYOUTS.has(layout) ? layout : 'cards';
    document.documentElement.setAttribute('data-layout', state.layout);
    dom.btnLayoutCards.setAttribute('aria-pressed', state.layout === 'cards' ? 'true' : 'false');
    dom.btnLayoutTable.setAttribute('aria-pressed', state.layout === 'table' ? 'true' : 'false');
    settings.set('layout', state.layout);
    renderList();
  }
  function setLayout(layout) {
    if (!VALID_LAYOUTS.has(layout)) return;
    state.layout = layout;
    applyLayout(layout);
  }

  /* ----------------------------------------------------------------------
   * Theme + view preferences
   * -------------------------------------------------------------------- */

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    dom.btnTheme.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
    dom.btnTheme.title = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';
    dom.iconThemeSun.hidden = theme === 'dark';
    dom.iconThemeMoon.hidden = theme !== 'dark';
  }

  function initTheme() {
    const stored = settings.get('theme', null);
    const validStored = stored === 'dark' || stored === 'light';
    const systemDark = !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    const theme = validStored ? stored : (systemDark ? 'dark' : 'light');
    applyTheme(theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    settings.set('theme', next);
  }

  function applyView(view) {
    document.documentElement.setAttribute('data-view', view);
    const labels = { compact: 'Compact', comfortable: 'Normal', large: 'Large' };
    dom.btnViewToggle.textContent = labels[view] || 'Normal';
    dom.btnViewToggle.setAttribute('aria-pressed', view === 'large' ? 'true' : 'false');
    dom.btnViewToggle.title = `Account size: ${labels[view] || 'Normal'}`;
  }

  function setView(view) {
    if (!VALID_VIEWS.has(view)) return;
    state.view = view;
    applyView(view);
    settings.set('view', view);
    if (typeof virtualList !== 'undefined' && virtualList && virtualList.setView) virtualList.setView(view);
    renderAll();
  }

  function toggleView() {
    const order = ['compact', 'comfortable', 'large'];
    setView(order[(order.indexOf(state.view) + 1) % order.length]);
  }

  function changeView(delta) {
    const order = ['compact', 'comfortable', 'large'];
    const index = Math.max(0, Math.min(order.length - 1, order.indexOf(state.view) + delta));
    setView(order[index]);
  }

  function toggleFocusList(force) {
    const next = typeof force === 'boolean' ? force : !state.focusList;
    state.focusList = next;
    document.body.classList.toggle('focus-list', state.focusList);
    dom.btnFocusList.setAttribute('aria-pressed', state.focusList ? 'true' : 'false');
    dom.btnFocusList.title = state.focusList ? 'Exit maximize account list' : 'Maximize account list';
    if (dom.btnExitFocusList) dom.btnExitFocusList.hidden = !state.focusList;
    if (state.focusList) {
      try { dom.listViewport.focus({ preventScroll: true }); }
      catch (_err) { if (dom.btnExitFocusList) dom.btnExitFocusList.focus(); }
    }
  }


  function normalizeTags(input) {
    return [...new Set(String(input || '').split(',').map((t) => FLM.utils.sanitizeName(t).replace(/^#/, '').trim()).filter(Boolean))].slice(0, 20);
  }

  async function editTags(id) {
    const account = accountsById.get(id);
    if (!account) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.value = (account.tags || []).join(', ');
    input.placeholder = 'e.g. friends, creators, gaming';
    input.setAttribute('aria-label', 'Comma-separated tags');
    modal.open({
      title: `Tags for ${account.name}`,
      bodyNodes: [
        el('p', { text: 'Add comma-separated tags. Keep them short so they remain useful as filters.' }),
        input,
      ],
      actions: [
        { label: 'Cancel', variant: 'secondary', autofocus: true },
        {
          label: 'Save tags',
          variant: 'primary',
          onClick: async () => {
            const updated = { ...account, tags: normalizeTags(input.value), updatedAt: Date.now() };
            try {
              await db.put(updated);
              Object.assign(account, updated);
              renderAll();
              toast.show('Tags saved.', { type: 'success', duration: 2000 });
            } catch (err) {
              console.error('[FLM] Tag save failed:', err);
              toast.show("Couldn't save tags.", { type: 'error' });
            }
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 0);
  }

  async function bulkAddTag() {
    const ids = Array.from(selection);
    if (!ids.length) return;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    input.placeholder = 'Tag to add, e.g. later';
    input.setAttribute('aria-label', 'Tag to add');
    modal.open({
      title: `Add tag to ${formatNumber(ids.length)} accounts`,
      bodyNodes: [el('p', { text: 'Enter one tag. It will be added without removing existing tags.' }), input],
      actions: [
        { label: 'Cancel', variant: 'secondary', autofocus: true },
        {
          label: 'Add tag',
          variant: 'primary',
          onClick: async () => {
            const tag = normalizeTags(input.value)[0];
            if (!tag) { toast.show('Enter a tag first.', { type: 'warning' }); return; }
            const now = Date.now();
            const updates = ids.map((id) => accountsById.get(id)).filter(Boolean).map((a) => ({
              ...a, tags: [...new Set([...(a.tags || []), tag])].slice(0, 20), updatedAt: now
            }));
            try {
              await db.putMany(updates);
              updates.forEach((u) => Object.assign(accountsById.get(u.id), u));
              selection.clear();
              renderAll();
              toast.show(`Added "${tag}" to ${formatNumber(updates.length)} accounts.`, { type: 'success' });
            } catch (err) {
              console.error('[FLM] Bulk tag save failed:', err);
              toast.show("Couldn't save tags.", { type: 'error' });
            }
          },
        },
      ],
    });
    setTimeout(() => input.focus(), 0);
  }

  async function openHistoryModal() {
    try {
      const history = await db.getHistory();
      const body = document.createElement('div');
      body.className = 'history-list';
      if (!history.length) {
        body.appendChild(el('p', { text: 'No imports or restores have been recorded yet.' }));
      } else {
        if (history.length >= 2) {
          const compare = document.createElement('button');
          compare.type = 'button';
          compare.className = 'btn btn--secondary btn--small';
          compare.textContent = 'Compare latest two import additions';
          compare.addEventListener('click', () => {
            const a = history[0], b = history[1];
            const first = new Set(Array.isArray(a.urls) ? a.urls : []);
            const second = new Set(Array.isArray(b.urls) ? b.urls : []);
            let added = 0, removed = 0, same = 0;
            for (const u of first) first.has(u) && second.has(u) && same++;
            for (const u of first) if (!second.has(u)) added++;
            for (const u of second) if (!first.has(u)) removed++;
            modal.open({
              title: 'Latest import additions comparison',
              bodyNodes: [
                el('p', { text: `${a.files?.join(', ') || 'Latest import'} compared with ${b.files?.join(', ') || 'Previous import'} based on URLs added by those import events.` }),
                el('p', { text: `Among the URLs added by these events: ${formatNumber(added)} appear only in the latest event, ${formatNumber(same)} appear in both events, and ${formatNumber(removed)} appear only in the previous event.` }),
              ],
              actions: [{ label: 'Close', variant: 'primary', autofocus: true }],
            });
          });
          body.appendChild(compare);
        }
        history.slice(0, 20).forEach((item) => {
          const row = document.createElement('div');
          row.className = 'history-item';
          const title = item.kind === 'restore' ? 'Restored backup' : 'Imported file';
          row.appendChild(el('strong', { text: title }));
          const files = Array.isArray(item.files) ? item.files.join(', ') : 'Local file';
          row.appendChild(el('span', { text: `${files} • +${formatNumber(item.added || 0)} • ${formatNumber(item.totalAfter || 0)} total • ${new Date(item.at || Date.now()).toLocaleString()}` }));
          body.appendChild(row);
        });
      }
      modal.open({
        title: 'Import history',
        bodyNodes: [body],
        actions: [
          { label: 'Close', variant: 'primary', autofocus: true },
          { label: 'Clear history', variant: 'danger', onClick: async () => {
            try {
              await db.clearHistory();
              modal.close();
              toast.show('History cleared.', { type: 'success' });
            } catch (err) {
              toast.show("Couldn't clear history.", { type: 'error' });
            }
          }},
        ],
      });
    } catch (err) {
      console.error('[FLM] History read failed:', err);
      toast.show("Couldn't read import history.", { type: 'error' });
    }
  }


  function getTriageAccounts() {
    return accounts
      .filter((a) => a.status === 'not-followed')
      .slice()
      .sort(SORTERS[state.sort] || SORTERS.newest);
  }

  function renderTriage() {
    const list = getTriageAccounts();
    if (!list.length) {
      dom.triageCounter.textContent = 'No not-followed accounts remain.';
      dom.triageName.textContent = 'You are all caught up.';
      dom.triageUrl.textContent = '';
      dom.triageUrl.removeAttribute('href');
      dom.triageStatus.hidden = true;
      dom.triageOpen.disabled = true;
      dom.triageFollow.disabled = true;
      dom.triageSkip.disabled = true;
      dom.triagePrev.disabled = true;
      dom.triageNext.disabled = true;
      return;
    }
    state.triageIndex = Math.max(0, Math.min(state.triageIndex, list.length - 1));
    const a = list[state.triageIndex];
    dom.triageCounter.textContent = `${formatNumber(state.triageIndex + 1)} of ${formatNumber(list.length)} not-followed accounts`;
    dom.triageName.textContent = a.name;
    dom.triageUrl.textContent = a.url;
    dom.triageUrl.href = a.url;
    dom.triageStatus.hidden = false;
    dom.triageStatus.textContent = STATUS_LABELS[a.status] || a.status;
    dom.triageOpen.disabled = false;
    dom.triageFollow.disabled = false;
    dom.triageSkip.disabled = false;
    dom.triagePrev.disabled = state.triageIndex <= 0;
    dom.triageNext.disabled = state.triageIndex >= list.length - 1;
  }

  function openTriage() {
    state.triageOpen = true;
    state.triageIndex = 0;
    dom.triageBackdrop.hidden = false;
    renderTriage();
    setTimeout(() => dom.triageOpen.focus(), 0);
  }
  function closeTriage() {
    state.triageOpen = false;
    dom.triageBackdrop.hidden = true;
    dom.btnTriage.focus();
  }
  async function triageAction(action) {
    const list = getTriageAccounts();
    if (!list.length) return;
    const a = list[state.triageIndex];
    if (!a) return;
    if (action === 'open') {
      await openProfileAndMarkFollowed(a.id);
    } else if (action === 'follow') {
      await applyStatusChange([a.id], 'followed', { message: 'Marked as followed.' });
    } else if (action === 'skip') {
      await applyStatusChange([a.id], 'skipped', { message: 'Account skipped.' });
    }
    const fresh = getTriageAccounts();
    if (state.triageIndex >= fresh.length) state.triageIndex = Math.max(0, fresh.length - 1);
    renderTriage();
  }

  function resumeLastOpened() {
    const a = state.lastOpenedId ? accountsById.get(state.lastOpenedId) : null;
    if (!a) { toast.show('No saved last-opened account is available.', { type: 'info' }); return; }
    openProfileAndMarkFollowed(a.id);
  }

  function saveLastOpened(id) {
    state.lastOpenedId = id;
    settings.set('lastOpenedId', id);
    settings.set('lastOpenedAt', Date.now());
  }

  /* ----------------------------------------------------------------------
   * Command palette
   * -------------------------------------------------------------------- */

  const COMMANDS = [
    { id: 'import', icon: '↥', title: 'Import files', hint: 'Add profile links from HTML, TXT, CSV and other supported files.', key: 'I', run: () => dom.fileImportHtml.click() },
    { id: 'next', icon: '→', title: 'Open next profile', hint: 'Open the next Not Followed profile.', key: 'N', run: openNextProfile },
    { id: 'triage', icon: '◇', title: 'Open Triage mode', hint: 'Work through accounts one by one.', key: 'T', run: openTriage },
    { id: 'resume', icon: '↺', title: 'Resume last account', hint: 'Jump back to the last opened profile.', key: 'R', run: resumeLastOpened },
    { id: 'theme', icon: '◐', title: 'Toggle theme', hint: 'Switch between light and dark appearance.', key: '', run: toggleTheme },
    { id: 'layout', icon: '▦', title: 'Toggle list layout', hint: 'Switch between Cards and Table.', key: '', run: () => setLayout(state.layout === 'cards' ? 'table' : 'cards') },
    { id: 'focus', icon: '⛶', title: 'Toggle focus mode', hint: 'Maximize the account list.', key: '', run: () => toggleFocusList() },
    { id: 'settings', icon: '⚙', title: 'Open settings', hint: 'Configure account-opening behavior.', key: '', run: openSettingsModal },
    { id: 'export', icon: '↓', title: 'Export JSON backup', hint: 'Save a portable backup of your local data.', key: 'E', run: handleExport },
  ];
  let commandFiltered = COMMANDS.slice();
  let commandIndex = 0;

  function renderCommandList() {
    const q = String(dom.commandInput.value || '').trim().toLowerCase();
    commandFiltered = COMMANDS.filter((c) =>
      `${c.title} ${c.hint}`.toLowerCase().includes(q)
    );
    if (commandIndex >= commandFiltered.length) commandIndex = Math.max(0, commandFiltered.length - 1);
    dom.commandList.replaceChildren();
    commandFiltered.forEach((cmd, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `command-item${i === commandIndex ? ' is-active' : ''}`;
      btn.dataset.commandId = cmd.id;
      btn.setAttribute('role', 'option');
      btn.setAttribute('aria-selected', i === commandIndex ? 'true' : 'false');
      const icon = document.createElement('span');
      icon.className = 'command-item__icon';
      icon.textContent = cmd.icon;
      const text = document.createElement('span');
      const title = document.createElement('span');
      title.className = 'command-item__title';
      title.textContent = cmd.title;
      const hint = document.createElement('span');
      hint.className = 'command-item__hint';
      hint.textContent = cmd.hint;
      text.append(title, hint);
      btn.append(icon, text);
      if (cmd.key) {
        const key = document.createElement('kbd');
        key.textContent = cmd.key;
        btn.appendChild(key);
      } else {
        btn.appendChild(document.createElement('span'));
      }
      dom.commandList.appendChild(btn);
    });
  }

  function openCommandPalette() {
    dom.commandBackdrop.hidden = false;
    dom.commandInput.value = '';
    commandIndex = 0;
    renderCommandList();
    setTimeout(() => dom.commandInput.focus(), 0);
  }

  function closeCommandPalette() {
    dom.commandBackdrop.hidden = true;
  }

  function runSelectedCommand() {
    const cmd = commandFiltered[commandIndex];
    if (!cmd) return;
    closeCommandPalette();
    try { cmd.run(); } catch (err) {
      console.error('[FLM] Command failed:', err);
      toast.show("Couldn't run that action.", { type: 'error' });
    }
  }

  /* ----------------------------------------------------------------------
   * Event wiring
   * -------------------------------------------------------------------- */

  function wireEvents() {
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      dom.btnInstall.hidden = false;
    });
    window.addEventListener('appinstalled', () => {
      deferredInstallPrompt = null;
      dom.btnInstall.hidden = true;
      toast.show('App installed.', { type: 'success', duration: 2500 });
    });
    dom.btnInstall.addEventListener('click', async () => {
      if (!deferredInstallPrompt) return;
      try {
        await deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
      } catch (_err) {}
      deferredInstallPrompt = null;
      dom.btnInstall.hidden = true;
    });
    dom.btnAbout.addEventListener('click', openAboutModal);
    dom.btnHistory.addEventListener('click', openHistoryModal);
    dom.btnSettings.addEventListener('click', openSettingsModal);
    dom.btnAboutInline.addEventListener('click', openAboutModal);
    dom.btnCommand.addEventListener('click', openCommandPalette);
    dom.btnCloseCommand.addEventListener('click', closeCommandPalette);
    dom.commandBackdrop.addEventListener('click', (e) => {
      if (e.target === dom.commandBackdrop) closeCommandPalette();
    });
    dom.commandInput.addEventListener('input', () => { commandIndex = 0; renderCommandList(); });
    dom.commandList.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-command-id]');
      if (!btn) return;
      commandIndex = commandFiltered.findIndex((c) => c.id === btn.dataset.commandId);
      runSelectedCommand();
    });
    dom.btnTheme.addEventListener('click', toggleTheme);
    dom.btnViewToggle.addEventListener('click', toggleView);
    dom.btnViewSmaller.addEventListener('click', () => changeView(-1));
    dom.btnViewLarger.addEventListener('click', () => changeView(1));
    dom.btnFocusList.addEventListener('click', toggleFocusList);
    if (dom.btnExitFocusList) dom.btnExitFocusList.addEventListener('click', () => toggleFocusList(false));
    dom.btnLayoutCards.addEventListener('click', () => setLayout('cards'));
    dom.btnLayoutTable.addEventListener('click', () => setLayout('table'));
    dom.tagFilter.addEventListener('change', (e) => {
      state.tagFilter = e.target.value;
      state.currentPage = 1;
      selection.clear();
      settings.set('tagFilter', state.tagFilter);
      renderAll();
    });
    dom.btnBulkTag.addEventListener('click', bulkAddTag);

    dom.btnImportHtml.addEventListener('click', () => dom.fileImportHtml.click());
    dom.fileImportHtml.addEventListener('change', async (e) => {
      const files = Array.from(e.target.files || []);
      e.target.value = ''; // allow re-selecting the same file later
      for (const file of files) {
        await handleImportAnyFile(file);
      }
    });
    dom.emptyStateAction.addEventListener('click', () => dom.fileImportHtml.click());

    dom.btnImportBackup.addEventListener('click', () => dom.fileImportBackup.click());
    dom.fileImportBackup.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      await handleImportBackupFile(file);
    });

    dom.btnExport.addEventListener('click', handleExport);
    dom.btnExportCsv.addEventListener('click', handleExportCsv);
    dom.btnExportHtml.addEventListener('click', handleExportHtml);
    dom.btnReset.addEventListener('click', handleReset);
    dom.btnOpenNext.addEventListener('click', openNextProfile);
     dom.btnTriage.addEventListener('click', openTriage);
     dom.btnResume.addEventListener('click', resumeLastOpened);
     dom.triageClose.addEventListener('click', closeTriage);
     dom.triageOpen.addEventListener('click', () => triageAction('open'));
     dom.triageFollow.addEventListener('click', () => triageAction('follow'));
     dom.triageSkip.addEventListener('click', () => triageAction('skip'));
     dom.triagePrev.addEventListener('click', () => { state.triageIndex--; renderTriage(); });
     dom.triageNext.addEventListener('click', () => { state.triageIndex++; renderTriage(); });
     dom.triageBackdrop.addEventListener('click', (e) => { if (e.target === dom.triageBackdrop) closeTriage(); });

    dom.filterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-filter]');
      if (!tab) return;
      state.filter = tab.dataset.filter;
      state.currentPage = 1;
      selection.clear();
      settings.set('filter', state.filter);
      renderAll();
    });

    dom.searchInput.addEventListener(
      'input',
      debounce((e) => {
        state.search = e.target.value.trim().toLowerCase();
        state.currentPage = 1;
        selection.clear();
        renderAll();
      }, 120)
    );

    dom.sortSelect.value = state.sort;
    dom.sortSelect.addEventListener('change', (e) => {
      state.sort = VALID_SORTS.has(e.target.value) ? e.target.value : 'newest';
      state.currentPage = 1;
      selection.clear();
      settings.set('sort', state.sort);
      renderAll();
    });

    dom.btnPrevPage.addEventListener('click', () => {
      if (state.currentPage <= 1) return;
      state.currentPage -= 1;
      dom.listViewport.scrollTop = 0;
      renderAll();
    });
    dom.btnNextPage.addEventListener('click', () => {
      const totalPages = Math.ceil(visibleList.length / state.pageSize);
      if (state.currentPage >= totalPages) return;
      state.currentPage += 1;
      dom.listViewport.scrollTop = 0;
      renderAll();
    });

    dom.selectAllVisible.addEventListener('change', (e) => {
      if (e.target.checked) {
        pagedList.forEach((a) => selection.add(a.id));
      } else {
        pagedList.forEach((a) => selection.delete(a.id));
      }
      renderSelectionUi();
      renderList();
    });

    dom.btnClearSelection.addEventListener('click', () => {
      selection.clear();
      renderSelectionUi();
      renderList();
    });

    dom.bulkBar.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-bulk]');
      if (!btn) return;
      const ids = Array.from(selection);
      const newStatus = btn.dataset.bulk;
      applyStatusChange(ids, newStatus).then((saved) => {
        if (saved) selection.clear();
        renderSelectionUi();
      });
    });

    // Delegated handlers for the (repeatedly re-rendered) row list.
    dom.listRows.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'open') {
        openProfileAndMarkFollowed(id);
      } else if (action === 'mark-followed') {
        applyStatusChange([id], 'followed');
      } else if (action === 'mark-skipped') {
        applyStatusChange([id], 'skipped');
      } else if (action === 'mark-not-followed') {
        applyStatusChange([id], 'not-followed');
      } else if (action === 'tags') {
        editTags(id);
      } else if (action === 'copy') {
        copyAccountLink(id);
      }
    });

    dom.listRows.addEventListener('change', (e) => {
      const checkbox = e.target.closest('[data-select-id]');
      if (!checkbox) return;
      const id = checkbox.dataset.selectId;
      if (checkbox.checked) selection.add(id);
      else selection.delete(id);
      renderSelectionUi();
    });

    dom.tableRows.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const { action, id } = btn.dataset;
      if (action === 'open') openProfileAndMarkFollowed(id);
      else if (action === 'mark-followed') applyStatusChange([id], 'followed');
      else if (action === 'mark-skipped') applyStatusChange([id], 'skipped');
      else if (action === 'mark-not-followed') applyStatusChange([id], 'not-followed');
      else if (action === 'tags') editTags(id);
      else if (action === 'copy') copyAccountLink(id);
    });
    dom.tableRows.addEventListener('change', (e) => {
      const checkbox = e.target.closest('[data-select-id]');
      if (!checkbox) return;
      const id = checkbox.dataset.selectId;
      if (checkbox.checked) selection.add(id); else selection.delete(id);
      renderSelectionUi();
    });

    window.addEventListener('resize', debounce(() => virtualList.onResize(), 100));

    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (dom.commandBackdrop.hidden) openCommandPalette(); else closeCommandPalette();
        return;
      }

      if (!dom.commandBackdrop.hidden) {
        if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); return; }
        if (e.key === 'ArrowDown') { e.preventDefault(); commandIndex = Math.min(commandIndex + 1, Math.max(0, commandFiltered.length - 1)); renderCommandList(); return; }
        if (e.key === 'ArrowUp') { e.preventDefault(); commandIndex = Math.max(commandIndex - 1, 0); renderCommandList(); return; }
        if (e.key === 'Enter') { e.preventDefault(); runSelectedCommand(); return; }
        return;
      }

      if (state.focusList && e.key === 'Escape') {
        e.preventDefault();
        toggleFocusList(false);
        return;
      }

      if (state.triageOpen) {
        if (e.key === 'Escape') { closeTriage(); return; }
        if (!typing && e.key === 'ArrowLeft') { e.preventDefault(); dom.triagePrev.click(); return; }
        if (!typing && e.key === 'ArrowRight') { e.preventDefault(); dom.triageNext.click(); return; }
        return;
      }
      if (e.key === 'Escape' && document.activeElement === dom.searchInput && dom.searchInput.value) {
        dom.searchInput.value = '';
        state.search = '';
        state.currentPage = 1;
        selection.clear();
        renderAll();
        return;
      }
      if (typing) return;

      if (e.key === '/') {
        e.preventDefault();
        dom.searchInput.focus();
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault();
        openNextProfile();
      } else if (e.key === 'p' || e.key === 'P') {
        e.preventDefault();
        if (state.currentPage > 1) { state.currentPage -= 1; dom.listViewport.scrollTop = 0; renderAll(); }
      } else if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        if (state.currentPage < Math.ceil(visibleList.length / state.pageSize)) { state.currentPage += 1; dom.listViewport.scrollTop = 0; renderAll(); }
      }
    });
  }

  function copyAccountLink(id) {
    const account = accountsById.get(id);
    if (!account) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard
        .writeText(account.url)
        .then(() => toast.show('Link copied.', { type: 'info', duration: 2000 }))
        .catch(() => legacyCopy(account.url));
    } else {
      legacyCopy(account.url);
    }
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    let copied = false;
    try { copied = document.execCommand('copy'); } catch (_err) { copied = false; }
    area.remove();
    toast.show(copied ? 'Link copied.' : "Couldn't copy the link.", { type: copied ? 'info' : 'error', duration: 2000 });
  }

  /* ----------------------------------------------------------------------
   * Init
   * -------------------------------------------------------------------- */

  async function init() {
    initTheme();
    applyView(state.view);

    dom.filterTabs.querySelectorAll('.filter-tab').forEach((tab) => {
      tab.classList.toggle('is-active', tab.dataset.filter === state.filter);
      tab.setAttribute('aria-selected', tab.dataset.filter === state.filter ? 'true' : 'false');
    });


    // Storage must never be able to keep the application on the loading screen.
    // db.js already falls back from IndexedDB to localStorage, but this final
    // guard also protects against unexpected browser/storage failures.
    let storageWarning = '';
    try {
      await db.init();
      const loaded = await db.getAll();
      accounts = normalizeLoadedAccounts(loaded);
      accountsById.clear();
      for (const a of accounts) accountsById.set(a.id, a);

      if (db.getMode() === 'localStorage') {
        storageWarning = 'Using local storage for saving because IndexedDB is unavailable or did not respond. Large lists may be a little slower.';
      }
    } catch (err) {
      console.error('[FLM] Failed to load saved accounts:', err);
      accounts = [];
      accountsById.clear();
      storageWarning = "Couldn't load browser storage, so the app started with an empty list. Check your browser's site storage settings.";
    } finally {
      // Startup must continue even if browser storage is unavailable.
    }

    state.lastOpenedId = settings.get('lastOpenedId', null);

    if (storageWarning) {
      toast.show(storageWarning, { type: 'warning', duration: 8000 });
    }

    virtualList = new render.VirtualList({
      viewport: dom.listViewport,
      sizer: dom.listSizer,
      rowsContainer: dom.listRows,
      view: state.view,
      getCount: () => pagedList.length,
      renderRow,
    });
    applyLayout(state.layout);

    const lastOpenedAt = settings.get('lastOpenedAt', null);
    if (state.lastOpenedId && lastOpenedAt) {
      const last = accountsById.get(state.lastOpenedId);
      if (last) {
        dom.listFootnote.textContent = `Last opened: ${last.name} • ${new Date(lastOpenedAt).toLocaleString()} • Tip: / searches, N opens next, P/J change pages.`;
      } else {
        dom.listFootnote.textContent = 'Tip: / searches, N opens next, P/J change pages.';
      }
    } else {
      dom.listFootnote.textContent = 'Tip: / searches, N opens next, P/J change pages.';
    }

    wireEvents();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

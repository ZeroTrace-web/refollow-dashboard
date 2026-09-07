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
    filter: settings.get('filter', 'all'),
    sort: settings.get('sort', 'newest'),
    view: settings.get('view', 'comfortable'),
    search: '',
  };

  let visibleList = []; // accounts after filter + search + sort, in display order
  let counts = { all: 0, 'not-followed': 0, followed: 0, skipped: 0 };

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
    btnAboutInline: $('btnAboutInline'),
    btnViewToggle: $('btnViewToggle'),
    btnTheme: $('btnTheme'),
    iconThemeSun: $('iconThemeSun'),
    iconThemeMoon: $('iconThemeMoon'),

    btnImportHtml: $('btnImportHtml'),
    fileImportHtml: $('fileImportHtml'),
    btnOpenNext: $('btnOpenNext'),
    btnExport: $('btnExport'),
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

    searchInput: $('searchInput'),
    sortSelect: $('sortSelect'),

    bulkBar: $('bulkBar'),
    bulkCount: $('bulkCount'),
    btnClearSelection: $('btnClearSelection'),

    selectAllVisible: $('selectAllVisible'),
    listHeaderHint: $('listHeaderHint'),

    listViewport: $('listViewport'),
    listSizer: $('listSizer'),
    listRows: $('listRows'),
    emptyState: $('emptyState'),
    emptyStateText: $('emptyStateText'),
    emptyStateAction: $('emptyStateAction'),
    listFootnote: $('listFootnote'),

    loadingOverlay: $('loadingOverlay'),
    importProgress: $('importProgress'),
    importProgressText: $('importProgressText'),
  };

  /* ----------------------------------------------------------------------
   * Derived state + rendering
   * -------------------------------------------------------------------- */

  function recomputeDerived() {
    counts = { all: accounts.length, 'not-followed': 0, followed: 0, skipped: 0 };
    for (const a of accounts) counts[a.status]++;

    let list = accounts;
    if (state.filter !== 'all') list = list.filter((a) => a.status === state.filter);
    if (state.search) {
      const q = state.search;
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.url.toLowerCase().includes(q));
    }
    visibleList = list.slice().sort(SORTERS[state.sort] || SORTERS.newest);

    // Selection can only ever refer to accounts that still exist.
    for (const id of selection) {
      if (!accountsById.has(id)) selection.delete(id);
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
    const visibleIds = visibleList.map((a) => a.id);
    const selectedVisible = visibleIds.filter((id) => selection.has(id));
    dom.selectAllVisible.checked = visibleIds.length > 0 && selectedVisible.length === visibleIds.length;
    dom.selectAllVisible.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length;

    dom.bulkBar.hidden = selection.size === 0;
    dom.bulkCount.textContent = `${formatNumber(selection.size)} selected`;
  }

  function renderListMeta() {
    dom.listHeaderHint.textContent = visibleList.length ? `${formatNumber(visibleList.length)} shown` : '';
  }

  function renderRow(index, total) {
    const account = visibleList[index];
    return render.createRowElement(account, { index, total, selected: selection.has(account.id) });
  }

  let virtualList = null;

  function renderList() {
    virtualList.refresh();
  }

  function renderAll() {
    recomputeDerived();
    renderStats();
    renderFilterCounts();
    renderEmptyState();
    renderSelectionUi();
    renderListMeta();
    renderOpenNextAvailability();
    renderList();
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
      ids.forEach((id) => {
        const selectorId = window.CSS && CSS.escape ? CSS.escape(id) : id;
        const rowEl = dom.listRows.querySelector(`[data-id="${selectorId}"]`);
        if (!rowEl) return;
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

    const win = window.open(account.url, '_blank', 'noopener,noreferrer');
    if (!win) {
      toast.show('Your browser blocked that popup. Allow popups for this page and try again.', { type: 'error' });
      return;
    }
    if (wasAlreadyFollowed) {
      toast.show('Profile opened.', { type: 'info', duration: 2000 });
      return;
    }
    await applyStatusChange([id], 'followed', { message: 'Opened profile — marked as followed.' });
  }

  async function openNextProfile() {
    const queue = accounts.filter((a) => a.status === 'not-followed').sort(SORTERS[state.sort] || SORTERS.newest);
    const next = queue[0];
    if (!next) {
      toast.show("You're all caught up — no not-followed accounts left.", { type: 'info' });
      return;
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

  async function handleImportHtmlFile(file) {
    if (!file) return;
    dom.importProgress.hidden = false;
    dom.importProgressText.textContent = `Reading ${file.name}…`;
    await nextPaint();

    let text;
    try {
      text = await readFileAsText(file);
    } catch (err) {
      dom.importProgress.hidden = true;
      toast.show("Couldn't read that file.", { type: 'error' });
      return;
    }

    dom.importProgressText.textContent = 'Extracting profile links…';
    await nextPaint();

    let result;
    try {
      result = importer.parseFollowingHtml(text, existingKeySet());
    } catch (err) {
      dom.importProgress.hidden = true;
      toast.show(err.message || "That file couldn't be parsed as HTML.", { type: 'error' });
      return;
    }

    dom.importProgress.hidden = true;

    if (result.linksFound === 0) {
      toast.show('No links were found in that file.', { type: 'warning' });
      return;
    }
    if (result.accountsToAdd.length === 0) {
      toast.show(`No new profile links found. ${formatNumber(result.duplicateCount)} duplicates were ignored.`, {
        type: 'info',
      });
      return;
    }

    try {
      await db.putMany(result.accountsToAdd);
    } catch (err) {
      console.error('[FLM] Failed to save imported accounts:', err);
      toast.show("Couldn't save the imported accounts — your browser storage may be full.", { type: 'error' });
      return;
    }

    for (const acc of result.accountsToAdd) {
      accounts.push(acc);
      accountsById.set(acc.id, acc);
    }
    renderAll();

    const parts = [`Imported ${formatNumber(result.accountsToAdd.length)} new profile links.`];
    if (result.duplicateCount > 0) parts.push(`${formatNumber(result.duplicateCount)} duplicates were ignored.`);
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
    toast.show(parts.join(' '), { type: 'success' });
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
          text: 'Clicking "Open Profile" opens the link in a new tab and immediately marks that account as followed. This app has no way to see or confirm what happens on the other site — it only tracks what you\u2019ve told it.',
        }),
      ],
      actions: [{ label: 'Got it', variant: 'primary', autofocus: true }],
    });
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
    const theme = stored || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
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
    dom.btnViewToggle.setAttribute('aria-pressed', view === 'compact' ? 'true' : 'false');
    dom.btnViewToggle.title = view === 'compact' ? 'Switch to comfortable view' : 'Switch to compact view';
  }

  function toggleView() {
    state.view = state.view === 'compact' ? 'comfortable' : 'compact';
    applyView(state.view);
    settings.set('view', state.view);
    virtualList.setView(state.view);
  }

  /* ----------------------------------------------------------------------
   * Event wiring
   * -------------------------------------------------------------------- */

  function wireEvents() {
    dom.btnAbout.addEventListener('click', openAboutModal);
    dom.btnAboutInline.addEventListener('click', openAboutModal);
    dom.btnTheme.addEventListener('click', toggleTheme);
    dom.btnViewToggle.addEventListener('click', toggleView);

    dom.btnImportHtml.addEventListener('click', () => dom.fileImportHtml.click());
    dom.fileImportHtml.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = ''; // allow re-selecting the same file later
      await handleImportHtmlFile(file);
    });
    dom.emptyStateAction.addEventListener('click', () => dom.fileImportHtml.click());

    dom.btnImportBackup.addEventListener('click', () => dom.fileImportBackup.click());
    dom.fileImportBackup.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      await handleImportBackupFile(file);
    });

    dom.btnExport.addEventListener('click', handleExport);
    dom.btnReset.addEventListener('click', handleReset);
    dom.btnOpenNext.addEventListener('click', openNextProfile);

    dom.filterTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('[data-filter]');
      if (!tab) return;
      state.filter = tab.dataset.filter;
      settings.set('filter', state.filter);
      renderAll();
    });

    dom.searchInput.addEventListener(
      'input',
      debounce((e) => {
        state.search = e.target.value.trim().toLowerCase();
        renderAll();
      }, 120)
    );

    dom.sortSelect.value = state.sort;
    dom.sortSelect.addEventListener('change', (e) => {
      state.sort = e.target.value;
      settings.set('sort', state.sort);
      renderAll();
    });

    dom.selectAllVisible.addEventListener('change', (e) => {
      if (e.target.checked) {
        visibleList.forEach((a) => selection.add(a.id));
      } else {
        visibleList.forEach((a) => selection.delete(a.id));
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
      applyStatusChange(ids, newStatus).then(() => {
        selection.clear();
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

    window.addEventListener('resize', debounce(() => virtualList.onResize(), 100));

    window.addEventListener('keydown', (e) => {
      const tag = (document.activeElement && document.activeElement.tagName) || '';
      const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

      if (e.key === 'Escape' && document.activeElement === dom.searchInput && dom.searchInput.value) {
        dom.searchInput.value = '';
        state.search = '';
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
        .catch(() => toast.show("Couldn't copy the link.", { type: 'error' }));
    } else {
      toast.show("Copying isn't supported in this browser.", { type: 'warning' });
    }
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

    const showLoadingTimer = setTimeout(() => {
      dom.loadingOverlay.hidden = false;
    }, 150);

    await db.init();
    accounts = await db.getAll();
    for (const a of accounts) accountsById.set(a.id, a);

    clearTimeout(showLoadingTimer);
    dom.loadingOverlay.hidden = true;

    if (db.getMode() === 'localStorage') {
      toast.show('Using local storage for saving (IndexedDB is unavailable here). Large lists may be a little slower.', {
        type: 'warning',
        duration: 7000,
      });
    }

    virtualList = new render.VirtualList({
      viewport: dom.listViewport,
      sizer: dom.listSizer,
      rowsContainer: dom.listRows,
      view: state.view,
      getCount: () => visibleList.length,
      renderRow,
    });

    dom.listFootnote.textContent = 'Tip: press / to search, Esc to clear it, and N to open the next profile.';

    wireEvents();
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();

/**
 * utils.js
 * Small, dependency-free helpers shared by the rest of the app.
 * Everything hangs off the single `FLM` namespace to avoid polluting globals
 * while still allowing plain <script> tags (no bundler, no module CORS
 * issues when the app is opened straight from disk).
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});

  /* ---------------------------------------------------------------------
   * IDs
   * ------------------------------------------------------------------- */

  /** Generate a reasonably unique id. Uses crypto when available. */
  function generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    }
    // Last-resort fallback: timestamp + random, good enough for a local id.
    return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }

  /* ---------------------------------------------------------------------
   * DOM building (never uses innerHTML with untrusted/dynamic text)
   * ------------------------------------------------------------------- */

  /**
   * Create an element without ever touching innerHTML.
   * @param {string} tag
   * @param {object} [opts] - {className, attrs, text, children, on}
   */
  function el(tag, opts) {
    const node = document.createElement(tag);
    opts = opts || {};
    if (opts.className) node.className = opts.className;
    if (opts.attrs) {
      for (const [k, v] of Object.entries(opts.attrs)) {
        if (v === false || v === null || v === undefined) continue;
        node.setAttribute(k, v === true ? '' : String(v));
      }
    }
    if (opts.text !== undefined && opts.text !== null) {
      node.textContent = String(opts.text);
    }
    if (opts.children) {
      for (const child of opts.children) {
        if (child) node.appendChild(child);
      }
    }
    if (opts.on) {
      for (const [evt, handler] of Object.entries(opts.on)) {
        node.addEventListener(evt, handler);
      }
    }
    return node;
  }

  /* ---------------------------------------------------------------------
   * URL handling
   * ------------------------------------------------------------------- */

  /** Returns a parsed URL only if the raw string is an absolute http/https URL. */
  function parseHttpUrl(raw) {
    if (!raw) return null;
    const trimmed = raw.trim();
    if (!/^https?:\/\//i.test(trimmed)) return null;
    try {
      const url = new URL(trimmed);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url;
    } catch (_err) {
      return null;
    }
  }

  /** Normalized key used purely for duplicate detection (not for display). */
  function normalizeUrlKey(href) {
    try {
      const url = new URL(href);
      let pathname = url.pathname.replace(/\/+$/, '');
      return `${url.hostname.toLowerCase()}${pathname.toLowerCase()}`;
    } catch (_err) {
      return href.toLowerCase();
    }
  }

  function deriveNameFromUrl(url) {
    const segments = url.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1];
    if (last) {
      try {
        return `@${decodeURIComponent(last)}`;
      } catch (_err) {
        return `@${last}`;
      }
    }
    return url.hostname.replace(/^www\./, '');
  }

  /** Collapse whitespace/newlines and cap length for anything shown as a name. */
  function sanitizeName(str) {
    if (!str) return '';
    const cleaned = String(str)
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned.length > 100 ? `${cleaned.slice(0, 99)}…` : cleaned;
  }

  /* ---------------------------------------------------------------------
   * Formatting
   * ------------------------------------------------------------------- */

  function formatNumber(n) {
    return Number(n).toLocaleString();
  }

  function formatDateForFilename(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatRelativeOrDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /* ---------------------------------------------------------------------
   * Misc
   * ------------------------------------------------------------------- */

  function debounce(fn, wait) {
    let timer = null;
    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /** Reads a File as text via FileReader, wrapped in a Promise. */
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error || new Error('Could not read the file.'));
      reader.readAsText(file);
    });
  }

  /** Triggers a client-side download of a JSON object. No network involved. */
  function downloadJSON(filename, dataObj) {
    const blob = new Blob([JSON.stringify(dataObj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    // Give the browser a tick to start the download before revoking.
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /** Yields to the browser so a UI update (e.g. "Importing…") can paint. */
  function nextPaint() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  FLM.utils = {
    generateId,
    el,
    parseHttpUrl,
    normalizeUrlKey,
    deriveNameFromUrl,
    sanitizeName,
    formatNumber,
    formatDateForFilename,
    formatRelativeOrDate,
    debounce,
    clamp,
    readFileAsText,
    downloadJSON,
    nextPaint,
  };

  /* ---------------------------------------------------------------------
   * Local UI settings (theme, filter, sort, view) — small values only.
   * Kept separate from the (potentially large) account dataset in db.js.
   * ------------------------------------------------------------------- */

  const SETTINGS_PREFIX = 'flm_setting_';

  const settings = {
    get(key, fallback) {
      try {
        const raw = window.localStorage.getItem(SETTINGS_PREFIX + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch (_err) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        window.localStorage.setItem(SETTINGS_PREFIX + key, JSON.stringify(value));
      } catch (_err) {
        // Non-fatal: UI preferences simply won't persist this session.
      }
    },
  };

  FLM.settings = settings;

  /* ---------------------------------------------------------------------
   * Shared status metadata (used by render.js, app.js and importer output)
   * ------------------------------------------------------------------- */

  FLM.STATUS_LABELS = {
    'not-followed': 'not followed',
    followed: 'followed',
    skipped: 'skipped',
  };

  /* ---------------------------------------------------------------------
   * Lightweight accessible modal (used for Reset confirmation and About)
   * ------------------------------------------------------------------- */

  const modalState = { lastFocused: null, onClose: null };

  function getModalEls() {
    return {
      backdrop: document.getElementById('modalBackdrop'),
      modal: document.getElementById('modal'),
      title: document.getElementById('modalTitle'),
      body: document.getElementById('modalBody'),
      actions: document.getElementById('modalActions'),
    };
  }

  function closeModal() {
    const { backdrop } = getModalEls();
    if (!backdrop || backdrop.hidden) return;
    backdrop.hidden = true;
    document.removeEventListener('keydown', onModalKeydown, true);
    if (modalState.onClose) modalState.onClose();
    modalState.onClose = null;
    if (modalState.lastFocused && typeof modalState.lastFocused.focus === 'function') {
      modalState.lastFocused.focus();
    }
  }

  function onModalKeydown(e) {
    const { modal } = getModalEls();
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeModal();
      return;
    }
    if (e.key === 'Tab' && modal) {
      const focusable = modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  /**
   * Opens the shared modal.
   * @param {object} opts - {title, bodyNodes:[Node], actions:[{label, variant, onClick, autofocus}], onClose}
   */
  function openModal(opts) {
    const { backdrop, title, body, actions } = getModalEls();
    if (!backdrop) return;
    modalState.lastFocused = document.activeElement;
    modalState.onClose = opts.onClose || null;

    title.textContent = opts.title || '';
    body.textContent = '';
    (opts.bodyNodes || []).forEach((node) => body.appendChild(node));

    actions.textContent = '';
    let autofocusTarget = null;
    (opts.actions || []).forEach((action) => {
      const btn = el('button', {
        className: `btn ${action.variant ? `btn--${action.variant}` : 'btn--secondary'}`,
        text: action.label,
        attrs: { type: 'button' },
        on: {
          click: () => {
            if (action.onClick) action.onClick();
            closeModal();
          },
        },
      });
      actions.appendChild(btn);
      if (action.autofocus) autofocusTarget = btn;
    });

    backdrop.hidden = false;
    document.addEventListener('keydown', onModalKeydown, true);
    (autofocusTarget || actions.querySelector('button') || document.getElementById('modal')).focus();
  }

  FLM.modal = { open: openModal, close: closeModal };
})();

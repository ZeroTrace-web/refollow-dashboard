/**
 * toast.js
 * A small, self-contained toast/notification manager. Toasts are
 * announced via the existing aria-live region in index.html so screen
 * readers pick them up without any extra wiring from callers.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const { el } = FLM.utils;

  const MAX_VISIBLE = 3;
  const DEFAULT_DURATION = 4500;
  const UNDO_DURATION = 6500;

  let region = null;
  const queue = []; // toasts waiting to be shown

  function ensureRegion() {
    if (!region) region = document.getElementById('toastRegion');
    return region;
  }

  function renderNext() {
    const r = ensureRegion();
    if (!r) return;
    if (r.children.length >= MAX_VISIBLE || queue.length === 0) return;
    const item = queue.shift();
    r.appendChild(item.node);
    // Force layout then add the "in" class so the CSS transition runs.
    requestAnimationFrame(() => item.node.classList.add('toast--in'));
    item.timer = setTimeout(() => dismiss(item), item.duration);
  }

  function dismiss(item) {
    if (item.dismissed) return;
    item.dismissed = true;
    clearTimeout(item.timer);
    item.node.classList.remove('toast--in');
    item.node.classList.add('toast--out');
    setTimeout(() => {
      item.node.remove();
      renderNext();
    }, 200);
  }

  /**
   * @param {string} message
   * @param {object} [opts] - {type: 'info'|'success'|'warning'|'error', actionLabel, onAction, duration}
   */
  function show(message, opts) {
    opts = opts || {};
    const type = opts.type || 'info';
    const duration = opts.duration || (opts.actionLabel ? UNDO_DURATION : DEFAULT_DURATION);

    const item = { dismissed: false, timer: null, duration };

    const closeBtn = el('button', {
      className: 'toast__close',
      attrs: { type: 'button', 'aria-label': 'Dismiss notification' },
      text: '×',
      on: { click: () => dismiss(item) },
    });

    const children = [el('p', { className: 'toast__message', text: message })];

    if (opts.actionLabel && opts.onAction) {
      children.push(
        el('button', {
          className: 'toast__action',
          attrs: { type: 'button' },
          text: opts.actionLabel,
          on: {
            click: () => {
              opts.onAction();
              dismiss(item);
            },
          },
        })
      );
    }
    children.push(closeBtn);

    item.node = el('div', {
      className: `toast toast--${type}`,
      attrs: { role: type === 'error' ? 'alert' : 'status' },
      children,
    });

    queue.push(item);
    renderNext();
  }

  FLM.toast = { show };
})();

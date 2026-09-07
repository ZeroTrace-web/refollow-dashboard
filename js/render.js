/**
 * render.js
 * DOM construction for account rows, plus a small virtual-scrolling list
 * controller. Keeping this separate from app.js means the "how do we draw
 * a row" logic is isolated from "what changed and when should we redraw".
 *
 * Only a fixed row height per view mode is supported (comfortable vs
 * compact), which keeps the virtual scroll math simple and fast even for
 * many thousands of rows — only the rows currently on screen ever exist
 * in the DOM.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const { STATUS_LABELS } = FLM;
  const { formatRelativeOrDate } = FLM.utils;

  const ROW_HEIGHT = { comfortable: 92, compact: 56 };

  let rowTemplate = null;
  function getTemplate() {
    if (!rowTemplate) rowTemplate = document.getElementById('rowTemplate');
    return rowTemplate;
  }

  /**
   * Builds (or reuses a cloned template for) one account row.
   * All dynamic text is set via textContent — never innerHTML — so
   * imported names/URLs can never be interpreted as markup.
   */
  function createRowElement(account, ctx) {
    const tpl = getTemplate();
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = account.id;
    node.dataset.status = account.status;
    node.setAttribute('aria-posinset', String(ctx.index + 1));
    node.setAttribute('aria-setsize', String(ctx.total));

    const checkbox = node.querySelector('.account-row__checkbox');
    checkbox.checked = ctx.selected;
    checkbox.dataset.selectId = account.id;
    checkbox.setAttribute('aria-label', `Select ${account.name}`);

    const nameEl = node.querySelector('.account-row__name');
    nameEl.textContent = account.name;

    const urlEl = node.querySelector('.account-row__url');
    urlEl.textContent = account.url;
    urlEl.title = account.url;

    const badge = node.querySelector('.account-row__badge');
    badge.textContent = STATUS_LABELS[account.status] || account.status;
    badge.title = `Updated ${formatRelativeOrDate(account.updatedAt)}`;

    const actions = node.querySelector('.account-row__actions');
    actions.textContent = '';
    actions.appendChild(makeActionButton('open', account.id, 'Open profile', 'btn--primary'));

    if (account.status !== 'followed') {
      actions.appendChild(makeActionButton('mark-followed', account.id, 'Mark followed', 'btn--secondary'));
    }
    if (account.status !== 'skipped') {
      actions.appendChild(makeActionButton('mark-skipped', account.id, 'Skip', 'btn--secondary'));
    }
    if (account.status !== 'not-followed') {
      actions.appendChild(makeActionButton('mark-not-followed', account.id, 'Mark not followed', 'btn--secondary'));
    }
    actions.appendChild(makeActionButton('copy', account.id, 'Copy link', 'btn--ghost'));

    return node;
  }

  function makeActionButton(action, id, label, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn btn--small ${extraClass || ''}`.trim();
    btn.dataset.action = action;
    btn.dataset.id = id;
    btn.textContent = label;
    return btn;
  }

  /**
   * Minimal fixed-row-height virtual scroller.
   * The caller supplies a `getItem(index)` accessor and `getCount()` so the
   * list controller stays decoupled from wherever the filtered/sorted
   * array actually lives.
   */
  class VirtualList {
    constructor({ viewport, sizer, rowsContainer, view, getCount, renderRow }) {
      this.viewport = viewport;
      this.sizer = sizer;
      this.rowsContainer = rowsContainer;
      this.view = view; // 'comfortable' | 'compact'
      this.getCount = getCount;
      this.renderRow = renderRow;
      this._lastStart = -1;
      this._lastEnd = -1;
      // Start from the nominal height for this view mode; corrected against
      // the real rendered row as soon as one exists (see _remeasure). Rows
      // on narrow/mobile layouts wrap onto extra lines, so the *actual*
      // height can differ from this guess — measuring keeps the virtual
      // scroll math correct at every viewport size without hand-tuning a
      // pixel value per breakpoint.
      this._measuredHeight = ROW_HEIGHT[view] || ROW_HEIGHT.comfortable;

      this._onScroll = this._onScroll.bind(this);
      this.viewport.addEventListener('scroll', this._onScroll, { passive: true });
    }

    setView(view) {
      this.view = view;
      this._measuredHeight = ROW_HEIGHT[view] || ROW_HEIGHT.comfortable;
      this.refresh();
    }

    get rowHeight() {
      return this._measuredHeight;
    }

    /** Call after the underlying data, filter, search or sort changes. */
    refresh() {
      this._lastStart = -1; // force a redraw even if the index range is unchanged
      this._renderVisible();
      this._remeasure();
    }

    /** Call on viewport resize — a breakpoint change can alter row height. */
    onResize() {
      this._lastStart = -1;
      this._renderVisible();
      this._remeasure();
    }

    /**
     * Every row shares the same structure and the same fixed set of
     * possible action-button labels, so measuring any one rendered row is
     * representative of them all at the current viewport width. If the
     * real height differs from our guess, correct it and reposition.
     */
    _remeasure() {
      const total = this.getCount();
      const firstRow = this.rowsContainer.firstElementChild;
      if (firstRow) {
        const measured = firstRow.getBoundingClientRect().height;
        if (measured > 0 && Math.abs(measured - this._measuredHeight) > 0.5) {
          this._measuredHeight = measured;
          this._lastStart = -1;
          this._renderVisible();
        }
      }
      this.sizer.style.height = `${total * this._measuredHeight}px`;
    }

    _onScroll() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => {
        this._raf = null;
        this._renderVisible();
      });
    }

    _renderVisible() {
      const total = this.getCount();
      const rowHeight = this._measuredHeight;
      const scrollTop = this.viewport.scrollTop;
      const viewportHeight = this.viewport.clientHeight || 600;
      const buffer = 8;

      let start = Math.max(0, Math.floor(scrollTop / rowHeight) - buffer);
      let end = Math.min(total, Math.ceil((scrollTop + viewportHeight) / rowHeight) + buffer);
      if (start >= end) end = start; // empty list

      if (start === this._lastStart && end === this._lastEnd) return;
      this._lastStart = start;
      this._lastEnd = end;

      this.rowsContainer.style.transform = `translateY(${start * rowHeight}px)`;

      const frag = document.createDocumentFragment();
      for (let i = start; i < end; i++) {
        frag.appendChild(this.renderRow(i, total));
      }
      this.rowsContainer.replaceChildren(frag);
    }
  }

  FLM.render = { createRowElement, VirtualList, ROW_HEIGHT };
})();

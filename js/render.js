/**
 * render.js
 * DOM construction for account rows and the paginated list controller.
 *
 * Pagination intentionally renders at most 50 rows at once. Rows use natural
 * heights rather than fixed virtualization math, which is more robust when
 * text wraps or mobile controls reflow.
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
  /**
   * Paginated list renderer.
   * Pagination caps each page at 50 rows, so natural row heights are simpler
   * and more reliable than fixed-height virtualization, especially on mobile.
   */
  class VirtualList {
    constructor({ viewport, sizer, rowsContainer, view, getCount, renderRow }) {
      this.viewport = viewport;
      this.sizer = sizer;
      this.rowsContainer = rowsContainer;
      this.view = view;
      this.getCount = getCount;
      this.renderRow = renderRow;
    }

    setView(view) {
      this.view = view;
      this.refresh();
    }

    refresh() {
      const total = this.getCount();
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < total; i++) {
        fragment.appendChild(this.renderRow(i, total));
      }
      this.rowsContainer.replaceChildren(fragment);
      this.rowsContainer.style.transform = 'none';
      this.sizer.style.height = 'auto';
    }

    onResize() {
      this.refresh();
    }
  }


  FLM.render = { createRowElement, VirtualList, ROW_HEIGHT };
})();

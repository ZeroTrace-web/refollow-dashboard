/**
 * render.js
 * DOM construction for paginated account list/table views.
 */
(function () {
  'use strict';
  const FLM = (window.FLM = window.FLM || {});
  const { STATUS_LABELS } = FLM;
  const { formatRelativeOrDate } = FLM.utils;

  let rowTemplate = null, tableTemplate = null;

  function getTemplate(id, cacheName) {
    if (cacheName === 'row' && !rowTemplate) rowTemplate = document.getElementById(id);
    if (cacheName === 'table' && !tableTemplate) tableTemplate = document.getElementById(id);
    return cacheName === 'row' ? rowTemplate : tableTemplate;
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

  function fillTags(container, account) {
    container.textContent = '';
    const tags = Array.isArray(account.tags) ? account.tags : [];
    if (!tags.length) {
      const empty = document.createElement('span');
      empty.className = 'tag-empty';
      empty.textContent = 'No tags';
      container.appendChild(empty);
      return;
    }
    tags.forEach((tag) => {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      chip.title = tag;
      container.appendChild(chip);
    });
  }

  function createActions(account, actions) {
    actions.textContent = '';
    actions.appendChild(makeActionButton('open', account.id, 'Open profile', 'btn--primary'));
    if (account.status !== 'followed') actions.appendChild(makeActionButton('mark-followed', account.id, 'Mark followed', 'btn--secondary'));
    if (account.status !== 'skipped') actions.appendChild(makeActionButton('mark-skipped', account.id, 'Skip', 'btn--secondary'));
    if (account.status !== 'not-followed') actions.appendChild(makeActionButton('mark-not-followed', account.id, 'Mark not followed', 'btn--secondary'));
    actions.appendChild(makeActionButton('tags', account.id, 'Tags', 'btn--ghost'));
    actions.appendChild(makeActionButton('copy', account.id, 'Copy link', 'btn--ghost'));
  }

  function createRowElement(account, ctx) {
    const tpl = getTemplate('rowTemplate', 'row');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = account.id;
    node.dataset.status = account.status;
    node.setAttribute('aria-posinset', String((ctx.offset || 0) + ctx.index + 1));
    node.setAttribute('aria-setsize', String(ctx.total));

    const checkbox = node.querySelector('.account-row__checkbox');
    checkbox.checked = ctx.selected;
    checkbox.dataset.selectId = account.id;
    checkbox.setAttribute('aria-label', `Select ${account.name}`);

    node.querySelector('.account-row__name').textContent = account.name;
    const urlEl = node.querySelector('.account-row__url');
    urlEl.textContent = account.url;
    urlEl.title = account.url;

    const badge = node.querySelector('.account-row__badge');
    badge.textContent = STATUS_LABELS[account.status] || account.status;
    badge.title = `Updated ${formatRelativeOrDate(account.updatedAt)}`;

    fillTags(node.querySelector('.account-row__tags'), account);
    createActions(account, node.querySelector('.account-row__actions'));
    return node;
  }

  function createTableElement(account, ctx) {
    const tpl = getTemplate('tableRowTemplate', 'table');
    const node = tpl.content.firstElementChild.cloneNode(true);
    node.dataset.id = account.id;
    const checkbox = node.querySelector('.account-table__checkbox');
    checkbox.checked = ctx.selected;
    checkbox.dataset.selectId = account.id;
    checkbox.setAttribute('aria-label', `Select ${account.name}`);
    node.querySelector('.account-table__name').textContent = account.name;
    const link = node.querySelector('.account-table__url');
    link.textContent = account.url;
    link.href = account.url;
    link.title = account.url;
    node.querySelector('.account-table__status').textContent = STATUS_LABELS[account.status] || account.status;
    node.querySelector('.account-table__status').dataset.status = account.status;
    fillTags(node.querySelector('.account-table__tags'), account);
    createActions(account, node.querySelector('.account-table__actions'));
    return node;
  }

  class VirtualList {
    constructor({ viewport, sizer, rowsContainer, view, getCount, renderRow }) {
      this.viewport = viewport;
      this.sizer = sizer;
      this.rowsContainer = rowsContainer;
      this.view = view;
      this.getCount = getCount;
      this.renderRow = renderRow;
    }
    setView(view) { this.view = view; this.refresh(); }
    refresh() {
      const total = this.getCount();
      const fragment = document.createDocumentFragment();
      for (let i = 0; i < total; i++) fragment.appendChild(this.renderRow(i, total));
      this.rowsContainer.replaceChildren(fragment);
      this.rowsContainer.style.transform = 'none';
      this.sizer.style.height = 'auto';
      this.sizer.hidden = total === 0;
    }
    onResize() { this.refresh(); }
  }
  FLM.render = { createRowElement, createTableElement, VirtualList };
})();

/**
 * importer.js
 * Turns untrusted input files (an exported "following" HTML page, or a
 * previously exported JSON backup) into plain account objects.
 *
 * Safety notes:
 *  - HTML is parsed with DOMParser, which produces an inert document that
 *    is never inserted into the live page and whose scripts never execute.
 *  - We only ever pull plain strings (href, text content, attributes) out
 *    of that inert document. No node from the parsed document is ever
 *    attached to the real DOM, and nothing is ever assigned via innerHTML.
 *  - Only absolute http/https URLs are accepted; everything else is
 *    counted as invalid and ignored.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const { parseHttpUrl, normalizeUrlKey, deriveNameFromUrl, sanitizeName, generateId } = FLM.utils;

  const VALID_STATUSES = new Set(['not-followed', 'followed', 'skipped']);

  /** Thrown for input that is fundamentally the wrong shape/format. */
  class ImportError extends Error {}
  FLM.ImportError = ImportError;

  /**
   * Extracts a human-friendly name for a link from its own text/attributes,
   * falling back to something derived from the URL itself.
   */
  function extractName(anchor, url) {
    const text = sanitizeName(anchor.textContent || '');
    if (text && !/^https?:\/\//i.test(text)) return text;

    const title = sanitizeName(anchor.getAttribute('title') || '');
    if (title) return title;

    const aria = sanitizeName(anchor.getAttribute('aria-label') || '');
    if (aria) return aria;

    return deriveNameFromUrl(url);
  }

  /**
   * Parses an exported "following" HTML file.
   * @param {string} htmlText raw file contents
   * @param {Set<string>} existingKeys normalized URL keys already in storage
   * @returns {{accountsToAdd: object[], duplicateCount: number, invalidCount: number, linksFound: number}}
   */
  function parseFollowingHtml(htmlText, existingKeys) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(htmlText, 'text/html');
    } catch (_err) {
      throw new ImportError('That file could not be read as HTML.');
    }

    // A parser error document from DOMParser still returns a Document, but
    // if there is no body/anchors at all it is almost certainly not HTML.
    const anchors = Array.from(doc.querySelectorAll('a[href]'));

    const accountsToAdd = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    let invalidCount = 0;
    const now = Date.now();

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute('href');
      const url = parseHttpUrl(rawHref);
      if (!url) {
        invalidCount++;
        continue;
      }
      const key = normalizeUrlKey(url.href);
      if (seenKeys.has(key) || existingKeys.has(key)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(key);
      accountsToAdd.push({
        id: generateId(),
        name: extractName(anchor, url),
        url: url.href,
        status: 'not-followed',
        createdAt: now,
        updatedAt: now,
      });
    }

    return { accountsToAdd, duplicateCount, invalidCount, linksFound: anchors.length };
  }

  /**
   * Parses a previously exported JSON backup file.
   * @param {string} jsonText raw file contents
   * @param {Set<string>} existingKeys normalized URL keys already in storage
   */
  function parseBackupJson(jsonText, existingKeys) {
    let data;
    try {
      data = JSON.parse(jsonText);
    } catch (_err) {
      throw new ImportError('That file is not valid JSON.');
    }

    let list;
    if (Array.isArray(data)) {
      list = data;
    } else if (data && Array.isArray(data.accounts)) {
      list = data.accounts;
    } else {
      throw new ImportError('This backup file does not contain a recognizable accounts list.');
    }

    const accountsToAdd = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    let invalidCount = 0;
    const now = Date.now();

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') {
        invalidCount++;
        continue;
      }
      const url = parseHttpUrl(entry.url);
      if (!url) {
        invalidCount++;
        continue;
      }
      const key = normalizeUrlKey(url.href);
      if (seenKeys.has(key) || existingKeys.has(key)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(key);

      const status = VALID_STATUSES.has(entry.status) ? entry.status : 'not-followed';
      const name = sanitizeName(entry.name) || deriveNameFromUrl(url);
      const createdAt = Number.isFinite(entry.createdAt) ? entry.createdAt : now;
      const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : now;

      accountsToAdd.push({
        id: generateId(),
        name,
        url: url.href,
        status,
        createdAt,
        updatedAt,
      });
    }

    return { accountsToAdd, duplicateCount, invalidCount, linksFound: list.length };
  }

  FLM.importer = { parseFollowingHtml, parseBackupJson };
})();

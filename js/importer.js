/**
 * importer.js
 * Local file importers for HTML, JSON backups, text, CSV/TSV, Markdown,
 * RTF, XML and common ZIP-based document formats such as DOCX/ODT/XLSX.
 *
 * All parsing happens in-browser. Imported files are never uploaded.
 */
(function () {
  'use strict';

  const FLM = (window.FLM = window.FLM || {});
  const {
    parseHttpUrl, normalizeUrlKey, deriveNameFromUrl, sanitizeName, generateId, normalizeTimestamp,
  } = FLM.utils;

  const VALID_STATUSES = new Set(['not-followed', 'followed', 'skipped']);
  const URL_RE = /\bhttps?:\/\/[^\s"'<>()[\]{}]+/gi;
  const MAX_IMPORT_BYTES = 100 * 1024 * 1024; // protect the UI from accidental huge files

  function decodeByteBuffer(buffer) {
    // Try UTF-8 first, then latin-1 as a lossless byte-oriented fallback.
    const bytes = new Uint8Array(buffer);
    try {
      return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    } catch (_err) {
      return new TextDecoder('latin1').decode(bytes);
    }
  }


  class ImportError extends Error {}

  function extractUrlsFromString(text) {
    const found = [];
    const seen = new Set();
    const source = String(text || '');
    const decodedSource = source
      .replace(/&amp;/gi, '&')
      .replace(/&#x26;/gi, '&')
      .replace(/&#38;/gi, '&');
    for (const raw of decodedSource.match(URL_RE) || []) {
      const cleaned = raw.replace(/[),.;:'"`]+$/g, '');
      const url = parseHttpUrl(cleaned);
      if (!url) continue;
      const key = normalizeUrlKey(url.href);
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(url.href);
    }
    return found;
  }

  function nameFromUrl(urlText) {
    try { return deriveNameFromUrl(new URL(urlText)); } catch (_err) { return urlText; }
  }

  function accountsFromUrls(urls, existingKeys) {
    const accountsToAdd = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    const now = Date.now();

    for (const href of urls) {
      const url = parseHttpUrl(href);
      if (!url) continue;
      const key = normalizeUrlKey(url.href);
      if (existingKeys.has(key) || seenKeys.has(key)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(key);
      accountsToAdd.push({
        id: generateId(),
        name: nameFromUrl(url.href),
        url: url.href,
        status: 'not-followed',
        tags: [],
        createdAt: now + accountsToAdd.length,
        updatedAt: now + accountsToAdd.length,
      });
    }
    return { accountsToAdd, duplicateCount };
  }

  function parseFollowingHtml(htmlText, existingKeys) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(htmlText, 'text/html');
    } catch (_err) {
      throw new ImportError('That file could not be read as HTML.');
    }

    const anchors = Array.from(doc.querySelectorAll('a[href]'));
    const accountsToAdd = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    let invalidCount = 0;
    const now = Date.now();

    for (const anchor of anchors) {
      const rawHref = anchor.getAttribute('href');
      const url = parseHttpUrl(rawHref);
      if (!url) { invalidCount++; continue; }

      const key = normalizeUrlKey(url.href);
      if (seenKeys.has(key) || existingKeys.has(key)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(key);

      const text = sanitizeName(anchor.textContent || '');
      const title = sanitizeName(anchor.getAttribute('title') || '');
      const aria = sanitizeName(anchor.getAttribute('aria-label') || '');
      const name = (text && !/^https?:\/\//i.test(text)) ? text
        : (title || aria || deriveNameFromUrl(url));

      accountsToAdd.push({
        id: generateId(),
        name,
        url: url.href,
        status: 'not-followed',
        tags: [],
        createdAt: now + accountsToAdd.length,
        updatedAt: now + accountsToAdd.length,
      });
    }

    return {
      accountsToAdd,
      duplicateCount,
      invalidCount,
      linksFound: anchors.length,
      urlsFound: anchors.filter(a => parseHttpUrl(a.getAttribute('href'))).length,
    };
  }

  async function unzipEntries(buffer) {
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);
    const decoder = new TextDecoder('utf-8');

    // Find End Of Central Directory, searching backwards.
    let eocd = -1;
    const min = Math.max(0, bytes.length - 0xFFFF - 22);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new ImportError('This document is not a readable ZIP-based document.');

    const cdSize = view.getUint32(eocd + 12, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    let pos = cdOffset;
    const entries = new Map();

    while (pos < cdOffset + cdSize && view.getUint32(pos, true) === 0x02014b50) {
      const compression = view.getUint16(pos + 10, true);
      const compressedSize = view.getUint32(pos + 20, true);
      const uncompressedSize = view.getUint32(pos + 24, true);
      const fileNameLen = view.getUint16(pos + 28, true);
      const extraLen = view.getUint16(pos + 30, true);
      const commentLen = view.getUint16(pos + 32, true);
      const localOffset = view.getUint32(pos + 42, true);
      const name = decoder.decode(bytes.slice(pos + 46, pos + 46 + fileNameLen));

      entries.set(name, { compression, compressedSize, uncompressedSize, localOffset });
      pos += 46 + fileNameLen + extraLen + commentLen;
    }

    async function readEntry(name) {
      const meta = entries.get(name);
      if (!meta) return null;

      const lp = meta.localOffset;
      if (view.getUint32(lp, true) !== 0x04034b50) throw new ImportError('A ZIP document entry is malformed.');
      const nameLen = view.getUint16(lp + 26, true);
      const extraLen = view.getUint16(lp + 28, true);
      const start = lp + 30 + nameLen + extraLen;
      const compressed = bytes.slice(start, start + meta.compressedSize);

      if (meta.compression === 0) return compressed;
      if (meta.compression === 8 && typeof DecompressionStream !== 'undefined') {
        const ds = new DecompressionStream('deflate-raw');
        const stream = new Blob([compressed]).stream().pipeThrough(ds);
        return new Uint8Array(await new Response(stream).arrayBuffer());
      }
      throw new ImportError('This browser cannot decompress this document format.');
    }

    return { entries, readEntry };
  }

  async function extractTextFromZipDocument(arrayBuffer) {
    const zip = await unzipEntries(arrayBuffer);
    const texts = [];

    for (const name of zip.entries.keys()) {
      const lower = name.toLowerCase();
      if (
        lower.endsWith('.xml') ||
        lower.endsWith('.rels') ||
        lower === 'content.xml' ||
        lower === 'sharedstrings.xml'
      ) {
        try {
          const data = await zip.readEntry(name);
          if (!data) continue;
          texts.push(new TextDecoder('utf-8').decode(data));
        } catch (_err) {
          // One damaged/unreadable XML entry should not prevent other entries.
        }
      }
    }
    return texts.join('\n');
  }

  function parseBackupJson(jsonText, existingKeys) {
    let data;
    try { data = JSON.parse(jsonText); }
    catch (_err) { throw new ImportError('That file is not valid JSON.'); }

    const list = Array.isArray(data) ? data : (data && Array.isArray(data.accounts) ? data.accounts : null);
    if (!list) throw new ImportError('This backup file does not contain a recognizable accounts list.');

    const accountsToAdd = [];
    const seenKeys = new Set();
    let duplicateCount = 0;
    let invalidCount = 0;
    const now = Date.now();

    for (const entry of list) {
      if (!entry || typeof entry !== 'object') { invalidCount++; continue; }
      const url = parseHttpUrl(entry.url);
      if (!url) { invalidCount++; continue; }

      const key = normalizeUrlKey(url.href);
      if (seenKeys.has(key) || existingKeys.has(key)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(key);

      accountsToAdd.push({
        id: generateId(),
        name: sanitizeName(entry.name) || deriveNameFromUrl(url),
        url: url.href,
        status: VALID_STATUSES.has(entry.status) ? entry.status : 'not-followed',
        tags: Array.isArray(entry.tags) ? [...new Set(entry.tags.map((t) => sanitizeName(t).replace(/^#/, '')).filter(Boolean).slice(0, 20))] : [],
        createdAt: normalizeTimestamp(entry.createdAt, now + accountsToAdd.length),
        updatedAt: normalizeTimestamp(entry.updatedAt, now + accountsToAdd.length),
      });
    }

    return { accountsToAdd, duplicateCount, invalidCount, linksFound: list.length };
  }

  function isJsonFile(file) {
    return /\.json$/i.test(file.name) || /application\/json/i.test(file.type || '');
  }

  function isHtmlFile(file) {
    return /\.(html?|xhtml)$/i.test(file.name) || /text\/html/i.test(file.type || '');
  }

  function isZipDocument(file) {
    return /\.(docx|odt|xlsx|xlsm|pptx|epub)$/i.test(file.name) ||
      /application\/(vnd\.openxmlformats|vnd\.oasis\.opendocument|epub\+zip)/i.test(file.type || '');
  }

  /**
   * Parses any supported file into candidate URLs. HTML/JSON get specialized
   * parsers; other formats fall back to URL extraction from text/XML/binary.
   */
  async function parseAnyFile(file, existingKeys) {
    if (!file) throw new ImportError('No file was selected.');
    if (Number.isFinite(file.size) && file.size > MAX_IMPORT_BYTES) {
      throw new ImportError(`"${file.name}" is larger than the 100 MB import limit.`);
    }

    if (isJsonFile(file)) {
      return { kind: 'backup', result: parseBackupJson(await file.text(), existingKeys) };
    }

    if (isHtmlFile(file)) {
      return { kind: 'accounts', result: parseFollowingHtml(await file.text(), existingKeys) };
    }

    if (isZipDocument(file)) {
      const buffer = await file.arrayBuffer();
      let text = '';
      try {
        text = await extractTextFromZipDocument(buffer);
      } catch (err) {
        // Some older browsers cannot decompress ZIP entries. We can still
        // recover literal URLs from the raw document bytes as a fallback.
        console.warn('[FLM] ZIP document parsing fallback:', err);
        text = decodeByteBuffer(buffer);
      }
      const urls = extractUrlsFromString(text);
      const result = accountsFromUrls(urls, existingKeys);
      return {
        kind: 'accounts',
        result: {
          ...result,
          invalidCount: 0,
          linksFound: urls.length,
          urlsFound: urls.length,
        },
      };
    }

    // Text-first formats: txt/csv/tsv/md/xml/rtf and unknown files.
    // For legacy .doc and other binary formats we also attempt to recover
    // literal HTTP/HTTPS URLs embedded in the file.
    let text = '';
    try {
      text = await file.text();
    } catch (_err) {
      try { text = decodeByteBuffer(await file.arrayBuffer()); }
      catch (_err2) { throw new ImportError(`Couldn't read "${file.name}".`); }
    }

    // Some binary formats (notably older PDF/DOC files) can contain readable
    // URL bytes even though they are not plain text. If text decoding found
    // nothing, scan the raw bytes too.
    let urls = extractUrlsFromString(text);
    if (!urls.length && file.size > 0) {
      try {
        urls = extractUrlsFromString(decodeByteBuffer(await file.arrayBuffer()));
      } catch (_err) {}
    }
    const result = accountsFromUrls(urls, existingKeys);
    return {
      kind: 'accounts',
      result: {
        ...result,
        invalidCount: 0,
        linksFound: urls.length,
        urlsFound: urls.length,
      },
    };
  }

  FLM.ImportError = ImportError;
  FLM.importer = {
    parseFollowingHtml,
    parseBackupJson,
    parseAnyFile,
  };
})();
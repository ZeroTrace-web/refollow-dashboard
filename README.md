# Follow List Manager

A local-first dashboard for organizing and working through imported social-media profile links one account at a time.

The app runs entirely in your browser. There is no backend, account system, analytics, or cloud database. Imported files are parsed locally, and your saved account data stays in the browser's local storage/database.

---

## Features

- Import one or many local files and recover HTTP/HTTPS profile links.
- Track each account as **Not followed**, **Followed**, or **Skipped**.
- Optionally auto-mark an account as **Followed** when you open its profile.
- Work through accounts with **Open next profile**, **Triage mode**, and **Resume**.
- Search, filter, sort, tag, and bulk-update accounts.
- Use **Cards** or **Table** view, with compact/comfortable/large display sizing.
- Export a full **JSON backup**, **CSV**, or portable **HTML report**.
- Restore JSON backups without duplicating accounts already saved locally.
- Review local **import/restore history**, including recently added URL sets.
- Use keyboard shortcuts for search, triage, and pagination.
- Install the app as a PWA when served from a compatible HTTPS environment.
- Continue loading the app shell offline after the service worker has cached it.

---

## Project structure

```text
follow-list-manager/
├── index.html              Main application page
├── style.css               Layout, themes, responsive UI
├── sw.js                   Service worker for the installable/offline shell
├── manifest.webmanifest    PWA metadata
├── README.md               This file
├── assets/
│   └── icon.svg            App icon / favicon
└── js/
    ├── utils.js            Shared helpers and settings
    ├── db.js               IndexedDB storage with localStorage fallback
    ├── importer.js         Local file parsing and URL extraction
    ├── toast.js            Toast notifications
    ├── render.js           Card/table rendering
    └── app.js              Application state and event wiring
```

---

## Running the app

There is no build step and no package installation required.

The simplest option is to open `index.html` in a modern browser. For the most reliable browser-storage and PWA behavior, serve the folder over a local HTTP server:

```bash
cd follow-list-manager
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

A production deployment can be hosted as a normal static site. PWA installation requires a browser/environment that supports installation and a secure HTTPS origin.

---

## Importing files

The main **Import files / following list** action accepts multiple local files in one operation.

### Supported formats

Specialized handling is available for:

- HTML, HTM, and XHTML
- JSON backups
- TXT
- CSV / TSV
- Markdown
- RTF
- XML
- DOC / DOCX
- ODT
- PDF
- XLSX / XLSM
- PPTX
- EPUB

For many non-HTML formats, the importer searches for literal `http://` and `https://` URLs. ZIP-based office/document formats are inspected through their internal XML when possible.

Extraction is best-effort. Formats that store links in a complex, encoded, encrypted, or otherwise non-literal way may not yield every URL.

### HTML imports

For HTML/XHTML, the app reads `<a href="...">` links and accepts only absolute `http://` or `https://` URLs.

Account names are chosen in this order:

1. Visible link text, when it is not itself a URL.
2. The link's `title` attribute.
3. The link's `aria-label` attribute.
4. A name derived from the URL.

Duplicate URLs already saved in the app, or repeated within the same import, are ignored.

### Import safety

All parsing happens locally in the browser. Files are never uploaded.

Files larger than **100 MB** are rejected to reduce the risk of freezing the browser with an unexpectedly large import.

---

## Account statuses and profile opening

Every saved account has one of three statuses:

- **Not followed**: the default status for newly imported accounts.
- **Followed**: an account you have marked as followed.
- **Skipped**: an account you decided not to follow.

### Open Profile and Auto-Mark

**Open Profile** opens the account URL in a new tab.

Whether that action also changes the status is controlled by **Settings → Automatically mark as Followed when opening a profile**.

When Auto-Mark is enabled, opening a previously un-followed account immediately changes it to **Followed**. When Auto-Mark is disabled, opening a profile does not change its status.

The app does not inspect the destination site and cannot verify whether you actually followed the account there.

The browser must allow the new tab to open as part of the user action. Profile opening is attempted before asynchronous storage work so normal popup protections are less likely to interfere.

### Open next profile

**Open next profile** selects the next **Not followed** account in the current sort order and opens it.

### Triage mode

**Triage mode** provides a focused one-account-at-a-time workflow for working through the remaining **Not followed** accounts.

### Resume

**Resume** reopens the last profile you worked with.

---

## Search, filters, sorting, tags, and bulk actions

The dashboard provides:

- **All / Not followed / Followed / Skipped** status filters.
- Case-insensitive search across account names and URLs.
- Sorting by newest, oldest, name A–Z, name Z–A, or recently updated.
- A **Tag** filter.
- **Cards** and **Table** layouts.
- Pagination, with up to 50 accounts shown per page.
- Per-row selection and **Select all visible**.
- Bulk status changes and bulk **Add tag**.

Each account can have up to **20 short tags**. Tags are saved locally with the account and can be edited later.

Display preferences such as theme, layout, density, filter, sort order, and tag filter are also persisted locally.

---

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search field |
| `Esc` | Clear search while the search field is focused, or close a dialog |
| `N` | Open the next not-followed account |
| `P` | Previous page |
| `J` | Next page |

Shortcuts are ignored while typing in text inputs.

---

## Local data storage

Account data is stored locally using **IndexedDB**, with a `localStorage` fallback when IndexedDB cannot be initialized.

This means:

- Refreshing or restarting the browser does not erase the list.
- Data belongs to this browser profile on this device.
- Another browser, device, or private/incognito window does not automatically share the same data.
- Clearing the site's stored browser data can permanently erase your saved accounts and progress.

The app uses persistence-first updates for account changes, so a failed database write does not silently update the in-memory state.

---

## Backups and exports

### JSON backup

**JSON backup** exports the complete account list, including names, URLs, statuses, tags, and timestamps.

Example filename:

```text
follow-list-backup-2026-09-07.json
```

### Restore backup

**Restore backup** accepts a JSON backup and validates its entries before adding them.

Existing URLs are not duplicated. The restore summary reports added, duplicate, and invalid entries.

### CSV export

Exports account data in a spreadsheet-friendly CSV format.

### HTML report

Exports a standalone, human-readable HTML report containing the account list and current statuses/tags.

---

## Import and restore history

The **History** view records recent imports/restores locally.

History can include:

- Source filename.
- Number of accounts added.
- Duplicate and invalid counts.
- The total account count afterward.
- Recently added URL sets used for comparison.

History comparisons describe URLs added by the recent import events. They are not complete historical snapshots of the source files.

---

## Resetting data

**Reset all data** permanently deletes the saved account list and related local progress after confirmation.

There is no server-side copy to recover from, so export a JSON backup before resetting if you may need the data later.

---

## Privacy

Follow List Manager is local-first:

- Imported files are parsed in the browser.
- Saved account data stays in browser storage.
- There is no server, user account, analytics pipeline, or tracking service in the project.
- The app does not receive or inspect activity from the social-media sites you open.

The one obvious exception to the phrase "nothing leaves your device" is the profile URL you deliberately open in another tab. That navigation goes to the destination site by design. The app itself does not upload your imported file or account database.

---

## PWA and offline behavior

The project includes:

- `manifest.webmanifest` for install metadata.
- `assets/icon.svg` for the app icon.
- `sw.js` for application-shell caching.

The service worker uses a **network-first** strategy for same-origin assets so deployed updates are less likely to remain stuck on stale JavaScript or CSS. When the network is unavailable, cached application assets can be used instead.

PWA installation depends on browser support and deployment conditions, including a suitable secure origin.

---

## Browser compatibility

The app uses standard browser APIs including:

- IndexedDB
- localStorage
- `DOMParser`
- `<template>`
- `File` / `Blob`
- Streams and `DecompressionStream` where available
- Service workers for the PWA shell

Use a reasonably current Chrome, Edge, Firefox, Safari, or Chromium-based mobile browser for the best experience.

Some document-import features depend on browser support for ZIP decompression. When that is unavailable, the importer falls back to recovering literal URLs from the document bytes where possible.

---

## Limitations

- **Open Profile is not verification.** The app records your dashboard action and cannot confirm what happened on the destination platform.
- **Local data is not synchronized.** Moving to another device or browser requires a JSON backup and restore.
- **Document extraction is best-effort.** Complex or encrypted documents may not expose all embedded links.
- **Account names are inferred.** Unusual export formats may produce a less useful display name even when the URL itself is recovered correctly.
- **Search covers visible account name and URL only.** Internal IDs and timestamps are not part of search.
- **Browser storage can be cleared.** Export backups before clearing site data or resetting the browser profile.

---

## Development notes

This is a plain static web application. There is no frontend build system and no external runtime dependency required by the project.

To test locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Keep the app's static files together so relative imports, the manifest, icons, and service worker continue to resolve correctly.


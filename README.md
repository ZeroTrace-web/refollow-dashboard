# Follow List Manager

A local-first, privacy-focused dashboard for importing social-media profile links and working through them one account at a time.

Follow List Manager runs entirely in the browser. There is no backend, user account, cloud database, analytics pipeline, or tracking service. Imported files are parsed locally, and account data remains in browser storage unless you explicitly export it.

> **Updated for the current project version:** this README reflects the features and workflows present in the included application.

---

## Features

- Import one or many local files and recover HTTP/HTTPS profile links.
- Track accounts as **Not followed**, **Followed**, or **Skipped**.
- Open profiles individually or use **Open next profile** to work through the remaining list.
- Use **Triage mode** for a focused one-account-at-a-time workflow.
- Use **Resume** to reopen the last profile you worked with.
- Optionally auto-mark an account as **Followed** when its profile is opened.
- Search, filter, sort, tag, select, and bulk-update accounts.
- Switch between **Cards** and **Table** layouts.
- Choose compact, comfortable, or large display density.
- Use **Focus/Maximize** and **Hide UI** controls for a less distracting workflow.
- Adjust text size, high contrast, and dark/light theme preferences.
- Export a complete **JSON backup**, spreadsheet-friendly **CSV**, or standalone **HTML report**.
- Restore JSON backups without duplicating URLs already stored locally.
- Review local **import and restore history**, including recently added URL sets.
- Install the app as a PWA on compatible browsers and deployments.
- Continue using the cached application shell offline after it has been stored by the service worker.

---

## Project structure

```text
follow-list-manager/
├── index.html              Main application page
├── style.css               Layout, themes, responsive and accessibility styles
├── sw.js                   Service worker for the installable/offline shell
├── manifest.webmanifest    PWA metadata
├── README.md               Project documentation
├── assets/
│   └── icon.svg            App icon / favicon
└── js/
    ├── utils.js            Shared helpers, settings, and modal utilities
    ├── db.js               IndexedDB storage with localStorage fallback
    ├── importer.js         Local file parsing and URL extraction
    ├── toast.js            Toast notifications
    ├── render.js           Card/table rendering
    └── app.js              Application state and event wiring
```

---

## Running the app

There is no build step and no package installation required.

You can open `index.html` directly in a modern browser. For the most reliable browser-storage, service-worker, and PWA behavior, serve the folder with a local HTTP server:

```bash
cd follow-list-manager
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

A production deployment can be hosted as a normal static site. PWA installation generally requires a compatible browser and a secure HTTPS origin.

---

## Importing files

Use **Import files / following list** to select one or multiple local files.

### Supported formats

The importer includes specialized or best-effort support for:

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

For many non-HTML formats, the importer searches for literal `http://` and `https://` URLs. ZIP-based office and document formats can be inspected through their internal XML where browser support allows it.

Extraction is best-effort. Complex, encrypted, encoded, or unusual document formats may not expose every embedded link.

### HTML imports

For HTML/XHTML files, the app reads `<a href="...">` links and accepts only absolute `http://` or `https://` URLs.

Account names are chosen in this order:

1. Visible link text, when it is not itself a URL.
2. The link's `title` attribute.
3. The link's `aria-label` attribute.
4. A name derived from the URL.

Duplicate URLs already stored in the app, or repeated within the same import operation, are ignored.

### Import safety

All parsing happens locally in the browser. Files are not uploaded by the app.

Files larger than **100 MB** are rejected to reduce the chance of an unexpectedly large import freezing the browser. Because apparently humans needed a safety rail for feeding giant files to a small browser app.

---

## Account statuses

Every saved account has one of three statuses:

- **Not followed**: the default status for newly imported accounts.
- **Followed**: an account you marked as followed.
- **Skipped**: an account you decided not to follow.

Status totals and follow progress are shown on the dashboard.

---

## Profile workflows

### Open Profile and Auto-Mark

**Open Profile** opens the account URL in a new tab.

The behavior is controlled by **Settings → Automatically mark as Followed when opening a profile**:

- When Auto-Mark is enabled, opening a previously not-followed account changes it to **Followed**.
- When Auto-Mark is disabled, opening a profile does not change its status automatically.

The app cannot inspect the destination website and cannot verify whether you actually followed the account there. It records the dashboard action, not your behavior on another site.

Profile opening is attempted as part of the user action before asynchronous storage work, which helps avoid normal popup blocking.

### Open next profile

**Open next profile** selects the next **Not followed** account in the current sort order and opens it.

### Triage mode

**Triage mode** provides a focused workflow for reviewing one remaining account at a time. You can open the profile, mark it followed, skip it, or move through the triage list.

### Resume

**Resume** returns to the last profile you worked with.

---

## Search, filters, sorting, tags, and bulk actions

The dashboard provides:

- **All / Not followed / Followed / Skipped** filters.
- Case-insensitive search across account names and URLs.
- Sorting by newest, oldest, name A–Z, name Z–A, or recently updated.
- A **Tag** filter.
- **Cards** and **Table** layouts.
- Pagination with up to 50 accounts per page.
- Per-account selection and **Select all visible**.
- Bulk status changes.
- Bulk **Add tag**.

Each account can have up to **20 short tags**. Tags are saved with the account and can be edited later.

Display preferences such as theme, layout, density, filter, sort order, tag filter, text scale, and contrast preference are stored locally.

---

## Dashboard controls and accessibility

Secondary dashboard controls are kept behind **Settings** so the main workflow remains uncluttered.

Available controls include:

- Display density adjustments.
- Focus/Maximize mode.
- Hide/Show UI.
- Theme switching.
- Larger text.
- High-contrast mode.
- Tracker settings.
- Import/restore history.
- Privacy and About information.
- PWA installation when the browser exposes an install prompt.

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
- Data belongs to the current browser profile on the current device.
- Another browser, device, or private/incognito window does not automatically share the data.
- Clearing site data can permanently erase saved accounts and progress.

Account changes use persistence-first updates so a failed database write does not silently leave the visible UI and saved data out of sync.

---

## Backups and exports

### JSON backup

**JSON backup** exports the complete account list, including names, URLs, statuses, tags, and timestamps.

Example filename:

```text
follow-list-backup-2026-09-07.json
```

### Restore backup

**Restore backup** accepts a JSON backup and validates entries before adding them.

Existing URLs are not duplicated. The restore summary reports added, duplicate, and invalid entries.

### CSV export

Exports account data in a spreadsheet-friendly CSV format.

### HTML report

Exports a standalone, human-readable HTML report containing the account list and its current statuses and tags.

---

## Import and restore history

The **History** view records recent import and restore activity locally.

History can include:

- Source filename.
- Number of accounts added.
- Duplicate and invalid counts.
- Total account count after the operation.
- Recently added URL sets used for comparison.

History comparisons describe URLs added by recent events. They are not complete historical snapshots of the original source files.

---

## Resetting data

**Reset all data** permanently deletes the saved account list and related local progress after confirmation.

There is no server-side copy to recover from, so export a JSON backup before resetting if you may need the data later. Computers remain tragically literal about permanent deletion.

---

## Privacy

Follow List Manager is local-first:

- Imported files are parsed in the browser.
- Saved account data stays in browser storage.
- There is no application backend or user account.
- There is no analytics pipeline or tracking service in the project.
- The app does not receive or inspect activity from the social-media sites you open.

The deliberate exception is navigation: when you choose to open a profile, the browser visits that destination URL in another tab. That request is made to the destination site as part of normal web navigation. The app itself does not upload your imported file or account database.

---

## PWA and offline behavior

The project includes:

- `manifest.webmanifest` for install metadata.
- `assets/icon.svg` for the application icon.
- `sw.js` for application-shell caching.

The service worker uses a **network-first** strategy for same-origin assets so deployed updates are less likely to remain stuck behind stale JavaScript or CSS. When the network is unavailable, cached application assets can still be used.

PWA installation and offline behavior depend on browser support and deployment conditions, including use of a suitable secure origin.

---

## Browser compatibility

The app uses standard browser APIs including:

- IndexedDB
- localStorage
- `DOMParser`
- `<template>`
- File and Blob APIs
- Streams and `DecompressionStream` where available
- Service workers for the PWA shell

Use a reasonably current Chrome, Edge, Firefox, Safari, or Chromium-based mobile browser for the best experience.

Some document-import features depend on browser support for ZIP decompression. When that support is unavailable, the importer falls back to recovering literal URLs from document bytes where possible.

---

## Limitations

- **Open Profile is not verification.** The app cannot confirm what happened on the destination platform.
- **Local data is not synchronized.** Moving to another device or browser requires exporting and restoring a JSON backup.
- **Document extraction is best-effort.** Complex or encrypted documents may not expose all embedded links.
- **Account names are inferred.** Unusual exports may produce a less useful display name even when the URL itself is recovered.
- **Search covers account names and URLs.** Internal IDs and timestamps are not searchable.
- **Browser storage can be cleared.** Export backups before clearing site data or resetting the browser profile.
- **PWA behavior varies by browser.** Installation and service-worker behavior depend on browser and deployment support.

---

## Development notes

This is a plain static web application with no frontend build system and no external runtime dependency.

To test locally:

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

Keep the application's static files together so relative scripts, the manifest, icons, and service worker continue to resolve correctly.

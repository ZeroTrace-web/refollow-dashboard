# Follow List Manager

A local-first web app for importing, organizing, and working through social-media profile links one account at a time.

**Live app:** https://refollow-dashboard.vercel.app/  
**Repository:** https://github.com/ZeroTrace-web/refollow-dashboard

## Overview

Follow List Manager is a browser-based dashboard for turning a collection of profile links into a manageable follow-review queue.

The app is designed around a simple workflow:

1. Import one or more local files.
2. Extract profile URLs from the files.
3. Review accounts individually or in a filtered list.
4. Mark accounts as **Not followed**, **Followed**, or **Skipped**.
5. Export a backup or report when needed.

No server-side account or database is required. Imported files are processed in the browser and saved account data is kept in the browser's local storage mechanisms.

## Features

### Import and organize

- Import multiple files in a single operation.
- Recover `http://` and `https://` links from supported documents.
- Deduplicate URLs already stored in the app and repeated within the same import.
- Infer account names from HTML link text, `title`, `aria-label`, or the URL.

### Review and follow workflow

- Track each account with one of three statuses:
  - **Not followed**
  - **Followed**
  - **Skipped**
- Open a profile in a new browser tab.
- Use **Open next profile** to move through the not-followed queue.
- Use **Triage mode** for a focused, one-account-at-a-time review.
- Use **Resume** to return to the most recently opened account.
- Optionally enable **Auto-Mark** to mark a not-followed account as followed when its profile is opened.

> The app records actions taken in the dashboard. It cannot verify whether an action was actually completed on the destination social-media site.

### Search, filtering, and bulk actions

- Filter by **All**, **Not followed**, **Followed**, or **Skipped**.
- Search account names and URLs.
- Sort by newest, oldest, name A–Z, name Z–A, or recently updated.
- Filter by tag.
- Add and edit short tags, with up to 20 tags per account.
- Select individual accounts or **Select all visible**.
- Apply bulk status changes or add a tag to selected accounts.
- Switch between **Cards** and **Table** views.
- Paginate the account list, with up to 50 accounts shown per page.

### Display and accessibility

- Compact, normal, and large account-card sizing.
- Maximize the account list for focused work.
- Hide surrounding dashboard UI.
- Increase text size.
- Enable high-contrast mode.
- Switch between light and dark themes.
- Keyboard shortcuts for common navigation.

### Backup and export

- Export a complete **JSON backup**.
- Restore JSON backups with validation and duplicate detection.
- Export account data as **CSV**.
- Export a standalone **HTML report**.
- Review local import and restore history.

### PWA and offline support

- Install the app as a Progressive Web App where supported.
- Use the cached application shell when the network is unavailable.
- The service worker uses a network-first strategy for same-origin assets so deployed updates can replace stale cached files more reliably.

## Supported import formats

The importer accepts the following file types:

| Format | Notes |
| --- | --- |
| HTML / HTM / XHTML | Extracts absolute URLs from anchor links |
| JSON | Supports application backup data |
| TXT | Best-effort URL extraction |
| CSV / TSV | Best-effort URL extraction |
| Markdown | Best-effort URL extraction |
| RTF | Best-effort URL extraction |
| XML | Best-effort URL extraction |
| DOC / DOCX | Best-effort extraction; ZIP/XML inspection where supported |
| ODT | Best-effort extraction |
| PDF | Best-effort URL extraction |
| XLSX / XLSM | Best-effort extraction; ZIP/XML inspection where supported |
| PPTX | Best-effort extraction; ZIP/XML inspection where supported |
| EPUB | Best-effort extraction |

For HTML/XHTML files, the importer reads `<a href="...">` links and accepts absolute `http://` or `https://` URLs.

For many non-HTML formats, the importer searches document content for literal HTTP/HTTPS URLs. ZIP-based office and document formats may be inspected through their internal XML when browser support makes that possible.

Extraction is best-effort. Complex, encrypted, encoded, or unusual documents may not expose every embedded link.

### Import limits and behavior

- Files larger than **100 MB** are rejected.
- Duplicate URLs are ignored.
- Account names are inferred and may be less useful for unusual exports.
- Import processing happens locally in the browser; the application does not upload the selected files to a backend.

## Using the app

### 1. Import a list

Click **Import files / following list** and select one or more local files.

The importer extracts supported profile URLs and adds new accounts to the dashboard.

### 2. Review accounts

Use the status filters, search field, sorting controls, and tags to narrow the list.

For a focused workflow, open **Triage mode** and process accounts one by one.

### 3. Update status

Each account can be marked as:

- **Not followed**: still needs review or action.
- **Followed**: marked as followed in the dashboard.
- **Skipped**: intentionally excluded from the workflow.

### 4. Open profiles

Use **Open Profile** on an account or **Open next profile** from the main toolbar.

The optional Auto-Mark setting controls whether opening a not-followed profile automatically changes its dashboard status to **Followed**.

### 5. Back up your data

Use **JSON backup** regularly if the stored list is important. Browser storage is local to the current browser profile and device.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search field |
| `Esc` | Clear search when the search field is focused, or close a dialog |
| `N` | Open the next not-followed account |
| `P` | Go to the previous page |
| `J` | Go to the next page |

Shortcuts are ignored while typing in text inputs.

## Data storage and privacy

Follow List Manager is designed to be local-first.

- Imported files are parsed in the browser.
- Account data is stored locally using **IndexedDB**, with a `localStorage` fallback when IndexedDB cannot be initialized.
- There is no application backend or user account.
- The project does not include an analytics pipeline or tracking service.
- Account data is not synchronized automatically between browsers or devices.
- Clearing site data can permanently remove the locally stored list and progress.

When you open a profile, the browser navigates to the destination URL in another tab. That network request goes to the destination site as part of normal browser navigation.

The app does not inspect activity performed on the destination social-media site.

## Backups and exports

### JSON backup

JSON backup contains the stored account data, including:

- Account name
- Profile URL
- Status
- Tags
- Timestamps

### Restore backup

Restore accepts JSON backup files, validates entries, and avoids adding duplicate URLs already present in the app.

The restore result reports added, duplicate, and invalid entries.

### CSV export

Exports account data in a spreadsheet-friendly format.

### HTML report

Exports a standalone HTML report containing the current account list, statuses, and tags.

## Import and restore history

The **History** view records recent import and restore activity locally.

History may include:

- Source filename
- Number of accounts added
- Duplicate and invalid counts
- Total account count after the operation
- Recently added URL sets used for comparison

History entries are not complete snapshots of the original source files.

## Resetting data

**Reset all data** permanently removes the saved account list and related local progress after confirmation.

There is no server-side copy of your local data. Export a JSON backup before resetting or clearing browser site data if you may need the list later.

## Running locally

This is a static web application. There is no package installation or frontend build step.

Serve the project directory with any static HTTP server. For example:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

You can also open `index.html` directly in a modern browser, but an HTTP server provides more reliable behavior for browser storage, service workers, and PWA features.

## Deployment

The project can be deployed as a normal static site.

For PWA installation and service-worker behavior, use a deployment that provides a suitable secure origin, such as HTTPS.

A current deployment is available at:

https://refollow-dashboard.vercel.app/

## Project structure

```text
refollow-dashboard/
├── index.html
├── style.css
├── sw.js
├── manifest.webmanifest
├── README.md
├── assets/
│   └── icon.svg
└── js/
    ├── app.js
    ├── db.js
    ├── importer.js
    ├── render.js
    ├── toast.js
    └── utils.js
```

### Main files

| File | Purpose |
| --- | --- |
| `index.html` | Application markup and UI structure |
| `style.css` | Layout, responsive styles, themes, and accessibility styles |
| `sw.js` | Service worker and application-shell caching |
| `manifest.webmanifest` | PWA metadata |
| `assets/icon.svg` | App icon and favicon |
| `js/app.js` | Application state, event handling, workflows, and exports |
| `js/db.js` | Local persistence using IndexedDB/localStorage |
| `js/importer.js` | File parsing and URL extraction |
| `js/render.js` | Account list and table rendering |
| `js/toast.js` | Toast notifications |
| `js/utils.js` | Shared helpers, settings, and modal utilities |

## Browser compatibility

The app uses standard browser APIs including:

- IndexedDB
- localStorage
- `DOMParser`
- File and Blob APIs
- `<template>`
- Streams and `DecompressionStream` where available
- Service workers

Use a reasonably current Chrome, Edge, Firefox, Safari, or Chromium-based mobile browser for the best experience.

Some document-import features depend on browser support for ZIP decompression. When that support is unavailable, the importer can fall back to recovering literal URLs from document content where possible.

## Limitations

- **Opening a profile is not verification.** The app cannot confirm what happened on the destination platform.
- **Data is local to a browser profile.** Moving to another browser or device requires a JSON export and restore.
- **Document extraction is best-effort.** Some files will not expose every embedded link.
- **Names are inferred.** The URL may be correct even when the displayed account name is not ideal.
- **Search is limited to names and URLs.** Internal IDs and timestamps are not searchable.
- **Browser storage can be cleared.** Keep a JSON backup for important lists.
- **PWA behavior varies by browser and deployment.**

## Development notes

Keep the static project files together so relative script, stylesheet, manifest, icon, and service-worker paths continue to resolve correctly.

For local development:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Status

The repository is a small, dependency-free static web application focused on local list management and one-account-at-a-time review.



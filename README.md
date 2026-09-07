# Follow List Manager

A local, single-user dashboard for working through an exported list of
social-media "following" links one profile at a time — open a profile,
have it marked followed automatically, skip the ones you don't want, and
pick up exactly where you left off later.

There is no server, no account, and no cloud storage. Everything — the
app and your data — lives in this folder and in your browser.

---

## Contents

```
follow-list-manager/
├── index.html          Page structure
├── style.css           All styling (light/dark themes, responsive layout)
├── README.md           This file
├── assets/
│   └── icon.svg         App icon / favicon
└── js/
    ├── utils.js         Shared helpers, DOM builder, settings, modal
    ├── db.js             IndexedDB storage (with a localStorage fallback)
    ├── importer.js       Parses the imported HTML/JSON files
    ├── toast.js           Toast notifications
    ├── render.js          Row rendering + virtual scrolling
    └── app.js             Application state and all the wiring
```

## What it does

1. You import the HTML file your social network exported for your
   "following" list.
2. The app pulls every valid profile link out of that file and lists
   each one as an account, starting as **Not followed**.
3. You work through the list: click **Open Profile** to open a profile
   in a new tab — doing so immediately marks it **Followed**. Click
   **Skip** for accounts you don't want. Filter, search, and sort as the
   list gets shorter.
4. Everything is saved locally after every change, so you can close the
   browser and pick up later — the list, and every status, is exactly as
   you left it.

## Running it

There's no build step and nothing to install. Open `index.html` in a
modern desktop or mobile browser — double-click the file, or drag it
into a browser window.

If your browser restricts local files from using browser storage (rare,
mostly older configurations), serve the folder instead:

```bash
# from inside the follow-list-manager folder
python3 -m http.server 8080
# then open http://localhost:8080 in your browser
```

Either way, nothing leaves your machine — see [Privacy](#privacy) below.

## Importing your following list

1. Export your following/followers list from your old account as an
   HTML file (most platforms offer this from an account-data or
   "download your information" export).
2. Click **Import following list** and choose that `.html` (or `.htm`)
   file.
3. The app reads the file locally in your browser, safely parses it —
   without ever executing anything inside it — and pulls out every link
   that:
   - is present in an `<a href="...">` tag, and
   - is an absolute `http://` or `https://` address.
4. Anything else (relative links, `javascript:` links, malformed URLs,
   non-HTML content) is ignored and counted as invalid rather than
   imported.
5. Links that already exist in your saved list, or that appear more
   than once in the same file, are skipped as duplicates.
6. A name is picked for each account from the link's own text, falling
   back to its `title` or `aria-label` attribute, and finally to a name
   derived from the URL itself (e.g. `@someuser`).
7. When it's done you'll see a summary, for example:

   > Imported 142 new profile links. 17 duplicates were ignored.

Every newly imported account starts as **Not followed**.

## How "Open Profile" works

This is the core of the app, so it's worth being explicit:

> **Clicking "Open Profile" automatically marks the account as
> Followed.** The application does not verify whether the Follow button
> was actually clicked on the external social-media platform.

Concretely, clicking **Open Profile**:

1. Opens the account's URL in a new browser tab.
2. Marks that account **Followed** and saves the change immediately.
3. Updates the stats, progress bar, and filters right away.

If your browser blocks the new tab as a popup, the app tells you so and
**does not** mark the account followed — nothing opened, so nothing
changed. Allow popups for this page and try again. (Re-opening a
profile that's already followed just re-opens the tab; it won't re-fire
a notification since nothing about its status changed.)

**Open next profile**, in the toolbar, does the same thing for the next
not-followed account in your current sort order — handy for working
through the list quickly without hunting for the next row yourself.

## How statuses work

Every account is always in exactly one of three states:

- **Not followed** — the starting state for every imported account.
- **Followed** — set automatically by Open Profile, or manually via
  **Mark followed**.
- **Skipped** — set via **Skip**, for accounts you've decided not to
  follow.

Each row exposes whichever of these don't already match its current
status, plus Open Profile and Copy link, so you can always move an
account to any other state by hand — including back to **Not followed**
if you change your mind. Status changes are saved immediately, and most
show a brief **Undo** option in case you clicked the wrong thing.

## Filtering, search and sort

- The **All / Not followed / Followed / Skipped** tabs filter the list
  and show a live count for each.
- **Search** matches an account's name or its link, instantly and
  case-insensitively, and works together with whichever filter is
  active.
- **Sort** offers newest first, oldest first, name A–Z, name Z–A, and
  recently updated.
- Select accounts with the row checkboxes (or **Select all visible**)
  to mark a batch **Followed**, **Skipped**, or **Not followed** in one
  go.

The list is virtualized, so it stays smooth with many thousands of
accounts — only the rows currently on screen exist in the page at any
moment.

## Local data storage

Your accounts are saved with [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API),
a browser-native database built for exactly this — reliably storing a
few thousand records on your own device. If a browser genuinely can't
provide IndexedDB, the app automatically falls back to `localStorage`
so it still works, just with a lower practical size ceiling; a
notification lets you know if that happens.

Either way:

- Your data survives refreshing the page, closing the tab, and
  restarting the browser.
- It is tied to this page in this browser profile. Opening the app from
  a different browser, a different device, or in a private/incognito
  window starts with an empty list.
- Clearing this site's data from your browser settings (or clearing
  history/cookies with "site data" included) erases it — export a
  backup first if you want to keep a copy.

Small interface preferences (theme, active filter, sort order, compact
vs. comfortable view) are saved separately in `localStorage` so they're
restored the next time you open the app too.

## Exporting a backup

**Export backup** downloads a JSON file named like
`follow-list-backup-2026-09-07.json`, containing every account and its
current status — enough to fully restore your progress later, on this
device or another one.

## Restoring a backup

**Restore backup** lets you choose a previously exported JSON file. The
app validates it, then adds any accounts it doesn't already have
(matched by link, so nothing is duplicated), preserving each one's
saved status. You'll see a summary of how many were restored, how many
already existed, and how many entries were invalid.

## Resetting

**Reset all data** permanently deletes every account and status after
you confirm — there's no server-side copy to recover it from, so the
app reminds you to export a backup first.

## Privacy

- The app runs entirely in this browser tab. Nothing you import is
  uploaded anywhere: no server, no account, no analytics, no tracking.
- Your data is stored locally, as described above, and never leaves
  your device.
- The app can't see or verify anything that happens on the social
  platforms you visit — it only records what you've told it by clicking
  a button here.

## Browser compatibility

Built with modern, standard web APIs only — no build tools or external
libraries. It works in current versions of:

- Chrome / Edge / other Chromium-based browsers
- Firefox
- Safari (desktop and iOS)
- Chromium-based mobile browsers on Android

It needs a browser with IndexedDB (or, failing that, `localStorage`),
`DOMParser`, and `<template>` support — all standard since long before
2020, so any reasonably current browser is fine.

## Keyboard shortcuts

| Key      | Action                                   |
| -------- | ----------------------------------------- |
| `/`      | Focus the search field                    |
| `Esc`    | Clear the search field (while it's focused), or close a dialog |
| `N`      | Open the next not-followed profile        |

Shortcuts are ignored while you're typing in a text field, so they never
interfere with search text or your imported data.

## Limitations

- The app has no way to detect whether you actually followed an account
  on the destination site — see [How "Open Profile" works](#how-open-profile-works).
  It only tracks what happens in this dashboard.
- Data is local to one browser on one device; there's no built-in way to
  sync between devices. Export a backup and restore it elsewhere if you
  need to move your progress.
- Very unusual or minified export formats may produce imperfect account
  names (falling back to something derived from the URL) — the link
  itself is always extracted correctly, only the display name is a
  best-effort guess.
- Name/URL search does not search inside the (undisplayed) internal ID
  or timestamps — just the visible name and link, matching what you can
  see on screen.


## Reliability notes

The app uses IndexedDB as its primary account store and localStorage only as a fallback when IndexedDB cannot be initialized. Individual IndexedDB write/clear failures are retried rather than silently switching storage backends, which prevents split-brain data.

The app does not show a startup loading overlay. The main interface renders immediately and local storage is loaded as part of initialization.

Clicking **Open Profile** opens the profile in a new tab and marks that account as **Followed**. If the browser blocks the new tab, the account is still marked followed and the app shows a warning.


## Importing files

The main **Import files / following list** action accepts multiple local files at once. It supports HTML/XHTML, plain text, CSV/TSV, Markdown, RTF, XML, JSON backups, and common ZIP-based office/document formats such as DOCX, ODT, XLSX, XLSM, PPTX, and EPUB. For other files, the app makes a best-effort scan for literal `http://` and `https://` URLs (which can help with some legacy/binary documents).

All parsing happens in the browser. Files are not uploaded. For document formats whose contents are compressed/encrypted or whose URLs are not stored as plain link strings, extraction may be incomplete.


### Import safety and compatibility

Imports are processed entirely in the browser. Files larger than 100 MB are rejected to prevent accidental browser freezes. The importer uses format-specific parsing where practical and falls back to literal URL recovery for difficult or legacy document formats.

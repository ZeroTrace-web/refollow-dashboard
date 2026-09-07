# Refollow

**Refollow** is a small, local-first web app for importing profile links and working through them one at a time.

It is built for a simple problem: you have a list of links, you want to review them, and you do not want to lose your place in a giant browser tab pile.

## What it does

- Imports profile links from local files
- Tracks accounts as **Not followed**, **Followed**, or **Skipped**
- Lets you search, filter, sort, and tag accounts
- Opens profiles one at a time with **Open next profile**
- Includes **Triage mode** for focused review
- Can resume the last profile you worked with
- Supports bulk status changes and tags
- Exports JSON backups, CSV files, and HTML reports
- Restores JSON backups without adding duplicate URLs
- Stores data locally in your browser
- Includes basic PWA and offline support where the browser supports it

## Privacy

Refollow is local-first.

- No user accounts
- No application backend
- No analytics pipeline
- No tracking service
- Imported files are processed in the browser

Your saved data stays in the browser on the device you are using. It is not automatically synced to another browser or device.

When you choose to open a profile, your browser visits that website normally. Refollow does not verify what you do on the destination platform.

## Running locally

There is no build step and no package installation required.

Serve the project with a local HTTP server:

```bash
python3 -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Important limitations

Refollow is intentionally a simple browser application.

- It cannot confirm whether you actually followed an account.
- Imported links and names may be incomplete or imperfect depending on the source file.
- Document import is best-effort for complex formats.
- Clearing browser site data can remove your saved list.
- Moving to another device or browser requires exporting and restoring a backup.
- PWA and offline behavior depend on browser support and deployment setup.

If the list matters, keep a JSON backup. Browsers are excellent at forgetting things when humans press the wrong button.

## Project

Repository: https://github.com/ZeroTrace-web/refollow-dashboard

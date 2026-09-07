Refollow Dashboard

A lightweight, local-first web app for importing, organizing, and tracking social media profile links.

Everything runs locally in your browser.

Features

- Import profile lists from multiple file formats
- Organize and track social media profiles
- Manage followed and unfollowed profiles
- Open the next profile in your list
- Triage mode for focused processing
- Search and filter profiles
- Track progress and statistics
- Export data as JSON, CSV, or HTML
- Restore data from a JSON backup
- Dark mode and display controls
- Accessibility options
- Local data storage
- Progressive Web App (PWA) support

Run Locally

1. Clone the Repository

git clone https://github.com/ZeroTrace-web/refollow-dashboard.git

2. Open the Project Folder

cd refollow-dashboard

3. Start a Local Server

Using Python

python -m http.server 8000

Then open:

http://localhost:8000

Using Node.js

npx serve .

Then open the local URL displayed in your terminal.

Project Structure

refollow-dashboard/
├── index.html
├── style.css
├── manifest.webmanifest
├── sw.js
├── assets/
│   └── icon.svg
└── js/
    ├── app.js
    ├── db.js
    ├── importer.js
    ├── render.js
    ├── toast.js
    └── utils.js

Data Storage

Refollow Dashboard is designed to be local-first.

- No account is required.
- No backend server is required.
- Imported files are processed locally.
- Your data stays in your browser unless you manually export or share it.

«Note: Clearing your browser's site data may remove locally stored information. Export a JSON backup if you want to preserve your data.»

Backup and Restore

Create a Backup

1. Open the application.
2. Click JSON Backup.
3. Save the downloaded file somewhere safe.

Restore a Backup

1. Open the application.
2. Click Restore Backup.
3. Select a previously exported JSON backup.

PWA Support

The project includes Progressive Web App support through:

- "manifest.webmanifest"
- "sw.js"
- Application icons

For the best experience, run the app through a local server during development.

Requirements

No build process or package installation is required.

You only need a modern web browser. For local development, you can use:

- Python, or
- Node.js

Live Demo

Visit the live version:

https://refollow-dashboard.vercel.app

Repository

https://github.com/ZeroTrace-web/refollow-dashboard
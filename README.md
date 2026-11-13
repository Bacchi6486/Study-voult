# StudyVault (first prototype)

A phone-friendly, installable web app prototype for a personal video study library and study planner.

## Included in this first version
- Add study targets with subject, topic, duration and priority.
- Generate a simple timetable from available daily hours and a start time.
- Mark targets complete and view progress.
- Import videos from your phone into browser storage, play them, and resume playback.
- Export planner tasks as JSON.
- Offline app shell after first successful load when hosted over HTTPS.

## Important storage limitations
This prototype stores imported video files inside the browser's IndexedDB on the same phone. Browser/device quotas vary. This is **not** 10 TB cloud storage, does not sync to another device, and may be cleared by Android/browser storage cleanup. Keep original videos and backups. The planner JSON export does not include video files.

## Easiest phone-only deployment
1. Extract this ZIP on your Android phone.
2. In Chrome, sign in to GitHub and create a new public repository named `studyvault`.
3. Upload all files in this folder to the repository root (`index.html`, `styles.css`, `app.js`, `manifest.webmanifest`, `sw.js`, `icon.svg`).
4. In the repository, open **Settings → Pages**.
5. Under Build and deployment, choose **Deploy from a branch**, select `main` and `/ (root)`, then Save.
6. Wait for GitHub Pages to publish. Open the published HTTPS address in Chrome on Android.
7. Chrome menu → **Add to Home screen** or **Install app**.

GitHub's mobile website interface may vary. If uploading a folder is awkward, upload the six files individually using the repository's Add file / Upload files option.

## Use
- **Videos** → Add a lecture video → choose a file from your phone.
- **Planner** → add subjects/topics and durations → set available hours and start time → Generate my timetable.
- **Home** shows today's tasks and recently added videos.
- **Progress** shows completion and lets you export planner data.

## Next development stages
1. Add editable subjects, dates, recurring tasks and smarter schedule conflict handling.
2. Add notes and PDF attachments.
3. Add robust video backup/cloud storage with a storage budget and privacy controls.
4. Add optional login and sync.

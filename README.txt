STUDYVAULT UPDATE V5

This update adds: editable saved-video titles; nested folders; per-folder lecture counts and video duration progress; a custom app icon from your supplied image; and fixes to the earlier folder/link/planner/quiz interface.

INSTALL ON GITHUB PAGES (Android phone):
1. Extract this ZIP.
2. In your GitHub repository, upload and replace index.html, app.js, styles.css, and sw.js.
3. Also upload the NEW files manifest.webmanifest, icon-192.png, and icon-512.png to the repository root.
4. Commit changes and wait for the Actions deployment to show a green check.
5. Close StudyVault fully and open the website in Chrome once.
6. For the new icon, Android may need the PWA shortcut to be added again after the manifest refreshes.

IMPORTANT DATA SAFETY:
- Do NOT clear browser/app storage or uninstall the app before checking your videos.
- Existing videos, folders, links and planner data remain in the browser's IndexedDB.
- Uploaded video files are stored on this device only, not in GitHub/cloud. Keep original files as backups.
- Video total duration becomes available after each video is played once. Completed time is estimated from the saved playback position; a lecture is marked complete when it reaches the end.
- YouTube playback is subject to the video's embedding permissions.

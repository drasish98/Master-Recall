# Master Recall v2

An offline-first, mobile-friendly spaced repetition and study-hours/MCQ tracker, rebuilt from the supplied Master Recall HTML without changing its basic 19-subject design.

**No Firebase account is required for local use.** The app starts empty: no old topics are migrated automatically.

## Quick start on GitHub Pages

1. Download and unzip `MasterRecall_v2_GitHubPages.zip`.
2. Create a *public* GitHub repository, for example `master-recall`.
3. Upload all files in the unzipped folder **to the repository root**. GitHub Pages needs `index.html`, `app.js`, `schedule.js`, `cloud.js`, `styles.css`, `sw.js`, `firebase-config.js`, `manifest.json`, and the icon files in the same root directory.
4. On GitHub open **Settings → Pages → Build and deployment → Deploy from a branch → main → / (root)** and save.
5. Open `https://YOURUSERNAME.github.io/master-recall/` in your phone's browser. Use *Add to Home Screen* if you want an app-like icon.
6. Test the web app once while online to let the service worker cache its files. The core tracker can then open offline.

You can also test locally by opening a terminal in the app folder and running `python -m http.server 8080`, then opening `http://localhost:8080`. **Don't rely on double-clicking `index.html`**, because modern browsers block JavaScript modules loaded from `file://`.

## Optional Firebase cloud sync

The app works locally without Firebase. When ready:

1. Visit https://console.firebase.google.com/ and create a Firebase project (the free Spark plan is suitable within its usage limits).
2. In project settings add a **Web app** and copy its web configuration values into `firebase-config.js` (`apiKey`, `authDomain`, `projectId`, and `appId`). This is browser configuration, not a private service-account secret.
3. In **Authentication → Sign-in method**, enable **Google** as a provider.
4. In **Authentication → Settings → Authorized domains**, add `YOURUSERNAME.github.io` (without the repository path). For local testing, also authorize `localhost` if needed.
5. In **Firestore Database**, create a database in a nearby region. In the **Rules** tab, replace the rules with the contents of `firebase.rules` and click **Publish**. **Never use `allow read, write: if true`.**
6. Update the GitHub repository with your configured `firebase-config.js`. Open the live GitHub Pages app, go to **Settings & backup → Connect with Google**, and sign in.
7. On another device, open the same URL and sign in using the **same Google account**. Each topic and session is stored in individual documents in `users/<uid>/topics`, `users/<uid>/logs`, and preferences.

The app retains a local mirror in the browser and tries to merge signed-in Firestore records by their per-record update timestamps. Firebase's Firestore persistence is enabled where supported. While offline, your local edits remain usable; once the cloud SDK and account reconnect, they are sent to Firestore. For the simplest safe experience, **avoid editing the same topic on two devices at the same moment**, especially while both devices are offline. The last updated version of that record can win. Use JSON backup exports regularly.

The free tier has quotas. Do not enable paid Google Cloud billing just to deploy this app unless you understand why you need it.

## What changed

- **Today and Overdue** in distinct columns, plus upcoming queue, revision debt, and daily pulse.
- **Past topic** tab for the true original Day 0 study date.
- **1, 3, 8, 15, then every 21 days**, with editable per-topic recurrence settings.
- Completing an overdue repetition offers a **per-topic fixed/shift decision**, and saves due/completion dates plus recall quality.
- Explicit **Reschedule this topic** adjusts one topic without marking a revision completed. The misleading global Shift Overdue button is gone.
- Subject/topic library includes search, status/subject filters, pause/resume, edit and delete.
- Upcoming revision calendar, exam countdown and cutoff, a configurable busy-day load warning, study performance charts, revision analytics, and recall quality summary.
- Study log tracks hours, MCQs attempted, optional correct answers, session date and subject, with editing and CSV export. Summaries and charts support weekly/monthly/daily grouping, hours-versus-MCQs metric selection, and custom windows.
- Undo the latest completion for up to 20 seconds using the visible Undo action (the underlying history is reversible in code but the UI offers a short window).
- Safer calendar dates including leap year/month transitions, input escaping, bounded import validation, no `localStorage.clear()`, storage failure alerts, and JSON export/import.
- Local cache is stored in this site's `localStorage` plus optional Firestore persistence. Charting uses inline SVG, so no Chart.js CDN is needed.
- A PWA service worker caches local files for offline access after a successful online visit.

## Important behavior

**Fixed schedule example:** R1 was due November 24, but completed November 28. R2 stays due November 26 and is therefore immediately overdue. This is deliberate and reflects your original plan.

**Shift schedule example:** R1 due November 24 completed November 28 is four days late. Choosing Shift moves R2 from November 26 to November 30, R3 from December 1 to December 5, and so on. Only that topic is affected, and the original completion record is retained.

**Backdated topic example:** If SLE was first studied November 10 and entered November 23, Day 0 is November 10. Its R1 originally fell November 11. The overdue queue reflects that.

**Calendar forecast:** The full set of future due dates is computed from the recurrence rule, without needing to mark the previous revision complete. If no exam date is configured, the calendar forecasts future dates when you navigate it, and analytics forecast 14–60 days. Setting an exam date hides occurrences after that date.

**Study hours:** Decimal hours such as `2.5` are supported. Multiple sessions on one day are summed. Correct answers can be blank; accuracy is calculated only for sessions with a supplied correct count. Individual sessions are capped at 24 hours for input sanity.

**Offline caution:** The browser can still clear site storage, private-mode data can disappear, and service-worker caches may be evicted. A web app cannot guarantee an export was saved. Always check the downloaded JSON file in Downloads periodically, particularly until Firebase sync is working.

**Cloud limitations:** The supplied cloud connector cannot be live-tested without your own Firebase project credentials, an authorized domain, and a real account. Cross-device edit conflicts are resolved per record using client update times, which is suitable for simple single-user use but not a multi-editor system. This app is not a medical records storage service and should not contain patient-identifying information.

## Testing

- `node --test tests/*.test.js` checks the pure scheduling algorithm.
- `python -m http.server 8080` then open `http://localhost:8080` to test interactions in Chrome/Edge/Firefox.
- Run an online load, then turn on airplane mode and reload. Revisit your scheduled revisions and study logs.
- Before starting serious use, export a JSON backup, try restoring it in a separate test browser profile, and confirm topic/revision history and study sessions reappear.

## Files

`index.html` = structure; `styles.css` = design; `app.js` = UI, storage, revision completion, study log, charts; `schedule.js` = pure calendar algorithm; `cloud.js` = optional Google sign-in/Firestore integration; `firebase-config.js` = your configuration; `firebase.rules` = Firestore security rules; `sw.js` = offline cache; `manifest.json`/icons = installable PWA; `tests/` = schedule tests.

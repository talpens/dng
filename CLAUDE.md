# Studio DNG – lessons & makeups app

Owner: Tal (Studio DNG, ceramics studio, Israel). Talk to Tal in Hebrew. UI text is Hebrew, RTL.
Tal likes short progress updates (every ~5% of the task) while you work.

## What this is
A sign-up system for weekly ceramics lessons. Students get a personal link from Tal (no account needed),
request a fixed weekly lesson, mark absences (which earn makeup credits), and request makeups in lessons
with free seats. Tal approves joins and makeups from an admin page and gets email notifications.

## Architecture (two parts)
1. **Backend + UI: Google Apps Script web app**, bound to Tal's Google account.
   - Script ID: `10uAfaJyEDQHPrKiTuhn-Uv-zFVOBMbl6MLIX9-svPDmtpQzktewfajdC`
   - Web app (deployment) URL: `https://script.google.com/macros/s/AKfycbyMML5WkOLAWTvZxXvFuySfhXMS4FM2mXqsxD_Tep1jxbah-0aSBfWJ0JBiauYgueZZNw/exec`
   - Files in `apps-script/`: `קוד.js` (server, shown as Code.gs in the editor: setup, doGet, studentState, register, setAbsence, requestMakeup,
     cancelMakeup, adminState, adminAction) and `Index.html` (whole client UI, vanilla JS, `google.script.run`).
   - Data lives in a Google Sheet ("שיעורים – סטודיו DNG") with tabs: Students, Invites, Absences,
     Makeups, Cancelled, Workshops, WsSignups, Inventory, Recipes, Teachers, Subs, Settings (the workshop, Inventory, Recipes, Teachers and Subs tabs are created automatically on first use). All cells are text. Settings holds ADMIN_KEY, SEATS (8),
     NOTIFY_EMAIL, APP_URL (base for invite links; must be https://talpens.github.io/dng/site/).
   - Source lives in `apps-script/` (pulled with clasp). The Sheet ID is kept in Script Properties (SHEET_ID), not in code.
2. **App shell: `site/`** (static, no build). `site/index.html` full-screens the web app in an iframe,
   plus `manifest.webmanifest` and icons so it installs to the phone home screen.
   - Live: https://talpens.github.io/dng/site/ (GitHub Pages, "deploy from branch" = root of `main`, publishes on
     every push). The root `index.html` forwards https://talpens.github.io/dng/ to `site/`, keeping ?t= / ?admin= / ?w=.
   - Netlify (studio-dng.netlify.app) was used briefly but its free plan forces a "Powered by Netlify" badge
     over the logo. `netlify.toml` now only 301-redirects every old Netlify link to GitHub Pages, keeping ?t= / ?admin= / ?w=.
   - `index.html` reads `?t=TOKEN` (student) or `?admin=KEY` (admin), remembers it in localStorage,
     and loads `<WEB_APP_URL>?t=...` / `?admin=...` in the iframe. Requires
     `XFrameOptionsMode.ALLOWALL` in doGet (already set).

## Business rules (keep these when changing code)
- Lessons: Sun 10:00–13:00, Sun 19:00–22:00, Tue 19:00–22:00, Wed 10:00–13:00, Wed 19:00–22:00.
  Slot ids: sun-am, sun-pm, tue-pm, wed-am, wed-pm. Lesson key = `YYYY-MM-DD_slotId` (week starts Sunday).
  Timezone Asia/Jerusalem.
- 8 seats per lesson (Settings.SEATS).
- Students cannot self-enrol: only someone with a personal invite link can request; Tal approves.
  An invite can be locked to a fixed slot (Invites.slot) — then the student can't pick another.
- Absence ("לא אגיע") gives a makeup credit. Deadline: morning lessons until 19:00 the day before;
  evening lessons until 10:00 the same day. After that only Tal can mark it (admin board).
- Credits = bonus + absences + cancelled own-slot lessons (since joined, not absent) − approved makeups.
- Free seats = SEATS − regulars + absent − approved makeups (0 if the lesson is cancelled).
- Makeup requests need a free seat and an available credit; Tal approves.
- Workshops (סדנאות): one-off events Tal opens from the admin "סדנאות" tab (name, date, hours, seats, optional
  price/description, optional "needs my approval", optional "students only"; "duplicate" copies one to a new date). Separate from regular lessons and credits. Approved students
  see upcoming open workshops inside their weekly schedule (on the workshop's date, no separate list; also shown in the admin "השבוע" tab); anyone can sign up (name + phone) from the workshop link `?w=<id>`.
  A pending sign-up holds a seat. Students can cancel until it starts; Tal can add/remove people and close sign-up.
- Inventory (מלאי, admin tab): items with qty, minimum, unit, optional category. An item is "to order" when min > 0 and
  qty <= min. When an item drops to its minimum Tal gets one email (Inventory.alerted), again only after it went back above.
  The "צריך להזמין" list can be sent by WhatsApp or email.
- Glaze recipes (מתכוני גלזורות): Tal mixes glazes himself. A recipe = inventory materials with % of dry weight (may exceed
  100% with additives). "הכנתי X ק"ג" deducts X × % / 100 kg from each material (×1000 if the material's unit is grams),
  never below 0. A material used in a recipe can't be deleted.

- Teachers (מורים, admin tab): each teacher has name, optional phone and fixed slots (Teachers.slots, comma list; a lesson
  may have several teachers). A one-time substitute for a single lesson is chosen in the admin "השבוע" tab (Subs:
  lessonKey → teacherId) and replaces the regular teachers for that lesson only. Students see the teacher on each lesson.
  The Teachers tab is seeded once on creation (Tair: sun-am, wed-pm; "דורון נעמה גלפר": the rest).

## Secrets / privacy
- Never commit the admin key, the Sheet ID, student names/phones, or tokens. This repo is public.
- The admin link is `https://talpens.github.io/dng/site/?admin=<ADMIN_KEY>`; the key is in the Settings tab.

## First-time setup (done 2026-11-23; kept for reference / a new machine)
1. Tal turns on the Apps Script API: https://script.google.com/home/usersettings → "Google Apps Script API" → On.
2. `npm install -g @google/clasp` then `clasp login` (Tal approves in the browser).
3. From the repo root: `mkdir apps-script; cd apps-script; clasp clone 10uAfaJyEDQHPrKiTuhn-Uv-zFVOBMbl6MLIX9-svPDmtpQzktewfajdC`
   This pulls the live `Code.gs`, `Index.html`, `appsscript.json`.
4. Move the site files into `site/` and add `netlify.toml` with `[build] publish = "site"`, so the
   Apps Script source isn't served publicly. (GitHub Pages: switch the source to the root and accept that
   the legacy github.io URL stops working, or keep a copy — ask Tal.)
5. Commit and push.

## Changing the Apps Script code
- Edit files in `apps-script/`, then `clasp push`.
- To make changes live at the SAME URL: `clasp deployments` → take the deployment id of the web app →
  `clasp deploy -i <deploymentId> -d "short description"`. Do NOT create a new deployment (that changes the URL
  and breaks every student link).
- Settings in the Sheet are read at runtime — changing them needs no redeploy.
- After deploying, open the admin link and check it loads.

## Changing the app shell
- Edit files in `site/`, commit, push to `main` → GitHub Pages publishes within a minute or two.

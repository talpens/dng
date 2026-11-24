/**
 * סטודיו DNG – מערכת שיעורים והשלמות
 * Google Apps Script (מוצמד לגיליון Google).
 */

const TZ = 'Asia/Jerusalem';
const SLOTS = [
  { id: 'sun-am', dow: 0, day: 'ראשון', part: 'בוקר', from: '10:00', to: '13:00' },
  { id: 'sun-pm', dow: 0, day: 'ראשון', part: 'ערב',  from: '19:00', to: '22:00' },
  { id: 'tue-pm', dow: 2, day: 'שלישי', part: 'ערב',  from: '19:00', to: '22:00' },
  { id: 'wed-am', dow: 3, day: 'רביעי', part: 'בוקר', from: '10:00', to: '13:00' },
  { id: 'wed-pm', dow: 3, day: 'רביעי', part: 'ערב',  from: '19:00', to: '22:00' },
];
const SHEETS = {
  Students:  ['token', 'name', 'phone', 'slot', 'status', 'since', 'bonus', 'requestedAt', 'note'],
  Invites:   ['token', 'label', 'createdAt', 'slot'],
  Absences:  ['token', 'lessonKey', 'createdAt'],
  Makeups:   ['token', 'lessonKey', 'status', 'createdAt', 'decidedAt'],
  Cancelled: ['lessonKey', 'createdAt'],
  Workshops: ['id', 'title', 'date', 'from', 'to', 'seats', 'price', 'desc', 'approve', 'status', 'createdAt', 'who'],
  WsSignups: ['wsId', 'sid', 'token', 'name', 'phone', 'status', 'createdAt'],
  Inventory: ['id', 'name', 'qty', 'min', 'unit', 'cat', 'note', 'updatedAt', 'alerted'],
  Recipes:   ['id', 'name', 'parts', 'note', 'createdAt', 'lastMade', 'lastKg'],
  Teachers:  ['id', 'name', 'phone', 'slots', 'createdAt'],
  Subs:      ['lessonKey', 'teacherId', 'createdAt'],
  Settings:  ['key', 'value'],
};

/* ===================== spreadsheet (bound or standalone) ===================== */
let SS_ = null;
function ss_() {
  if (SS_) return SS_;
  return SS_ = openSs_();
}
function openSs_() {
  let s = null;
  try { s = SpreadsheetApp.getActive(); } catch (e) {}
  if (s) return s;
  const props = PropertiesService.getScriptProperties(), id = props.getProperty('SHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  s = SpreadsheetApp.create('שיעורים – סטודיו DNG');
  props.setProperty('SHEET_ID', s.getId());
  return s;
}

/* ===================== setup & menu ===================== */
function setup() {
  const ss = ss_();
  Object.keys(SHEETS).forEach(name => {
    let s = ss.getSheetByName(name), isNew = !s;
    if (!s) s = ss.insertSheet(name);
    const h = SHEETS[name];
    s.getRange(1, 1, s.getMaxRows(), h.length).setNumberFormat('@');
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    s.setFrozenRows(1);
    s.setTabColor(name === 'Settings' ? '#e8742b' : '#161616');
    if (isNew && name === 'Teachers') seedTeachers_();
  });
  const st = settings_();
  if (!st.ADMIN_KEY) setSetting_('ADMIN_KEY', randomToken_(24));
  if (!st.SEATS) setSetting_('SEATS', '8');
  if (!st.APP_URL) setSetting_('APP_URL', 'https://talpens.github.io/dng/site/');
  if (!st.NOTIFY_EMAIL) setSetting_('NOTIFY_EMAIL', Session.getEffectiveUser().getEmail());
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  bumpCache_();
  const key = settings_().ADMIN_KEY;
  console.log('הגיליון: ' + ss.getUrl());
  const url = ScriptApp.getService().getUrl();
  console.log(url ? 'קישור ניהול: ' + url + '?admin=' + key : 'אחרי Deploy להריץ את adminLink כדי לקבל את קישור הניהול');
  return 'ok';
}
/** להריץ מהעורך אחרי Deploy – מדפיס את קישור הניהול ביומן (Execution log). */
function adminLink() {
  const url = ScriptApp.getService().getUrl();
  console.log(url ? 'קישור ניהול: ' + url + '?admin=' + settings_().ADMIN_KEY : 'עוד לא פורסם (Deploy ← New deployment ← Web app)');
}
function onOpen() {
  try { SpreadsheetApp.getUi().createMenu('סטודיו DNG')
    .addItem('הגדרה ראשונית', 'setupUi')
    .addItem('הצג קישור ניהול', 'showAdminLink')
    .addItem('רענון נתונים באפליקציה (אחרי עריכה ידנית)', 'clearCache')
    .addToUi(); } catch (e) {}
}
/** כשהסקריפט מוצמד לגיליון: עריכה ידנית מרעננת את המטמון מיד. */
function onEdit() { bumpCache_(); }
function setupUi() {
  setup();
  SpreadsheetApp.getUi().alert('ההגדרה הושלמה. עכשיו צריך לפרסם: Deploy ← New deployment ← Web app. אחר כך: סטודיו DNG ← הצג קישור ניהול.');
}
function showAdminLink() {
  const url = ScriptApp.getService().getUrl();
  const ui = SpreadsheetApp.getUi();
  if (!url) { ui.alert('עוד לא פורסם. Deploy ← New deployment ← Web app.'); return; }
  ui.alert('קישור הניהול שלך (לא לשתף!):\n\n' + url + '?admin=' + settings_().ADMIN_KEY);
}

/* ===================== web app ===================== */
function doGet(e) {
  let t;
  try { t = HtmlService.createTemplateFromFile('Index'); }
  catch (err) { t = HtmlService.createTemplateFromFile('Index.html'); }
  const token = clean_(e.parameter.t), admin = clean_(e.parameter.admin), ws = clean_(e.parameter.w);
  // המצב הראשון נשלח יחד עם הדף, כדי שלא יהיה עוד סיבוב לשרת אחרי שהדף נטען.
  let state = null;
  try { state = admin ? adminState(admin, 0) : token ? studentState(token) : ws ? wsPublicState(ws) : null; } catch (err) { console.log('boot state failed: ' + err); }
  t.boot = JSON.stringify({ token, admin, ws, state }).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  return t.evaluate()
    .setTitle('שיעורים – סטודיו DNG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ===================== sheet helpers ===================== */
const SH_ = {};
const LAZY_SHEETS = ['Workshops', 'WsSignups', 'Inventory', 'Recipes', 'Teachers', 'Subs'];
function sh_(n) {
  if (SH_[n]) return SH_[n];
  let s = ss_().getSheetByName(n);
  if (!s && LAZY_SHEETS.indexOf(n) >= 0) { // גיליונות חדשים נוצרים לבד בפעם הראשונה, בלי להריץ setup
    s = ss_().insertSheet(n); const h = SHEETS[n];
    s.getRange(1, 1, s.getMaxRows(), h.length).setNumberFormat('@');
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold'); s.setFrozenRows(1); s.setTabColor('#161616');
    SH_[n] = s;
    if (n === 'Teachers') seedTeachers_();
  }
  return SH_[n] = s;
}
function rows_(n) {
  const s = sh_(n); if (!s) throw new Error('חסר גיליון ' + n + ' – צריך להריץ setup');
  const v = s.getDataRange().getValues(), h = SHEETS[n], out = [];
  for (let i = 1; i < v.length; i++) {
    if (v[i].every(x => x === '' || x === null)) continue;
    const o = { _row: i + 1 };
    h.forEach((k, j) => { o[k] = norm_(v[i][j]); });
    out.push(o);
  }
  return out;
}
function norm_(x) { return x instanceof Date ? Utilities.formatDate(x, TZ, 'yyyy-MM-dd') : String(x == null ? '' : x); }
function rowVals_(n, obj) { return SHEETS[n].map(k => obj[k] == null ? '' : String(obj[k])); }
function append_(n, obj) {
  const s = sh_(n), h = SHEETS[n], r = s.getLastRow() + 1;
  s.getRange(r, 1, 1, h.length).setNumberFormat('@').setValues([rowVals_(n, obj)]);
  return r;
}
/** כותב את כל השורה בקריאה אחת (במקום תא-תא). rec היא השורה המלאה כפי שנקראה. */
function update_(n, rec, obj) {
  Object.keys(obj).forEach(k => { rec[k] = String(obj[k]); });
  sh_(n).getRange(rec._row, 1, 1, SHEETS[n].length).setNumberFormat('@').setValues([rowVals_(n, rec)]);
}
function settings_() { const o = {}; rows_('Settings').forEach(r => o[r.key] = r.value); return o; }
function setSetting_(k, v) {
  const r = rows_('Settings').find(x => x.key === k);
  if (r) update_('Settings', r, { value: v }); else append_('Settings', { key: k, value: v });
  bumpCache_();
}

/* ===================== data in memory + cache =====================
 * כל קריאה לשרת קראה את כל 6 הגיליונות מחדש. עכשיו:
 *  - קריאה בלבד (פתיחת הדף, מעבר שבוע) מגיעה מ-CacheService, אם יש.
 *  - פעולה שכותבת קוראת תמיד מהגיליון עצמו (בתוך הנעילה), מעדכנת גם את הזיכרון,
 *    ושומרת את הנתונים המעודכנים במטמון, כך שהתשובה לא קוראת שוב את הגיליון.
 *  - שינוי ידני בגיליון מופיע באפליקציה תוך CACHE_TTL שניות לכל היותר
 *    (או מיד, עם תפריט "סטודיו DNG ← רענון נתונים" / הפונקציה clearCache).
 */
const CACHE_TTL = 300, CACHE_CHUNK = 90000, LIST_SHEET = { stu: 'Students', inv: 'Invites', abs: 'Absences', mk: 'Makeups', can: 'Cancelled', ws: 'Workshops', wss: 'WsSignups', stock: 'Inventory', rec: 'Recipes', tch: 'Teachers', sub: 'Subs' };
function cacheVer_(c) { return c.get('dver') || '0'; }
function cacheGet_() {
  try {
    const c = CacheService.getScriptCache(), ver = cacheVer_(c), n = +c.get('dn_' + ver);
    if (!n) return null;
    const keys = []; for (let i = 0; i < n; i++) keys.push('dc_' + ver + '_' + i);
    const got = c.getAll(keys); let json = '';
    for (let i = 0; i < n; i++) { if (got[keys[i]] == null) return null; json += got[keys[i]]; }
    return JSON.parse(json);
  } catch (e) { console.log('cache read failed: ' + e); return null; }
}
function cachePut_(D, ver) {
  try {
    const c = CacheService.getScriptCache();
    if (ver != null && cacheVer_(c) !== ver) return; // מישהו כתב בינתיים – לא לדרוס בנתונים ישנים
    ver = cacheVer_(c);
    const json = JSON.stringify(D), o = {}; let n = 0;
    for (let i = 0; i < json.length; i += CACHE_CHUNK) o['dc_' + ver + '_' + (n++)] = json.slice(i, i + CACHE_CHUNK);
    o['dn_' + ver] = String(n);
    c.putAll(o, CACHE_TTL);
  } catch (e) { console.log('cache write failed: ' + e); }
}
function bumpCache_() {
  try { const c = CacheService.getScriptCache(); c.put('dver', String(Date.now()) + Math.floor(Math.random() * 1000), 21600); }
  catch (e) { console.log('cache bump failed: ' + e); }
}
/** להריץ מהעורך (או מהתפריט) אחרי עריכה ידנית בגיליון, כדי שהאפליקציה תראה אותה מיד. */
function clearCache() { bumpCache_(); return 'ok'; }

/** הוספת שורה גם לגיליון וגם לנתונים שבזיכרון. */
function addRow_(D, list, obj) {
  const n = LIST_SHEET[list], rec = { _row: append_(n, obj) };
  SHEETS[n].forEach(k => { rec[k] = obj[k] == null ? '' : String(obj[k]); });
  D[list].push(rec); D._dirty = true;
  return rec;
}
function setRow_(D, list, rec, obj) { update_(LIST_SHEET[list], rec, obj); D._dirty = true; }
function delRow_(D, list, rec) {
  sh_(LIST_SHEET[list]).deleteRow(rec._row);
  D[list] = D[list].filter(r => r !== rec);
  D[list].forEach(r => { if (r._row > rec._row) r._row--; });
  D._dirty = true;
}
/** אחרי כתיבה: גרסה חדשה במטמון, עם הנתונים המעודכנים. */
function saveCache_(D) { if (!D._dirty) return; delete D._dirty; bumpCache_(); cachePut_(D, null); }
function clean_(s) { return String(s || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 64); }
function randomToken_(n) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'; let s = '';
  for (let i = 0; i < n; i++) s += a.charAt(Math.floor(Math.random() * a.length));
  return s;
}
function withLock_(fn) {
  const l = LockService.getScriptLock(); l.waitLock(20000);
  try { return fn(); } finally { l.releaseLock(); }
}

/* ===================== dates (Israel) ===================== */
let NOW_ = null, NOW_AT_ = 0;
function ilNow_() {
  if (NOW_ && Date.now() - NOW_AT_ < 20000) return NOW_;
  NOW_AT_ = Date.now(); return NOW_ = ilNow0_();
}
function ilNow0_() {
  const p = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH mm u').split(' ');
  return { date: p[0], min: (+p[1]) * 60 + (+p[2]), dow: (+p[3]) % 7 };
}
function addDays_(iso, n) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekStart_(off) { const n = ilNow_(); return addDays_(n.date, -n.dow + 7 * (off || 0)); }
function slotById_(id) { return SLOTS.find(s => s.id === id); }
function lesson_(key) { const wk = key.slice(0, 10), s = slotById_(key.slice(11)); return { wk, s, date: s ? addDays_(wk, s.dow) : wk }; }
function toMin_(hhmm) { const p = hhmm.split(':'); return (+p[0]) * 60 + (+p[1]); }
function started_(key) { const L = lesson_(key), n = ilNow_(); if (!L.s) return true; return L.date < n.date || (L.date === n.date && n.min >= toMin_(L.s.from)); }
function ended_(key) { const L = lesson_(key), n = ilNow_(); if (!L.s) return true; return L.date < n.date || (L.date === n.date && n.min >= toMin_(L.s.to)); }
function absDeadline_(key) { const L = lesson_(key); if (!L.s) return null; return toMin_(L.s.from) < 720 ? { date: addDays_(L.date, -1), min: 19 * 60, txt: 'עד 19:00 ביום הקודם' } : { date: L.date, min: 10 * 60, txt: 'עד 10:00 באותו יום' }; }
function absLate_(key) { const d = absDeadline_(key), n = ilNow_(); if (!d) return true; return n.date > d.date || (n.date === d.date && n.min >= d.min); }
function slotName_(id) { const s = slotById_(id); return s ? s.day + ' ' + s.part : id; }
function fmtD_(iso) { const p = iso.split('-'); return (+p[2]) + '.' + (+p[1]); }

/* ===================== domain ===================== */
/** fresh=true: לקרוא מהגיליון (לפני כתיבה). אחרת: מהמטמון אם יש. */
function load_(fresh) {
  let ver = null;
  if (!fresh) {
    const hit = cacheGet_(); if (hit && hit.ws && hit.wss && hit.stock && hit.rec && hit.tch && hit.sub) return hit;
    try { ver = cacheVer_(CacheService.getScriptCache()); } catch (e) {}
  }
  const D = {
    stu: rows_('Students'), inv: rows_('Invites'), abs: rows_('Absences'), mk: rows_('Makeups'),
    can: rows_('Cancelled'), ws: rows_('Workshops'), wss: rows_('WsSignups'), stock: rows_('Inventory'), rec: rows_('Recipes'), tch: rows_('Teachers'), sub: rows_('Subs'), set: settings_(),
  };
  if (fresh) bumpCache_();
  cachePut_(D, fresh ? null : ver);
  return D;
}
function cancelled_(D, key) { return D.can.some(r => r.lessonKey === key); }
function seats_(D) { return +(D.set.SEATS || 8); }
function seat_(D, key) {
  const L = lesson_(key);
  const regs = D.stu.filter(s => s.status === 'approved' && s.slot === L.s.id && s.since <= L.date);
  const absent = regs.filter(s => D.abs.some(a => a.token === s.token && a.lessonKey === key));
  const mkOk = D.mk.filter(m => m.lessonKey === key && m.status === 'ok');
  const cancelled = cancelled_(D, key);
  return { regs, absent, mkOk, cancelled, free: cancelled ? 0 : Math.max(0, seats_(D) - regs.length + absent.length - mkOk.length) };
}
function credits_(D, token) {
  const st = D.stu.find(s => s.token === token); if (!st || st.status !== 'approved') return 0;
  let c = +st.bonus || 0;
  c += D.abs.filter(a => a.token === token).length;
  D.can.forEach(r => {
    const k = r.lessonKey, L = lesson_(k);
    if (L.s && L.s.id === st.slot && st.since <= L.date && !D.abs.some(a => a.token === token && a.lessonKey === k)) c += 1;
  });
  c -= D.mk.filter(m => m.token === token && m.status === 'ok').length;
  return c;
}
function pendingMkCount_(D, token) { return D.mk.filter(m => m.token === token && m.status === 'pending' && !ended_(m.lessonKey)).length; }
function notify_(D, subject, body, linkLabel) {
  try {
    const to = D.set.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    const url = ScriptApp.getService().getUrl();
    MailApp.sendEmail(to, subject, body + (url ? '\n\n' + (linkLabel || 'לאישור') + ': ' + url + '?admin=' + D.set.ADMIN_KEY : ''));
  } catch (e) { console.log('mail failed: ' + e); }
}

/* ===================== student API ===================== */
function studentState(token) { return studentState_(load_(), clean_(token)); }
function studentState_(D, token) {
  if (!token || !D.inv.some(i => i.token === token)) return { state: 'invalid' };
  const st = D.stu.find(s => s.token === token);
  const occupancy = {}; SLOTS.forEach(s => occupancy[s.id] = D.stu.filter(x => x.status === 'approved' && x.slot === s.id).length);
  const inv = D.inv.find(i => i.token === token) || {};
  const base = { slots: SLOTS, seats: seats_(D), occupancy, fixedSlot: slotById_(inv.slot) ? inv.slot : '' };
  if (!st) return Object.assign(base, { state: 'new', label: inv.label || '' });
  if (st.status === 'pending') return Object.assign(base, { state: 'pending', me: { name: st.name, phone: st.phone, slot: st.slot, note: st.note } });
  if (st.status === 'rejected') return Object.assign(base, { state: 'rejected', me: { name: st.name, phone: st.phone, slot: st.slot, note: st.note } });
  if (st.status !== 'approved') return Object.assign(base, { state: 'removed' });
  const weeks = [0, 1, 2, 3].map(w => {
    const wk = weekStart_(w);
    return { wk, lessons: SLOTS.map(s => {
      const key = wk + '_' + s.id, L = lesson_(key), S = seat_(D, key), m = D.mk.find(x => x.token === token && x.lessonKey === key);
      return { key, slot: s.id, date: L.date, free: S.free, cancelled: S.cancelled,
        mine: s.id === st.slot && st.since <= L.date,
        absent: D.abs.some(a => a.token === token && a.lessonKey === key),
        mk: m ? m.status : '', teacher: teacherNames_(D, key), started: started_(key), ended: ended_(key), absLate: absLate_(key), absBy: absDeadline_(key).txt };
    }) };
  });
  return Object.assign(base, { state: 'ok', me: { name: st.name, slot: st.slot }, credits: credits_(D, token), pendingMk: pendingMkCount_(D, token), weeks,
    workshops: D.ws.filter(w => w.status === 'open' && !wsEnded_(w)).sort(wsSort_).map(w => wsPub_(D, w, token)) });
}
function register(token, f) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(true);
    const inv = D.inv.find(i => i.token === token);
    if (!inv) throw new Error('קישור לא תקין');
    if (slotById_(inv.slot)) f.slot = inv.slot;
    const name = String(f.name || '').trim().slice(0, 40), phone = String(f.phone || '').trim().slice(0, 20);
    const slot = slotById_(f.slot) ? f.slot : '', note = String(f.note || '').trim().slice(0, 140);
    if (!name || !slot) throw new Error('צריך שם ושיעור');
    const st = D.stu.find(s => s.token === token);
    if (st && (st.status === 'approved' || st.status === 'removed')) throw new Error('כבר רשום/ה');
    const obj = { token, name, phone, slot, status: 'pending', requestedAt: Date.now(), note };
    if (st) setRow_(D, 'stu', st, obj); else addRow_(D, 'stu', Object.assign({ since: '', bonus: '0' }, obj));
    saveCache_(D);
    notify_(D, 'בקשת הרשמה: ' + name, name + ' (' + phone + ') מבקש/ת מקום קבוע ב' + slotName_(slot) + (note ? '\nהערה: ' + note : ''));
    return studentState_(D, token);
  });
}
function setAbsence(token, key, on) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(true), st = D.stu.find(s => s.token === token && s.status === 'approved');
    if (!st) throw new Error('אין הרשאה');
    const L = lesson_(key);
    if (!L.s || L.s.id !== st.slot || st.since > L.date) throw new Error('זה לא השיעור הקבוע שלך');
    if (absLate_(key)) throw new Error('עבר מועד הביטול (' + absDeadline_(key).txt + '). לביטול מאוחר פנו לסטודיו');
    const ex = D.abs.find(a => a.token === token && a.lessonKey === key);
    if (on && !ex) addRow_(D, 'abs', { token, lessonKey: key, createdAt: Date.now() });
    if (!on && ex) delRow_(D, 'abs', ex);
    saveCache_(D);
    return studentState_(D, token);
  });
}
function requestMakeup(token, key) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(true), st = D.stu.find(s => s.token === token && s.status === 'approved');
    if (!st) throw new Error('אין הרשאה');
    const L = lesson_(key); if (!L.s) throw new Error('שיעור לא קיים');
    if (started_(key)) throw new Error('השיעור כבר התחיל');
    if (L.s.id === st.slot && st.since <= L.date) throw new Error('זה השיעור הקבוע שלך');
    if (D.mk.some(m => m.token === token && m.lessonKey === key)) throw new Error('כבר ביקשת את השיעור הזה');
    if (seat_(D, key).free <= 0) throw new Error('אין מקום פנוי בשיעור');
    if (credits_(D, token) - pendingMkCount_(D, token) <= 0) throw new Error('אין יתרת השלמות');
    addRow_(D, 'mk', { token, lessonKey: key, status: 'pending', createdAt: Date.now(), decidedAt: '' });
    saveCache_(D);
    notify_(D, 'בקשת השלמה: ' + st.name, st.name + ' מבקש/ת השלמה ב' + slotName_(L.s.id) + ' ' + fmtD_(L.date));
    return studentState_(D, token);
  });
}
function cancelMakeup(token, key) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(true), m = D.mk.find(x => x.token === token && x.lessonKey === key && x.status === 'pending');
    if (m) delRow_(D, 'mk', m);
    saveCache_(D);
    return studentState_(D, token);
  });
}

/* ===================== admin API ===================== */
function isAdmin_(D, key) { return !!key && clean_(key) === D.set.ADMIN_KEY; }
function adminState(adminKey, weekOff) { return adminState_(load_(), adminKey, weekOff); }
function adminState_(D, adminKey, weekOff) {
  if (!isAdmin_(D, adminKey)) return { state: 'denied' };
  const byTok = {}; D.stu.forEach(s => byTok[s.token] = s);
  const nm = t => (byTok[t] && byTok[t].name) || 'ללא שם';
  const url = ScriptApp.getService().getUrl() || '';
  const pendingJoin = D.stu.filter(s => s.status === 'pending').map(s => ({ token: s.token, name: s.name, phone: s.phone, slot: s.slot, note: s.note, taken: D.stu.filter(x => x.status === 'approved' && x.slot === s.slot).length }));
  const pendingMk = D.mk.filter(m => m.status === 'pending' && !ended_(m.lessonKey)).map(m => {
    const L = lesson_(m.lessonKey); return { token: m.token, key: m.lessonKey, name: nm(m.token), slot: L.s ? L.s.id : '', date: L.date, free: seat_(D, m.lessonKey).free, credits: credits_(D, m.token) };
  });
  const wk = weekStart_(weekOff || 0);
  const week = SLOTS.map(s => {
    const key = wk + '_' + s.id, S = seat_(D, key);
    const sub = D.sub.find(x => x.lessonKey === key);
    return { key, slot: s.id, date: lesson_(key).date, free: S.free, cancelled: S.cancelled, ended: ended_(key),
      teacher: teacherNames_(D, key), regular: tchNames_(regularTeachers_(D, s.id)), sub: sub ? sub.teacherId : '',
      regs: S.regs.map(r => ({ token: r.token, name: r.name, absent: S.absent.some(a => a.token === r.token) })),
      mk: S.mkOk.map(m => ({ token: m.token, name: nm(m.token) })) };
  });
  const students = D.stu.filter(s => s.status === 'approved').map(s => ({ token: s.token, name: s.name, phone: s.phone, slot: s.slot, bonus: +s.bonus || 0, credits: credits_(D, s.token) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const invites = D.inv.slice(-30).reverse().map(i => ({ token: i.token, label: i.label, slot: i.slot, used: !!byTok[i.token], link: (D.set.APP_URL || url) ? (D.set.APP_URL || url) + '?t=' + i.token : '' }));
  const base = D.set.APP_URL || url;
  const workshops = D.ws.slice().sort(wsSort_).filter(w => !wsEnded_(w) || w.date >= addDays_(ilNow_().date, -14)).map(w => Object.assign(wsPub_(D, w, ''), {
    status: w.status, link: base ? base + '?w=' + w.id : '',
    signups: D.wss.filter(x => x.wsId === w.id && x.status !== 'no').map(x => ({ sid: x.sid, name: x.name, phone: x.phone, status: x.status, student: !!x.token })) }));
  const pendingWs = D.wss.filter(x => x.status === 'pending').map(x => { const w = D.ws.find(y => y.id === x.wsId); return w && !wsEnded_(w) ? { sid: x.sid, name: x.name, phone: x.phone, title: w.title, date: w.date, free: wsFree_(D, w) } : null; }).filter(Boolean);
  const stock = D.stock.map(stockPub_).sort((a, b) => (a.cat || '\uffff').localeCompare(b.cat || '\uffff', 'he') || a.name.localeCompare(b.name, 'he'));
  return { state: 'ok', slots: SLOTS, seats: seats_(D), wk, pendingJoin, pendingMk, pendingWs, week, students, invites, workshops, stock, recipes: D.rec.map(recPub_).sort((a, b) => a.name.localeCompare(b.name, 'he')),
    teachers: D.tch.map(tchPub_).sort((a, b) => a.name.localeCompare(b.name, 'he')), hasUrl: !!url };
}
function adminAction(adminKey, act, p) {
  p = p || {};
  return withLock_(() => {
    const D = load_(true); if (!isAdmin_(D, adminKey)) throw new Error('אין הרשאה');
    const st = p.token ? D.stu.find(s => s.token === clean_(p.token)) : null;
    if (act === 'approve' && st) setRow_(D, 'stu', st, { status: 'approved', since: weekStart_(0), bonus: st.bonus || '0' });
    else if (act === 'reject' && st) setRow_(D, 'stu', st, { status: 'rejected' });
    else if ((act === 'mkok' || act === 'mkno') && p.key) {
      const m = D.mk.find(x => x.token === clean_(p.token) && x.lessonKey === p.key);
      if (m) setRow_(D, 'mk', m, { status: act === 'mkok' ? 'ok' : 'no', decidedAt: Date.now() });
    }
    else if (act === 'absence' && st && p.key) {
      const ex = D.abs.find(a => a.token === st.token && a.lessonKey === p.key);
      if (p.on && !ex) addRow_(D, 'abs', { token: st.token, lessonKey: p.key, createdAt: Date.now() });
      if (!p.on && ex) delRow_(D, 'abs', ex);
    }
    else if (act === 'cancel' && p.key) {
      const r = D.can.find(x => x.lessonKey === p.key);
      if (r) delRow_(D, 'can', r); else addRow_(D, 'can', { lessonKey: p.key, createdAt: Date.now() });
    }
    else if (act === 'slot' && st && slotById_(p.slot)) setRow_(D, 'stu', st, { slot: p.slot, since: weekStart_(0) });
    else if (act === 'bonus' && st) setRow_(D, 'stu', st, { bonus: (+st.bonus || 0) + (+p.delta || 0) });
    else if (act === 'remove' && st) setRow_(D, 'stu', st, { status: 'removed' });
    else if (act === 'invite') addRow_(D, 'inv', { token: randomToken_(16), label: String(p.label || '').slice(0, 40), createdAt: Date.now(), slot: slotById_(p.slot) ? p.slot : '' });
    else if (act === 'revoke' && p.token) { const r = D.inv.find(i => i.token === clean_(p.token)); if (r) delRow_(D, 'inv', r); }
    else if (act === 'wsSave') {
      const f = wsFields_(p), w = p.id ? D.ws.find(x => x.id === clean_(p.id)) : null;
      if (w) setRow_(D, 'ws', w, f); else addRow_(D, 'ws', Object.assign({ id: randomToken_(10), status: 'open', createdAt: Date.now() }, f));
    }
    else if (act === 'wsToggle' && p.id) { const w = D.ws.find(x => x.id === clean_(p.id)); if (w) setRow_(D, 'ws', w, { status: w.status === 'open' ? 'closed' : 'open' }); }
    else if (act === 'wsDelete' && p.id) {
      const id = clean_(p.id), w = D.ws.find(x => x.id === id);
      D.wss.filter(x => x.wsId === id).sort((a, b) => b._row - a._row).forEach(x => delRow_(D, 'wss', x));
      if (w) delRow_(D, 'ws', w);
    }
    else if ((act === 'wsOk' || act === 'wsNo') && p.sid) {
      const x = D.wss.find(y => y.sid === clean_(p.sid));
      if (x) setRow_(D, 'wss', x, { status: act === 'wsOk' ? 'ok' : 'no' });
    }
    else if (act === 'wsAdd' && p.id) { // רישום ידני על ידי טל (למשל מי שהתקשר/ה)
      const w = D.ws.find(x => x.id === clean_(p.id)), name = String(p.name || '').trim().slice(0, 40);
      if (w && name) addRow_(D, 'wss', { wsId: w.id, sid: randomToken_(12), token: '', name, phone: String(p.phone || '').trim().slice(0, 20), status: 'ok', createdAt: Date.now() });
    }
    else if (act.indexOf('stock') === 0) stockAction_(D, act, p);
    else if (act.indexOf('tch') === 0) teacherAction_(D, act, p);
    saveCache_(D);
    return adminState_(D, adminKey, p.week || 0);
  });
}

/* ===================== workshops (סדנאות חד-פעמיות) =====================
 * סדנה = אירוע חד-פעמי עם תאריך, שעות, מספר מקומות, מחיר ותיאור. לא קשורה לשיעורים
 * הקבועים ולא ליתרת ההשלמות. נרשמים אליה תלמידים (מהקישור האישי) או כל אחד מקישור
 * הסדנה (?w=ID). אם הסדנה "דורשת אישור", ההרשמה מחכה לאישור של טל; אחרת נכנסת מיד.
 * מקום נתפס גם ע"י הרשמה שממתינה לאישור, כדי שלא יהיה עודף נרשמים.
 */
function wsSort_(a, b) { return (a.date + a.from).localeCompare(b.date + b.from); }
function wsEnded_(w) { const n = ilNow_(); return w.date < n.date || (w.date === n.date && n.min >= toMin_(w.to || '23:59')); }
function wsStarted_(w) { const n = ilNow_(); return w.date < n.date || (w.date === n.date && n.min >= toMin_(w.from || '00:00')); }
function wsTaken_(D, w) { return D.wss.filter(x => x.wsId === w.id && (x.status === 'ok' || x.status === 'pending')).length; }
function wsFree_(D, w) { return Math.max(0, (+w.seats || 0) - wsTaken_(D, w)); }
function wsPub_(D, w, token) {
  const me = token ? D.wss.find(x => x.wsId === w.id && x.token === token && x.status !== 'no') : null;
  return { id: w.id, title: w.title, date: w.date, from: w.from, to: w.to, seats: +w.seats || 0, price: w.price, desc: w.desc,
    approve: w.approve === '1', studentsOnly: w.who === 'students', open: w.status === 'open', free: wsFree_(D, w), started: wsStarted_(w), ended: wsEnded_(w), mine: me ? me.status : '' };
}
function wsFields_(p) {
  const hm = s => /^\d{1,2}:\d{2}$/.test(String(s || '')) ? ('0' + s).slice(-5) : '';
  const title = String(p.title || '').trim().slice(0, 60), date = /^\d{4}-\d{2}-\d{2}$/.test(p.date || '') ? p.date : '';
  const from = hm(p.from), to = hm(p.to), seats = Math.max(1, Math.min(99, Math.floor(+p.seats || 0)));
  if (!title || !date || !from || !to) throw new Error('צריך שם, תאריך ושעות');
  if (to <= from) throw new Error('שעת הסיום צריכה להיות אחרי שעת ההתחלה');
  if (!(+p.seats > 0)) throw new Error('צריך מספר מקומות');
  return { title, date, from, to, seats, price: String(p.price || '').trim().slice(0, 30), desc: String(p.desc || '').trim().slice(0, 400), approve: p.approve ? '1' : '', who: p.studentsOnly ? 'students' : '' };
}
function wsDateTxt_(w) { return fmtD_(w.date) + ' ' + w.from + '–' + w.to; }
function wsDayName_(iso) { return ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'][new Date(iso + 'T12:00:00Z').getUTCDay()]; }

/** דף ציבורי של סדנה (?w=ID) */
function wsPublicState(id) { return wsPublicState_(load_(), clean_(id)); }
function wsPublicState_(D, id, done) {
  const w = D.ws.find(x => x.id === id);
  if (!w) return { state: 'wsinvalid' };
  return { state: 'ws', ws: wsPub_(D, w, ''), done: done || '' };
}
/** הרשמה לסדנה. token = קישור אישי של תלמיד/ה (אם יש). f = { name, phone } למי שנרשם/ת מקישור הסדנה. */
function wsSignup(id, token, f) {
  id = clean_(id); token = clean_(token); f = f || {};
  return withLock_(() => {
    const D = load_(true), w = D.ws.find(x => x.id === id);
    if (!w) throw new Error('הסדנה לא נמצאה');
    if (w.status !== 'open') throw new Error('ההרשמה לסדנה סגורה');
    if (wsStarted_(w)) throw new Error('הסדנה כבר התחילה');
    let name, phone;
    if (token) {
      const st = D.stu.find(s => s.token === token && s.status === 'approved');
      if (!st) throw new Error('אין הרשאה');
      if (D.wss.some(x => x.wsId === id && x.token === token && x.status !== 'no')) throw new Error('כבר נרשמת לסדנה הזו');
      name = st.name; phone = st.phone;
    } else {
      if (w.who === 'students') throw new Error('הסדנה הזו פתוחה רק לתלמידי הסטודיו');
      name = String(f.name || '').trim().slice(0, 40); phone = String(f.phone || '').trim().slice(0, 20);
      if (!name || !phone) throw new Error('צריך שם וטלפון');
      const digits = s => String(s).replace(/\D/g, '');
      if (D.wss.some(x => x.wsId === id && x.status !== 'no' && digits(x.phone) === digits(phone))) throw new Error('המספר הזה כבר רשום לסדנה');
    }
    if (wsFree_(D, w) <= 0) throw new Error('אין יותר מקומות בסדנה');
    const status = w.approve === '1' ? 'pending' : 'ok';
    addRow_(D, 'wss', { wsId: id, sid: randomToken_(12), token, name, phone, status, createdAt: Date.now() });
    saveCache_(D);
    notify_(D, (status === 'pending' ? 'בקשת הרשמה לסדנה: ' : 'נרשמ/ה לסדנה: ') + name,
      name + ' (' + phone + ') ' + (status === 'pending' ? 'מבקש/ת להירשם' : 'נרשמ/ה') + ' לסדנה "' + w.title + '" ב' + wsDayName_(w.date) + ' ' + wsDateTxt_(w) +
      '\nנשארו ' + wsFree_(D, w) + ' מקומות.');
    return token ? studentState_(D, token) : wsPublicState_(D, id, status);
  });
}
/** תלמיד/ה מבטל/ת הרשמה לסדנה (רק לפני שהתחילה). */
function wsCancel(id, token) {
  id = clean_(id); token = clean_(token);
  return withLock_(() => {
    const D = load_(true), w = D.ws.find(x => x.id === id);
    const x = D.wss.find(y => y.wsId === id && y.token === token && y.status !== 'no');
    if (!w || !x || !token) throw new Error('לא נמצאה הרשמה');
    if (wsStarted_(w)) throw new Error('הסדנה כבר התחילה');
    delRow_(D, 'wss', x);
    saveCache_(D);
    notify_(D, 'ביטול הרשמה לסדנה: ' + x.name, x.name + ' ביטל/ה את ההרשמה לסדנה "' + w.title + '" (' + wsDateTxt_(w) + ').');
    return studentState_(D, token);
  });
}

/* ===================== inventory (מלאי) =====================
 * כל פריט: שם, כמות, מינימום, יחידה (ק"ג, שקית, בקבוק…) וקטגוריה (לא חובה).
 * פריט "חסר" כשהכמות הגיעה למינימום או ירדה ממנו (ומינימום > 0).
 * ברגע שפריט יורד למינימום נשלח מייל אחד (alerted=1), ושוב רק אחרי שחזר מעל המינימום.
 */
function num_(x) { const n = parseFloat(String(x == null ? '' : x).replace(',', '.')); return isFinite(n) ? Math.round(n * 1000) / 1000 : 0; }
function stockLow_(r) { const m = num_(r.min); return m > 0 && num_(r.qty) <= m; }
function stockPub_(r) { return { id: r.id, name: r.name, qty: num_(r.qty), min: num_(r.min), unit: r.unit, cat: r.cat, note: r.note, low: stockLow_(r), updatedAt: +r.updatedAt || 0 }; }
function stockTxt_(r) { return r.name + ': יש ' + num_(r.qty) + (r.unit ? ' ' + r.unit : '') + ' (מינימום ' + num_(r.min) + ')'; }
function stockOrderList_(D) { return D.stock.filter(stockLow_).sort((a, b) => a.name.localeCompare(b.name, 'he')).map(r => '• ' + stockTxt_(r)).join('\n'); }
/** אחרי שינוי כמות: מייל כשפריט ירד עכשיו למינימום. */
function stockCheck_(D, recs) {
  const fell = [];
  recs.forEach(r => {
    const low = stockLow_(r);
    if (low && r.alerted !== '1') { setRow_(D, 'stock', r, { alerted: '1' }); fell.push(r); }
    else if (!low && r.alerted === '1') setRow_(D, 'stock', r, { alerted: '' });
  });
  if (fell.length) notify_(D, 'מלאי: צריך להזמין ' + fell.map(r => r.name).join(', '),
    'ירד למינימום:\n' + fell.map(r => '• ' + stockTxt_(r)).join('\n') + '\n\nכל מה שצריך להזמין עכשיו:\n' + stockOrderList_(D), 'למלאי');
}
/* מתכון גלזורה: רשימת חומרים מהמלאי עם אחוז מהמשקל היבש (כמו במתכוני גלזורה – יכול לעבור 100% עם תוספים).
 * "הכנתי X ק"ג" מוריד מכל חומר X × אחוז / 100 ק"ג (או בגרמים, אם יחידת החומר היא גרם). */
function recParts_(rr) { try { const a = JSON.parse(rr.parts || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function isGram_(unit) { return /^(גרם|ג'|ג|גר|gr|g)$/i.test(String(unit || '').trim().replace(/["׳.]/g, '')); }
function recNeed_(r, kg, pct) { return num_(kg * num_(pct) / 100 * (isGram_(r.unit) ? 1000 : 1)); }
function recPub_(rr) { return { id: rr.id, name: rr.name, note: rr.note, parts: recParts_(rr), lastMade: +rr.lastMade || 0, lastKg: num_(rr.lastKg) }; }
function stockFields_(p) {
  const name = String(p.name || '').trim().slice(0, 60);
  if (!name) throw new Error('צריך שם לפריט');
  return { name, qty: Math.max(0, num_(p.qty)), min: Math.max(0, num_(p.min)), unit: String(p.unit || '').trim().slice(0, 20),
    cat: String(p.cat || '').trim().slice(0, 30), note: String(p.note || '').trim().slice(0, 140), updatedAt: Date.now() };
}
function stockAction_(D, act, p) {
  const r = p.id ? D.stock.find(x => x.id === clean_(p.id)) : null;
  if (act === 'stockSave') {
    const f = stockFields_(p);
    if (D.stock.some(x => x !== r && x.name === f.name)) throw new Error('כבר יש פריט בשם הזה');
    stockCheck_(D, [r ? (setRow_(D, 'stock', r, f), r) : addRow_(D, 'stock', Object.assign({ id: randomToken_(10), alerted: '' }, f))]);
  }
  else if (act === 'stockDelta' && r) { setRow_(D, 'stock', r, { qty: Math.max(0, num_(num_(r.qty) + num_(p.delta))), updatedAt: Date.now() }); stockCheck_(D, [r]); }
  else if (act === 'stockSet' && r) { setRow_(D, 'stock', r, { qty: Math.max(0, num_(p.qty)), updatedAt: Date.now() }); stockCheck_(D, [r]); }
  else if (act === 'stockDelete' && r) {
    if (D.rec.some(x => recParts_(x).some(y => y.id === r.id))) throw new Error('החומר נמצא במתכון. קודם להוציא אותו מהמתכון');
    delRow_(D, 'stock', r);
  }
  else if (act === 'stockRecipeSave') {
    const name = String(p.name || '').trim().slice(0, 60), rr = p.id ? D.rec.find(x => x.id === clean_(p.id)) : null;
    if (!name) throw new Error('צריך שם למתכון');
    const seen = {}, parts = (Array.isArray(p.parts) ? p.parts : []).map(x => ({ id: clean_(x.id), pct: num_(x.pct) }))
      .filter(x => x.pct > 0 && D.stock.some(r => r.id === x.id) && !seen[x.id] && (seen[x.id] = 1));
    if (!parts.length) throw new Error('צריך לפחות חומר אחד עם אחוז');
    const f = { name, parts: JSON.stringify(parts), note: String(p.note || '').trim().slice(0, 300) };
    if (rr) setRow_(D, 'rec', rr, f); else addRow_(D, 'rec', Object.assign({ id: randomToken_(10), createdAt: Date.now(), lastMade: '', lastKg: '' }, f));
  }
  else if (act === 'stockRecipeDelete' && p.id) { const rr = D.rec.find(x => x.id === clean_(p.id)); if (rr) delRow_(D, 'rec', rr); }
  else if (act === 'stockBatch' && p.id) {
    const rr = D.rec.find(x => x.id === clean_(p.id)), kg = num_(p.kg);
    if (!rr) throw new Error('המתכון לא נמצא');
    if (!(kg > 0)) throw new Error('צריך כמות להכנה');
    const touched = [];
    recParts_(rr).forEach(x => {
      const r = D.stock.find(y => y.id === x.id); if (!r) return;
      setRow_(D, 'stock', r, { qty: Math.max(0, num_(num_(r.qty) - recNeed_(r, kg, x.pct))), updatedAt: Date.now() });
      touched.push(r);
    });
    setRow_(D, 'rec', rr, { lastMade: Date.now(), lastKg: kg });
    stockCheck_(D, touched);
  }
  else if (act === 'stockMail') {
    const list = stockOrderList_(D);
    if (!list) throw new Error('אין כרגע מה להזמין');
    notify_(D, 'מלאי: רשימת הזמנה', 'צריך להזמין:\n' + list, 'למלאי');
  }
}

/* ===================== teachers (מורים) =====================
 * כל מורה: שם, טלפון (לא חובה) והשיעורים הקבועים שלו (Teachers.slots, רשימת slot ids מופרדת בפסיק).
 * לשיעור יכולים להיות כמה מורים. מחליף חד-פעמי לשיעור מסוים נשמר ב-Subs (lessonKey → teacherId)
 * ובא במקום המורים הקבועים של אותו שיעור בלבד.
 */
const TEACHERS_SEED = [ // נכנס פעם אחת, כשגיליון Teachers נוצר. אחר כך משנים מעמוד הניהול.
  { name: 'תאיר', slots: ['sun-am', 'wed-pm'] },
  { name: 'דורון נעמה גלפר', slots: ['sun-pm', 'tue-pm', 'wed-am'] },
];
function seedTeachers_() {
  if (sh_('Teachers').getLastRow() > 1) return;
  TEACHERS_SEED.forEach(t => append_('Teachers', { id: randomToken_(10), name: t.name, phone: '', slots: t.slots.join(','), createdAt: Date.now() }));
}
function tchSlots_(t) { return String(t.slots || '').split(',').filter(id => slotById_(id)); }
function tchPub_(t) { return { id: t.id, name: t.name, phone: t.phone, slots: tchSlots_(t) }; }
function tchNames_(list) { return list.map(t => t.name).join(' ו'); }
function regularTeachers_(D, slotId) { return D.tch.filter(t => tchSlots_(t).indexOf(slotId) >= 0); }
/** מי מלמד בשיעור הזה: המחליף אם יש, אחרת המורים הקבועים. */
function teachersOf_(D, key) {
  const sub = D.sub.find(x => x.lessonKey === key), t = sub && D.tch.find(x => x.id === sub.teacherId);
  if (t) return [t];
  const L = lesson_(key); return L.s ? regularTeachers_(D, L.s.id) : [];
}
function teacherNames_(D, key) { return tchNames_(teachersOf_(D, key)); }
function teacherAction_(D, act, p) {
  const t = p.id ? D.tch.find(x => x.id === clean_(p.id)) : null;
  if (act === 'tchSave') {
    const name = String(p.name || '').trim().slice(0, 40), phone = String(p.phone || '').trim().slice(0, 20);
    if (!name) throw new Error('צריך שם למורה');
    if (D.tch.some(x => x !== t && x.name === name)) throw new Error('כבר יש מורה בשם הזה');
    if (t) setRow_(D, 'tch', t, { name, phone });
    else addRow_(D, 'tch', { id: randomToken_(10), name, phone, slots: (Array.isArray(p.slots) ? p.slots : []).filter(id => slotById_(id)).join(','), createdAt: Date.now() });
  }
  else if (act === 'tchSlot' && t && slotById_(p.slot)) {
    const cur = tchSlots_(t).filter(id => id !== p.slot);
    if (p.on) cur.push(p.slot);
    setRow_(D, 'tch', t, { slots: SLOTS.map(s => s.id).filter(id => cur.indexOf(id) >= 0).join(',') });
  }
  else if (act === 'tchDelete' && t) {
    D.sub.filter(x => x.teacherId === t.id).sort((a, b) => b._row - a._row).forEach(x => delRow_(D, 'sub', x));
    delRow_(D, 'tch', t);
  }
  else if (act === 'tchSub' && p.key && lesson_(p.key).s) { // מחליף לשיעור אחד. teacherId ריק = חוזרים למורה הקבוע
    const ex = D.sub.find(x => x.lessonKey === p.key), tid = clean_(p.teacherId);
    if (tid && !D.tch.some(x => x.id === tid)) throw new Error('המורה לא נמצא');
    if (ex && tid) setRow_(D, 'sub', ex, { teacherId: tid, createdAt: Date.now() });
    else if (ex) delRow_(D, 'sub', ex);
    else if (tid) addRow_(D, 'sub', { lessonKey: p.key, teacherId: tid, createdAt: Date.now() });
  }
}

/** מעדכן את כתובת האפליקציה לקישורים חדשים */
function setAppUrl() { setSetting_('APP_URL', 'https://talpens.github.io/dng/site/'); console.log('APP_URL: ' + settings_().APP_URL); }

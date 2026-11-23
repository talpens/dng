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
  Settings:  ['key', 'value'],
};

/* ===================== spreadsheet (bound or standalone) ===================== */
function ss_() {
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
    let s = ss.getSheetByName(name);
    if (!s) s = ss.insertSheet(name);
    const h = SHEETS[name];
    s.getRange(1, 1, s.getMaxRows(), h.length).setNumberFormat('@');
    s.getRange(1, 1, 1, h.length).setValues([h]).setFontWeight('bold');
    s.setFrozenRows(1);
    s.setTabColor(name === 'Settings' ? '#e8742b' : '#161616');
  });
  const st = settings_();
  if (!st.ADMIN_KEY) setSetting_('ADMIN_KEY', randomToken_(24));
  if (!st.SEATS) setSetting_('SEATS', '8');
  if (!st.APP_URL) setSetting_('APP_URL', 'https://talpens.github.io/dng/site/');
  if (!st.NOTIFY_EMAIL) setSetting_('NOTIFY_EMAIL', Session.getEffectiveUser().getEmail());
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('גיליון1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
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
    .addToUi(); } catch (e) {}
}
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
  t.boot = JSON.stringify({ token: clean_(e.parameter.t), admin: clean_(e.parameter.admin) });
  return t.evaluate()
    .setTitle('שיעורים – סטודיו DNG')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/* ===================== sheet helpers ===================== */
function sh_(n) { return ss_().getSheetByName(n); }
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
function append_(n, obj) {
  const s = sh_(n), h = SHEETS[n], r = s.getLastRow() + 1;
  s.getRange(r, 1, 1, h.length).setNumberFormat('@').setValues([h.map(k => obj[k] == null ? '' : String(obj[k]))]);
}
function update_(n, row, obj) {
  const s = sh_(n), h = SHEETS[n];
  h.forEach((k, j) => { if (k in obj) s.getRange(row, j + 1).setNumberFormat('@').setValue(String(obj[k])); });
}
function settings_() { const o = {}; rows_('Settings').forEach(r => o[r.key] = r.value); return o; }
function setSetting_(k, v) {
  const r = rows_('Settings').find(x => x.key === k);
  if (r) update_('Settings', r._row, { value: v }); else append_('Settings', { key: k, value: v });
}
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
function ilNow_() {
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
function load_() {
  return {
    stu: rows_('Students'), inv: rows_('Invites'), abs: rows_('Absences'), mk: rows_('Makeups'),
    cancel: rows_('Cancelled').map(r => r.lessonKey), set: settings_(),
  };
}
function seats_(D) { return +(D.set.SEATS || 8); }
function seat_(D, key) {
  const L = lesson_(key);
  const regs = D.stu.filter(s => s.status === 'approved' && s.slot === L.s.id && s.since <= L.date);
  const absent = regs.filter(s => D.abs.some(a => a.token === s.token && a.lessonKey === key));
  const mkOk = D.mk.filter(m => m.lessonKey === key && m.status === 'ok');
  const cancelled = D.cancel.indexOf(key) >= 0;
  return { regs, absent, mkOk, cancelled, free: cancelled ? 0 : Math.max(0, seats_(D) - regs.length + absent.length - mkOk.length) };
}
function credits_(D, token) {
  const st = D.stu.find(s => s.token === token); if (!st || st.status !== 'approved') return 0;
  let c = +st.bonus || 0;
  c += D.abs.filter(a => a.token === token).length;
  D.cancel.forEach(k => {
    const L = lesson_(k);
    if (L.s && L.s.id === st.slot && st.since <= L.date && !D.abs.some(a => a.token === token && a.lessonKey === k)) c += 1;
  });
  c -= D.mk.filter(m => m.token === token && m.status === 'ok').length;
  return c;
}
function pendingMkCount_(D, token) { return D.mk.filter(m => m.token === token && m.status === 'pending' && !ended_(m.lessonKey)).length; }
function notify_(D, subject, body) {
  try {
    const to = D.set.NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
    const url = ScriptApp.getService().getUrl();
    MailApp.sendEmail(to, subject, body + (url ? '\n\nלאישור: ' + url + '?admin=' + D.set.ADMIN_KEY : ''));
  } catch (e) { console.log('mail failed: ' + e); }
}

/* ===================== student API ===================== */
function studentState(token) {
  token = clean_(token); const D = load_();
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
        mk: m ? m.status : '', started: started_(key), ended: ended_(key), absLate: absLate_(key), absBy: absDeadline_(key).txt };
    }) };
  });
  return Object.assign(base, { state: 'ok', me: { name: st.name, slot: st.slot }, credits: credits_(D, token), pendingMk: pendingMkCount_(D, token), weeks });
}
function register(token, f) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_();
    const inv = D.inv.find(i => i.token === token);
    if (!inv) throw new Error('קישור לא תקין');
    if (slotById_(inv.slot)) f.slot = inv.slot;
    const name = String(f.name || '').trim().slice(0, 40), phone = String(f.phone || '').trim().slice(0, 20);
    const slot = slotById_(f.slot) ? f.slot : '', note = String(f.note || '').trim().slice(0, 140);
    if (!name || !slot) throw new Error('צריך שם ושיעור');
    const st = D.stu.find(s => s.token === token);
    if (st && (st.status === 'approved' || st.status === 'removed')) throw new Error('כבר רשום/ה');
    const obj = { token, name, phone, slot, status: 'pending', requestedAt: Date.now(), note };
    if (st) update_('Students', st._row, obj); else append_('Students', Object.assign({ since: '', bonus: '0' }, obj));
    notify_(D, 'בקשת הרשמה: ' + name, name + ' (' + phone + ') מבקש/ת מקום קבוע ב' + slotName_(slot) + (note ? '\nהערה: ' + note : ''));
    return studentState(token);
  });
}
function setAbsence(token, key, on) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(), st = D.stu.find(s => s.token === token && s.status === 'approved');
    if (!st) throw new Error('אין הרשאה');
    const L = lesson_(key);
    if (!L.s || L.s.id !== st.slot || st.since > L.date) throw new Error('זה לא השיעור הקבוע שלך');
    if (absLate_(key)) throw new Error('עבר מועד הביטול (' + absDeadline_(key).txt + '). לביטול מאוחר פנו לסטודיו');
    const ex = D.abs.find(a => a.token === token && a.lessonKey === key);
    if (on && !ex) append_('Absences', { token, lessonKey: key, createdAt: Date.now() });
    if (!on && ex) sh_('Absences').deleteRow(ex._row);
    return studentState(token);
  });
}
function requestMakeup(token, key) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(), st = D.stu.find(s => s.token === token && s.status === 'approved');
    if (!st) throw new Error('אין הרשאה');
    const L = lesson_(key); if (!L.s) throw new Error('שיעור לא קיים');
    if (started_(key)) throw new Error('השיעור כבר התחיל');
    if (L.s.id === st.slot && st.since <= L.date) throw new Error('זה השיעור הקבוע שלך');
    if (D.mk.some(m => m.token === token && m.lessonKey === key)) throw new Error('כבר ביקשת את השיעור הזה');
    if (seat_(D, key).free <= 0) throw new Error('אין מקום פנוי בשיעור');
    if (credits_(D, token) - pendingMkCount_(D, token) <= 0) throw new Error('אין יתרת השלמות');
    append_('Makeups', { token, lessonKey: key, status: 'pending', createdAt: Date.now(), decidedAt: '' });
    notify_(D, 'בקשת השלמה: ' + st.name, st.name + ' מבקש/ת השלמה ב' + slotName_(L.s.id) + ' ' + fmtD_(L.date));
    return studentState(token);
  });
}
function cancelMakeup(token, key) {
  token = clean_(token);
  return withLock_(() => {
    const D = load_(), m = D.mk.find(x => x.token === token && x.lessonKey === key && x.status === 'pending');
    if (m) sh_('Makeups').deleteRow(m._row);
    return studentState(token);
  });
}

/* ===================== admin API ===================== */
function isAdmin_(D, key) { return !!key && clean_(key) === D.set.ADMIN_KEY; }
function adminState(adminKey, weekOff) {
  const D = load_(); if (!isAdmin_(D, adminKey)) return { state: 'denied' };
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
    return { key, slot: s.id, date: lesson_(key).date, free: S.free, cancelled: S.cancelled, ended: ended_(key),
      regs: S.regs.map(r => ({ token: r.token, name: r.name, absent: S.absent.some(a => a.token === r.token) })),
      mk: S.mkOk.map(m => ({ token: m.token, name: nm(m.token) })) };
  });
  const students = D.stu.filter(s => s.status === 'approved').map(s => ({ token: s.token, name: s.name, phone: s.phone, slot: s.slot, bonus: +s.bonus || 0, credits: credits_(D, s.token) }))
    .sort((a, b) => a.name.localeCompare(b.name, 'he'));
  const invites = D.inv.slice(-30).reverse().map(i => ({ token: i.token, label: i.label, slot: i.slot, used: !!byTok[i.token], link: (D.set.APP_URL || url) ? (D.set.APP_URL || url) + '?t=' + i.token : '' }));
  return { state: 'ok', slots: SLOTS, seats: seats_(D), wk, pendingJoin, pendingMk, week, students, invites, hasUrl: !!url };
}
function adminAction(adminKey, act, p) {
  p = p || {};
  return withLock_(() => {
    const D = load_(); if (!isAdmin_(D, adminKey)) throw new Error('אין הרשאה');
    const st = p.token ? D.stu.find(s => s.token === clean_(p.token)) : null;
    if (act === 'approve' && st) update_('Students', st._row, { status: 'approved', since: weekStart_(0), bonus: st.bonus || '0' });
    else if (act === 'reject' && st) update_('Students', st._row, { status: 'rejected' });
    else if ((act === 'mkok' || act === 'mkno') && p.key) {
      const m = D.mk.find(x => x.token === clean_(p.token) && x.lessonKey === p.key);
      if (m) update_('Makeups', m._row, { status: act === 'mkok' ? 'ok' : 'no', decidedAt: Date.now() });
    }
    else if (act === 'absence' && st && p.key) {
      const ex = D.abs.find(a => a.token === st.token && a.lessonKey === p.key);
      if (p.on && !ex) append_('Absences', { token: st.token, lessonKey: p.key, createdAt: Date.now() });
      if (!p.on && ex) sh_('Absences').deleteRow(ex._row);
    }
    else if (act === 'cancel' && p.key) {
      const r = rows_('Cancelled').find(x => x.lessonKey === p.key);
      if (r) sh_('Cancelled').deleteRow(r._row); else append_('Cancelled', { lessonKey: p.key, createdAt: Date.now() });
    }
    else if (act === 'slot' && st && slotById_(p.slot)) update_('Students', st._row, { slot: p.slot, since: weekStart_(0) });
    else if (act === 'bonus' && st) update_('Students', st._row, { bonus: (+st.bonus || 0) + (+p.delta || 0) });
    else if (act === 'remove' && st) update_('Students', st._row, { status: 'removed' });
    else if (act === 'invite') append_('Invites', { token: randomToken_(16), label: String(p.label || '').slice(0, 40), createdAt: Date.now(), slot: slotById_(p.slot) ? p.slot : '' });
    else if (act === 'revoke' && p.token) { const r = D.inv.find(i => i.token === clean_(p.token)); if (r) sh_('Invites').deleteRow(r._row); }
    return adminState(adminKey, p.week || 0);
  });
}

/** מעדכן את כתובת האפליקציה לקישורים חדשים */
function setAppUrl() { setSetting_('APP_URL', 'https://talpens.github.io/dng/site/'); console.log('APP_URL: ' + settings_().APP_URL); }

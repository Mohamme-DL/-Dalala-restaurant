/* منظومة دلالة للمطاعم — التشغيل على عدة أجهزة بقاعدة بيانات واحدة.
   In "host" (main computer) or "client" mode the data lives on the main computer's server.
   This device keeps a working copy: every save sends only the records that changed (stock as a
   difference, settings as changed keys), other devices' changes arrive by long-polling, and an
   offline queue resends whatever could not be delivered. In "local" mode nothing here runs. */
'use strict';

const NETCFG = (window.dalalaNet && window.dalalaNet.config) || { mode: 'local' };
const NETSTATE = { on: NETCFG.mode === 'host' || NETCFG.mode === 'client', online: false, pending: 0, version: 0, error: '' };
const INC_FIELDS = { products: ['stock'] }; // counters sent as +/- so simultaneous sales add up

(function () {
  if (!NETSTATE.on) return;
  const LKEY = 'dalala_pos_v1', QKEY = 'dalala_net_queue', VKEY = 'dalala_net_version';
  const clientId = (() => { try { let id = localStorage.getItem('dalala_net_client'); if (!id) { id = uid(); localStorage.setItem('dalala_net_client', id); } return id; } catch (e) { return uid(); } })();
  const H = { 'x-dalala-key': NETCFG.key || '', 'x-dalala-client': clientId, 'content-type': 'application/json' };
  let base = {}, queue = [], sending = false, renderPending = false, polling = false, booted = false;
  try { queue = JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { queue = []; }
  NETSTATE.pending = queue.length;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const saveQueue = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch (e) { /* ignore */ } NETSTATE.pending = queue.length; };
  const setVersion = v => { NETSTATE.version = v; try { localStorage.setItem(VKEY, String(v)); } catch (e) { /* ignore */ } };
  const cacheLocal = () => { try { localStorage.setItem(LKEY, JSON.stringify(Store.data)); } catch (e) { /* cache only */ } };

  async function req(path, { method = 'GET', body, timeout = 8000 } = {}) {
    const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch(NETCFG.url + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal, cache: 'no-store' });
      if (res.status === 401) throw new Error('مفتاح الربط غير صحيح');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(tm); }
  }

  /* every record needs an id to be synced (old log lines had none) */
  let FILL = null;
  function normalize(d) {
    const fill = FILL = FILL || defaultData();
    for (const k in fill) if (d[k] === undefined) d[k] = clone(fill[k]);
    for (const k in fill.settings) if (d.settings[k] === undefined) d.settings[k] = fill.settings[k];
    (d.log || []).forEach((l, i) => { if (l && !l.id) l.id = 'l' + (l.t || 0).toString(36) + i.toString(36); });
    return d;
  }
  const _logAct = logAct;
  logAct = function (action, detail) { _logAct(action, detail); if (DB.log[0] && !DB.log[0].id) DB.log[0].id = uid(); };

  /* ---- record-level diff against what the server already has ---- */
  function snapshotOf(d) {
    const b = {};
    for (const [k, v] of Object.entries(d || {})) {
      if (k === 'version') continue;
      if (Array.isArray(v)) b[k] = new Map(v.filter(r => r && r.id).map(r => [r.id, JSON.stringify(r)]));
      else if (v && typeof v === 'object') b[k] = Object.fromEntries(Object.entries(v).map(([kk, vv]) => [kk, JSON.stringify(vv)]));
    }
    return b;
  }
  function diff() {
    const ops = [];
    for (const [k, v] of Object.entries(Store.data)) {
      if (k === 'version') continue;
      if (Array.isArray(v)) {
        const old = base[k] instanceof Map ? base[k] : new Map(); const put = [], seen = new Set(), inc = {};
        for (const r of v) {
          if (!r || !r.id) continue; seen.add(r.id); const s = JSON.stringify(r); const o = old.get(r.id);
          if (o === s) continue;
          put.push(JSON.parse(s));
          if (o && INC_FIELDS[k]) { const before = JSON.parse(o); for (const f of INC_FIELDS[k]) if (typeof r[f] === 'number' && typeof before[f] === 'number' && r[f] !== before[f]) (inc[r.id] = inc[r.id] || {})[f] = r[f] - before[f]; }
        }
        const del = [...old.keys()].filter(id => !seen.has(id));
        if (put.length || del.length) ops.push(Object.keys(inc).length ? { col: k, put, del, inc } : { col: k, put, del });
      } else if (v && typeof v === 'object') {
        const old = base[k] && !(base[k] instanceof Map) ? base[k] : {}; const patch = {};
        for (const [kk, vv] of Object.entries(v)) { const s = JSON.stringify(vv); if (old[kk] !== s && s !== undefined) patch[kk] = JSON.parse(s); }
        if (Object.keys(patch).length) ops.push({ obj: k, patch });
      }
    }
    base = snapshotOf(Store.data); return ops;
  }
  const pendingIds = () => { const s = new Set(); queue.forEach(op => (op.put || []).forEach(r => s.add(op.col + '|' + r.id))); return s; };
  function queueLocal() { // capture local edits not yet sent before remote changes move the baseline
    if (!booted) return; clearTimeout(Store._t);
    const ops = diff(); if (ops.length) { cacheLocal(); queue.push(...ops); saveQueue(); flush(); }
  }
  function applyEntries(entries) {
    queueLocal();
    const mine = pendingIds(); let n = 0; const d = Store.data;
    for (const e of entries) for (const op of e.ops) {
      if (op.obj) {
        if (op.value && typeof op.value === 'object') { d[op.obj] = op.value; n++; }
        else if (op.patch || op.unset) { const o = d[op.obj] = { ...(d[op.obj] || {}), ...(op.patch || {}) }; (op.unset || []).forEach(k => delete o[k]); n++; }
        continue;
      }
      const arr = Array.isArray(d[op.col]) ? d[op.col] : (d[op.col] = []);
      if (op.del && op.del.length) { const ds = new Set(op.del); d[op.col] = arr.filter(r => !ds.has(r.id)); }
      const tgt = d[op.col]; const idx = new Map(tgt.map((r, i) => [r.id, i]));
      for (const r of op.put || []) {
        if (mine.has(op.col + '|' + r.id) && e.clientId !== clientId) continue; // my newer change is on its way
        if (idx.has(r.id)) tgt[idx.get(r.id)] = r; else { idx.set(r.id, tgt.length); tgt.push(r); }
      }
      if (op.col === 'tickets') tgt.sort((a, b) => (b.at || 0) - (a.at || 0));
      if (op.col === 'log') tgt.sort((a, b) => (b.t || 0) - (a.t || 0));
      n++;
    }
    if (!n) return;
    normalize(d); DB = Store.data; base = snapshotOf(d); cacheLocal();
    if (App.user) App.user = DB.users.find(u => u.id === App.user.id) || App.user;
    if (entries.some(e => e.clientId !== clientId && e.ops.some(o => o.col === 'tickets'))) renderPending = 'kitchen'; else renderPending = renderPending || true;
  }

  /* ---- Store: keep saving locally (offline copy) + send the changes ---- */
  Store.saveNow = function () {
    clearTimeout(this._t);
    if (!booted || !this.data) return;
    cacheLocal();
    const ops = diff(); if (ops.length) { queue.push(...ops); saveQueue(); flush(); updateBadge(); }
  };
  Store.load = function () { return this.data; };

  async function flush() {
    if (sending || !queue.length) return; sending = true;
    const batch = queue.slice(0, 300);
    try {
      await req('/api/apply', { method: 'POST', body: { ops: batch }, timeout: 30000 });
      queue.splice(0, batch.length); saveQueue(); NETSTATE.online = true; NETSTATE.error = '';
      sending = false; updateBadge(); if (queue.length) flush();
    } catch (e) { NETSTATE.online = false; NETSTATE.error = e.message; sending = false; updateBadge(); setTimeout(flush, 3000); }
  }
  async function reloadSnapshot() {
    const s = await req('/api/snapshot', { timeout: 30000 });
    if (s.data && s.data.settings) Store.data = normalize(s.data);
    DB = Store.data; base = snapshotOf(Store.data); setVersion(s.version); cacheLocal();
    if (App.user) App.user = DB.users.find(u => u.id === App.user.id) || null;
    return s;
  }
  async function poll() {
    if (polling) return; polling = true;
    for (;;) {
      try {
        const r = await req(`/api/changes?since=${NETSTATE.version}&wait=1&name=${encodeURIComponent(NETCFG.name || '')}`, { timeout: 35000 });
        NETSTATE.online = true; NETSTATE.error = '';
        if (r.reset) { queueLocal(); await reloadSnapshot(); renderPending = true; }
        else { if (r.entries && r.entries.length) applyEntries(r.entries); setVersion(r.version); }
        if (queue.length) flush();
        updateBadge();
      } catch (e) { NETSTATE.online = false; NETSTATE.error = e.message; updateBadge(); await sleep(3000); }
    }
  }

  /* refresh the screen after other devices' changes, but never under someone's fingers */
  function busy() { const a = document.activeElement; return Modal.isOpen || !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.id !== 'posSearch'); }
  setInterval(() => {
    if (!renderPending || busy()) return;
    const kitchen = renderPending === 'kitchen'; renderPending = false;
    if (!App.user) { if (!App.pin) App.renderLogin(); return; }
    if (App.view === 'settings') { App.brand(); App.updateShiftBadge(); return; } // forms: don't redraw under the admin
    const y = ($('[data-view="' + App.view + '"]') || {}).scrollTop;
    App.brand(); App.refresh(); App.updateShiftBadge();
    const v = $('[data-view="' + App.view + '"]'); if (v && y) v.scrollTop = y;
    if (kitchen && App.view === 'kitchen') beep(990, .15);
  }, 700);

  function updateBadge() { const b = $('#netBadge'); if (b) b.outerHTML = netBadge(); }

  /* boot: fetch the shared database (or fall back to this device's last copy when offline) */
  const origInit = App.init.bind(App);
  App.init = async function () {
    const boot = document.createElement('div'); boot.id = 'netBoot';
    boot.className = 'fixed inset-0 z-[60] bg-slate-950 flex flex-col items-center justify-center gap-3 text-center p-6';
    boot.innerHTML = `<i class="fa-solid fa-network-wired text-4xl text-sky-400 pulse-dot"></i><b class="text-white">جارٍ الاتصال بالجهاز الرئيسي…</b><small class="text-slate-400" dir="ltr">${esc(NETCFG.url)}</small>`;
    document.body.appendChild(boot);
    let local = null; try { const raw = localStorage.getItem(LKEY); if (raw) local = JSON.parse(raw); } catch (e) { local = null; }
    try {
      const s = await req('/api/snapshot', { timeout: 7000 });
      NETSTATE.online = true;
      if (s.data && s.data.settings) await reloadSnapshot();
      else if (NETCFG.mode === 'host') { // first start as main computer: share this computer's data
        Store.data = normalize(local && local.settings ? local : defaultData());
        const r = await req('/api/init', { method: 'POST', body: { data: Store.data }, timeout: 60000 }); setVersion(r.version);
        base = snapshotOf(Store.data); cacheLocal();
      } else throw new Error('الجهاز الرئيسي لا يحتوي بيانات بعد — شغّل البرنامج عليه أولاً');
    } catch (e) {
      NETSTATE.online = false; NETSTATE.error = e.message;
      if (local && local.settings) { Store.data = normalize(local); base = snapshotOf(Store.data); try { NETSTATE.version = +localStorage.getItem(VKEY) || 0; } catch (e2) { NETSTATE.version = 0; } }
      else {
        boot.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-4xl text-rose-400"></i><b class="text-rose-300">تعذّر الاتصال بالجهاز الرئيسي</b><small class="text-slate-400" dir="ltr">${esc(NETCFG.url)} — ${esc(e.message)}</small>
          <p class="text-slate-400 text-sm max-w-md">تأكد أن الجهاز الرئيسي مشغّل والبرنامج مفتوح عليه، وأن الجهازين على نفس الشبكة.</p>
          <div class="flex gap-2"><button class="btn-primary" onclick="location.reload()">إعادة المحاولة</button><button class="btn-ghost" onclick="Net.goLocal()">العمل كجهاز مستقل</button></div>`;
        poll(); return;
      }
    }
    DB = Store.data; booted = true; boot.remove();
    origInit();
    if (queue.length) flush();
    poll(); updateBadge();
  };
})();

function netBadge() {
  if (!NETSTATE.on) return '<span id="netBadge" class="hidden"></span>';
  const role = NETCFG.mode === 'host' ? 'رئيسي' : 'فرعي';
  return `<span id="netBadge" title="${esc(NETSTATE.error || NETCFG.url)}" class="${NETSTATE.online ? 'text-emerald-400' : 'text-rose-400'}"><i class="fa-solid fa-network-wired"></i> ${role} · ${NETSTATE.online ? 'متصل' : 'غير متصل'}${NETSTATE.pending ? ` (${NETSTATE.pending} بانتظار الإرسال)` : ''}</span>`;
}

/* settings: choose standalone / main / branch device */
const Net = {
  card() {
    if (!window.dalalaNet || !App.isAdmin()) return '';
    const c = NETCFG, m = c.mode || 'local';
    const opt = (k, icon, title, desc) => `<label class="net-mode press cursor-pointer card p-3 flex flex-col gap-1 border-2 ${m === k ? 'border-sky-500 bg-sky-500/10' : 'border-slate-700'}">
      <input type="radio" name="netMode" value="${k}" ${m === k ? 'checked' : ''} class="hidden" onchange="Net.modeFields()"><span class="font-bold text-sm"><i class="fa-solid ${icon} text-sky-400"></i> ${title}</span><span class="text-[11px] text-slate-400 leading-relaxed">${desc}</span></label>`;
    return `<div class="card p-5 mb-4" id="netCard"><h3 class="font-bold mb-2 flex justify-between items-center flex-wrap gap-2"><span><i class="fa-solid fa-network-wired text-sky-400"></i> التشغيل على عدة أجهزة (شبكة)</span><span class="text-xs">${netBadge()}</span></h3>
      <p class="text-xs text-slate-400 mb-3 leading-relaxed">شغّل عدة أجهزة (كاشير، تابلت للنادل، شاشة المطبخ) على قاعدة بيانات واحدة عبر الشبكة المحلية. الطلبات المفتوحة والطاولات وتذاكر المطبخ والفواتير والمخزون تظهر على كل الأجهزة فوراً.</p>
      <div class="grid sm:grid-cols-3 gap-2 mb-3">
        ${opt('local', 'fa-desktop', 'جهاز مستقل', 'البيانات على هذا الجهاز فقط')}
        ${opt('host', 'fa-server', 'جهاز رئيسي (خادم)', 'يحفظ قاعدة البيانات وتتصل به بقية الأجهزة — يجب أن يبقى مشغّلاً')}
        ${opt('client', 'fa-tablet-screen-button', 'جهاز فرعي', 'يعمل على بيانات الجهاز الرئيسي')}</div>
      <div class="grid sm:grid-cols-3 gap-3 mb-3">
        <div class="net-c"><label class="lbl">عنوان الجهاز الرئيسي (IP)</label><input class="inp num" dir="ltr" id="netHost" value="${esc(c.host || '')}" placeholder="192.168.1.10"></div>
        <div class="net-c"><label class="lbl">مفتاح الربط</label><input class="inp num" dir="ltr" id="netKey" value="${esc(m === 'client' ? c.key || '' : '')}" placeholder="XXXX-XXXX"></div>
        <div><label class="lbl">المنفذ</label><input class="inp num" type="number" dir="ltr" id="netPort" value="${esc(c.port || 47630)}"></div></div>
      <div id="netInfo"></div>
      <div class="flex flex-wrap gap-2 mt-3"><button class="btn-ghost text-xs net-c" onclick="Net.test()"><i class="fa-solid fa-plug"></i> اختبار الاتصال</button>
        <button class="btn-primary text-xs" onclick="Net.save()"><i class="fa-solid fa-check"></i> حفظ وإعادة التشغيل</button></div>
      <p class="text-[11px] text-slate-500 mt-3 leading-relaxed">عند تحويل جهاز إلى «فرعي» يعمل على بيانات الجهاز الرئيسي بدلاً من بياناته المحلية — خذ نسخة احتياطية أولاً. كل جهاز يحتاج مفتاح تفعيل خاص به.</p></div>`;
  },
  mode() { return ($('input[name=netMode]:checked') || {}).value || 'local'; },
  modeFields() {
    const m = this.mode();
    $$('.net-c').forEach(el => el.classList.toggle('hidden', m !== 'client'));
    const nb = $('#netInfo');   // تلميح قبل الحفظ: بيانات الربط تظهر بعد إعادة التشغيل كجهاز رئيسي
    if (nb && NETCFG.mode !== 'host') nb.innerHTML = m === 'host' ? '<div class="bg-amber-500/10 border border-amber-500/30 text-amber-200 rounded-xl p-3 text-xs leading-relaxed"><b>خطوة واحدة متبقية:</b> اضغط «حفظ وإعادة التشغيل». بعد أن يفتح البرنامج من جديد يظهر هنا <b>عنوان هذا الجهاز ومفتاح الربط</b> لتكتبهما في الأجهزة الفرعية.</div>' : '';
    $$('.net-mode').forEach(l => { const on = l.querySelector('input').checked; l.classList.toggle('border-sky-500', on); l.classList.toggle('bg-sky-500/10', on); l.classList.toggle('border-slate-700', !on); });
  },
  async fill() {
    const box = $('#netInfo'); if (!box || !window.dalalaNet) return;
    this.modeFields();
    if (NETCFG.mode !== 'host') { box.innerHTML = ''; return; }
    const i = await window.dalalaNet.info(); const clients = (i.server && i.server.clients) || [];
    box.innerHTML = `<div class="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-800/50 rounded-xl p-3 text-xs">
        <div><div class="text-slate-400">عنوان هذا الجهاز</div><b class="num text-sm" dir="ltr">${esc((i.ips || []).join(' / ') || '—')}</b></div>
        <div><div class="text-slate-400">المنفذ</div><b class="num text-sm">${esc(i.port)}</b></div>
        <div><div class="text-slate-400">مفتاح الربط</div><b class="num text-lg tracking-widest text-amber-300" dir="ltr">${esc(i.key || '—')}</b></div>
        <div><div class="text-slate-400">الأجهزة المتصلة</div><b class="text-sm">${clients.filter(x => x.online).length} متصل الآن</b></div></div>
      ${clients.length ? `<div class="mt-2 space-y-1">${clients.map(x => `<div class="flex justify-between items-center bg-slate-800/40 rounded-lg px-3 py-1.5 text-xs"><span><i class="fa-solid fa-computer text-slate-400"></i> <b>${esc(x.name || x.id.slice(0, 6))}</b> <span class="text-slate-500 num" dir="ltr">${esc(String(x.ip || '').replace('::ffff:', ''))} · ${fmtTime(x.lastSeen)}</span></span><span class="${x.online ? 'text-emerald-400' : 'text-slate-500'}">${x.online ? 'متصل' : 'غير متصل'}</span></div>`).join('')}</div>` : ''}
      ${i.serverError ? `<p class="text-rose-400 text-xs mt-2">${esc(i.serverError)}</p>` : ''}
      <p class="text-[11px] text-slate-400 mt-2 leading-relaxed">في كل جهاز فرعي: الإعدادات ← التشغيل على عدة أجهزة ← جهاز فرعي، ثم أدخل عنوان هذا الجهاز ومفتاح الربط. إن لم يتصل فاسمح للبرنامج في جدار حماية ويندوز (الشبكات الخاصة).</p>`;
  },
  async test() {
    const host = $('#netHost').value.trim(), port = +$('#netPort').value || 47630, key = $('#netKey').value.trim();
    if (!host) return toast('أدخل عنوان الجهاز الرئيسي', 'warning');
    const r = await window.dalalaNet.test({ host, port, key });
    if (r.ok && r.keyOk) toast('تم الاتصال بالجهاز الرئيسي بنجاح', 'success');
    else toast(r.ok ? 'مفتاح الربط غير صحيح' : 'تعذّر الاتصال — ' + (r.error || ''), 'error');
  },
  async save() {
    const mode = this.mode(); const cfg = { mode, port: +$('#netPort').value || 47630 };
    if (mode === 'client') { cfg.host = $('#netHost').value.trim(); cfg.key = $('#netKey').value.trim(); if (!cfg.host || !cfg.key) return toast('أدخل عنوان الجهاز الرئيسي ومفتاح الربط', 'error'); }
    if (!(await confirmBox('سيُعاد تشغيل البرنامج لتطبيق إعدادات الشبكة. متابعة؟', { ok: 'متابعة' }))) return;
    Store.saveNow(); window.dalalaNet.set(cfg);
  },
  goLocal() { if (confirm('سيُعاد تشغيل البرنامج كجهاز مستقل. متابعة؟')) window.dalalaNet.set({ mode: 'local', port: +NETCFG.port || 47630 }); }
};

/* show the network card at the top of the settings page and the status in the header */
(function () {
  const origSettings = VIEWS.settings;
  VIEWS.settings = el => {
    origSettings(el);
    const html = Net.card(); if (!html) return;
    const first = el.querySelector('.card');
    if (first) first.insertAdjacentHTML('afterend', html); else el.insertAdjacentHTML('beforeend', html);
    setTimeout(() => Net.fill(), 0);
  };
  const add = () => { const h = $('#hdrShift'); if (h && !$('#netBadge')) h.insertAdjacentHTML('afterend', netBadge()); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();

/* Dalala Restaurant — rules the main computer applies to changes from every device:
   - invoice numbers (orders.no) never repeat; settings.nextInvoice always moves past the highest
   - the daily order number (dailyNo, shown to customers and the kitchen) never repeats on the same day,
     across open orders and paid invoices; kitchen tickets of a renumbered order follow the new number
   - two devices updating the counters at the same time keep the highest value */
'use strict';
const pad = n => String(n).padStart(2, '0');
const dayKey = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const whenOf = r => r.openedAt || r.createdAt || r.date || Date.now();

function settings(ctx) { return ctx.data.settings && typeof ctx.data.settings === 'object' ? ctx.data.settings : null; }

function put(col, rec, ctx) {
  const mem = ctx.mem.renum = ctx.mem.renum || {};
  if ((col === 'open' || col === 'orders') && rec.dailyNo) {
    // the same order already renumbered earlier keeps its new number
    const known = mem[rec.id];
    if (known && rec.dailyNo === known.from) rec.dailyNo = known.to;
    const day = dayKey(whenOf(rec));
    const sameDay = r => r && r.id !== rec.id && r.dailyNo && dayKey(whenOf(r)) === day;
    const all = [...(ctx.data.open || []), ...(ctx.data.orders || [])].filter(sameDay);
    if (all.some(r => r.dailyNo === rec.dailyNo)) {
      const from = rec.dailyNo; rec.dailyNo = Math.max(0, ...all.map(r => +r.dailyNo || 0)) + 1;
      mem[rec.id] = { from, to: rec.dailyNo };
    }
    const s = settings(ctx);
    if (s && day === dayKey(Date.now())) {
      const dn = s.dailyNo && s.dailyNo.day === day ? s.dailyNo : { day, n: 0 };
      if (dn.n < rec.dailyNo) { s.dailyNo = { day, n: rec.dailyNo }; ctx.touch('settings'); }
    }
  }
  if (col === 'orders' && rec.no != null && Number.isFinite(+rec.no)) {
    const orders = ctx.data.orders || [];
    if (orders.some(r => r.id !== rec.id && +r.no === +rec.no)) rec.no = Math.max(0, ...orders.filter(r => r.id !== rec.id).map(r => +r.no || 0)) + 1;
    const s = settings(ctx);
    if (s && !(+s.nextInvoice > +rec.no)) { s.nextInvoice = +rec.no + 1; ctx.touch('settings'); }
  }
  if (col === 'tickets' && rec.orderId && mem[rec.orderId]) {
    const { from, to } = mem[rec.orderId];
    if (rec.dailyNo === from) { rec.dailyNo = to; if (typeof rec.label === 'string') rec.label = rec.label.replace(' رقم ' + from, ' رقم ' + to); }
  }
}

function obj(name, val, cur) {
  if (name !== 'settings' || !val || !cur) return val;
  const out = { ...val };
  if (+cur.nextInvoice > +out.nextInvoice) out.nextInvoice = cur.nextInvoice;
  const a = cur.dailyNo || {}, b = out.dailyNo || {};
  if (a.day && (!b.day || a.day > b.day || (a.day === b.day && +a.n > +b.n))) out.dailyNo = { ...a };
  return out;
}

module.exports = { put, obj };

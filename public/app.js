/* Tableau de bord Vinted multi-comptes.
 * Toutes les données vivent dans un seul objet (ST) :
 *   accounts : comptes Vinted (nom, identifiant Vinted, statut, porte-monnaie, dernière synchro)
 *   sales    : ventes (compte, date, article, prix, coût d'achat, frais, statut)
 *   listings : annonces (compte, date de publication, prix, vues, favoris, statut)
 *   views    : vues gagnées par jour et par compte (calculées à chaque synchro)
 *   log      : journal des actions
 * Avec le serveur (npm start) tout est enregistré dans data/db.json ; sinon dans le navigateur.
 */
(() => {
'use strict';

/* =====================================================================
   Outils
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const DAY_MS = 864e5;
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => { const r = new Date(d.getTime()); r.setDate(r.getDate() + n); return r; };
const sum = a => a.reduce((x, y) => x + y, 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const range = (a, b) => { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const fromYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

const NF0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const NF1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF2 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const NB = ' ';
const eur = v => NF0.format(v) + NB + '€';
const eur2 = v => NF2.format(v) + NB + '€';
const int = v => NF0.format(v);
const pctTxt = p => (Math.abs(p) >= 100 ? String(Math.round(Math.abs(p))) : NF1.format(Math.abs(p))) + NB + '%';
const ddmm = d => String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0');
const DOW = new Intl.DateTimeFormat('fr-FR', { weekday: 'short' });
const MONTH = new Intl.DateTimeFormat('fr-FR', { month: 'long' });
const DT = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const DD = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const longDay = d => DOW.format(d) + ' ' + ddmm(d);
const hh = h => String(h).padStart(2, '0') + 'h';
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const vuesAxis = v => v >= 10000 ? NF1.format(v / 1000) + NB + 'k' : NF0.format(v);
const plural = (n, one, many) => int(n) + NB + (n > 1 ? many : one);
const parseNum = v => {
  if (v == null) return null;
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'object') return parseNum(v.amount != null ? v.amount : v.value);
  const s =String(v).replace(/[\s  €]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = parseFloat(s);
  return isFinite(n) ? n : null;
};
const cents = v => Math.round(v * 100) / 100;
const toLocalInput = t => { const d = new Date(t); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
function rel(t) {
  const m = Math.floor((Date.now() - t) / 60000);
  if (m < 1) return "à l'instant";
  if (m < 60) return `il y a ${m}${NB}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `il y a ${h}${NB}h`;
  const d = Math.floor(h / 24);
  return d === 1 ? 'hier' : `il y a ${d}${NB}jours`;
}

/* =====================================================================
   Référentiels
   ===================================================================== */
const ACC_STATUS = {
  ok: { label: 'Actif' },
  live: { label: 'En cours (agent actif)' },
  alert: { label: 'Action requise' },
  pause: { label: 'En pause' },
};
const SALE_STATUS = {
  ship: { label: 'À envoyer', c: 'var(--amber)' },
  sent: { label: 'Envoyée', c: 'var(--blue)' },
  wait: { label: 'En attente de validation', c: 'var(--lavender)' },
  done: { label: 'Validée', c: 'var(--green)' },
  cancelled: { label: 'Annulée', c: 'var(--red)' },
};
const LIST_STATUS = {
  sourcing: { label: 'À sourcer', c: 'var(--lavender)' },
  draft: { label: 'Prête à publier', c: 'var(--purple)' },
  online: { label: 'En ligne', c: 'var(--blue)' },
  reserved: { label: 'Réservée', c: 'var(--amber)' },
  sold: { label: 'Vendue', c: 'var(--green)' },
  removed: { label: 'Retirée', c: 'var(--slate-2)' },
};
const CAT = {
  pantalon: { label: 'Pantalons', icon: 'pants', re: /pantalon|jean|cargo|baggy|palazzo|jogging|short/ },
  legging: { label: 'Leggings & collants', icon: 'legging', re: /legging|collant/ },
  robe: { label: 'Robes', icon: 'dress', re: /\brobe/ },
  jupe: { label: 'Jupes', icon: 'skirt', re: /\bjupe/ },
  combi: { label: 'Combinaisons', icon: 'pants', re: /combinaison|salopette/ },
  veste: { label: 'Vestes & manteaux', icon: 'top', re: /veste|manteau|blouson|doudoune|trench|parka|blazer/ },
  maille: { label: 'Mailles & sweats', icon: 'top', re: /pull|gilet|cardigan|maille|sweat|hoodie/ },
  cape: { label: 'Capes & pèlerines', icon: 'cape', re: /cape|pèlerine|pelerine|poncho/ },
  haut: { label: 'Hauts', icon: 'top', re: /top|chemis|blouse|t-shirt|tee|débardeur|debardeur|body|corset|crop|bustier|polo/ },
  chaussures: { label: 'Chaussures', icon: 'shoe', re: /chaussure|basket|botte|bottine|sandale|escarpin|sneaker|mocassin/ },
  accessoire: { label: 'Accessoires', icon: 'bag', re: /sac|ceinture|bijou|collier|bague|boucle d|chapeau|bonnet|écharpe|echarpe|lunette|montre/ },
  autre: { label: 'Autres', icon: 'top', re: null },
};
const guessCat = title => {
  const t = String(title || '').toLowerCase();
  for (const [k, c] of Object.entries(CAT)) if (c.re && c.re.test(t)) return k;
  return 'autre';
};
const ICONS = {
  pants: 'M7 3h10l1.4 18h-4.6L12 10.4 9.2 21H4.6z',
  legging: 'M8.6 3h6.8l.9 18h-3.4L12 10.6 11.1 21H7.7z',
  dress: 'M9.2 2.5h5.6l-.6 4.2 4.6 14.8H5.2l4.6-14.8z',
  skirt: 'M8 4.5h8l4.4 15.5H3.6z',
  top: 'M8.3 3.2 3.6 6.4l2 3.8 2.1-1.1V20.8h8.6V9.1l2.1 1.1 2-3.8-4.7-3.2c-.5 1.5-2 2.5-3.7 2.5s-3.2-1-3.7-2.5z',
  cape: 'M12 3.4c1.5 0 2.5.9 2.5 2 2.7.8 5.6 5.3 6.5 13.4H3c.9-8.1 3.8-12.6 6.5-13.4 0-1.1 1-2 2.5-2z',
  shoe: 'M3 15.5V9l4 1.5 3-3 2 4 6.5 2.2c1.6.5 2.5 1.6 2.5 2.8v1H3z',
  bag: 'M5 8h14l-1.2 12H6.2zM9 8V6.5a3 3 0 0 1 6 0V8',
};

/* =====================================================================
   État et enregistrement
   ===================================================================== */
const EMPTY = () => ({ version: 1, accounts: [], sales: [], listings: [], views: [], log: [], settings: { goal: 0, defaultCostPct: 0 } });
let ST = EMPTY();
function normalize(s) {
  const e = EMPTY();
  if (!s || typeof s !== 'object') return e;
  for (const k of ['accounts', 'sales', 'listings', 'views', 'log']) e[k] = Array.isArray(s[k]) ? s[k] : [];
  e.settings = { ...e.settings, ...(s.settings || {}) };
  e.accounts.forEach(a => { a.wallet = a.wallet || { available: 0, pending: 0 }; a.status = a.status || 'ok'; });
  return e;
}
const saveEl = $('#save');
function setSave(txt, err) { saveEl.textContent = txt; saveEl.classList.toggle('err', !!err); }
const store = {
  mode: 'local', timer: 0,
  async load() {
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      try {
        const r = await fetch('api/state', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) { this.mode = 'server'; return await r.json(); }
      } catch (e) { /* pas de serveur : stockage navigateur */ }
    }
    try { const t = localStorage.getItem('vd-state'); return t ? JSON.parse(t) : null; } catch (e) { return null; }
  },
  save() { clearTimeout(this.timer); setSave('Enregistrement…'); this.timer = setTimeout(() => this.flush(), 350); },
  async flush() {
    const txt = JSON.stringify(ST);
    if (this.mode === 'server') {
      try {
        const r = await fetch('api/state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: txt });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        setSave('Enregistré');
      } catch (e) { setSave("Échec de l'enregistrement : le serveur est-il lancé ?", true); }
    } else {
      try { localStorage.setItem('vd-state', txt); setSave('Enregistré dans ce navigateur'); }
      catch (e) { setSave('Stockage plein : exporte une sauvegarde', true); }
    }
  },
};
function addLog(kind, text, accountId) {
  ST.log.unshift({ id: uid(), t: Date.now(), kind, text, accountId: accountId || null });
  if (ST.log.length > 300) ST.log.length = 300;
}
function commit(kind, text, accountId) {
  if (text) addLog(kind, text, accountId);
  store.save();
  render();
}
const accById = id => ST.accounts.find(a => a.id === id);
const accName = id => (accById(id) || { name: '—' }).name;
function newAccount(p = {}) {
  return { id: uid(), name: p.name || 'Nouveau compte', handle: p.handle || '', vintedId: p.vintedId || '', domain: p.domain || '', status: p.status || 'ok', note: p.note || '', wallet: { available: 0, pending: 0 }, createdAt: Date.now(), lastSync: null, lastErrors: [] };
}

/* ---------- calculs de base ---------- */
const costOf = s => (s.cost != null && s.cost !== '') ? +s.cost : (+ST.settings.defaultCostPct || 0) * s.price / 100;
const profitOf = s => s.price - costOf(s) - (+s.fees || 0);
let SALES = [];      // ventes comptées (hors annulées), triées par date
let LISTINGS = [];   // annonces publiées (avec date), triées
function prepare() {
  SALES = ST.sales.filter(s => s.status !== 'cancelled' && isFinite(s.price) && isFinite(s.date))
    .map(s => ({ ...s, t: +s.date, cost: costOf(s), profit: profitOf(s), fees: +s.fees || 0 }))
    .sort((a, b) => a.t - b.t);
  LISTINGS = ST.listings.filter(l => l.publishedAt && l.status !== 'sourcing' && l.status !== 'draft').map(l => ({ ...l, t: +l.publishedAt })).sort((a, b) => a.t - b.t);
}
function salesIn(t0, t1, acc) { const a = +t0, b = +t1; return SALES.filter(o => o.t >= a && o.t < b && (!acc || o.accountId === acc)); }
function totals(list) {
  let profit = 0, ca = 0, cost = 0, fees = 0;
  for (const o of list) { profit += o.profit; ca += o.price; cost += o.cost; fees += o.fees; }
  return { profit, ca, cost, fees, n: list.length };
}
function viewsIn(t0, t1, acc) {
  const a = startOfDay(new Date(+t0)).getTime(), b = +t1;
  let v = 0;
  for (const e of ST.views) {
    if (acc && e.accountId !== acc) continue;
    const t = fromYmd(e.date).getTime();
    if (t >= a && t < b) v += +e.views || 0;
  }
  return v;
}
function pubsIn(t0, t1, acc) { const a = +t0, b = +t1; return LISTINGS.filter(l => l.t >= a && l.t < b && (!acc || l.accountId === acc)).length; }

/* ---------- périodes ---------- */
function getRange(key) {
  const NOW = new Date(), T = startOfDay(NOW);
  switch (key) {
    case 'today': return { key, start: T, end: NOW, pStart: addDays(T, -1), pEnd: addDays(NOW, -1), gran: 'hour', cmp: 'vs hier, même heure' };
    case 'yesterday': return { key, start: addDays(T, -1), end: T, pStart: addDays(T, -2), pEnd: addDays(T, -1), gran: 'hour', cmp: 'vs avant-hier' };
    case '7d': return { key, start: addDays(T, -6), end: NOW, pStart: addDays(T, -13), pEnd: addDays(NOW, -7), gran: 'day', cmp: "vs les 7 jours d'avant, même heure" };
    case 'month': {
      const y = T.getFullYear(), m = T.getMonth();
      const last = new Date(y, m, 0).getDate();
      const pEnd = new Date(y, m - 1, Math.min(NOW.getDate(), last), NOW.getHours(), NOW.getMinutes(), NOW.getSeconds());
      return { key, start: new Date(y, m, 1), end: NOW, pStart: new Date(y, m - 1, 1), pEnd, gran: 'day', cmp: 'vs le mois dernier, même jour' };
    }
    case 'lastmonth': {
      const y = T.getFullYear(), m = T.getMonth();
      return { key, start: new Date(y, m - 1, 1), end: new Date(y, m, 1), pStart: new Date(y, m - 2, 1), pEnd: new Date(y, m - 1, 1), gran: 'day', cmp: "vs le mois d'avant" };
    }
    case 'all': return { key, start: new Date(0), end: new Date(8.64e15), gran: 'day' };
    default: return { key: '30d', start: addDays(T, -29), end: NOW, pStart: addDays(T, -59), pEnd: addDays(NOW, -30), gran: 'day', cmp: "vs les 30 jours d'avant, même heure" };
  }
}
function buckets(r) {
  const out = [];
  if (r.gran === 'hour') {
    const d = startOfDay(r.start);
    const lab = r.key === 'today' ? "Aujourd'hui" : 'Hier';
    for (let h = 0; h < 24; h++) {
      const s = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h);
      if (s >= r.end) break;
      const e = new Date(d.getFullYear(), d.getMonth(), d.getDate(), h + 1);
      out.push({ s, e: e > r.end ? r.end : e, short: hh(h), long: lab + ', ' + hh(h) + '–' + hh(h + 1) });
    }
  } else {
    for (let s = new Date(r.start); s < r.end; s = addDays(s, 1)) {
      const e = addDays(s, 1);
      out.push({ s, e: e > r.end ? r.end : e, short: ddmm(s), long: longDay(s) });
    }
  }
  return out;
}
function seriesFor(r, acc) {
  const B = buckets(r);
  const list = salesIn(r.start, r.end, acc);
  const profit = B.map(() => 0), ca = B.map(() => 0), n = B.map(() => 0);
  let bi = 0;
  for (const o of list) {
    while (bi < B.length - 1 && o.t >= +B[bi].e) bi++;
    profit[bi] += o.profit; ca[bi] += o.price; n[bi]++;
  }
  return { B, list, profit, ca, n, pubs: B.map(b => pubsIn(b.s, b.e, acc)) };
}

/* =====================================================================
   Graphiques SVG
   ===================================================================== */
function niceStep(raw, integer) {
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const mults = integer && mag < 10 ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  let step = mag * mults.find(m => m * mag >= raw - 1e-9);
  if (integer) step = Math.max(1, Math.round(step));
  return step;
}
function niceScale(max, intervals, integer) {
  if (!(max > 0)) max = integer ? 4 : 100;
  const step = niceStep(max / intervals, integer);
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks = [];
  for (let k = 0; k * step <= top + step * 1e-6; k++) ticks.push(+(k * step).toFixed(6));
  return { top, ticks };
}
function niceFixed(max, intervals, integer) {
  if (!(max > 0)) max = integer ? intervals : 1;
  const step = niceStep(max / intervals, integer);
  return { top: step * intervals, ticks: range(0, intervals).map(k => +(k * step).toFixed(6)) };
}
const tip = $('#tip');
let tipTimer = 0;
const tipRows = (title, rows) => `<div class="tip-t">${esc(title)}</div>` +
  rows.map(([k, v, c]) => `<div class="tip-r"><span><i style="background:${c}"></i>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');

function renderChart(el, spec) {
  el._spec = spec;
  const W = Math.max(240, Math.round(el.getBoundingClientRect().width));
  if (!el.isConnected || el.offsetParent === null) { el._w = 0; return; }
  el._w = W;
  const H = W < 560 ? 205 : 238;
  const n = spec.labels.length;
  const isLine = spec.kind === 'line';
  const s0 = spec.series[0].values, s1 = spec.series[1] ? spec.series[1].values : null;
  const main = spec.kind === 'stack' ? s0.map((v, i) => v + s1[i]) : s0;
  const minV = Math.min(0, ...main);
  const maxL = Math.max(0, ...main);
  const sc = niceScale(Math.max(maxL, -minV), 4, spec.intY);
  const lo = minV < 0 ? -Math.ceil(-minV / (sc.ticks[1] || 1)) * (sc.ticks[1] || 1) : 0;
  const ticks = minV < 0 ? range(Math.round(lo / sc.ticks[1]), sc.ticks.length - 1).map(k => k * sc.ticks[1]) : sc.ticks;
  const yl = ticks.map(spec.fmtY);
  const CW = 6.7;
  const left = Math.ceil(Math.max(...yl.map(s => s.length)) * CW) + 12;
  let scR = null, ylR = [], right = isLine ? 6 : 2;
  if (spec.kind === 'combo') {
    scR = niceFixed(Math.max(0, ...s1), sc.ticks.length - 1, true);
    ylR = scR.ticks.map(spec.fmtYR);
    right = Math.ceil(Math.max(...ylR.map(s => s.length)) * CW) + 12;
  }
  const top = 24, bottom = 26;
  const pw = W - left - right, ph = H - top - bottom;
  const Y = v => top + ph - ((v - lo) / (sc.top - lo)) * ph;
  const YR = v => top + ph - (v / scR.top) * ph;
  const band = pw / Math.max(1, n);
  const pad = isLine ? 6 : 0;
  const X = i => isLine ? (n === 1 ? left + pw / 2 : left + pad + i * (pw - 2 * pad) / (n - 1)) : left + band * (i + 0.5);
  const f1 = v => v.toFixed(1);
  let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(spec.aria)}">`;
  if (isLine) s += `<defs><linearGradient id="g-${spec.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${spec.color};stop-opacity:.28"/><stop offset="1" style="stop-color:${spec.color};stop-opacity:0"/></linearGradient></defs>`;
  ticks.forEach((t, k) => {
    const y = f1(Y(t));
    s += `<line class="${t === 0 ? 'gl0' : 'gl'}" x1="${left}" x2="${W - right}" y1="${y}" y2="${y}"/>`;
    s += `<text class="ax" x="${left - 10}" y="${y}" text-anchor="end" dominant-baseline="middle">${esc(yl[k])}</text>`;
  });
  if (scR) scR.ticks.forEach((t, k) => { s += `<text class="ax" x="${W - right + 10}" y="${f1(YR(t))}" dominant-baseline="middle">${esc(ylR[k])}</text>`; });
  if (!isLine) s += `<rect class="hb" x="0" y="${top}" width="${f1(band)}" height="${ph}" visibility="hidden"/>`;
  const maxLab = Math.max(2, Math.floor(pw / 58));
  const stepL = Math.max(1, Math.ceil(n / maxLab));
  for (let i = n - 1; i >= 0; i -= stepL) {
    let x = X(i), anchor = 'middle';
    const lab = spec.labels[i].short, half = lab.length * 3.4;
    if (x + half > W) { x = W; anchor = 'end'; }
    if (x - half < 0) { x = 0; anchor = 'start'; }
    s += `<text class="ax" x="${f1(x)}" y="${H - 6}" text-anchor="${anchor}">${esc(lab)}</text>`;
  }
  const geo = { n, isLine, left, pad, pw, band, top, ph, X: [], Y: [] };
  if (isLine) {
    const pts = s0.map((v, i) => [X(i), Y(v)]);
    pts.forEach(p => { geo.X.push(p[0]); geo.Y.push(p[1]); });
    const line = pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ',' + f1(p[1])).join('');
    const base = f1(Y(0));
    if (n > 1) s += `<path d="${line}L${f1(pts[n - 1][0])},${base}L${f1(pts[0][0])},${base}Z" style="fill:url(#g-${spec.id})"/>`;
    if (spec.avg != null && maxL > 0) {
      const ya = f1(Y(spec.avg));
      s += `<line class="al" x1="${left}" x2="${W - right}" y1="${ya}" y2="${ya}"/><text class="avg" x="${W - right}" y="${f1(Y(spec.avg) - 7)}" text-anchor="end">${esc(W < 560 && spec.avgShort ? spec.avgShort : spec.avgText)}</text>`;
    }
    s += `<path d="${line}" fill="none" style="stroke:${spec.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`;
    if (n <= 48) pts.forEach(p => { s += `<circle class="pt" cx="${f1(p[0])}" cy="${f1(p[1])}" r="3.6" style="stroke:${spec.color}"/>`; });
    let im = 0;
    s0.forEach((v, i) => { if (v > s0[im]) im = i; });
    if (s0[im] > 0) s += `<text class="vl" x="${f1(clamp(pts[im][0], left + 30, W - right - 30))}" y="${f1(pts[im][1] - 11)}" text-anchor="middle">${esc(spec.fmtV(s0[im]))}</text>`;
    if (n > 1 && im !== n - 1 && maxL > 0) s += `<text class="vl" x="${f1(pts[n - 1][0] - 7)}" y="${f1(pts[n - 1][1] - 11)}" text-anchor="end">${esc(spec.fmtV(s0[n - 1]))}</text>`;
    s += `<g class="hv" visibility="hidden"><line class="gd" x1="0" x2="0" y1="${top}" y2="${top + ph}"/><circle class="hd" r="5" cx="0" cy="0" style="fill:${spec.color};stroke:var(--bg);stroke-width:2"/></g>`;
  } else {
    const bw = Math.max(2, Math.min(30, band * 0.72));
    const base = Y(0);
    for (let i = 0; i < n; i++) {
      const x = f1(X(i) - bw / 2);
      geo.X.push(X(i));
      if (spec.kind === 'stack') {
        const y1 = Y(s0[i]), y2 = Y(s0[i] + s1[i]);
        if (s0[i] > 0) s += `<rect x="${x}" y="${f1(y1)}" width="${f1(bw)}" height="${f1(base - y1)}" style="fill:${spec.series[0].color}"/>`;
        if (s1[i] > 0) s += `<rect x="${x}" y="${f1(y2)}" width="${f1(bw)}" height="${f1(Math.max(0.8, y1 - y2 - (s0[i] > 0 ? 1 : 0)))}" rx="1.5" style="fill:${spec.series[1].color}"/>`;
      } else {
        const y1 = Y(Math.max(0, s0[i]));
        if (s0[i] > 0) s += `<rect x="${x}" y="${f1(y1)}" width="${f1(bw)}" height="${f1(base - y1)}" rx="1.5" style="fill:${spec.series[0].color};opacity:.82"/>`;
      }
    }
    if (spec.kind === 'combo') {
      const pts = s1.map((v, i) => [X(i), YR(v)]);
      pts.forEach(p => geo.Y.push(p[1]));
      s += `<path d="${pts.map((p, i) => (i ? 'L' : 'M') + f1(p[0]) + ',' + f1(p[1])).join('')}" fill="none" style="stroke:${spec.series[1].color}" stroke-width="2" stroke-linejoin="round"/>`;
      if (n <= 48) pts.forEach(p => { s += `<circle class="pt" cx="${f1(p[0])}" cy="${f1(p[1])}" r="3" style="stroke:${spec.series[1].color}"/>`; });
      s += `<g class="hv" visibility="hidden"><circle class="hd" r="4.5" cx="0" cy="0" style="fill:${spec.series[1].color};stroke:var(--bg);stroke-width:2"/></g>`;
    }
  }
  s += '</svg>';
  el.innerHTML = s;
  el._geo = geo;
  attachHover(el);
}
function attachHover(el) {
  if (el._hov) return;
  el._hov = true;
  const svgOf = () => el.querySelector('svg');
  const show = e => {
    const g = el._geo, spec = el._spec;
    const svg = svgOf();
    if (!g || !g.n || !svg) return;
    const rect = el.getBoundingClientRect();
    const x = e.clientX - rect.left;
    let i = g.isLine
      ? (g.n === 1 ? 0 : Math.round((x - g.left - g.pad) / ((g.pw - 2 * g.pad) / (g.n - 1))))
      : Math.floor((x - g.left) / g.band);
    i = clamp(i, 0, g.n - 1);
    const hv = svg.querySelector('.hv');
    if (hv) {
      hv.setAttribute('visibility', 'visible');
      const gd = hv.querySelector('.gd');
      if (gd) { gd.setAttribute('x1', g.X[i]); gd.setAttribute('x2', g.X[i]); }
      const hd = hv.querySelector('.hd');
      if (hd && g.Y.length) { hd.setAttribute('cx', g.X[i]); hd.setAttribute('cy', g.Y[i]); }
    }
    const hb = svg.querySelector('.hb');
    if (hb) { hb.setAttribute('visibility', 'visible'); hb.setAttribute('x', (g.left + g.band * i).toFixed(1)); }
    tip.innerHTML = spec.tip(i);
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let tx = e.clientX + 16, ty = e.clientY - th - 12;
    if (tx + tw > window.innerWidth - 8) tx = e.clientX - tw - 16;
    if (ty < 8) ty = e.clientY + 18;
    tip.style.left = Math.max(8, tx) + 'px';
    tip.style.top = ty + 'px';
    clearTimeout(tipTimer);
  };
  const hide = e => {
    const run = () => {
      tip.hidden = true;
      const svg = svgOf();
      if (!svg) return;
      const hv = svg.querySelector('.hv'); if (hv) hv.setAttribute('visibility', 'hidden');
      const hb = svg.querySelector('.hb'); if (hb) hb.setAttribute('visibility', 'hidden');
    };
    clearTimeout(tipTimer);
    if (e && e.pointerType === 'touch') tipTimer = setTimeout(run, 1600); else run();
  };
  el.addEventListener('pointermove', show);
  el.addEventListener('pointerdown', show);
  el.addEventListener('pointerleave', hide);
}
function spark(values, color) {
  const n = values.length, W = 300, H = 30;
  if (!n) return '<div class="spark"></div>';
  const max = Math.max(0, ...values) || 1;
  const pts = values.map((v, i) => [n === 1 ? W : i * W / (n - 1), H - 3 - (Math.max(0, v) / max) * (H - 6)]);
  const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('');
  const last = pts[n - 1];
  return `<div class="spark" style="color:${color}"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" style="stroke:${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/></svg><i style="top:${(last[1] / H * 100).toFixed(1)}%;background:${color}"></i></div>`;
}
function thumb(o) {
  const src = o.photo || (o.photos && o.photos[0]);
  if (src && /^(https:\/\/|photos\/[a-f0-9]+\.jpg$|data:image\/)/.test(src)) return `<span class="th"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"></span>`;
  const c = CAT[o.category] || CAT[guessCat(o.title)];
  return `<span class="th"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[c.icon]}" style="fill:var(--slate-2)"/></svg></span>`;
}

/* =====================================================================
   Tableau de bord
   ===================================================================== */
const UI = { period: '30d', acc: null, sort: 'profit', showAll: false, page: 'dashboard', vLimit: 200, aLimit: 200 };
try { const p = localStorage.getItem('vd-period'); if (p) UI.period = p; } catch (e) { /* stockage indisponible */ }

function deltaHTML(cur, prev, cmp) {
  if (!(prev > 0)) return (cur > 0 ? '<b class="up">nouveau</b> ' : '<b class="flat">—</b> ') + esc(cmp);
  const p = (cur - prev) / prev * 100;
  const up = p >= 0;
  return `<b class="${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${pctTxt(p)}</b> ${esc(cmp)}`;
}
function renderKpis(r, s) {
  const cur = totals(s.list);
  const prev = totals(salesIn(r.pStart, r.pEnd, UI.acc));
  const vCur = viewsIn(r.start, r.end, UI.acc), vPrev = viewsIn(r.pStart, r.pEnd, UI.acc);
  const unit = r.gran === 'hour' ? 'heure' : 'jour';
  const per = s.B.length ? cur.n / s.B.length : 0;
  const noCost = s.list.filter(o => o.cost === 0 && (ST.sales.find(x => x.id === o.id) || {}).cost == null).length;
  const cards = [
    { l: 'Bénéfice', v: eur(cur.profit), cls: cur.profit < 0 ? 'neg' : 'pos', d: deltaHTML(cur.profit, prev.profit, r.cmp), s: `achats ${eur(cur.cost)} · frais ${eur(cur.fees)}${noCost ? ` · ${int(noCost)} sans coût` : ''}`, sp: spark(s.profit, 'var(--green)') },
    { l: "Chiffre d'affaires", v: eur(cur.ca), d: deltaHTML(cur.ca, prev.ca, r.cmp), s: `panier moyen ${cur.n ? eur2(cur.ca / cur.n) : '—'}`, sp: spark(s.ca, 'var(--lavender)') },
    { l: 'Commandes', v: int(cur.n), d: deltaHTML(cur.n, prev.n, r.cmp), s: `${NF1.format(per)} par ${unit}`, sp: spark(s.n, 'var(--blue)') },
    { l: 'Vues', v: int(vCur), d: deltaHTML(vCur, vPrev, r.cmp), s: vCur ? `conversion ${NF2.format(cur.n / vCur * 100)}${NB}%` : 'vues relevées à chaque synchro', sp: spark(s.vues, 'var(--purple)') },
  ];
  $('#kpis').innerHTML = cards.map(c => `<div class="kpi"><div class="kpi-l">${esc(c.l)}</div><div class="kpi-v${c.cls ? ' ' + c.cls : ''}">${esc(c.v)}</div><div class="kpi-d">${c.d}</div><div class="kpi-s tn">${esc(c.s)}</div>${c.sp}</div>`).join('');
}
function walletTotals(acc) {
  const list = ST.accounts.filter(a => !acc || a.id === acc);
  return { dispo: sum(list.map(a => +a.wallet.available || 0)), wait: sum(list.map(a => +a.wallet.pending || 0)) };
}
function renderWallet() {
  const w = walletTotals(UI.acc);
  $('#w-dispo').textContent = `${eur2(w.dispo)} disponibles`;
  $('#w-wait').textContent = `${eur2(w.wait)} en attente de validation`;
  const goal = +ST.settings.goal || 0;
  const NOW = new Date();
  const ca = totals(salesIn(new Date(NOW.getFullYear(), NOW.getMonth(), 1), NOW, UI.acc)).ca;
  if (!goal) { $('#goal').innerHTML = `<span>CA de ${esc(MONTH.format(NOW))} : <b class="tn">${esc(eur(ca))}</b></span><a class="link" href="#reglages">Définir un objectif</a>`; return; }
  const pct = ca / goal * 100;
  $('#goal').innerHTML = `<span>Objectif ${esc(MONTH.format(NOW))}</span><span class="gbar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(Math.min(100, pct))}"><span style="width:${Math.min(100, pct).toFixed(1)}%"></span></span><span class="tn"><b>${esc(eur(ca))}</b> / ${esc(eur(goal))} · ${Math.round(pct)}${NB}%</span><a class="link" href="#reglages">Modifier</a>`;
}
function renderCharts(r, s) {
  const unit = r.gran === 'hour' ? 'heure' : 'jour';
  const nB = Math.max(1, s.B.length);
  $('#t-profit').textContent = `Bénéfice par ${unit}`;
  const L = s.B;
  const avgP = sum(s.profit) / nB;
  renderChart($('#ch-profit'), {
    id: 'profit', kind: 'line', aria: `Bénéfice par ${unit}`, labels: L, color: 'var(--green)',
    series: [{ values: s.profit }], fmtY: v => eur(v), fmtV: v => eur2(v),
    avg: avgP, avgText: `moyenne ${eur2(avgP)} / ${unit}`, avgShort: `moy. ${eur2(avgP)}`,
    tip: i => tipRows(L[i].long, [['Bénéfice', eur2(s.profit[i]), 'var(--green)'], ['CA', eur2(s.ca[i]), 'var(--lavender)'], ['Commandes', int(s.n[i]), 'var(--blue)']]),
  });
  renderChart($('#ch-ca'), {
    id: 'ca', kind: 'combo', aria: `Chiffre d'affaires et commandes par ${unit}`, labels: L,
    series: [{ values: s.ca, color: 'var(--lavender)' }, { values: s.n, color: 'var(--blue)' }],
    fmtY: v => eur(v), fmtYR: v => int(v),
    tip: i => tipRows(L[i].long, [['CA', eur2(s.ca[i]), 'var(--lavender)'], ['Commandes', int(s.n[i]), 'var(--blue)'], ['Panier moyen', s.n[i] ? eur2(s.ca[i] / s.n[i]) : '—', 'var(--slate)']]),
  });
  // vues : relevées par jour (pas d'heure) → en vue horaire on montre les 7 derniers jours
  const vr = r.gran === 'hour' ? getRange('7d') : r;
  const VB = vr === r ? s.B : buckets(vr);
  const vues = VB.map(b => viewsIn(b.s, b.e, UI.acc));
  const avgV = sum(vues) / Math.max(1, VB.length);
  $('#t-vues').textContent = r.gran === 'hour' ? 'Vues par jour · 7 derniers jours' : 'Vues par jour';
  renderChart($('#ch-vues'), {
    id: 'vues', kind: 'line', aria: 'Vues par jour', labels: VB, color: 'var(--purple)',
    series: [{ values: vues }], fmtY: vuesAxis, fmtV: v => int(v), intY: true,
    avg: avgV, avgText: `moyenne ${int(avgV)} / jour`, avgShort: `moy. ${int(avgV)}`,
    tip: i => tipRows(VB[i].long, [['Vues', int(vues[i]), 'var(--purple)']]),
  });
  renderChart($('#ch-pub'), {
    id: 'pub', kind: 'stack', aria: `Publications et commandes par ${unit}`, labels: L, intY: true,
    series: [{ values: s.pubs, color: 'var(--blue)' }, { values: s.n, color: 'var(--bar-green)' }],
    fmtY: v => int(v),
    tip: i => tipRows(L[i].long, [['Publiés', int(s.pubs[i]), 'var(--blue)'], ['Commandes', int(s.n[i]), 'var(--bar-green)']]),
  });
}
function renderBoard() {
  const NOW = new Date();
  const map = Object.fromEntries(ST.accounts.map(a => [a.id, { id: a.id, n: 0, ca: 0, profit: 0 }]));
  for (const o of salesIn(addDays(startOfDay(NOW), -13), NOW)) { const m = map[o.accountId]; if (m) { m.n++; m.ca += o.price; m.profit += o.profit; } }
  const key = UI.sort;
  const rows = Object.values(map).sort((a, b) => b[key] - a[key] || b.profit - a.profit);
  const max = Math.max(...rows.map(r => Math.abs(r[key])), 0) || 1;
  const vis = UI.showAll ? rows : rows.slice(0, 6);
  $('#board').innerHTML = vis.map((r, i) => {
    const a = accById(r.id);
    return `<li class="brow" data-acc="${esc(a.id)}" role="button" tabindex="0" aria-pressed="${UI.acc === a.id}">
      <span class="b-r tn">${i + 1}</span><i class="b-d d-${esc(a.status)}" title="${esc((ACC_STATUS[a.status] || ACC_STATUS.ok).label)}"></i>
      <span class="b-n">${esc(a.name)}</span>
      <span class="b-t"><span class="f-${esc(a.status)}" style="width:${(Math.max(0, r[key]) / max * 100).toFixed(1)}%"></span></span>
      <span class="b-v tn">${plural(r.n, 'vente', 'ventes')}</span><span class="b-c tn">CA ${esc(eur(r.ca))}</span><span class="b-p tn${r.profit < 0 ? ' neg' : ''}">${esc(eur(r.profit))}</span></li>`;
  }).join('') || '<li class="empty">Ajoute un compte pour voir le classement.</li>';
  const rest = rows.length - 6;
  const more = $('#board-more');
  more.hidden = rest <= 0;
  more.textContent = UI.showAll ? 'Masquer les autres comptes' : `Voir les ${rest} autres comptes`;
  $$('#sort button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === key)));
}
function saleRow(o) {
  const d = new Date(o.t);
  const p = o.profit;
  return `<li class="sale" data-sale="${esc(o.id)}" tabindex="0"><span class="s-d">${ddmm(d)}</span>${thumb(o)}<span class="s-m"><span class="s-ti">${esc(o.title)}<em> · ${esc(accName(o.accountId))}</em></span><span class="s-meta">${ddmm(d)} · ${esc(eur2(o.price))}</span></span><span class="s-pr">${esc(eur2(o.price))}</span><span class="s-pf${p < 0 ? ' neg' : ''}">${p >= 0 ? '+' : '−'}${esc(eur2(Math.abs(p)))}</span></li>`;
}
function renderSalesShort(r) {
  const list = SALES.filter(o => !UI.acc || o.accountId === UI.acc).slice(-6).reverse();
  $('#sales').innerHTML = list.map(saleRow).join('') || '<li class="empty">Aucune vente pour l\'instant.</li>';
  $('#sales-count').textContent = plural(salesIn(r.start, r.end, UI.acc).length, 'vente', 'ventes') + ' sur la période';
}
const LOG_ICON = {
  sync: ['<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 5v6h-6"/>', 'var(--green)'],
  import: ['<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>', 'var(--lavender)'],
  sale: ['<path d="M3 12V4h8l9 9-8 8z"/><circle cx="7.5" cy="8.5" r="1.4"/>', 'var(--blue)'],
  listing: ['<path d="M12 19V5M5 12l7-7 7 7"/>', 'var(--purple)'],
  account: ['<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>', 'var(--slate-2)'],
  delete: ['<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>', 'var(--red)'],
  error: ['<path d="M12 3 2 20h20z"/><path d="M12 10v4M12 17h.01"/>', 'var(--amber)'],
};
function renderJournal() {
  const list = ST.log.filter(e => !UI.acc || !e.accountId || e.accountId === UI.acc).slice(0, 8);
  $('#journal').innerHTML = list.map(e => {
    const [ic, c] = LOG_ICON[e.kind] || LOG_ICON.account;
    const acc = e.accountId && accById(e.accountId);
    return `<li class="ev"><span class="ev-ic" style="--c:${c}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ic}</svg></span><div class="ev-b"><div class="ev-t">${esc(e.text)}</div><div class="ev-x">${esc(acc ? acc.name : 'Tous les comptes')}</div></div><time>${esc(rel(e.t))}</time></li>`;
  }).join('') || '<li class="empty">Rien pour l\'instant : les synchros, imports et modifications apparaîtront ici.</li>';
}
function renderFlow() {
  const NOW = new Date();
  const L = ST.listings.filter(l => !UI.acc || l.accountId === UI.acc);
  const S = ST.sales.filter(s => !UI.acc || s.accountId === UI.acc);
  const cl = k => L.filter(l => l.status === k).length;
  const cs = k => S.filter(s => s.status === k).length;
  const steps = [
    ['À sourcer', cl('sourcing'), 'var(--lavender)'],
    ['Prêts à publier', cl('draft'), 'var(--purple)'],
    ['En ligne', cl('online') + cl('reserved'), 'var(--blue)'],
    ['À envoyer', cs('ship'), 'var(--amber)'],
    ['Envoyés', cs('sent'), 'var(--slate-2)'],
    ['En attente de validation', cs('wait'), 'var(--green)'],
  ];
  $('#flow').innerHTML = steps.map(([l, n, c], i) => `<div class="fs"><span class="fs-step">${i + 1}/6</span><span class="fs-n">${int(n)}</span><span class="fs-l"><i style="background:${c}"></i>${esc(l)}</span></div>`).join('');
  const t30 = addDays(startOfDay(NOW), -29);
  const n30 = salesIn(t30, NOW, UI.acc).length;
  const p30 = pubsIn(t30, NOW, UI.acc);
  const c30 = S.filter(s => s.status === 'cancelled' && +s.date >= +t30).length;
  $('#flow-stats').innerHTML = `<span>Taux de vente 30 j <b class="tn">${p30 ? NF1.format(n30 / p30 * 100) + NB + '%' : '—'}</b></span><span>Publications 30 j <b class="tn">${int(p30)}</b></span><span>Annulées 30 j <b class="tn">${int(c30)}</b></span>`;
}
function renderHeat() {
  const NOW = new Date();
  const days = range(-6, 0).map(o => addDays(startOfDay(NOW), o));
  const grid = days.map(() => new Array(24).fill(0));
  for (const o of salesIn(days[0], NOW, UI.acc)) {
    const d = new Date(o.t);
    const r = days.findIndex(x => x.getDate() === d.getDate() && x.getMonth() === d.getMonth());
    if (r >= 0) grid[r][d.getHours()]++;
  }
  const max = Math.max(1, ...grid.flat());
  const shade = v => v ? `color-mix(in srgb, var(--purple) ${Math.round(22 + 78 * v / max)}%, var(--track))` : 'var(--track)';
  let h = '<span></span>' + range(0, 23).map(x => `<span class="hx">${x % 3 === 0 ? x : ''}</span>`).join('');
  days.forEach((d, r) => {
    h += `<span class="hl">${esc(longDay(d))}</span>`;
    h += grid[r].map((v, x) => `<span class="hc" style="background:${shade(v)}" title="${esc(longDay(d))} · ${hh(x)} : ${plural(v, 'vente', 'ventes')}"></span>`).join('');
  });
  $('#heat').innerHTML = h;
  $('#heat-scale').innerHTML = 'moins' + [0, 0.25, 0.5, 0.75, 1].map(f => `<i style="background:${f ? `color-mix(in srgb, var(--purple) ${Math.round(22 + 78 * f)}%, var(--track))` : 'var(--track)'}"></i>`).join('') + 'plus';
}
function renderCats(r) {
  const by = {};
  for (const o of salesIn(r.start, r.end, UI.acc)) {
    const k = CAT[o.category] ? o.category : guessCat(o.title);
    const c = by[k] || (by[k] = { cat: k, ca: 0, n: 0, p: 0 });
    c.ca += o.price; c.n++; c.p += o.profit;
  }
  const rows = Object.values(by).sort((a, b) => b.ca - a.ca).slice(0, 6);
  const max = rows.length ? rows[0].ca || 1 : 1;
  $('#cats').innerHTML = rows.map(c => `<li class="cat"><span class="cat-n">${esc(CAT[c.cat].label)}</span><span class="cat-t"><span style="width:${(c.ca / max * 100).toFixed(1)}%"></span></span><span class="cat-c">${esc(eur(c.ca))}</span><span class="cat-v tn">${plural(c.n, 'vente', 'ventes')}</span><span class="cat-m tn">${c.ca ? Math.round(c.p / c.ca * 100) : 0}${NB}%</span></li>`).join('') || '<li class="empty">Aucune vente sur cette période.</li>';
}
function renderDashboard() {
  const r = getRange(UI.period);
  const s = seriesFor(r, UI.acc);
  s.vues = s.B.map(b => viewsIn(b.s, b.e, UI.acc));
  $$('#tabs .tab').forEach(b => b.setAttribute('aria-selected', String(b.dataset.p === r.key)));
  $('#onboard').hidden = ST.accounts.length > 0;
  renderKpis(r, s);
  renderWallet();
  renderCharts(r, s);
  renderBoard();
  renderSalesShort(r);
  renderJournal();
  renderFlow();
  renderHeat();
  renderCats(r);
}

/* =====================================================================
   Pages Ventes / Annonces / Comptes / Réglages
   ===================================================================== */
const accOptions = (sel, allLabel) => (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') +
  ST.accounts.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')).map(a => `<option value="${esc(a.id)}"${a.id === sel ? ' selected' : ''}>${esc(a.name)}</option>`).join('');
const statusOptions = (dict, sel, allLabel) => (allLabel != null ? `<option value="">${esc(allLabel)}</option>` : '') +
  Object.entries(dict).map(([k, v]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(v.label)}</option>`).join('');
function fillSelect(el, html) { const v = el.value; el.innerHTML = html; if ([...el.options].some(o => o.value === v)) el.value = v; }

function filteredSales() {
  const q = $('#v-q').value.trim().toLowerCase();
  const acc = $('#v-acc').value, st = $('#v-st').value;
  const r = getRange($('#v-per').value);
  return ST.sales.filter(s => (!acc || s.accountId === acc) && (!st || s.status === st) && +s.date >= +r.start && +s.date < +r.end &&
    (!q || String(s.title).toLowerCase().includes(q) || accName(s.accountId).toLowerCase().includes(q)))
    .sort((a, b) => b.date - a.date);
}
function renderVentes() {
  fillSelect($('#v-acc'), accOptions(null, 'Tous les comptes'));
  fillSelect($('#v-st'), statusOptions(SALE_STATUS, null, 'Tous les statuts'));
  const list = filteredSales();
  const counted = list.filter(s => s.status !== 'cancelled');
  const ca = sum(counted.map(s => s.price)), pr = sum(counted.map(profitOf));
  const missing = counted.filter(s => s.cost == null || s.cost === '').length;
  $('#v-sum').innerHTML = `<span><b class="tn">${int(list.length)}</b> ventes</span><span>CA <b class="tn">${esc(eur2(ca))}</b></span><span>Bénéfice <b class="tn">${esc(eur2(pr))}</b></span>` +
    (missing ? `<span class="warn">${plural(missing, 'vente sans coût d\'achat', 'ventes sans coût d\'achat')}</span>` : '');
  const vis = list.slice(0, UI.vLimit);
  $('#v-tbl tbody').innerHTML = vis.map(s => {
    const p = profitOf(s), noCost = s.cost == null || s.cost === '';
    return `<tr data-sale="${esc(s.id)}"><td class="d">${esc(DT.format(new Date(+s.date)))}</td><td>${esc(accName(s.accountId))}</td>
      <td class="t"><div>${thumb(s)}<span title="${esc(s.title)}">${esc(s.title)}</span></div></td>
      <td class="r">${esc(eur2(s.price))}</td><td class="r${noCost ? ' miss' : ''}" title="${noCost ? 'Coût non renseigné' : ''}">${noCost ? '—' : esc(eur2(+s.cost))}</td><td class="r">${esc(eur2(+s.fees || 0))}</td>
      <td class="r ${s.status === 'cancelled' ? '' : p < 0 ? 'neg' : 'pos'}">${s.status === 'cancelled' ? '—' : esc(eur2(p))}</td>
      <td><select class="mini" data-sale-status="${esc(s.id)}" aria-label="Statut">${statusOptions(SALE_STATUS, s.status)}</select></td></tr>`;
  }).join('') || `<tr><td colspan="8" class="empty">${ST.sales.length ? 'Aucune vente ne correspond aux filtres.' : 'Aucune vente. Synchronise un compte, importe un CSV ou ajoute une vente.'}</td></tr>`;
  const more = $('#v-more');
  more.hidden = list.length <= UI.vLimit;
  more.textContent = `Afficher plus (${int(list.length - vis.length)} restantes)`;
}
function filteredListings() {
  const q = $('#a-q').value.trim().toLowerCase();
  const acc = $('#a-acc').value, st = $('#a-st').value;
  return ST.listings.filter(l => (!acc || l.accountId === acc) && (!st || l.status === st) && (!q || String(l.title).toLowerCase().includes(q)))
    .sort((a, b) => (b.publishedAt || b.createdAt || 0) - (a.publishedAt || a.createdAt || 0));
}
function renderAnnonces() {
  fillSelect($('#a-acc'), accOptions(null, 'Tous les comptes'));
  fillSelect($('#a-st'), statusOptions(LIST_STATUS, null, 'Tous les statuts'));
  const list = filteredListings();
  const online = list.filter(l => l.status === 'online' || l.status === 'reserved');
  $('#a-sum').innerHTML = `<span><b class="tn">${int(list.length)}</b> annonces</span><span>En ligne <b class="tn">${int(online.length)}</b></span><span>Valeur en ligne <b class="tn">${esc(eur(sum(online.map(l => +l.price || 0))))}</b></span><span>Vues cumulées <b class="tn">${int(sum(list.map(l => +l.views || 0)))}</b></span>`;
  const vis = list.slice(0, UI.aLimit);
  $('#a-tbl tbody').innerHTML = vis.map(l => `<tr data-listing="${esc(l.id)}"><td class="d">${l.publishedAt ? esc(DD.format(new Date(+l.publishedAt))) : '—'}</td><td>${esc(accName(l.accountId))}</td>
    <td class="t"><div>${thumb(l)}<span title="${esc(l.title)}">${esc(l.title)}</span></div></td>
    <td class="r">${l.price != null ? esc(eur2(+l.price)) : '—'}</td><td class="r">${l.views != null ? int(l.views) : '—'}</td><td class="r">${l.favourites != null ? int(l.favourites) : '—'}</td>
    <td><select class="mini" data-listing-status="${esc(l.id)}" aria-label="Statut">${statusOptions(LIST_STATUS, l.status)}</select></td><td>${['draft', 'sourcing'].includes(l.status) ? `<button class="btn" type="button" data-act="publish" data-id="${esc(l.id)}">Publier</button>` : ''}</td></tr>`).join('') ||
    `<tr><td colspan="8" class="empty">${ST.listings.length ? 'Aucune annonce ne correspond aux filtres.' : 'Aucune annonce. Synchronise un compte ou ajoute une annonce.'}</td></tr>`;
  const more = $('#a-more');
  more.hidden = list.length <= UI.aLimit;
  more.textContent = `Afficher plus (${int(list.length - vis.length)} restantes)`;
}
function renderComptes() {
  const NOW = new Date();
  const t30 = addDays(startOfDay(NOW), -29);
  $('#acc-cards').innerHTML = ST.accounts.map(a => {
    const t = totals(salesIn(t30, NOW, a.id));
    const online = ST.listings.filter(l => l.accountId === a.id && (l.status === 'online' || l.status === 'reserved')).length;
    const errs = (a.lastErrors || []).length;
    return `<article class="card" data-acc-card="${esc(a.id)}">
      <div class="card-h"><div><h3><i class="d-${esc(a.status)}"></i>${esc(a.name)}</h3><p>${a.handle ? '@' + esc(a.handle) + ' · ' : ''}${esc((ACC_STATUS[a.status] || ACC_STATUS.ok).label)}</p></div>
      <select class="mini" data-acc-status="${esc(a.id)}" aria-label="Statut du compte">${statusOptions(ACC_STATUS, a.status)}</select></div>
      <div class="kv"><div><span>Ventes 30 j</span><b>${int(t.n)}</b></div><div><span>CA 30 j</span><b>${esc(eur(t.ca))}</b></div><div><span>Bénéfice 30 j</span><b style="color:var(--green-2)">${esc(eur(t.profit))}</b></div>
        <div><span>En ligne</span><b>${int(online)}</b></div><div><span>Disponible</span><b>${esc(eur2(+a.wallet.available || 0))}</b></div><div><span>En attente</span><b>${esc(eur2(+a.wallet.pending || 0))}</b></div></div>
      <p class="muted" style="margin:0;font-size:12.5px">${a.lastSync ? 'Synchronisé ' + esc(rel(a.lastSync)) : 'Jamais synchronisé'}${a.vintedId ? ' · ID Vinted ' + esc(a.vintedId) : ''}</p>
      ${errs ? `<p class="warn" style="margin:0">Dernière synchro incomplète : ${esc(a.lastErrors.slice(0, 2).join(' ; '))}</p>` : ''}
      <div class="acts"><button class="btn" type="button" data-edit-acc="${esc(a.id)}">Modifier</button><button class="btn ghost" type="button" data-filter-acc="${esc(a.id)}">Voir son tableau de bord</button><button class="btn danger" type="button" data-del-acc="${esc(a.id)}">Supprimer</button></div>
    </article>`;
  }).join('') || '<p class="empty">Aucun compte. Ajoute-en un à la main, ou utilise le favori de synchro ci-dessous : le compte sera créé automatiquement.</p>';
  $('#bookmarklet').href = bookmarkletHref();
  $('#connect-mode').textContent = store.mode === 'server'
    ? `Le tableau de bord tourne sur ${location.origin} : le favori enverra les données ici.`
    : "Lance l'appli avec « npm start » puis ouvre http://localhost:3000 pour que le favori puisse envoyer les données automatiquement. Sinon, utilise le collage manuel plus bas.";
}
function renderReglages() {
  $('#set-goal').value = +ST.settings.goal || 0;
  $('#set-cost').value = +ST.settings.defaultCostPct || 0;
  renderAISettings();
  $('#store-info').textContent = store.mode === 'server'
    ? `Données enregistrées par le serveur local (fichier data/db.json, sauvegardes automatiques dans data/backups). ${plural(ST.accounts.length, 'compte', 'comptes')}, ${plural(ST.sales.length, 'vente', 'ventes')}, ${plural(ST.listings.length, 'annonce', 'annonces')}.`
    : `Données enregistrées dans ce navigateur uniquement. Lance « npm start » pour les garder dans un fichier. ${plural(ST.accounts.length, 'compte', 'comptes')}, ${plural(ST.sales.length, 'vente', 'ventes')}.`;
}

/* ---------- rendu global + navigation ---------- */
function render() {
  prepare();
  fillSelect($('#acc-sel'), accOptions(UI.acc, 'Tous les comptes'));
  if (UI.acc && !accById(UI.acc)) UI.acc = null;
  $('#acc-sel').value = UI.acc || '';
  $$('[data-view]').forEach(v => { v.hidden = v.dataset.view !== UI.page; });
  $$('.nav a').forEach(a => { if (a.dataset.page === UI.page) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (UI.page === 'dashboard') renderDashboard();
  else if (UI.page === 'ventes') renderVentes();
  else if (UI.page === 'annonces') renderAnnonces();
  else if (UI.page === 'comptes') renderComptes();
  else if (UI.page === 'reglages') renderReglages();
}
const PAGES = { '': 'dashboard', ventes: 'ventes', annonces: 'annonces', comptes: 'comptes', reglages: 'reglages', sync: 'comptes' };
function route() {
  const h = location.hash.replace('#', '');
  UI.page = PAGES[h] || 'dashboard';
  render();
  window.scrollTo(0, 0);
}

/* =====================================================================
   Fenêtres (formulaires, confirmations)
   ===================================================================== */
const modal = $('#modal'), mbox = $('#modal-box');
let lastFocus = null;
function openModal(html) {
  lastFocus = document.activeElement;
  mbox.innerHTML = html;
  modal.hidden = false;
  const f = mbox.querySelector('input,select,textarea,button');
  if (f) f.focus();
}
function closeModal() { modal.hidden = true; mbox.innerHTML = ''; mbox.classList.remove('wide'); if (lastFocus && lastFocus.focus) lastFocus.focus(); }
modal.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

function field(f) {
  const id = 'f-' + f.name;
  const full = f.full ? ' class="full"' : '';
  const req = f.required ? ' required' : '';
  let input;
  if (f.type === 'select') input = `<select id="${id}" name="${f.name}"${req}>${f.options}</select>`;
  else if (f.type === 'textarea') input = `<textarea id="${id}" name="${f.name}">${esc(f.value || '')}</textarea>`;
  else input = `<input id="${id}" name="${f.name}" type="${f.type || 'text'}"${f.step ? ` step="${f.step}"` : ''}${f.min != null ? ` min="${f.min}"` : ''} value="${esc(f.value == null ? '' : f.value)}"${req}${f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : ''}>`;
  return `<label${full}>${esc(f.label)}${input}${f.hint ? `<span class="hint">${esc(f.hint)}</span>` : ''}</label>`;
}
function formModal({ title, sub, fields, submit, onSubmit, onDelete, extra }) {
  openModal(`<h2 id="modal-t">${esc(title)}</h2>${sub ? `<p class="sub">${esc(sub)}</p>` : '<div style="height:10px"></div>'}
    <form class="form" id="mform" novalidate>${fields.map(field).join('')}</form>
    <p class="err-msg" id="mform-err" hidden></p>
    <div class="form-acts">${onDelete ? '<button class="btn danger" type="button" id="mform-del">Supprimer</button>' : ''}${extra ? extra.html : ''}
      <div><button class="btn ghost" type="button" data-close>Annuler</button><button class="btn primary" type="submit" form="mform">${esc(submit || 'Enregistrer')}</button></div></div>`);
  const form = $('#mform');
  form.addEventListener('submit', e => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const err = onSubmit(data);
    if (err) { const m = $('#mform-err'); m.textContent = err; m.hidden = false; return; }
    closeModal();
  });
  if (onDelete) $('#mform-del').addEventListener('click', onDelete);
  if (extra) extra.bind();
}
function confirmModal({ title, text, ok = 'Confirmer', danger = true, typed }) {
  return new Promise(resolve => {
    openModal(`<h2 id="modal-t">${esc(title)}</h2><p class="sub">${esc(text)}</p>
      ${typed ? `<form class="form" id="cform"><label class="full">Tape « ${esc(typed)} » pour confirmer<input id="c-typed" autocomplete="off"></label></form>` : ''}
      <div class="form-acts"><div><button class="btn ghost" type="button" id="c-no">Annuler</button><button class="btn ${danger ? 'danger' : 'primary'}" type="button" id="c-yes">${esc(ok)}</button></div></div>`);
    const done = v => { closeModal(); resolve(v); };
    $('#c-no').addEventListener('click', () => done(false));
    $('#c-yes').addEventListener('click', () => {
      if (typed && $('#c-typed').value.trim().toUpperCase() !== typed) { $('#c-typed').focus(); return; }
      done(true);
    });
  });
}
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, 3200);
}
const needAccount = () => {
  if (ST.accounts.length) return false;
  toast("Ajoute d'abord un compte (page Comptes).");
  location.hash = '#comptes';
  return true;
};

/* ---------- comptes ---------- */
function accountForm(a) {
  const isNew = !a;
  a = a || newAccount();
  formModal({
    title: isNew ? 'Ajouter un compte' : `Modifier ${a.name}`,
    sub: isNew ? 'Le nom sert dans le tableau de bord. La synchro Vinted remplit le reste.' : null,
    fields: [
      { name: 'name', label: 'Nom', value: a.name === 'Nouveau compte' ? '' : a.name, required: true, placeholder: 'Ex. Agathe' },
      { name: 'handle', label: 'Pseudo Vinted', value: a.handle, placeholder: 'ex. agathe_vintage' },
      { name: 'status', label: 'Statut', type: 'select', options: statusOptions(ACC_STATUS, a.status) },
      { name: 'available', label: 'Porte-monnaie disponible (€)', type: 'number', step: '0.01', min: 0, value: +a.wallet.available || 0 },
      { name: 'pending', label: 'En attente de validation (€)', type: 'number', step: '0.01', min: 0, value: +a.wallet.pending || 0 },
      { name: 'note', label: 'Note', type: 'textarea', value: a.note, full: true },
    ],
    submit: isNew ? 'Ajouter' : 'Enregistrer',
    onSubmit: d => {
      const name = d.name.trim();
      if (!name) return 'Donne un nom au compte.';
      if (ST.accounts.some(x => x.id !== a.id && x.name.toLowerCase() === name.toLowerCase())) return 'Un compte porte déjà ce nom.';
      Object.assign(a, { name, handle: d.handle.trim().replace(/^@/, ''), status: d.status, note: d.note.trim() });
      a.wallet = { available: parseNum(d.available) || 0, pending: parseNum(d.pending) || 0 };
      if (isNew) ST.accounts.push(a);
      commit('account', isNew ? `Compte ajouté : ${name}` : `Compte modifié : ${name}`, a.id);
      toast(isNew ? 'Compte ajouté' : 'Compte enregistré');
    },
    onDelete: isNew ? null : () => deleteAccount(a.id),
  });
}
async function deleteAccount(id) {
  const a = accById(id);
  if (!a) return;
  const ns = ST.sales.filter(s => s.accountId === id).length, nl = ST.listings.filter(l => l.accountId === id).length;
  const ok = await confirmModal({ title: `Supprimer ${a.name} ?`, text: `Le compte, ses ${int(ns)} ventes et ses ${int(nl)} annonces seront supprimés du tableau de bord. Ton compte Vinted n'est pas touché.`, ok: 'Supprimer' });
  if (!ok) return;
  ST.accounts = ST.accounts.filter(x => x.id !== id);
  ST.sales = ST.sales.filter(s => s.accountId !== id);
  ST.listings = ST.listings.filter(l => l.accountId !== id);
  ST.views = ST.views.filter(v => v.accountId !== id);
  if (UI.acc === id) UI.acc = null;
  commit('delete', `Compte supprimé : ${a.name}`);
  toast('Compte supprimé');
}

/* ---------- ventes ---------- */
function saleForm(s, preset) {
  if (needAccount()) return;
  const isNew = !s;
  const prevStatus = s ? s.status : null;
  s = s || { id: uid(), accountId: (preset && preset.accountId) || UI.acc || ST.accounts[0].id, date: Date.now(), title: '', category: '', price: '', cost: null, fees: 0, status: 'ship', note: '', source: 'manuel', ...(preset || {}) };
  formModal({
    title: isNew ? 'Ajouter une vente' : 'Modifier la vente',
    sub: s.extId ? `Vente synchronisée depuis Vinted (n° ${s.extId}).` : null,
    fields: [
      { name: 'accountId', label: 'Compte', type: 'select', options: accOptions(s.accountId), required: true },
      { name: 'date', label: 'Date de la vente', type: 'datetime-local', value: toLocalInput(+s.date), required: true },
      { name: 'title', label: 'Article', value: s.title, required: true, full: true, placeholder: 'Ex. Jupe longue gothique dentelle noire' },
      { name: 'price', label: 'Prix de vente (€)', type: 'number', step: '0.01', min: 0, value: s.price, required: true },
      { name: 'cost', label: "Coût d'achat (€)", type: 'number', step: '0.01', min: 0, value: s.cost == null ? '' : s.cost, hint: 'Vide = coût par défaut des réglages' },
      { name: 'fees', label: 'Frais (studio, emballage…) (€)', type: 'number', step: '0.01', min: 0, value: +s.fees || 0 },
      { name: 'status', label: 'Statut', type: 'select', options: statusOptions(SALE_STATUS, s.status) },
      { name: 'category', label: 'Catégorie', type: 'select', options: `<option value="">Automatique</option>` + Object.entries(CAT).map(([k, c]) => `<option value="${k}"${k === s.category ? ' selected' : ''}>${esc(c.label)}</option>`).join('') },
      { name: 'note', label: 'Note', type: 'textarea', value: s.note, full: true },
    ],
    submit: isNew ? 'Ajouter' : 'Enregistrer',
    onSubmit: d => {
      const price = parseNum(d.price);
      if (!d.title.trim()) return "Indique le nom de l'article.";
      if (price == null || price < 0) return 'Indique un prix de vente valide.';
      const t = Date.parse(d.date);
      if (isNaN(t)) return 'Indique une date valide.';
      const cost = parseNum(d.cost);
      Object.assign(s, { accountId: d.accountId, date: t, title: d.title.trim(), price, cost, fees: parseNum(d.fees) || 0, status: d.status, category: d.category || guessCat(d.title), note: d.note.trim() });
      if (!isNew && s.status !== prevStatus) s.statusLocked = true;
      if (isNew) {
        ST.sales.push(s);
        if (s.listingId) { const l = ST.listings.find(x => x.id === s.listingId); if (l) l.status = 'sold'; }
      }
      commit('sale', `${isNew ? 'Vente ajoutée' : 'Vente modifiée'} : ${s.title} (${eur2(price)})`, s.accountId);
      toast(isNew ? 'Vente ajoutée' : 'Vente enregistrée');
    },
    onDelete: isNew ? null : async () => {
      const ok = await confirmModal({ title: 'Supprimer cette vente ?', text: `${s.title} · ${eur2(+s.price)}`, ok: 'Supprimer' });
      if (!ok) return;
      ST.sales = ST.sales.filter(x => x.id !== s.id);
      commit('delete', `Vente supprimée : ${s.title}`, s.accountId);
    },
  });
}

/* ---------- annonces : fiche complète, photos, IA, publication ---------- */
const CONDITIONS = ['Neuf avec étiquette', 'Neuf sans étiquette', 'Très bon état', 'Bon état', 'Satisfaisant'];
const catOptions = sel => Object.entries(CAT).map(([k, c]) => `<option value="${k}"${k === sel ? ' selected' : ''}>${esc(c.label)}</option>`).join('');
const isServer = () => store.mode === 'server';

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { 'content-type': 'application/json', ...(opts.headers || {}) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
  return j;
}
async function aiRun(task, input) {
  if (!isServer()) throw new Error("L'IA demande le serveur local : lance « npm start ».");
  return (await api('api/ai/run', { method: 'POST', body: JSON.stringify({ task, input }) })).result;
}

/* Photos : redimensionnement, recadrage 3:4 et correction automatique (niveaux par canal = lumière + balance des blancs).
   Le vrai article reste tel quel : aucune génération d'image. */
async function loadImage(src) {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  await img.decode();
  return img;
}
function autoLevels(px) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  for (let i = 0; i < px.length; i += 4) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; }
  const n = px.length / 4, cut = n * 0.005;
  const lut = [0, 1, 2].map(c => {
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[c][v]; if (acc > cut) { lo = v; break; } }
    acc = 0;
    for (let v = 255; v >= 0; v--) { acc += hist[c][v]; if (acc > cut) { hi = v; break; } }
    hi = Math.max(hi, lo + 40);
    const g = Math.min(2.2, 255 / (hi - lo));
    const t = new Float32Array(256);
    for (let v = 0; v < 256; v++) t[v] = clamp((v - lo) * g, 0, 255);
    return t;
  });
  let sl = 0, cnt = 0;
  for (let i = 0; i < px.length; i += 16) { sl += 0.299 * lut[0][px[i]] + 0.587 * lut[1][px[i + 1]] + 0.114 * lut[2][px[i + 2]]; cnt++; }
  const mean = sl / cnt / 255;
  const gamma = mean < 0.42 ? 0.8 : mean > 0.64 ? 1.1 : 1;
  const out = lut.map(t => { const o = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) o[v] = 255 * Math.pow(t[v] / 255, gamma); return o; });
  for (let i = 0; i < px.length; i += 4) { px[i] = out[0][px[i]]; px[i + 1] = out[1][px[i + 1]]; px[i + 2] = out[2][px[i + 2]]; }
}
function renderPhoto(img, { enhance, crop, max = 1600, quality = 0.88 }) {
  let sw = img.naturalWidth, sh = img.naturalHeight, sx = 0, sy = 0;
  if (crop) {
    const target = 3 / 4;
    if (sw / sh > target) { const nw = sh * target; sx = (sw - nw) / 2; sw = nw; } else { const nh = sw / target; sy = (sh - nh) / 2; sh = nh; }
  }
  const scale = Math.min(1, max / Math.max(sw, sh));
  const w = Math.round(sw * scale), h = Math.round(sh * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  if (enhance) { const d = ctx.getImageData(0, 0, w, h); autoLevels(d.data); ctx.putImageData(d, 0, 0); }
  return c.toDataURL('image/jpeg', quality);
}
async function storePhoto(dataUrl) {
  if (!isServer()) return dataUrl; // mode navigateur : photo gardée dans les données (lourd)
  return (await api('api/photos', { method: 'POST', body: JSON.stringify({ dataUrl }) })).url;
}
async function photoForAI(src) {
  const img = await loadImage(src);
  return renderPhoto(img, { enhance: false, crop: false, max: 1280, quality: 0.85 });
}

function listingForm(l) {
  if (needAccount()) return;
  const isNew = !l;
  l = l || { id: uid(), accountId: UI.acc || ST.accounts[0].id, title: '', category: '', price: null, status: 'draft', publishedAt: null, views: null, favourites: null, cost: null, fees: 0, photos: [], createdAt: Date.now(), source: 'manuel' };
  const photos = [...(l.photos || [])];
  const v = x => x == null ? '' : x;
  openModal(`<h2 id="modal-t">${isNew ? 'Nouvelle annonce' : 'Fiche annonce'}</h2>
    <p class="sub">${l.extId ? `Annonce synchronisée depuis Vinted (n° ${esc(l.extId)}). ` : ''}Ajoute tes vraies photos, laisse l'IA rédiger, vérifie, puis publie.</p>
    <div class="ph-zone">
      <div class="ph-grid" id="ph-grid"></div>
      <div class="row" style="margin-top:10px">
        <label class="btn" for="ph-in">+ Ajouter des photos</label>
        <input id="ph-in" type="file" accept="image/*" multiple hidden>
        <label class="chk"><input type="checkbox" id="ph-enh" checked> Améliorer lumière et couleurs</label>
        <label class="chk"><input type="checkbox" id="ph-crop"> Recadrer en 3:4</label>
      </div>
      ${l.sourceImage ? `<p class="hint-l">Image du fournisseur (référence, à ne pas publier) : <a href="${esc(l.sourceImage)}" target="_blank" rel="noopener noreferrer">voir</a></p>` : ''}
    </div>
    <div class="row ai-row"><button class="btn ai" type="button" id="ai-fill">✦ Remplir avec l'IA</button><span class="muted" id="ai-status" style="font-size:12.5px"></span></div>
    <ul class="warn-list" id="ai-warn" hidden></ul>
    <form class="form" id="mform" novalidate>
      <label>Compte<select name="accountId">${accOptions(l.accountId)}</select></label>
      <label>Statut<select name="status">${statusOptions(LIST_STATUS, l.status)}</select></label>
      <label class="full">Titre<input name="title" value="${esc(l.title)}" maxlength="100" required placeholder="Ex. Jupe longue gothique en dentelle noire"></label>
      <label class="full">Description<textarea name="description" rows="5">${esc(v(l.description))}</textarea></label>
      <label>Marque<input name="brand" value="${esc(v(l.brand))}"></label>
      <label>Taille<input name="size" value="${esc(v(l.size))}" placeholder="Ex. M / 38"></label>
      <label>État<select name="condition"><option value="">—</option>${CONDITIONS.map(c => `<option${c === l.condition ? ' selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
      <label>Couleur<input name="color" value="${esc(v(l.color))}"></label>
      <label>Matière<input name="material" value="${esc(v(l.material))}"></label>
      <label>Catégorie<select name="category">${catOptions(l.category || guessCat(l.title))}</select></label>
      <label>Prix de vente (€)<input name="price" type="number" step="0.01" min="0" value="${esc(v(l.price))}"><span class="hint" id="price-hint"></span></label>
      <label>Coût d'achat (€)<input name="cost" type="number" step="0.01" min="0" value="${esc(v(l.cost))}"><span class="hint">Repris dans la vente</span></label>
      <label>Frais (studio, emballage) (€)<input name="fees" type="number" step="0.01" min="0" value="${esc(v(l.fees))}"></label>
      <label>Vues<input name="views" type="number" step="1" min="0" value="${esc(v(l.views))}"></label>
      <label class="full">Lien fournisseur<input name="sourceUrl" type="url" value="${esc(v(l.sourceUrl))}" placeholder="https://…"></label>
    </form>
    <p class="err-msg" id="mform-err" hidden></p>
    <div class="form-acts">${isNew ? '' : '<button class="btn danger" type="button" id="mform-del">Supprimer</button>'}
      <button class="btn" type="button" id="mk-pub">Préparer la publication</button>${isNew ? '' : '<button class="btn" type="button" id="mk-sale">Créer la vente</button>'}
      <div><button class="btn ghost" type="button" data-close>Annuler</button><button class="btn primary" type="submit" form="mform">Enregistrer</button></div></div>`);
  mbox.classList.add('wide');
  const form = $('#mform');
  const grid = $('#ph-grid');
  const drawPhotos = () => {
    grid.innerHTML = photos.map((p, i) => `<figure class="ph"><img src="${esc(p)}" alt="Photo ${i + 1}"><figcaption>${i === 0 ? 'Couverture' : i + 1}</figcaption>
      <div class="ph-acts">${i ? `<button type="button" data-ph-left="${i}" aria-label="Avancer la photo">←</button>` : ''}<button type="button" data-ph-del="${i}" aria-label="Retirer la photo">×</button></div></figure>`).join('') ||
      '<p class="muted" style="margin:0;font-size:13px">Aucune photo. Prends l\'article en photo à la lumière du jour, sur fond neutre, de face, de dos et les détails (étiquette, matière, défauts).</p>';
  };
  drawPhotos();
  grid.addEventListener('click', e => {
    const d = e.target.closest('[data-ph-del]'), m = e.target.closest('[data-ph-left]');
    if (d) { photos.splice(+d.dataset.phDel, 1); drawPhotos(); }
    if (m) { const i = +m.dataset.phLeft; [photos[i - 1], photos[i]] = [photos[i], photos[i - 1]]; drawPhotos(); }
  });
  $('#ph-in').addEventListener('change', async e => {
    const files = [...e.target.files].slice(0, 20 - photos.length);
    e.target.value = '';
    const st = $('#ai-status');
    for (const [k, f] of files.entries()) {
      st.textContent = `Traitement des photos ${k + 1}/${files.length}…`;
      const url = URL.createObjectURL(f);
      try {
        const img = await loadImage(url);
        photos.push(await storePhoto(renderPhoto(img, { enhance: $('#ph-enh').checked, crop: $('#ph-crop').checked })));
        drawPhotos();
      } catch (err) { toast(`Photo « ${f.name} » illisible : ${err.message}`); }
      finally { URL.revokeObjectURL(url); }
    }
    st.textContent = files.length ? `${plural(files.length, 'photo ajoutée', 'photos ajoutées')}.` : '';
  });
  $('#ai-fill').addEventListener('click', async () => {
    const btn = $('#ai-fill'), st = $('#ai-status');
    if (!photos.length) { st.textContent = "Ajoute d'abord au moins une photo."; return; }
    btn.disabled = true; st.textContent = "L'IA regarde les photos…";
    try {
      const fd = Object.fromEntries(new FormData(form).entries());
      const images = await Promise.all(photos.slice(0, 6).map(photoForAI));
      const r = await aiRun('listing', { images, hints: { titre: fd.title, marque: fd.brand, taille: fd.size, notes: fd.description, cout_achat: fd.cost } });
      const set = (name, val, force) => { const el = form.elements[name]; if (el && val != null && val !== '' && (force || !el.value)) el.value = val; };
      set('title', r.title, true); set('description', r.description, true);
      set('brand', r.brand); set('size', r.size); set('color', r.color); set('material', r.material);
      if (CONDITIONS.includes(r.condition)) form.elements.condition.value = r.condition;
      if (CAT[r.category]) form.elements.category.value = r.category;
      if (parseNum(r.price_suggested) != null) {
        set('price', parseNum(r.price_suggested));
        $('#price-hint').textContent = `IA : ${eur2(parseNum(r.price_low) || 0)} – ${eur2(parseNum(r.price_high) || 0)}`;
      }
      const w = $('#ai-warn');
      const list = Array.isArray(r.warnings) ? r.warnings.filter(Boolean) : [];
      w.innerHTML = list.map(x => `<li>${esc(x)}</li>`).join('');
      w.hidden = !list.length;
      st.textContent = 'Fiche remplie : relis et corrige avant de publier.';
    } catch (err) { st.textContent = err.message; }
    finally { btn.disabled = false; }
  });
  const save = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    if (!d.title.trim()) { const m = $('#mform-err'); m.textContent = "Indique le titre de l'annonce."; m.hidden = false; return null; }
    Object.assign(l, {
      accountId: d.accountId, status: d.status, title: d.title.trim(), description: d.description.trim(), brand: d.brand.trim(), size: d.size.trim(),
      condition: d.condition, color: d.color.trim(), material: d.material.trim(), category: d.category, price: parseNum(d.price), cost: parseNum(d.cost),
      fees: parseNum(d.fees) || 0, views: parseNum(d.views), sourceUrl: d.sourceUrl.trim(), photos: [...photos],
    });
    if (['online', 'reserved', 'sold'].includes(l.status) && !l.publishedAt) l.publishedAt = Date.now();
    if (!ST.listings.includes(l)) ST.listings.push(l);
    commit('listing', `${isNew ? 'Annonce ajoutée' : 'Annonce modifiée'} : ${l.title}`, l.accountId);
    return l;
  };
  form.addEventListener('submit', e => { e.preventDefault(); if (save()) { closeModal(); toast('Annonce enregistrée'); } });
  $('#mk-pub').addEventListener('click', () => { if (save()) { closeModal(); publishModal(l); } });
  if (!isNew) {
    $('#mk-sale').addEventListener('click', () => { if (!save()) return; closeModal(); saleForm(null, { accountId: l.accountId, title: l.title, price: l.price == null ? '' : l.price, cost: l.cost == null ? null : l.cost, fees: l.fees || 0, category: l.category, listingId: l.id, photo: (l.photos || [])[0] || null }); });
    $('#mform-del').addEventListener('click', async () => {
      const ok = await confirmModal({ title: 'Supprimer cette annonce ?', text: l.title, ok: 'Supprimer' });
      if (!ok) return;
      ST.listings = ST.listings.filter(x => x.id !== l.id);
      commit('delete', `Annonce supprimée : ${l.title}`, l.accountId);
    });
  }
}

/* Publication assistée : tout est prêt à copier-coller dans le formulaire Vinted. */
function publishModal(l) {
  const a = accById(l.accountId) || {};
  const domain = /^(www\.)?vinted\.[a-z.]+$/.test(a.domain || '') ? a.domain : 'www.vinted.fr';
  const rows = [['Titre', l.title], ['Description', l.description], ['Marque', l.brand], ['Taille', l.size], ['État', l.condition], ['Couleur', l.color], ['Matière', l.material], ['Prix', l.price != null ? NF2.format(l.price) : '']].filter(r => r[1]);
  const missing = [!l.photos || !l.photos.length ? 'photos' : '', !l.description ? 'description' : '', l.price == null ? 'prix' : '', !l.condition ? 'état' : ''].filter(Boolean);
  openModal(`<h2 id="modal-t">Publier sur Vinted</h2>
    <p class="sub">Compte : <b>${esc(a.name || '—')}</b>${a.handle ? ' (@' + esc(a.handle) + ')' : ''}. Vérifie que ce compte est bien connecté sur Vinted avant de publier.</p>
    ${missing.length ? `<p class="warn">Il manque : ${esc(missing.join(', '))}.</p>` : ''}
    <ol class="pub-steps">
      <li><b>Télécharge les photos</b> (dans l'ordre, la première sert de couverture).
        <div class="ph-grid small">${(l.photos || []).map((p, i) => `<a class="ph" href="${esc(p)}" download="${esc(slug(l.title))}-${i + 1}.jpg" title="Télécharger la photo ${i + 1}"><img src="${esc(p)}" alt="Photo ${i + 1}"><figcaption>${i + 1} ↓</figcaption></a>`).join('') || '<span class="muted">Aucune photo.</span>'}</div>
        ${(l.photos || []).length > 1 ? '<button class="btn" type="button" id="dl-all" style="margin-top:8px">Tout télécharger</button>' : ''}</li>
      <li><b>Ouvre le formulaire Vinted</b> : <a class="btn primary" href="https://${esc(domain)}/items/new" target="_blank" rel="noopener noreferrer">Ouvrir Vinted ↗</a></li>
      <li><b>Copie chaque champ</b> :
        <div class="copy-list">${rows.map(([k, val], i) => `<div class="copy-row"><span class="k">${esc(k)}</span><span class="v">${esc(val)}</span><button class="btn" type="button" data-copy="${i}">Copier</button></div>`).join('')}</div></li>
      <li><b>Publie sur Vinted</b>, puis marque l'annonce ici : <button class="btn primary" type="button" id="mark-pub">C'est publié</button></li>
    </ol>
    <div class="form-acts"><div><button class="btn ghost" type="button" data-close>Fermer</button></div></div>`);
  mbox.classList.add('wide');
  mbox.querySelectorAll('[data-copy]').forEach(b => b.addEventListener('click', () => {
    const val = rows[+b.dataset.copy][1];
    navigator.clipboard.writeText(String(val)).then(() => { b.textContent = 'Copié ✓'; setTimeout(() => { b.textContent = 'Copier'; }, 1500); },
      () => { toast('Copie bloquée par le navigateur : sélectionne le texte à la main.'); });
  }));
  const dl = $('#dl-all');
  if (dl) dl.addEventListener('click', async () => {
    for (const [i, p] of (l.photos || []).entries()) {
      const a2 = document.createElement('a');
      a2.href = p; a2.download = `${slug(l.title)}-${i + 1}.jpg`;
      document.body.appendChild(a2); a2.click(); a2.remove();
      await new Promise(r => setTimeout(r, 350));
    }
  });
  $('#mark-pub').addEventListener('click', () => {
    l.status = 'online';
    l.publishedAt = l.publishedAt || Date.now();
    commit('listing', `Annonce publiée : ${l.title}`, l.accountId);
    closeModal();
    toast('Annonce marquée en ligne');
  });
}
const slug = s => String(s || 'article').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'article';

/* Recherche d'articles : calcul de marge avant d'acheter. */
function sourcingForm() {
  if (needAccount()) return;
  openModal(`<h2 id="modal-t">Sourcer un article</h2>
    <p class="sub">Colle le lien du produit chez ton fournisseur : l'outil calcule ta marge avant d'acheter.</p>
    <form class="form" id="mform" novalidate>
      <label class="full">Lien du produit<span class="row" style="flex-wrap:nowrap"><input name="url" type="url" placeholder="https://…" style="flex:1"><button class="btn" type="button" id="src-read">Lire la page</button></span><span class="hint" id="src-hint"></span></label>
      <div class="full src-prev" id="src-prev" hidden></div>
      <label class="full">Article<input name="title" required placeholder="Ex. Pantalon cargo parachute noir"></label>
      <label>Prix fournisseur (€)<input name="supplier" type="number" step="0.01" min="0"></label>
      <label>Livraison / frais d'achat (€)<input name="shipping" type="number" step="0.01" min="0" value="0"></label>
      <label>Frais de vente (studio, emballage) (€)<input name="fees" type="number" step="0.01" min="0" value="0"></label>
      <label>Prix de revente prévu (€)<input name="resale" type="number" step="0.01" min="0"><button class="link" type="button" id="src-ai" style="justify-self:start">✦ Estimer avec l'IA</button></label>
      <label>Compte<select name="accountId">${accOptions(UI.acc || ST.accounts[0].id)}</select></label>
      <label>Quantité<input name="qty" type="number" step="1" min="1" max="50" value="1"></label>
      <div class="full margin-box" id="src-calc"></div>
    </form>
    <p class="err-msg" id="mform-err" hidden></p>
    <div class="form-acts"><div><button class="btn ghost" type="button" data-close>Annuler</button><button class="btn primary" type="submit" form="mform">Ajouter à « À sourcer »</button></div></div>`);
  mbox.classList.add('wide');
  const form = $('#mform');
  let image = '';
  const calc = () => {
    const d = Object.fromEntries(new FormData(form).entries());
    const cost = (parseNum(d.supplier) || 0) + (parseNum(d.shipping) || 0);
    const resale = parseNum(d.resale), fees = parseNum(d.fees) || 0;
    if (resale == null || !cost) { $('#src-calc').innerHTML = '<span class="muted">Renseigne le prix fournisseur et le prix de revente pour voir la marge.</span>'; return; }
    const m = resale - cost - fees, pct = resale ? m / resale * 100 : 0, mult = cost ? resale / cost : 0;
    const cls = m <= 0 ? 'neg' : pct < 30 ? 'mid' : 'pos';
    $('#src-calc').innerHTML = `<div class="mg ${cls}"><b>${m >= 0 ? '+' : '−'}${esc(eur2(Math.abs(m)))}</b> par article · marge ${Math.round(pct)}${NB}% · ×${NF1.format(mult)}</div>
      <div class="muted" style="font-size:12.5px">Coût ${esc(eur2(cost))} + frais ${esc(eur2(fees))} · revente ${esc(eur2(resale))}${cls === 'mid' ? ' · marge faible : prévois les offres et réductions' : ''}${cls === 'neg' ? ' · article à perte' : ''}</div>`;
  };
  form.addEventListener('input', calc);
  calc();
  $('#src-read').addEventListener('click', async () => {
    const hint = $('#src-hint');
    const url = form.elements.url.value.trim();
    if (!/^https?:\/\//.test(url)) { hint.textContent = 'Colle une adresse qui commence par https://'; return; }
    if (!isServer()) { hint.textContent = 'La lecture de page demande le serveur local (npm start).'; return; }
    hint.textContent = 'Lecture de la page…';
    try {
      const m = await api('api/fetch-meta?url=' + encodeURIComponent(url));
      if (m.title && !form.elements.title.value) form.elements.title.value = m.title.replace(/\s*\|.*$/, '').slice(0, 100);
      if (m.price != null && !form.elements.supplier.value) form.elements.supplier.value = m.price;
      image = m.image || '';
      const prev = $('#src-prev');
      prev.hidden = !image && !m.title;
      prev.innerHTML = `${image ? `<img src="${esc(image)}" alt="" referrerpolicy="no-referrer">` : ''}<div><b>${esc(m.title || 'Sans titre')}</b><div class="muted">${m.price != null ? esc(eur2(m.price)) + (m.currency && m.currency !== 'EUR' ? ' ' + esc(m.currency) : '') : 'Prix non trouvé : saisis-le'}</div></div>`;
      hint.textContent = m.title ? 'Infos récupérées : vérifie-les.' : "Page lue, mais pas d'infos produit : saisis-les.";
      calc();
    } catch (err) { hint.textContent = err.message + '. Saisis les infos à la main.'; }
  });
  $('#src-ai').addEventListener('click', async () => {
    const b = $('#src-ai');
    const d = Object.fromEntries(new FormData(form).entries());
    if (!d.title.trim()) { $('#src-hint').textContent = "Indique d'abord le nom de l'article."; return; }
    b.disabled = true; b.textContent = 'Estimation…';
    try {
      const r = await aiRun('price', { article: d.title, cout: (parseNum(d.supplier) || 0) + (parseNum(d.shipping) || 0), etat: 'neuf', plateforme: 'Vinted France' });
      if (parseNum(r.price_suggested) != null) form.elements.resale.value = parseNum(r.price_suggested);
      $('#src-hint').textContent = `IA : ${eur2(parseNum(r.price_low) || 0)} – ${eur2(parseNum(r.price_high) || 0)}. ${r.reasoning || ''}`;
      calc();
    } catch (err) { $('#src-hint').textContent = err.message; }
    finally { b.disabled = false; b.textContent = "✦ Estimer avec l'IA"; }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form).entries());
    if (!d.title.trim()) { const m = $('#mform-err'); m.textContent = "Indique le nom de l'article."; m.hidden = false; return; }
    const qty = clamp(Math.round(parseNum(d.qty) || 1), 1, 50);
    const cost = (parseNum(d.supplier) || 0) + (parseNum(d.shipping) || 0);
    for (let i = 0; i < qty; i++) {
      ST.listings.push({ id: uid(), accountId: d.accountId, title: d.title.trim(), category: guessCat(d.title), price: parseNum(d.resale), cost: cost || null, fees: parseNum(d.fees) || 0, status: 'sourcing', publishedAt: null, views: null, favourites: null, photos: [], sourceUrl: d.url.trim(), sourceImage: image, createdAt: Date.now(), source: 'sourcing' });
    }
    commit('listing', `À sourcer : ${d.title.trim()}${qty > 1 ? ' ×' + qty : ''}`, d.accountId);
    closeModal();
    toast(qty > 1 ? `${qty} articles ajoutés à « À sourcer »` : 'Article ajouté à « À sourcer »');
  });
}

/* Réglages de l'IA */
const PROVIDERS = { anthropic: 'Claude (Anthropic)', openai: 'ChatGPT (OpenAI)', gemini: 'Gemini (Google)' };
async function renderAISettings() {
  const box = $('#ai-settings');
  if (!isServer()) { box.innerHTML = '<p class="muted">L\'IA passe par le serveur local, qui garde tes clés en sécurité : lance « npm start » puis ouvre http://localhost:3000.</p>'; return; }
  let cfg;
  try { cfg = await api('api/ai/config'); } catch (err) { box.innerHTML = `<p class="warn">${esc(err.message)}</p>`; return; }
  box.innerHTML = `<form class="form" id="ai-form">
      <label class="full">IA utilisée<select name="provider">${Object.entries(PROVIDERS).map(([k, n]) => `<option value="${k}"${k === cfg.provider ? ' selected' : ''}>${esc(n)}${cfg.providers[k].hasKey ? '' : ' · clé manquante'}</option>`).join('')}</select></label>
      ${Object.entries(PROVIDERS).map(([k, n]) => { const p = cfg.providers[k]; return `
      <label>Clé ${esc(n)}<input name="key-${k}" type="password" autocomplete="off" placeholder="${p.hasKey ? (p.fromEnv ? 'depuis la variable d\'environnement' : 'enregistrée ' + esc(p.hint)) : 'colle ta clé API'}"><span class="hint">${p.hasKey && !p.fromEnv ? 'Laisse vide pour la garder, « - » pour l\'effacer' : 'Gardée sur ton ordinateur (data/config.json)'}</span></label>
      <label>Modèle ${esc(n)}<input name="model-${k}" value="${esc(p.model)}" placeholder="${esc(p.defaultModel)}"><span class="hint">Vide = ${esc(p.defaultModel)}</span></label>`; }).join('')}
      <div class="full row"><button class="btn primary" type="submit">Enregistrer</button><button class="btn" type="button" id="ai-test">Tester la connexion</button><span class="muted" id="ai-test-res" style="font-size:12.5px"></span></div>
    </form>`;
  const f = $('#ai-form');
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(f).entries());
    const body = { provider: d.provider, keys: {}, models: {} };
    for (const k of Object.keys(PROVIDERS)) { body.keys[k] = d['key-' + k] || ''; body.models[k] = d['model-' + k] || ''; }
    try { await api('api/ai/config', { method: 'PUT', body: JSON.stringify(body) }); toast('Réglages IA enregistrés'); renderAISettings(); }
    catch (err) { toast(err.message); }
  });
  $('#ai-test').addEventListener('click', async () => {
    const out = $('#ai-test-res');
    out.textContent = 'Test en cours…';
    try { const r = await api('api/ai/run', { method: 'POST', body: JSON.stringify({ task: 'ping', input: {} }) }); out.textContent = `OK : ${PROVIDERS[r.provider]} répond (${r.model}).`; }
    catch (err) { out.textContent = err.message; }
  });
}

/* =====================================================================
   Import / export CSV et sauvegardes
   ===================================================================== */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ';' : ',';
  const rows = [];
  let row = [], f = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim() !== ''));
}
const norm = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z]/g, '');
function parseDate(v) {
  v = String(v || '').trim();
  let m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2})[:h](\d{2}))?/);
  if (m) { const y = +m[3] < 100 ? 2000 + +m[3] : +m[3]; return new Date(y, +m[2] - 1, +m[1], +(m[4] || 12), +(m[5] || 0)).getTime(); }
  m = v.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 12), +(m[5] || 0)).getTime();
  const t = Date.parse(v);
  return isNaN(t) ? null : t;
}
function statusFromText(v) {
  const n = norm(v);
  if (!n) return 'done';
  for (const [k, s] of Object.entries(SALE_STATUS)) if (norm(s.label) === n || k === n) return k;
  return mapVintedStatus(v);
}
function importSalesCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Fichier vide ou sans ligne de données.');
  const head = rows[0].map(norm);
  const col = names => head.findIndex(h => names.includes(h));
  const ix = {
    date: col(['date', 'datedevente', 'vendule']), acc: col(['compte', 'account', 'vendeur']), title: col(['article', 'titre', 'title', 'produit', 'nom']),
    price: col(['prix', 'price', 'montant', 'prixdevente', 'ca']), cost: col(['cout', 'achat', 'cost', 'coutdachat', 'prixdachat']),
    fees: col(['frais', 'studio', 'fees']), status: col(['statut', 'status', 'etat']), cat: col(['categorie', 'category']),
  };
  if (ix.title < 0 || ix.price < 0) throw new Error('Colonnes « article » et « prix » introuvables dans la première ligne.');
  let added = 0, skipped = 0, created = 0;
  for (const r of rows.slice(1)) {
    const price = parseNum(r[ix.price]);
    const title = (r[ix.title] || '').trim();
    if (price == null || !title) { skipped++; continue; }
    const accName0 = ix.acc >= 0 ? (r[ix.acc] || '').trim() : '';
    let acc = accName0 ? ST.accounts.find(a => a.name.toLowerCase() === accName0.toLowerCase() || (a.handle && a.handle.toLowerCase() === accName0.toLowerCase())) : (UI.acc ? accById(UI.acc) : ST.accounts[0]);
    if (!acc) { acc = newAccount({ name: accName0 || 'Compte importé' }); ST.accounts.push(acc); created++; }
    const date = ix.date >= 0 ? parseDate(r[ix.date]) : Date.now();
    const cat = ix.cat >= 0 ? Object.keys(CAT).find(k => norm(CAT[k].label) === norm(r[ix.cat]) || k === norm(r[ix.cat])) : null;
    ST.sales.push({ id: uid(), accountId: acc.id, date: date || Date.now(), title, price, cost: ix.cost >= 0 ? parseNum(r[ix.cost]) : null, fees: ix.fees >= 0 ? parseNum(r[ix.fees]) || 0 : 0, status: ix.status >= 0 ? statusFromText(r[ix.status]) : 'done', category: cat || guessCat(title), source: 'csv' });
    added++;
  }
  commit('import', `Import CSV : ${plural(added, 'vente', 'ventes')}${created ? `, ${plural(created, 'compte créé', 'comptes créés')}` : ''}`);
  return { added, skipped, created };
}
function salesCSV(list) {
  const f2 = v => v == null || v === '' ? '' : NF2.format(+v).replace(/[\s  ]/g, '');
  const q = s => '"' + String(s == null ? '' : s).replace(/"/g, '""') + '"';
  const head = ['date', 'compte', 'article', 'prix', 'coût', 'frais', 'bénéfice', 'statut', 'catégorie'];
  const lines = list.map(s => [DT.format(new Date(+s.date)).replace(',', ''), q(accName(s.accountId)), q(s.title), f2(s.price), f2(s.cost), f2(s.fees || 0), s.status === 'cancelled' ? '' : f2(profitOf(s)), q(SALE_STATUS[s.status] ? SALE_STATUS[s.status].label : s.status), q((CAT[s.category] || CAT.autre).label)].join(';'));
  return '﻿' + [head.join(';'), ...lines].join('\r\n');
}
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* =====================================================================
   Synchro Vinted
   ===================================================================== */
// Statut texte renvoyé par Vinted → statut du tableau de bord (heuristique).
function mapVintedStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (/cancel|annul|refund|rembours|fail|expired|dispute|litige/.test(s)) return 'cancelled';
  if (/complet|finali|termin|success|done|closed|valid/.test(s)) return 'done';
  if (/deliver|livr|received|re[çc]u/.test(s)) return 'wait';
  if (/await|paid|pay|pending|new|attente|wait/.test(s)) return 'ship';
  if (/ship|sent|envoy|transit|label|bordereau/.test(s)) return 'sent';
  return 'wait';
}
function mergeSync(p) {
  if (!p || typeof p !== 'object') throw new Error('Données de synchro illisibles.');
  if (!p.user || !p.user.id) throw new Error("Profil Vinted introuvable dans les données : es-tu bien connecté sur Vinted ?");
  const vid = String(p.user.id), login = String(p.user.login || '');
  let acc = ST.accounts.find(a => a.vintedId === vid) || ST.accounts.find(a => login && ((a.handle || '').toLowerCase() === login.toLowerCase() || a.name.toLowerCase() === login.toLowerCase()));
  const isNew = !acc;
  if (!acc) { acc = newAccount({ name: login || 'Compte ' + vid, handle: login }); ST.accounts.push(acc); }
  Object.assign(acc, { vintedId: vid, handle: acc.handle || login, domain: p.domain || acc.domain, lastSync: Date.now(), lastErrors: Array.isArray(p.errors) ? p.errors.slice(0, 10) : [] });
  if (p.wallet && (p.wallet.available != null || p.wallet.pending != null)) {
    acc.wallet = { available: p.wallet.available != null ? +p.wallet.available : acc.wallet.available, pending: p.wallet.pending != null ? +p.wallet.pending : acc.wallet.pending };
  }
  const salesByExt = new Map(ST.sales.filter(s => s.accountId === acc.id && s.extId).map(s => [s.extId, s]));
  let ns = 0, us = 0;
  for (const o of Array.isArray(p.orders) ? p.orders : []) {
    const price = parseNum(o.price);
    if (!o.extId || price == null) continue;
    const status = mapVintedStatus(o.statusRaw);
    const ex = salesByExt.get(String(o.extId));
    if (ex) {
      if (!ex.statusLocked) ex.status = status;
      ex.statusRaw = o.statusRaw || ex.statusRaw;
      if (o.photo) ex.photo = o.photo;
      us++;
    } else {
      const s = { id: uid(), accountId: acc.id, extId: String(o.extId), date: +o.date || Date.now(), title: String(o.title || 'Article'), category: guessCat(o.title), price, cost: null, fees: 0, status, statusRaw: o.statusRaw || '', photo: o.photo || null, source: 'vinted' };
      const lst = ST.listings.find(l => l.accountId === acc.id && l.title === s.title && l.cost != null);
      if (lst) { s.cost = lst.cost; s.listingId = lst.id; }
      ST.sales.push(s); salesByExt.set(s.extId, s); ns++;
    }
  }
  const listByExt = new Map(ST.listings.filter(l => l.accountId === acc.id && l.extId).map(l => [l.extId, l]));
  const today = ymd(new Date());
  let nl = 0, ul = 0, gained = 0;
  for (const it of Array.isArray(p.items) ? p.items : []) {
    if (!it.extId) continue;
    const views = parseNum(it.views), favs = parseNum(it.favourites);
    const ex = listByExt.get(String(it.extId));
    if (ex) {
      if (views != null && ex.views != null && views > ex.views) gained += views - ex.views;
      Object.assign(ex, { title: it.title || ex.title, price: parseNum(it.price) ?? ex.price, status: it.status || ex.status, views: views ?? ex.views, favourites: favs ?? ex.favourites, photo: it.photo || ex.photo });
      if (!ex.publishedAt && it.publishedAt) ex.publishedAt = +it.publishedAt;
      ul++;
    } else {
      const l = { id: uid(), accountId: acc.id, extId: String(it.extId), title: String(it.title || 'Article'), category: guessCat(it.title), price: parseNum(it.price), status: it.status || 'online', publishedAt: +it.publishedAt || null, views, favourites: favs, photo: it.photo || null, cost: null, createdAt: Date.now(), source: 'vinted' };
      // les vues déjà accumulées servent de point de départ : seules les nouvelles vues sont comptées par jour
      ST.listings.push(l); listByExt.set(l.extId, l); nl++;
    }
  }
  if (gained) addViews(acc.id, today, gained);
  const parts = [`${plural(ns, 'nouvelle vente', 'nouvelles ventes')}`, `${plural(nl, 'nouvelle annonce', 'nouvelles annonces')}`];
  if (us + ul) parts.push(`${int(us + ul)} mises à jour`);
  if (gained) parts.push(`+${int(gained)} vues`);
  addLog(acc.lastErrors.length ? 'error' : 'sync', `Synchro ${acc.name}${isNew ? ' (nouveau compte)' : ''} : ${parts.join(', ')}`, acc.id);
  store.save();
  render();
  return { account: acc.name, sales: ns, listings: nl, updated: us + ul, errors: acc.lastErrors };
}
function addViews(accountId, date, views) {
  const e = ST.views.find(v => v.accountId === accountId && v.date === date);
  if (e) e.views += views; else ST.views.push({ accountId, date, views });
}

/* Script exécuté sur vinted.fr (favori). Il doit rester autonome : aucune variable extérieure.
   Il utilise la session Vinted déjà ouverte dans le navigateur ; aucun mot de passe. */
async function vintedSync(APP) {
  var host = location.hostname;
  if (!/(^|\.)vinted\.[a-z.]+$/.test(host)) { alert('Ouvre d’abord www.vinted.fr (connecté au compte à synchroniser), puis reclique sur le favori.'); return; }
  var win = APP ? window.open(APP + '#sync', 'vinted-dashboard') : null;
  var box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;width:340px;max-width:calc(100% - 32px);background:#1c1b2a;color:#e9e8f4;font:13px/1.45 system-ui,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.45);border:1px solid #34334c';
  var msg = document.createElement('div');
  box.appendChild(msg);
  document.body.appendChild(box);
  var say = function (t) { msg.textContent = 'Synchro tableau de bord : ' + t; };
  say('démarrage…');
  var meta = document.querySelector('meta[name="csrf-token"]');
  var headers = { accept: 'application/json, text/plain, */*' };
  if (meta && meta.content) headers['x-csrf-token'] = meta.content;
  var get = async function (p) {
    var r = await fetch(location.origin + p, { credentials: 'include', headers: headers });
    if (!r.ok) throw new Error(p.split('?')[0] + ' : HTTP ' + r.status);
    return r.json();
  };
  var num = function (v) { if (v == null) return null; if (typeof v === 'object') v = v.amount != null ? v.amount : (v.value != null ? v.value : v.price); var n = parseFloat(String(v).replace(',', '.')); return isFinite(n) ? n : null; };
  var ms = function (v) { if (v == null || v === '') return null; if (typeof v === 'number') return v < 1e12 ? v * 1000 : v; var n = Date.parse(v); return isNaN(n) ? null : n; };
  var pic = function (o) { if (!o) return null; var p = o.photo || (o.photos && o.photos[0]) || (o.item && (o.item.photo || (o.item.photos && o.item.photos[0]))); if (!p) return null; return p.url || p.full_size_url || (p.thumbnails && p.thumbnails[0] && p.thumbnails[0].url) || null; };
  var errors = [];
  var user = null;
  try { var j = await get('/api/v2/users/current'); user = j.user || j; } catch (e) { errors.push(e.message); }
  if (!user || !user.id) {
    say('impossible de lire ton profil. Vérifie que tu es connecté à Vinted, puis réessaie.');
    if (win) win.close();
    return;
  }
  var orders = [];
  for (var page = 1; page <= 80; page++) {
    say('ventes, page ' + page + '…');
    var jo;
    try { jo = await get('/api/v2/my_orders?type=sold&status=all&per_page=100&page=' + page); } catch (e) { errors.push(e.message); break; }
    var lo = jo.my_orders || jo.orders || jo.transactions || [];
    lo.forEach(function (o) {
      var it = o.item || {};
      orders.push({ extId: String(o.transaction_id != null ? o.transaction_id : (o.id != null ? o.id : it.id)), title: o.title || o.item_title || it.title || 'Article', price: num(o.price != null ? o.price : (o.total_amount != null ? o.total_amount : (o.item_price != null ? o.item_price : it.price))), date: ms(o.date || o.created_at || o.updated_at || o.status_updated_at), statusRaw: String(o.status || o.transaction_status || o.status_title || ''), photo: pic(o) });
    });
    var tp = jo.pagination && (jo.pagination.total_pages || jo.pagination.totalPages);
    if (!lo.length || (tp && page >= tp)) break;
  }
  var items = [];
  for (var pg = 1; pg <= 80; pg++) {
    say('annonces, page ' + pg + '…');
    var ji;
    try { ji = await get('/api/v2/wardrobe/' + user.id + '/items?page=' + pg + '&per_page=96&order=newest_first'); } catch (e) { errors.push(e.message); break; }
    var li = ji.items || [];
    li.forEach(function (i) {
      var hr = i.photo && i.photo.high_resolution;
      items.push({ extId: String(i.id), title: i.title || 'Article', price: num(i.price != null ? i.price : i.price_numeric), publishedAt: ms(i.created_at_ts || i.created_at || (hr && hr.timestamp)), views: i.view_count != null ? i.view_count : null, favourites: i.favourite_count != null ? i.favourite_count : null, status: (i.is_closed || i.is_sold) ? 'sold' : (i.is_reserved ? 'reserved' : ((i.is_hidden || i.is_draft) ? 'draft' : 'online')), photo: pic(i) });
    });
    var tpi = ji.pagination && (ji.pagination.total_pages || ji.pagination.totalPages);
    if (!li.length || (tpi && pg >= tpi)) break;
  }
  var wallet = null;
  var wp = ['/api/v2/wallet/balance', '/api/v2/users/' + user.id + '/balance', '/api/v2/wallets/current'];
  for (var k = 0; k < wp.length && !wallet; k++) {
    try {
      var jw = await get(wp[k]);
      var b = jw.balance || jw.wallet || jw.user_balance || jw;
      var av = num(b.available_amount != null ? b.available_amount : b.available);
      var pe = num(b.pending_amount != null ? b.pending_amount : (b.escrow_amount != null ? b.escrow_amount : b.pending));
      if (av != null || pe != null) wallet = { available: av, pending: pe };
    } catch (e) { }
  }
  if (!wallet) errors.push('porte-monnaie non lu (à saisir dans Comptes)');
  var payload = { domain: host, fetchedAt: Date.now(), user: { id: String(user.id), login: user.login || user.username || '' }, orders: orders, items: items, wallet: wallet, errors: errors };
  say(orders.length + ' ventes et ' + items.length + ' annonces lues, envoi…');
  var acked = false;
  window.addEventListener('message', function (e) {
    if (e.data && e.data.type === 'vinted-sync-ack') {
      acked = true;
      say(e.data.ok ? ('terminé pour ' + e.data.account + ' : ' + e.data.sales + ' nouvelles ventes, ' + e.data.listings + ' nouvelles annonces.' + (errors.length ? ' (Avertissements : ' + errors.length + ')' : '')) : ('erreur : ' + e.data.error));
      setTimeout(function () { box.remove(); }, 9000);
    }
  });
  var target = /^https?:/.test(APP || '') ? new URL(APP).origin : '*';
  var tries = 0;
  var showCopy = function () {
    say('la fenêtre du tableau de bord ne répond pas. Copie les données et colle-les dans Comptes > « Coller des données de synchro ».');
    var btn = document.createElement('button');
    btn.textContent = 'Copier les données';
    btn.style.cssText = 'margin-top:10px;background:#34c48b;color:#05150e;border:0;border-radius:8px;padding:7px 12px;font:600 13px system-ui;cursor:pointer';
    btn.onclick = function () {
      var txt = JSON.stringify(payload);
      navigator.clipboard.writeText(txt).then(function () { btn.textContent = 'Copié ✓'; }, function () {
        var ta = document.createElement('textarea'); ta.value = txt; ta.style.cssText = 'width:100%;height:90px;margin-top:8px'; box.appendChild(ta); ta.select();
        btn.textContent = 'Copie bloquée : sélectionne le texte';
      });
    };
    box.appendChild(btn);
  };
  var iv = setInterval(function () {
    if (acked) { clearInterval(iv); return; }
    if (++tries > 24 || !win || win.closed) { clearInterval(iv); showCopy(); return; }
    try { win.postMessage({ type: 'vinted-sync', payload: payload }, target); } catch (e) { }
  }, 500);
}
function appUrl() { return location.origin + location.pathname; }
function syncCode() {
  const src = vintedSync.toString().replace(/\n\s*/g, ' ');
  return `(${src})(${JSON.stringify(store.mode === 'server' ? appUrl() : '')})`;
}
function bookmarkletHref() { return 'javascript:' + encodeURIComponent(syncCode() + ';void 0'); }

// réception des données envoyées par le favori
const VINTED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*vinted\.[a-z.]+$/;
let READY = false;
const pendingMsgs = [];
function handleSyncMessage(e) {
  if (!VINTED_ORIGIN.test(e.origin) || !e.data || e.data.type !== 'vinted-sync') return;
  if (!READY) { pendingMsgs.push(e); return; }
  if (handleSyncMessage.seen === e.data.payload.fetchedAt) { e.source && e.source.postMessage({ type: 'vinted-sync-ack', ok: true, ...handleSyncMessage.last }, e.origin); return; }
  try {
    const res = mergeSync(e.data.payload);
    handleSyncMessage.seen = e.data.payload.fetchedAt;
    handleSyncMessage.last = { account: res.account, sales: res.sales, listings: res.listings };
    e.source && e.source.postMessage({ type: 'vinted-sync-ack', ok: true, account: res.account, sales: res.sales, listings: res.listings }, e.origin);
    toast(`Synchro ${res.account} : ${plural(res.sales, 'nouvelle vente', 'nouvelles ventes')}, ${plural(res.listings, 'nouvelle annonce', 'nouvelles annonces')}`);
  } catch (err) {
    e.source && e.source.postMessage({ type: 'vinted-sync-ack', ok: false, error: err.message }, e.origin);
    toast(err.message);
  }
}
window.addEventListener('message', handleSyncMessage);

/* =====================================================================
   Événements
   ===================================================================== */
window.addEventListener('hashchange', route);
$('#tabs').addEventListener('click', e => {
  const b = e.target.closest('.tab');
  if (!b) return;
  UI.period = b.dataset.p;
  try { localStorage.setItem('vd-period', UI.period); } catch (err) { /* ignoré */ }
  render();
});
const setAcc = id => { UI.acc = id || null; render(); };
$('#acc-sel').addEventListener('change', e => setAcc(e.target.value));
$('#board').addEventListener('click', e => { const row = e.target.closest('.brow'); if (row) setAcc(UI.acc === row.dataset.acc ? null : row.dataset.acc); });
$('#board').addEventListener('keydown', e => { const row = e.target.closest('.brow'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setAcc(UI.acc === row.dataset.acc ? null : row.dataset.acc); } });
$('#sort').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { UI.sort = b.dataset.k; renderBoard(); } });
$('#board-more').addEventListener('click', () => { UI.showAll = !UI.showAll; renderBoard(); });

document.addEventListener('click', e => {
  const act = e.target.closest('[data-act]');
  if (act) {
    const a = act.dataset.act;
    if (a === 'new-sale') saleForm();
    else if (a === 'new-listing') listingForm();
    else if (a === 'new-account') accountForm();
    else if (a === 'source') sourcingForm();
    else if (a === 'publish') { const l = ST.listings.find(x => x.id === act.dataset.id); if (l) publishModal(l); }
    return;
  }
  const sale = e.target.closest('[data-sale]');
  if (sale && !e.target.closest('select')) { const s = ST.sales.find(x => x.id === sale.dataset.sale); if (s) saleForm(s); return; }
  const lst = e.target.closest('[data-listing]');
  if (lst && !e.target.closest('select')) { const l = ST.listings.find(x => x.id === lst.dataset.listing); if (l) listingForm(l); return; }
  const ed = e.target.closest('[data-edit-acc]');
  if (ed) { accountForm(accById(ed.dataset.editAcc)); return; }
  const del = e.target.closest('[data-del-acc]');
  if (del) { deleteAccount(del.dataset.delAcc); return; }
  const fa = e.target.closest('[data-filter-acc]');
  if (fa) { UI.acc = fa.dataset.filterAcc; location.hash = ''; route(); }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  const sale = e.target.closest && e.target.closest('li[data-sale]');
  if (sale) { const s = ST.sales.find(x => x.id === sale.dataset.sale); if (s) saleForm(s); }
});
document.addEventListener('change', e => {
  const t = e.target;
  if (t.dataset.saleStatus) {
    const s = ST.sales.find(x => x.id === t.dataset.saleStatus);
    if (s) { s.status = t.value; s.statusLocked = true; commit('sale', `Statut « ${SALE_STATUS[t.value].label} » : ${s.title}`, s.accountId); }
  } else if (t.dataset.listingStatus) {
    const l = ST.listings.find(x => x.id === t.dataset.listingStatus);
    if (l) {
      l.status = t.value;
      if (['online', 'reserved', 'sold'].includes(l.status) && !l.publishedAt) l.publishedAt = Date.now();
      commit('listing', `Annonce « ${LIST_STATUS[t.value].label} » : ${l.title}`, l.accountId);
    }
  } else if (t.dataset.accStatus) {
    const a = accById(t.dataset.accStatus);
    if (a) { a.status = t.value; commit('account', `${a.name} : ${ACC_STATUS[t.value].label}`, a.id); }
  }
});
['#v-q', '#v-acc', '#v-st', '#v-per'].forEach(s => $(s).addEventListener('input', () => { UI.vLimit = 200; renderVentes(); }));
['#a-q', '#a-acc', '#a-st'].forEach(s => $(s).addEventListener('input', () => { UI.aLimit = 200; renderAnnonces(); }));
$('#v-more').addEventListener('click', () => { UI.vLimit += 300; renderVentes(); });
$('#a-more').addEventListener('click', () => { UI.aLimit += 300; renderAnnonces(); });

$('#csv-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try { const r = importSalesCSV(await f.text()); toast(`${plural(r.added, 'vente importée', 'ventes importées')}${r.skipped ? `, ${int(r.skipped)} lignes ignorées` : ''}`); }
  catch (err) { toast('Import impossible : ' + err.message); }
});
$('#csv-export').addEventListener('click', () => {
  const list = filteredSales();
  download(`ventes-${ymd(new Date())}.csv`, salesCSV(list), 'text/csv;charset=utf-8');
  toast(`${plural(list.length, 'vente exportée', 'ventes exportées')}`);
});
$('#settings-form').addEventListener('submit', e => {
  e.preventDefault();
  ST.settings.goal = Math.max(0, parseNum($('#set-goal').value) || 0);
  ST.settings.defaultCostPct = clamp(parseNum($('#set-cost').value) || 0, 0, 100);
  commit('account', 'Réglages modifiés');
  toast('Réglages enregistrés');
});
$('#backup-export').addEventListener('click', () => download(`sauvegarde-vinted-${ymd(new Date())}.json`, JSON.stringify(ST, null, 1), 'application/json'));
$('#backup-file').addEventListener('change', async e => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = normalize(JSON.parse(await f.text()));
    const ok = await confirmModal({ title: 'Restaurer cette sauvegarde ?', text: `Elle contient ${plural(data.accounts.length, 'compte', 'comptes')} et ${plural(data.sales.length, 'vente', 'ventes')}. Les données actuelles seront remplacées.`, ok: 'Restaurer' });
    if (!ok) return;
    ST = data;
    commit('import', 'Sauvegarde restaurée');
    toast('Sauvegarde restaurée');
  } catch (err) { toast('Fichier de sauvegarde illisible.'); }
});
$('#reset-all').addEventListener('click', async () => {
  const ok = await confirmModal({ title: 'Effacer toutes les données ?', text: 'Comptes, ventes, annonces, vues et journal seront supprimés. Exporte une sauvegarde avant si tu veux pouvoir revenir en arrière.', ok: 'Tout effacer', typed: 'EFFACER' });
  if (!ok) return;
  ST = EMPTY();
  UI.acc = null;
  commit('delete', 'Toutes les données ont été effacées');
  toast('Données effacées');
});
$('#copy-script').addEventListener('click', () => {
  const code = syncCode();
  navigator.clipboard.writeText(code).then(() => toast('Script copié : colle-le dans la console de vinted.fr (F12 > Console)'), () => {
    $('#paste-sync').value = code; $('#paste-sync').select(); toast('Copie bloquée : le script est dans la zone de texte');
  });
});
$('#bookmarklet').addEventListener('click', e => { e.preventDefault(); toast('Fais glisser ce bouton dans ta barre de favoris, puis clique-le depuis vinted.fr.'); });
$('#paste-import').addEventListener('click', () => {
  const txt = $('#paste-sync').value.trim();
  if (!txt) { toast('Colle d\'abord les données copiées depuis Vinted.'); return; }
  try {
    const obj = JSON.parse(txt);
    const res = mergeSync(obj.payload || obj);
    $('#paste-sync').value = '';
    toast(`Synchro ${res.account} : ${plural(res.sales, 'nouvelle vente', 'nouvelles ventes')}, ${plural(res.listings, 'nouvelle annonce', 'nouvelles annonces')}`);
  } catch (err) { toast(err instanceof SyntaxError ? 'Ce texte ne ressemble pas à des données de synchro.' : err.message); }
});

const ro = new ResizeObserver(entries => {
  for (const en of entries) {
    const el = en.target;
    const w = Math.round(en.contentRect.width);
    if (el._spec && w > 0 && Math.abs(w - el._w) > 1) renderChart(el, el._spec);
  }
});
$$('.chart').forEach(el => ro.observe(el));
setInterval(() => { if (UI.page === 'dashboard' && modal.hidden) renderJournal(); }, 60000);

/* ---------- démarrage ---------- */
(async () => {
  setSave('Chargement…');
  ST = normalize(await store.load());
  setSave(store.mode === 'server' ? 'Connecté au serveur local' : 'Mode navigateur');
  READY = true;
  route();
  while (pendingMsgs.length) handleSyncMessage(pendingMsgs.shift());
  window.__dashboard = { get state() { return ST; }, mergeSync, importSalesCSV, store, syncCode };
})();
})();

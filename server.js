#!/usr/bin/env node
'use strict';
/*
 * Serveur local du tableau de bord.
 * - sert les fichiers de public/ et les photos de data/photos/
 * - GET/PUT /api/state      : données du tableau de bord (data/db.json, sauvegardes horodatées)
 * - GET/PUT /api/ai/config  : choix de l'IA et clés (data/config.json, jamais renvoyées en clair)
 * - POST /api/ai/run        : rédaction d'annonce / estimation de prix par l'IA
 * - POST /api/photos        : enregistre une photo (JPEG) et renvoie son adresse
 * - GET /api/fetch-meta     : lit le titre, le prix et l'image d'une page produit
 * Par défaut il n'écoute que sur 127.0.0.1 (ton ordinateur uniquement).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const ai = require('./ai');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB = path.join(DATA_DIR, 'db.json');
const CONFIG = path.join(DATA_DIR, 'config.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const PHOTOS = path.join(DATA_DIR, 'photos');
const MAX_STATE = 50 * 1024 * 1024;
const MAX_PHOTO = 15 * 1024 * 1024;
const MAX_AI = 40 * 1024 * 1024;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 30;

fs.mkdirSync(BACKUPS, { recursive: true });
fs.mkdirSync(PHOTOS, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8', extra = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra });
  res.end(body);
}
const json = (res, code, obj) => send(res, code, JSON.stringify(obj));

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('données trop volumineuses'), { status: 413 })); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
async function readJSON(req, max) {
  if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw Object.assign(new Error('JSON attendu'), { status: 415 });
  try { return JSON.parse(await readBody(req, max)); } catch (e) { if (e.status) throw e; throw Object.assign(new Error('JSON invalide'), { status: 400 }); }
}

/* ---------- données ---------- */
let lastBackup = 0;
function backupPrevious() {
  if (Date.now() - lastBackup < BACKUP_EVERY_MS || !fs.existsSync(DB)) return;
  lastBackup = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB, path.join(BACKUPS, `db-${stamp}.json`));
  const files = fs.readdirSync(BACKUPS).filter(f => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) fs.unlinkSync(path.join(BACKUPS, f));
}
function writeAtomic(file, text) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, file);
}
function loadConfig() { try { return JSON.parse(fs.readFileSync(CONFIG, 'utf8')); } catch (e) { return { provider: 'anthropic', keys: {}, models: {} }; } }

/* ---------- lecture d'une page produit (protégée contre l'accès au réseau local) ---------- */
function isPrivateIP(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIP(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}
async function safeFetch(url, redirects = 3) {
  const u = new URL(url);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('adresse http(s) attendue');
  const addrs = await dns.lookup(u.hostname, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIP(a.address))) throw new Error('adresse non autorisée');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch(u, { redirect: 'manual', signal: ctrl.signal, headers: { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', 'accept-language': 'fr-FR,fr;q=0.9' } });
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      if (!redirects) throw new Error('trop de redirections');
      return safeFetch(new URL(r.headers.get('location'), u).toString(), redirects - 1);
    }
    if (!r.ok) throw new Error('la page a répondu ' + r.status);
    const reader = r.body.getReader();
    let html = '', total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      html += Buffer.from(value).toString('utf8');
      if (total > 3 * 1024 * 1024) { ctrl.abort(); break; }
    }
    return { html, finalUrl: u.toString() };
  } finally { clearTimeout(timer); }
}
function decodeEntities(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).trim();
}
function extractMeta(html, baseUrl) {
  const meta = name => {
    const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${name}["'][^>]*>`, 'i');
    const tag = html.match(re);
    if (!tag) return '';
    const c = tag[0].match(/content=["']([^"']*)["']/i);
    return c ? decodeEntities(c[1]) : '';
  };
  let title = meta('og:title') || meta('twitter:title') || decodeEntities((html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]);
  let image = meta('og:image') || meta('twitter:image');
  let price = meta('product:price:amount') || meta('og:price:amount') || meta('price');
  let currency = meta('product:price:currency') || meta('og:price:currency') || meta('priceCurrency');
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(m[1]);
      const list = [].concat(data['@graph'] || data);
      const prod = list.find(x => x && /Product/i.test([].concat(x['@type']).join(' ')));
      if (!prod) continue;
      title = title || prod.name;
      image = image || [].concat(prod.image || [])[0];
      const offer = [].concat(prod.offers || [])[0] || {};
      price = price || offer.price || offer.lowPrice;
      currency = currency || offer.priceCurrency;
    } catch (e) { /* bloc illisible */ }
  }
  if (image && typeof image === 'object') image = image.url;
  if (image) { try { image = new URL(image, baseUrl).toString(); } catch (e) { image = ''; } }
  const p = parseFloat(String(price || '').replace(',', '.'));
  return { title: title || '', image: image || '', price: isFinite(p) ? p : null, currency: currency || '' };
}

/* ---------- routes ---------- */
function hostAllowed(req) {
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return true;
  const h = String(req.headers.host || '').replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

async function handle(req, res) {
  if (!hostAllowed(req)) return json(res, 403, { error: 'hôte non autorisé' });
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;

  if (p === '/api/health') return json(res, 200, { ok: true });

  if (p === '/api/state') {
    if (req.method === 'GET') {
      let txt = 'null';
      try { txt = fs.readFileSync(DB, 'utf8'); } catch (e) { /* pas encore de données */ }
      return send(res, 200, txt);
    }
    if (req.method === 'PUT') {
      const obj = await readJSON(req, MAX_STATE);
      if (!obj || !Array.isArray(obj.accounts) || !Array.isArray(obj.sales)) return json(res, 400, { error: 'format invalide' });
      backupPrevious();
      writeAtomic(DB, JSON.stringify(obj));
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: 'méthode non autorisée' });
  }

  if (p === '/api/ai/config') {
    if (req.method === 'GET') return json(res, 200, ai.publicConfig(loadConfig()));
    if (req.method === 'PUT') {
      const body = await readJSON(req, 64 * 1024);
      const cfg = loadConfig();
      cfg.keys = cfg.keys || {}; cfg.models = cfg.models || {};
      if (['anthropic', 'openai', 'gemini'].includes(body.provider)) cfg.provider = body.provider;
      for (const prov of ['anthropic', 'openai', 'gemini']) {
        if (body.keys && typeof body.keys[prov] === 'string') {
          const k = body.keys[prov].trim();
          if (k === '-') delete cfg.keys[prov];      // « - » efface la clé
          else if (k) cfg.keys[prov] = k;
        }
        if (body.models && typeof body.models[prov] === 'string') cfg.models[prov] = body.models[prov].trim();
      }
      writeAtomic(CONFIG, JSON.stringify(cfg, null, 1));
      return json(res, 200, ai.publicConfig(cfg));
    }
    return json(res, 405, { error: 'méthode non autorisée' });
  }

  if (p === '/api/ai/run' && req.method === 'POST') {
    const body = await readJSON(req, MAX_AI);
    try { return json(res, 200, await ai.run(loadConfig(), body.task, body.input || {})); }
    catch (e) { return json(res, 502, { error: e.message }); }
  }

  if (p === '/api/photos' && req.method === 'POST') {
    const body = await readJSON(req, MAX_PHOTO);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.dataUrl || ''));
    if (!m) return json(res, 400, { error: 'photo JPEG attendue' });
    const id = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(path.join(PHOTOS, id + '.jpg'), Buffer.from(m[1], 'base64'));
    return json(res, 200, { url: `photos/${id}.jpg`, id });
  }

  if (p === '/api/fetch-meta' && req.method === 'GET') {
    try {
      const { html, finalUrl } = await safeFetch(url.searchParams.get('url') || '');
      return json(res, 200, { ...extractMeta(html, finalUrl), url: finalUrl });
    } catch (e) { return json(res, 502, { error: 'Lecture de la page impossible : ' + e.message }); }
  }

  if (p.startsWith('/photos/')) {
    const id = p.slice(8);
    if (!/^[a-f0-9]{24}\.jpg$/.test(id)) return send(res, 404, 'introuvable', 'text/plain; charset=utf-8');
    return fs.readFile(path.join(PHOTOS, id), (err, buf) => err ? send(res, 404, 'introuvable', 'text/plain; charset=utf-8') : send(res, 200, buf, 'image/jpeg', { 'cache-control': 'max-age=31536000, immutable' }));
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'méthode non autorisée' });
  let rel;
  try { rel = decodeURIComponent(p); } catch (e) { return send(res, 400, 'URL invalide', 'text/plain; charset=utf-8'); }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'interdit', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'introuvable', 'text/plain; charset=utf-8');
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { if (!res.headersSent) json(res, e.status || 500, { error: e.message || 'erreur serveur' }); });
});
server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Tableau de bord Vinted : http://${shown}:${PORT}`);
  console.log(`Données : ${DATA_DIR}`);
});

#!/usr/bin/env node
'use strict';
/*
 * Serveur local du tableau de bord.
 * - sert les fichiers de public/
 * - GET /api/state : renvoie les données (data/db.json)
 * - PUT /api/state : enregistre les données (écriture atomique + sauvegardes horodatées)
 * Par défaut il n'écoute que sur 127.0.0.1 (ton ordinateur uniquement).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB = path.join(DATA_DIR, 'db.json');
const BACKUPS = path.join(DATA_DIR, 'backups');
const MAX_BODY = 50 * 1024 * 1024;
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 30;

fs.mkdirSync(BACKUPS, { recursive: true });

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}

let lastBackup = 0;
function backupPrevious() {
  if (Date.now() - lastBackup < BACKUP_EVERY_MS || !fs.existsSync(DB)) return;
  lastBackup = Date.now();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  fs.copyFileSync(DB, path.join(BACKUPS, `db-${stamp}.json`));
  const files = fs.readdirSync(BACKUPS).filter(f => f.endsWith('.json')).sort();
  for (const f of files.slice(0, Math.max(0, files.length - BACKUP_KEEP))) fs.unlinkSync(path.join(BACKUPS, f));
}

function writeState(json) {
  backupPrevious();
  const tmp = DB + '.tmp';
  fs.writeFileSync(tmp, json);
  fs.renameSync(tmp, DB);
}

// Bloque les requêtes dont l'en-tête Host n'est pas local (protection DNS rebinding),
// sauf si HOST a été changé volontairement pour ouvrir l'accès au réseau.
function hostAllowed(req) {
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') return true;
  const h = String(req.headers.host || '').replace(/:\d+$/, '');
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

const server = http.createServer((req, res) => {
  if (!hostAllowed(req)) return send(res, 403, '{"error":"hôte non autorisé"}');
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/health') return send(res, 200, '{"ok":true}');

  if (url.pathname === '/api/state') {
    if (req.method === 'GET') {
      let txt = 'null';
      try { txt = fs.readFileSync(DB, 'utf8'); } catch (e) { /* pas encore de données */ }
      return send(res, 200, txt);
    }
    if (req.method === 'PUT') {
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) return send(res, 415, '{"error":"JSON attendu"}');
      const chunks = [];
      let size = 0, aborted = false;
      req.on('data', c => {
        size += c.length;
        if (size > MAX_BODY && !aborted) { aborted = true; send(res, 413, '{"error":"données trop volumineuses"}'); req.destroy(); }
        else chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        try {
          const obj = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!obj || !Array.isArray(obj.accounts) || !Array.isArray(obj.sales)) throw new Error('format invalide');
          writeState(JSON.stringify(obj));
          send(res, 200, '{"ok":true}');
        } catch (e) {
          send(res, 400, JSON.stringify({ error: e.message }));
        }
      });
      return;
    }
    return send(res, 405, '{"error":"méthode non autorisée"}');
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'méthode non autorisée', 'text/plain; charset=utf-8');
  let p;
  try { p = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'URL invalide', 'text/plain; charset=utf-8'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'interdit', 'text/plain; charset=utf-8');
  fs.readFile(file, (err, buf) => {
    if (err) return send(res, 404, 'introuvable', 'text/plain; charset=utf-8');
    send(res, 200, buf, TYPES[path.extname(file)] || 'application/octet-stream');
  });
});

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' ? 'localhost' : HOST;
  console.log(`Tableau de bord Vinted : http://${shown}:${PORT}`);
  console.log(`Données : ${DB}`);
});

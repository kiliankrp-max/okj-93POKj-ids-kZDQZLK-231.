'use strict';
/*
 * Appels IA pour le tableau de bord : rédaction d'annonce à partir des photos,
 * estimation du prix de revente. Trois fournisseurs au choix :
 *   - Claude (SDK officiel @anthropic-ai/sdk)
 *   - OpenAI (API Chat Completions)
 *   - Gemini (API generateContent)
 * Les clés restent sur le serveur (data/config.json ou variables d'environnement).
 */

const DEFAULT_MODELS = {
  anthropic: 'claude-opus-5-5',
  openai: 'gpt-4.1-mini',
  gemini: 'gemini-2.5-flash',
};
const ENV_KEYS = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY' };

const CONDITIONS = ['Neuf avec étiquette', 'Neuf sans étiquette', 'Très bon état', 'Bon état', 'Satisfaisant'];
const CATEGORIES = ['pantalon', 'legging', 'robe', 'jupe', 'combi', 'veste', 'maille', 'cape', 'haut', 'chaussures', 'accessoire', 'autre'];

const SYSTEM = `Tu aides un vendeur à rédiger des annonces Vinted en français.
Règles :
- Décris uniquement ce qui est visible sur les photos ou donné par le vendeur. N'invente jamais une marque, une taille, une matière ou une mesure : laisse le champ vide si tu ne sais pas.
- Signale honnêtement tout défaut visible (tache, bouloche, accroc, décoloration).
- Ton simple et clair, sans majuscules partout ni emojis en excès. Pas de fausses promesses.
- Réponds uniquement avec un objet JSON valide, sans texte autour.`;

function listingPrompt(hints) {
  return `Rédige l'annonce de cet article à partir des photos.
Informations du vendeur (peuvent être vides) : ${JSON.stringify(hints || {})}

Renvoie ce JSON :
{
  "title": "titre de 40 à 70 caractères : type d'article, style, couleur, détail marquant",
  "description": "3 à 6 phrases : description, coupe, matière si connue, état réel, défauts visibles. Termine par une ligne de mots-clés utiles à la recherche.",
  "brand": "marque si lisible sur une étiquette, sinon chaîne vide",
  "size": "taille si lisible ou donnée, sinon chaîne vide",
  "condition": "une valeur parmi ${JSON.stringify(CONDITIONS)}",
  "color": "couleur principale",
  "material": "matière si lisible sur l'étiquette, sinon chaîne vide",
  "category": "une valeur parmi ${JSON.stringify(CATEGORIES)}",
  "price_suggested": nombre en euros,
  "price_low": nombre en euros,
  "price_high": nombre en euros,
  "warnings": ["points que le vendeur doit vérifier avant de publier"]
}`;
}

function pricePrompt(input) {
  return `Estime un prix de revente sur Vinted (France, seconde main, en euros) pour cet article.
Données : ${JSON.stringify(input || {})}
Tu n'as pas accès aux prix du marché en direct : donne une estimation prudente et dis-le dans "reasoning".

Renvoie ce JSON :
{ "price_suggested": nombre, "price_low": nombre, "price_high": nombre, "reasoning": "1 à 2 phrases" }`;
}

function parseJSON(text) {
  const t = String(text || '').trim();
  try { return JSON.parse(t); } catch (e) { /* cherche le premier objet */ }
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { /* ignoré */ } }
  throw new Error("Réponse de l'IA illisible (JSON attendu).");
}

function splitDataUrl(u) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(u || ''));
  if (!m) throw new Error('Image invalide (JPEG, PNG ou WebP en base64 attendu).');
  return { mime: m[1], data: m[2] };
}

/* ---------- Claude ---------- */
let anthropicMod = null;
async function callAnthropic(cfg, prompt, images) {
  if (!anthropicMod) {
    try { anthropicMod = require('@anthropic-ai/sdk'); } catch (e) { throw new Error('SDK Claude manquant : lance « npm install ».'); }
  }
  const Anthropic = anthropicMod.default || anthropicMod;
  const client = new Anthropic(cfg.key ? { apiKey: cfg.key } : {});
  const content = images.map(u => { const { mime, data } = splitDataUrl(u); return { type: 'image', source: { type: 'base64', media_type: mime, data } }; });
  content.push({ type: 'text', text: prompt });
  let res;
  try {
    res = await client.beta.messages.create({
      model: cfg.model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('Clé Claude refusée : vérifie-la dans Réglages.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Trop de requêtes vers Claude : réessaie dans un instant.');
    if (e instanceof Anthropic.BadRequestError) throw new Error('Requête refusée par Claude : ' + e.message);
    if (e instanceof Anthropic.APIError) throw new Error(`Erreur Claude ${e.status || ''} : ${e.message}`);
    if (/authentication method/i.test(String(e.message))) throw new Error('Ajoute ta clé Claude dans Réglages (ou la variable ANTHROPIC_API_KEY).');
    throw e;
  }
  if (res.stop_reason === 'refusal') throw new Error("Claude a refusé de traiter cette demande.");
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return parseJSON(text);
}

/* ---------- OpenAI ---------- */
async function callOpenAI(cfg, prompt, images) {
  if (!cfg.key) throw new Error('Ajoute ta clé OpenAI dans Réglages.');
  const content = [{ type: 'text', text: prompt }, ...images.map(u => { splitDataUrl(u); return { type: 'image_url', image_url: { url: u } }; })];
  const r = await fetch((process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1') + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.key },
    body: JSON.stringify({ model: cfg.model, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Erreur OpenAI ${r.status} : ${(j.error && j.error.message) || 'requête refusée'}`);
  return parseJSON(j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content);
}

/* ---------- Gemini ---------- */
async function callGemini(cfg, prompt, images) {
  if (!cfg.key) throw new Error('Ajoute ta clé Gemini dans Réglages.');
  const parts = [...images.map(u => { const { mime, data } = splitDataUrl(u); return { inline_data: { mime_type: mime, data } }; }), { text: prompt }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': cfg.key },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts }], generationConfig: { responseMimeType: 'application/json' } }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Erreur Gemini ${r.status} : ${(j.error && j.error.message) || 'requête refusée'}`);
  const c = j.candidates && j.candidates[0];
  const text = c && c.content && (c.content.parts || []).map(p => p.text || '').join('');
  if (!text) throw new Error('Gemini n\'a rien renvoyé' + (c && c.finishReason ? ` (${c.finishReason})` : '') + '.');
  return parseJSON(text);
}

function resolve(config) {
  const provider = ['anthropic', 'openai', 'gemini'].includes(config.provider) ? config.provider : 'anthropic';
  const key = (config.keys && config.keys[provider]) || process.env[ENV_KEYS[provider]] || '';
  const model = (config.models && config.models[provider]) || DEFAULT_MODELS[provider];
  return { provider, key, model };
}

async function run(config, task, input) {
  const cfg = resolve(config);
  if (cfg.provider !== 'anthropic' && !cfg.key) throw new Error(`Ajoute ta clé ${cfg.provider === 'openai' ? 'OpenAI' : 'Gemini'} dans Réglages.`);
  let prompt, images = [];
  if (task === 'listing') {
    images = (input.images || []).slice(0, 6);
    if (!images.length) throw new Error("Ajoute au moins une photo de l'article.");
    prompt = listingPrompt(input.hints);
  } else if (task === 'price') {
    prompt = pricePrompt(input);
  } else if (task === 'ping') {
    prompt = 'Réponds {"ok": true}.';
  } else throw new Error('Tâche inconnue.');
  const call = cfg.provider === 'openai' ? callOpenAI : cfg.provider === 'gemini' ? callGemini : callAnthropic;
  const out = await call(cfg, prompt, images);
  return { provider: cfg.provider, model: cfg.model, result: out };
}

function publicConfig(config) {
  const keys = config.keys || {};
  const info = {};
  for (const p of Object.keys(DEFAULT_MODELS)) {
    const k = keys[p] || process.env[ENV_KEYS[p]] || '';
    info[p] = { hasKey: !!k, hint: k ? '••••' + k.slice(-4) : '', fromEnv: !keys[p] && !!process.env[ENV_KEYS[p]], model: (config.models && config.models[p]) || '', defaultModel: DEFAULT_MODELS[p] };
  }
  return { provider: resolve(config).provider, providers: info };
}

module.exports = { run, publicConfig, DEFAULT_MODELS, CONDITIONS };

'use strict';
// Perfis de impressora: ligados a um MODELO de aparelho, com o driver e as preferências de impressão.
// Puro e testável; a persistência fica em electron/printers/service.js.
// Perfil: { id, name, model, driver: { name }, prefs: { paperSize, inputBin, orientation, duplex, color, collate }, usedAt }

const ORIENTATIONS = ['Portrait', 'Landscape'];
const DUPLEX = ['OneSided', 'TwoSidedLongEdge', 'TwoSidedShortEdge'];
const NAME_RE = /^[A-Za-z0-9_]{1,40}$/; // PaperSize / InputBin: nomes de enum do Windows

const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);

/** Preferências válidas e só as preenchidas. Valor desconhecido é descartado (nunca vira texto de script). */
function normalizePrefs(p = {}) {
  const out = {};
  if (NAME_RE.test(str(p.paperSize))) out.paperSize = str(p.paperSize);
  if (NAME_RE.test(str(p.inputBin))) out.inputBin = str(p.inputBin);
  if (ORIENTATIONS.includes(p.orientation)) out.orientation = p.orientation;
  if (DUPLEX.includes(p.duplex)) out.duplex = p.duplex;
  if (typeof p.color === 'boolean') out.color = p.color;
  if (typeof p.collate === 'boolean') out.collate = p.collate;
  return out;
}

/** Valida e completa um perfil vindo da UI ou de um arquivo importado. Lança Error com mensagem em português. */
function normalizeProfile(p = {}, makeId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6)) {
  const name = str(p.name, 80);
  if (!name) throw new Error('Dê um nome ao perfil');
  const model = str(p.model || (p.match && p.match.model), 120); // p.match.model: perfis da primeira versão
  if (!model) throw new Error('O perfil precisa de um modelo de impressora');
  const driver = {};
  if (str(p.driver && p.driver.name)) driver.name = str(p.driver.name);
  const out = { id: str(p.id, 40) || makeId(), name, model, driver, prefs: normalizePrefs(p.prefs) };
  if (Number(p.usedAt) > 0) out.usedAt = Number(p.usedAt);
  return out;
}

/** Perfis a importar: aceita { profiles: [...] } ou uma lista. Ids novos, para não sobrescrever os existentes. */
function parseImport(text, makeId) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error('O arquivo não é um JSON válido'); }
  const list = Array.isArray(raw) ? raw : Array.isArray(raw && raw.profiles) ? raw.profiles : null;
  if (!list) throw new Error('O arquivo não tem perfis');
  return list.map((p) => normalizeProfile({ ...p, id: '', usedAt: 0 }, makeId));
}

// Fabricantes e palavras que o mesmo aparelho escreve de jeitos diferentes (IPP, SNMP, nome do driver).
const NOISE = new Set(['hp', 'hewlett', 'packard', 'epson', 'brother', 'kyocera', 'ricoh', 'canon', 'samsung', 'xerox', 'lexmark',
  'zebra', 'oki', 'konica', 'minolta', 'series', 'pcl', 'pcl5', 'pcl6', 'ps', 'v3', 'v4', 'class', 'driver', 'universal']);

/** Palavras do modelo, sem fabricante nem ruído; números de modelo perdem o sufixo (M404dn → m404). */
function modelTokens(model) {
  return String(model || '').toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !NOISE.has(t))
    .map((t) => (/^[a-z]{0,3}\d{2,}[a-z]{0,3}$/.test(t) ? t.replace(/[a-z]{1,3}$/, '') : t));
}

/** O perfil serve a esse modelo? Mesmas palavras, ou o mesmo número de modelo (m404, l3250). */
function sameModel(a, b) {
  const ta = modelTokens(a);
  const tb = modelTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta.join(' ') === tb.join(' ')) return true;
  const codes = (t) => t.filter((x) => /\d/.test(x) && x.length >= 3);
  const cb = new Set(codes(tb));
  return codes(ta).some((c) => cb.has(c));
}

const matches = (profile, device) => sameModel(profile.model, device.model || device.name);

/** Perfis do modelo, o usado mais recentemente primeiro. */
function forModel(profiles, model) {
  return profiles.filter((p) => sameModel(p.model, model)).sort((a, b) => (b.usedAt || 0) - (a.usedAt || 0));
}

module.exports = { normalizePrefs, normalizeProfile, parseImport, matches, sameModel, forModel, ORIENTATIONS, DUPLEX };

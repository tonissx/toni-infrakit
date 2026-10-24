'use strict';
// Leitura de arquivos .inf de driver de impressora: classe, fornecedor, versão e os modelos que o driver atende
// (nome + IDs de hardware). Puro: recebe o texto já decodificado (ver decodeInf para UTF-16).

/** Buffer do .inf → texto. Os INFs vêm em UTF-16 LE (com BOM), UTF-8 ou ANSI (cp1252). */
function decodeInf(buf) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return buf.subarray(2).toString('utf16le');
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const sw = Buffer.from(buf.subarray(2));
    sw.swap16();
    return sw.toString('utf16le');
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  // Sem BOM: UTF-16 LE sem marca tem um zero a cada dois bytes no texto ASCII.
  let zeros = 0;
  const n = Math.min(buf.length, 200);
  for (let i = 1; i < n; i += 2) if (buf[i] === 0) zeros++;
  if (n > 10 && zeros > n / 4) return buf.toString('utf16le');
  return buf.toString('latin1');
}

/** Tira comentário (;) fora de aspas. */
function stripComment(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === ';' && !q) return line.slice(0, i);
  }
  return line;
}

/** Divide por vírgula fora de aspas e tira as aspas. */
function splitList(s) {
  const out = [];
  let cur = '';
  let q = false;
  for (const c of s) {
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Texto do INF → { secao(minúscula): [linhas] }. Junta linhas continuadas com "\" no fim. */
function sections(text) {
  const map = new Map();
  let cur = null;
  let pending = '';
  for (const rawLine of text.split(/\r?\n/)) {
    let line = stripComment(rawLine).trim();
    if (pending) { line = pending + line; pending = ''; }
    if (!line) continue;
    if (line.endsWith('\\')) { pending = line.slice(0, -1); continue; }
    const m = /^\[(.+)\]$/.exec(line);
    if (m) {
      cur = m[1].trim().toLowerCase();
      if (!map.has(cur)) map.set(cur, []);
      continue;
    }
    if (cur) map.get(cur).push(line);
  }
  return map;
}

/** Linha "chave = valor" → [chave, valor] (chave pode estar entre aspas). */
function keyValue(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === '=' && !q) return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
  }
  return [null, line.trim()];
}

const unquote = (s) => String(s ?? '').trim().replace(/^"(.*)"$/, '$1');

/**
 * Lê o INF. Retorna { cls, classGuid, provider, driverVer, models: [{ name, hwids, install, section }], manufacturers }.
 * Só as seções de modelo da arquitetura atual (sem decoração ou NTamd64) entram, para não oferecer driver x86/ARM.
 */
function parseInf(text, { arch = 'amd64' } = {}) {
  const secs = sections(text);
  const strings = new Map();
  for (const name of secs.keys()) {
    // [Strings] e [Strings.0416] (pt-BR): a localizada sobrescreve a neutra quando existir.
    if (name === 'strings' || name.startsWith('strings.')) {
      for (const line of secs.get(name)) {
        const [k, v] = keyValue(line);
        if (k && (name === 'strings' || !strings.has(k.toLowerCase()) || name === 'strings.0416')) strings.set(unquote(k).toLowerCase(), unquote(v));
      }
    }
  }
  const sub = (s) => String(s ?? '').replace(/%([^%]+)%/g, (all, k) => (strings.has(k.toLowerCase()) ? strings.get(k.toLowerCase()) : all));

  const version = {};
  for (const line of secs.get('version') || []) {
    const [k, v] = keyValue(line);
    if (k) version[k.toLowerCase()] = sub(unquote(v));
  }

  const models = [];
  const manufacturers = [];
  for (const line of secs.get('manufacturer') || []) {
    const [k, v] = keyValue(line);
    const parts = splitList(v);
    const base = parts[0];
    if (!base) continue;
    const decorations = parts.slice(1).map((d) => d.toLowerCase());
    manufacturers.push(sub(unquote(k || base)));
    // Seções candidatas: "Base.NTamd64[.x.y]" para a arquitetura; "Base" se não houver decoração.
    const want = [];
    if (!decorations.length) want.push(base.toLowerCase());
    for (const d of decorations) {
      if (d.startsWith('nt' + arch) || (arch === 'amd64' && d === 'ntamd64')) want.push((base + '.' + d).toLowerCase());
    }
    for (const sname of want) {
      for (const ml of secs.get(sname) || []) {
        const [mk, mv] = keyValue(ml);
        if (!mk) continue;
        const list = splitList(mv);
        const name = sub(unquote(mk)).trim();
        if (!name) continue;
        models.push({ name, install: list[0] || '', hwids: list.slice(1).filter(Boolean), section: sname });
      }
    }
  }

  // Um mesmo modelo pode aparecer em várias linhas (um ID por linha): junta os IDs.
  const byName = new Map();
  for (const m of models) {
    const key = m.name.toLowerCase();
    const prev = byName.get(key);
    if (prev) prev.hwids = [...new Set([...prev.hwids, ...m.hwids])];
    else byName.set(key, { ...m, hwids: [...new Set(m.hwids)] });
  }

  return {
    cls: version.class || '',
    classGuid: (version.classguid || '').toLowerCase(),
    provider: version.provider || '',
    driverVer: version.driverver || '',
    manufacturers,
    models: [...byName.values()],
  };
}

const PRINTER_CLASS_GUID = '{4d36e979-e325-11ce-bfc1-08002be10318}';

/** É um INF de fila de impressão (classe Printer)? */
const isPrinterInf = (inf) => inf.cls.toLowerCase() === 'printer' || inf.classGuid === PRINTER_CLASS_GUID;

module.exports = { decodeInf, parseInf, isPrinterInf, sections, splitList, PRINTER_CLASS_GUID };

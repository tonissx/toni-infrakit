'use strict';
// Nomes de fabricante/modelo: normalização, IEEE 1284 Device ID e semelhança entre um modelo e um nome de driver.
// Puro (sem Node/Electron): usado no processo principal (casar drivers) e na interface.

/** Fabricantes conhecidos: apelidos → nome canônico. A ordem importa (o mais específico primeiro). */
const VENDORS = [
  ['hp', ['hewlett-packard', 'hewlett packard', 'hewlettpackard', 'hp']],
  ['epson', ['seiko epson', 'epson']],
  ['brother', ['brother']],
  ['canon', ['canon']],
  ['ricoh', ['ricoh', 'nrg', 'savin', 'lanier', 'gestetner']],
  ['kyocera', ['kyocera mita', 'kyocera', 'kyoceramita']],
  ['samsung', ['samsung']],
  ['lexmark', ['lexmark']],
  ['xerox', ['fuji xerox', 'fujixerox', 'xerox']],
  ['konica minolta', ['konica minolta', 'konicaminolta', 'konica', 'minolta']],
  ['sharp', ['sharp']],
  ['oki', ['oki data', 'okidata', 'oki']],
  ['toshiba', ['toshiba']],
  ['zebra', ['zebra']],
  ['elgin', ['elgin']],
  ['bematech', ['bematech']],
  ['argox', ['argox']],
  ['pantum', ['pantum']],
  ['dell', ['dell']],
  ['microsoft', ['microsoft']],
];

/** Palavras que não ajudam a distinguir um modelo (aparecem em nomes de driver de vários modelos). */
const NOISE = new Set(['printer', 'impressora', 'series', 'serie', 'class', 'driver', 'pcl', 'pcl5', 'pcl5e', 'pcl5c', 'pcl6', 'ps', 'ps3',
  'postscript', 'xl', 'xps', 'gdi', 'v3', 'v4', 'mfp', 'mfc', 'all', 'in', 'one', 'network', 'usb', 'wsd', 'ipp', 'the', 'for', 'and',
  'color', 'colour', 'mono', 'laser', 'inkjet', 'jet', 'fax', 'scan', 'scanner', 'copier', 'multifunction', 'multifuncional', 'ink']);

const GENERIC_DRIVER = /universal|generic|gen[ée]rico|global print|class driver|upd\b/i;

/** Texto → minúsculas, sem acento, só [a-z0-9] e espaços. */
function clean(s) {
  return String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Fabricante canônico encontrado no texto (ou null). */
function vendorOf(text) {
  const c = ' ' + clean(text) + ' ';
  const squashed = c.replace(/ /g, '');
  for (const [name, aliases] of VENDORS) {
    for (const a of aliases) {
      const ca = clean(a);
      if (c.includes(' ' + ca + ' ')) return name;
      // "HPLaserJet" (IDs de hardware) — só no começo, para não achar "hp" no meio de outra palavra.
      if (ca.length >= 4 && squashed.startsWith(ca.replace(/ /g, ''))) return name;
    }
  }
  return null;
}

/** Tira o fabricante do começo do nome: "HP LaserJet Pro M404" → "LaserJet Pro M404". */
function stripVendor(text) {
  let c = clean(text);
  for (const [, aliases] of VENDORS) {
    for (const a of aliases) {
      const ca = clean(a);
      if (c === ca) return '';
      if (c.startsWith(ca + ' ')) c = c.slice(ca.length + 1);
    }
  }
  return c;
}

/**
 * Tokens que identificam o modelo. "LaserJet Pro M404dn" → ['laserjet', 'pro', 'm404dn'].
 * Separa letras coladas em números só quando vira um código comum ("m404dn" fica junto).
 */
function modelTokens(text) {
  // "PCL 6" e "PS 3" são linguagem, não modelo: sem isso o "6" solto viraria um código de modelo.
  const s = stripVendor(text).replace(/\b(pcl|ps) ?(\d|xl)\b/g, ' ');
  return s.split(' ').filter((t) => t && !NOISE.has(t) && !/^\d$/.test(t));
}

const hasDigit = (t) => /\d/.test(t);

/**
 * Semelhança (0..1) entre o modelo detectado no aparelho e o nome de um driver.
 * Os números de modelo pesam mais: "M404dn" casa com "M404" (driver de série) mas não com "M402".
 */
function similarity(deviceModel, driverName) {
  const dv = vendorOf(deviceModel);
  const rv = vendorOf(driverName);
  if (dv && rv && dv !== rv) return 0;
  const a = modelTokens(deviceModel);
  const b = modelTokens(driverName);
  if (!a.length || !b.length) return 0;
  const codes = a.filter(hasDigit);
  const words = a.filter((t) => !hasDigit(t));
  const bCodes = b.filter(hasDigit);
  let score = 0;
  let max = 0;
  for (const c of codes) {
    max += 3;
    if (b.includes(c)) { score += 3; continue; }
    // Driver de série: "m404" cobre "m404dn"; "m404n" vs "m404dn" também é a mesma família.
    const fam = (t) => t.replace(/[a-z]+$/, '');
    const hit = bCodes.find((t) => (t.length >= 3 && (c.startsWith(t) || t.startsWith(c))) || (fam(t).length >= 3 && fam(t) === fam(c)));
    if (hit) score += 2;
  }
  for (const w of words) {
    max += 1;
    if (b.includes(w)) score += 1;
  }
  // Código no driver que não existe no aparelho = outro modelo ("M402" quando o aparelho é "M404").
  if (codes.length && bCodes.length && !codes.some((c) => bCodes.some((t) => c === t || c.startsWith(t) || t.startsWith(c) || c.replace(/[a-z]+$/, '') === t.replace(/[a-z]+$/, '')))) return 0;
  if (!max) return 0;
  let s = score / max;
  if (dv && rv && dv === rv) s = Math.min(1, s + 0.05);
  return Math.round(s * 100) / 100;
}

const isGenericDriver = (name) => GENERIC_DRIVER.test(String(name ?? ''));

/**
 * IEEE 1284 Device ID ("MFG:HP;MDL:LaserJet P1102;CMD:PJL,PCL;") → { mfg, mdl, cmd, cls, des, raw }.
 * As chaves aparecem abreviadas ou por extenso (MANUFACTURER, MODEL, COMMAND SET).
 */
function parseDeviceId(raw) {
  const out = { raw: String(raw ?? '') };
  for (const part of out.raw.split(';')) {
    const i = part.indexOf(':');
    if (i < 0) continue;
    const k = part.slice(0, i).trim().toUpperCase();
    const v = part.slice(i + 1).trim();
    if (!v) continue;
    if (k === 'MFG' || k === 'MANUFACTURER') out.mfg = v;
    else if (k === 'MDL' || k === 'MODEL') out.mdl = v;
    else if (k === 'CMD' || k === 'COMMAND SET') out.cmd = v.split(',').map((x) => x.trim()).filter(Boolean);
    else if (k === 'CLS' || k === 'CLASS') out.cls = v;
    else if (k === 'DES' || k === 'DESCRIPTION') out.des = v;
    else if (k === 'SN' || k === 'SERN' || k === 'SERIALNUMBER') out.sn = v;
  }
  return out;
}

/** "HP" + "HP LaserJet P1102" → "HP LaserJet P1102" (sem repetir o fabricante). */
function joinMakeModel(make, model) {
  const m = String(model ?? '').trim();
  const k = String(make ?? '').trim();
  if (!k) return m;
  if (!m) return k;
  const vm = vendorOf(m);
  if (vm && vm === vendorOf(k)) return m;
  return k + ' ' + m;
}

/** Linguagens de impressão a partir do CMD do 1284 ou de document-format-supported do IPP. */
function languages({ cmd = [], formats = [] } = {}) {
  const set = new Set();
  const all = [...cmd, ...formats].map((x) => String(x).toLowerCase());
  for (const x of all) {
    if (/pcl ?6|pclxl|pcl-xl|vnd\.hp-pclxl/.test(x)) set.add('PCL6');
    else if (/pcl/.test(x)) set.add('PCL');
    if (/postscript|^ps$|br-script|kpdl/.test(x)) set.add('PostScript');
    if (/pwg-raster|^pwg$|urf|apple-raster/.test(x)) set.add('IPP Everywhere');
    if (/pdf/.test(x)) set.add('PDF');
    if (/zpl/.test(x)) set.add('ZPL');
    if (/escpl2|esc\/p|escp/.test(x)) set.add('ESC/P');
  }
  return [...set];
}

module.exports = { clean, vendorOf, stripVendor, modelTokens, similarity, isGenericDriver, parseDeviceId, joinMakeModel, languages, VENDORS };

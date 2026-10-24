'use strict';
// IPP (RFC 8010/8011), só o necessário para perguntar à impressora quem ela é: Get-Printer-Attributes.
// Puro: monta o corpo da requisição e lê a resposta binária. O HTTP fica em electron/printers/net.js.

const TAG = {
  operation: 0x01, job: 0x02, end: 0x03, printer: 0x04, unsupported: 0x05,
  integer: 0x21, boolean: 0x22, enum: 0x23,
  octetString: 0x30, dateTime: 0x31, resolution: 0x32, rangeOfInteger: 0x33, begCollection: 0x34,
  textWithLanguage: 0x35, nameWithLanguage: 0x36, endCollection: 0x37,
  text: 0x41, name: 0x42, keyword: 0x44, uri: 0x45, uriScheme: 0x46, charset: 0x47, naturalLanguage: 0x48, mimeMediaType: 0x49,
  memberAttrName: 0x4a,
};

const GET_PRINTER_ATTRIBUTES = 0x000b;

/** Atributos que interessam para identificar o aparelho e escolher o driver. */
const REQUESTED = [
  'printer-make-and-model', 'printer-name', 'printer-info', 'printer-location', 'printer-state', 'printer-state-reasons',
  'printer-device-id', 'printer-uri-supported', 'document-format-supported', 'ipp-versions-supported', 'printer-uuid',
  'marker-names', 'marker-levels', 'marker-colors', 'marker-types', 'printer-more-info', 'color-supported', 'sides-supported',
];

function attr(tag, name, value) {
  const n = Buffer.from(name, 'utf8');
  const v = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  const b = Buffer.alloc(1 + 2 + n.length + 2 + v.length);
  let o = b.writeUInt8(tag, 0);
  o = b.writeUInt16BE(n.length, o);
  o += n.copy(b, o);
  o = b.writeUInt16BE(v.length, o);
  v.copy(b, o);
  return b;
}

/** Corpo da requisição Get-Printer-Attributes para `printerUri` (ex.: ipp://10.0.0.5:631/ipp/print). */
function encodeGetPrinterAttributes(printerUri, requestId = 1, requested = REQUESTED) {
  const head = Buffer.alloc(8);
  head.writeUInt8(2, 0); // versão 2.0 (as impressoras 1.1 também aceitam)
  head.writeUInt8(0, 1);
  head.writeUInt16BE(GET_PRINTER_ATTRIBUTES, 2);
  head.writeInt32BE(requestId, 4);
  const parts = [
    head,
    Buffer.from([TAG.operation]),
    attr(TAG.charset, 'attributes-charset', 'utf-8'),
    attr(TAG.naturalLanguage, 'attributes-natural-language', 'en'),
    attr(TAG.uri, 'printer-uri', printerUri),
  ];
  requested.forEach((k, i) => parts.push(attr(TAG.keyword, i === 0 ? 'requested-attributes' : '', k)));
  parts.push(Buffer.from([TAG.end]));
  return Buffer.concat(parts);
}

function readValue(tag, buf) {
  switch (tag) {
    case TAG.integer:
    case TAG.enum:
      return buf.length >= 4 ? buf.readInt32BE(0) : null;
    case TAG.boolean:
      return buf.length >= 1 ? buf[0] !== 0 : null;
    case TAG.rangeOfInteger:
      return buf.length >= 8 ? [buf.readInt32BE(0), buf.readInt32BE(4)] : null;
    case TAG.resolution:
      return buf.length >= 9 ? { x: buf.readInt32BE(0), y: buf.readInt32BE(4), units: buf[8] === 3 ? 'dpi' : 'dpcm' } : null;
    case TAG.textWithLanguage:
    case TAG.nameWithLanguage: {
      if (buf.length < 4) return '';
      const ll = buf.readUInt16BE(0);
      const tl = buf.readUInt16BE(2 + ll);
      return buf.subarray(4 + ll, 4 + ll + tl).toString('utf8');
    }
    case TAG.dateTime:
    case TAG.octetString:
      // Algumas impressoras mandam printer-device-id como octetString: texto é o mais útil.
      return buf.toString('utf8');
    default:
      if (tag >= 0x40 && tag <= 0x5f) return buf.toString('utf8');
      return null; // out-of-band (no-value, unknown) e tipos que não usamos
  }
}

/**
 * Resposta IPP → { version, status, requestId, ok, printer: { atributo: valor | valor[] }, operation: {…} }.
 * Coleções (marker-*-col etc.) são puladas: nada do que lemos depende delas.
 */
function decodeResponse(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 9) throw new Error('Resposta IPP curta demais');
  const res = {
    version: buf[0] + '.' + buf[1],
    status: buf.readUInt16BE(2),
    requestId: buf.readInt32BE(4),
    operation: {},
    printer: {},
  };
  let o = 8;
  let group = null;
  let last = null; // [grupo, nome] do último atributo (valores adicionais vêm com nome vazio)
  let depth = 0;   // dentro de uma coleção
  const put = (g, name, value, additional) => {
    if (!g) return;
    if (additional) {
      const cur = g[name];
      g[name] = Array.isArray(cur) ? [...cur, value] : [cur, value];
    } else {
      g[name] = value;
    }
  };
  while (o < buf.length) {
    const tag = buf[o++];
    if (tag === TAG.end) break;
    if (tag <= 0x0f) {
      group = tag === TAG.operation ? res.operation : tag === TAG.printer ? res.printer : null;
      last = null;
      continue;
    }
    if (o + 2 > buf.length) break;
    const nl = buf.readUInt16BE(o); o += 2;
    const name = buf.subarray(o, o + nl).toString('utf8'); o += nl;
    if (o + 2 > buf.length) break;
    const vl = buf.readUInt16BE(o); o += 2;
    const raw = buf.subarray(o, o + vl); o += vl;
    if (tag === TAG.begCollection) { depth++; if (depth === 1) last = null; continue; }
    if (tag === TAG.endCollection) { depth = Math.max(0, depth - 1); continue; }
    if (depth > 0) continue;
    const value = readValue(tag, raw);
    if (name) { put(group, name, value, false); last = name; }
    else if (last) put(group, last, value, true);
  }
  res.ok = res.status < 0x0100;
  return res;
}

const asList = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

const PRINTER_STATE = { 3: 'idle', 4: 'processing', 5: 'stopped' };

/** Atributos IPP → resumo usado pelo app. */
function summarize(printer) {
  const names = asList(printer['marker-names']);
  const levels = asList(printer['marker-levels']);
  const colors = asList(printer['marker-colors']);
  return {
    makeModel: printer['printer-make-and-model'] || '',
    name: printer['printer-name'] || '',
    info: printer['printer-info'] || '',
    location: printer['printer-location'] || '',
    state: PRINTER_STATE[printer['printer-state']] || null,
    reasons: asList(printer['printer-state-reasons']).filter((r) => r && r !== 'none'),
    deviceId: printer['printer-device-id'] || '',
    uris: asList(printer['printer-uri-supported']),
    formats: asList(printer['document-format-supported']),
    versions: asList(printer['ipp-versions-supported']),
    uuid: printer['printer-uuid'] || '',
    moreInfo: printer['printer-more-info'] || '',
    color: printer['color-supported'] ?? null,
    duplex: asList(printer['sides-supported']).some((s) => /two-sided/.test(s)),
    supplies: names.map((n, i) => ({ name: n, level: typeof levels[i] === 'number' ? levels[i] : null, color: colors[i] || null })),
  };
}

/**
 * Dá para instalar com o driver de classe IPP da Microsoft (sem driver do fabricante)?
 * Precisa falar IPP 2.0 e aceitar PWG Raster ou PDF — o que o selo IPP Everywhere/Mopria garante.
 */
function supportsIppClassDriver(s) {
  if (!s) return false;
  const v2 = s.versions.some((v) => /^2\./.test(String(v)));
  const fmt = s.formats.some((f) => /pwg-raster|pdf|urf/i.test(String(f)));
  return v2 && fmt;
}

module.exports = { encodeGetPrinterAttributes, decodeResponse, summarize, supportsIppClassDriver, TAG, REQUESTED };

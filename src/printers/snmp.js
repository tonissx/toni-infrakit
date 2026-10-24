'use strict';
// SNMP v1/v2c GET (só leitura), com BER mínimo: o suficiente para ler descrição, modelo, serial e suprimentos
// (Printer-MIB, RFC 3805). Puro: o UDP fica em electron/printers/net.js.

const OID = {
  sysDescr: '1.3.6.1.2.1.1.1.0',
  sysName: '1.3.6.1.2.1.1.5.0',
  sysLocation: '1.3.6.1.2.1.1.6.0',
  hrDeviceDescr: '1.3.6.1.2.1.25.3.2.1.3.1',
  serial: '1.3.6.1.2.1.43.5.1.1.17.1',
  // prtMarkerSuppliesDescription / MaxCapacity / Level, linha N (1..4).
  supplyDescr: (n) => '1.3.6.1.2.1.43.11.1.1.6.1.' + n,
  supplyMax: (n) => '1.3.6.1.2.1.43.11.1.1.8.1.' + n,
  supplyLevel: (n) => '1.3.6.1.2.1.43.11.1.1.9.1.' + n,
};

const SUPPLY_ROWS = [1, 2, 3, 4];

/** OIDs pedidos de uma vez ao aparelho. */
function defaultOids() {
  return [OID.sysDescr, OID.sysName, OID.sysLocation, OID.hrDeviceDescr, OID.serial,
    ...SUPPLY_ROWS.flatMap((n) => [OID.supplyDescr(n), OID.supplyMax(n), OID.supplyLevel(n)])];
}

/* ─── BER ─── */
function encLen(n) {
  if (n < 0x80) return Buffer.from([n]);
  if (n < 0x100) return Buffer.from([0x81, n]);
  return Buffer.from([0x82, (n >> 8) & 0xff, n & 0xff]);
}
const tlv = (tag, body) => Buffer.concat([Buffer.from([tag]), encLen(body.length), body]);

function encInt(n) {
  const bytes = [];
  let v = n;
  do { bytes.unshift(v & 0xff); v >>= 8; } while (v !== 0 && v !== -1);
  if (n >= 0 && bytes[0] & 0x80) bytes.unshift(0);
  if (n < 0 && !(bytes[0] & 0x80)) bytes.unshift(0xff);
  return tlv(0x02, Buffer.from(bytes));
}

function encOid(oid) {
  const p = oid.split('.').map(Number);
  const out = [40 * p[0] + p[1]];
  for (const n of p.slice(2)) {
    const chunk = [n & 0x7f];
    let v = Math.floor(n / 128);
    while (v > 0) { chunk.unshift((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

/** Mensagem GetRequest. version: 0 = v1, 1 = v2c. */
function encodeGet(oids, { community = 'public', version = 1, requestId = 1 } = {}) {
  const vbs = Buffer.concat(oids.map((o) => tlv(0x30, Buffer.concat([encOid(o), Buffer.from([0x05, 0x00])]))));
  const pdu = tlv(0xa0, Buffer.concat([encInt(requestId), encInt(0), encInt(0), tlv(0x30, vbs)]));
  return tlv(0x30, Buffer.concat([encInt(version), tlv(0x04, Buffer.from(community, 'utf8')), pdu]));
}

function readTlv(buf, o) {
  const tag = buf[o];
  let len = buf[o + 1];
  let h = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[o + 2 + i];
    h = 2 + n;
  }
  if (o + h + len > buf.length) throw new Error('SNMP: TLV truncado');
  return { tag, start: o + h, end: o + h + len, next: o + h + len };
}

function decInt(b) {
  if (!b.length) return 0;
  // Complemento de dois: começar em -1 propaga o sinal (0xFD → -3).
  let v = b[0] & 0x80 ? -1 : 0;
  for (const x of b) v = v * 256 + x;
  return v;
}
function decUint(b) { let v = 0; for (const x of b) v = v * 256 + x; return v; }

function decOid(b) {
  if (!b.length) return '';
  const p = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) { p.push(v); v = 0; }
  }
  return p.join('.');
}

function decValue(tag, b) {
  switch (tag) {
    case 0x02: return decInt(b);
    case 0x04: {
      // Textos às vezes vêm com \0 no fim; binário (MAC) vira hex.
      const s = b.toString('utf8').replace(/\0+$/, '');
      return /[\x00-\x08\x0e-\x1f]/.test(s) ? b.toString('hex') : s;
    }
    case 0x05: return null;
    case 0x06: return decOid(b);
    case 0x40: return [...b].join('.');
    case 0x41: case 0x42: case 0x43: case 0x46: return decUint(b);
    case 0x80: case 0x81: case 0x82: return undefined; // noSuchObject / noSuchInstance / endOfMibView
    default: return b.toString('hex');
  }
}

/** Resposta → { version, community, requestId, errorStatus, errorIndex, values: { oid: valor } }. */
function decodeResponse(buf) {
  const msg = readTlv(buf, 0);
  if (msg.tag !== 0x30) throw new Error('SNMP: não é uma mensagem');
  const ver = readTlv(buf, msg.start);
  const com = readTlv(buf, ver.next);
  const pdu = readTlv(buf, com.next);
  if (pdu.tag !== 0xa2) throw new Error('SNMP: não é GetResponse');
  const rid = readTlv(buf, pdu.start);
  const es = readTlv(buf, rid.next);
  const ei = readTlv(buf, es.next);
  const list = readTlv(buf, ei.next);
  const values = {};
  let o = list.start;
  while (o < list.end) {
    const vb = readTlv(buf, o);
    const oid = readTlv(buf, vb.start);
    const val = readTlv(buf, oid.next);
    const v = decValue(val.tag, buf.subarray(val.start, val.end));
    if (v !== undefined) values[decOid(buf.subarray(oid.start, oid.end))] = v;
    o = vb.next;
  }
  return {
    version: decInt(buf.subarray(ver.start, ver.end)),
    community: buf.subarray(com.start, com.end).toString('utf8'),
    requestId: decInt(buf.subarray(rid.start, rid.end)),
    errorStatus: decInt(buf.subarray(es.start, es.end)),
    errorIndex: decInt(buf.subarray(ei.start, ei.end)),
    values,
  };
}

/**
 * Valores → resumo. Nível de suprimento: -3 = "tem, mas não sabe quanto", -2 = desconhecido.
 * pct só quando dá para calcular.
 */
function summarize(values) {
  const supplies = [];
  for (const n of SUPPLY_ROWS) {
    const name = values[OID.supplyDescr(n)];
    if (!name) continue;
    const max = values[OID.supplyMax(n)];
    const level = values[OID.supplyLevel(n)];
    const pct = typeof max === 'number' && max > 0 && typeof level === 'number' && level >= 0 ? Math.round((level / max) * 100) : null;
    supplies.push({ name, level: typeof level === 'number' ? level : null, max: typeof max === 'number' ? max : null, pct, some: level === -3 });
  }
  return {
    sysDescr: values[OID.sysDescr] || '',
    sysName: values[OID.sysName] || '',
    location: values[OID.sysLocation] || '',
    model: values[OID.hrDeviceDescr] || '',
    serial: values[OID.serial] || '',
    supplies,
  };
}

module.exports = { encodeGet, decodeResponse, summarize, defaultOids, OID, encOid, decOid, tlv, encInt };

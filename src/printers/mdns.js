'use strict';
// mDNS/DNS-SD (Bonjour): pergunta quem anuncia serviços de impressão na rede local e lê as respostas.
// Puro: monta a pergunta e lê pacotes DNS. O UDP fica em electron/printers/net.js.

const SERVICES = ['_ipp._tcp.local', '_ipps._tcp.local', '_pdl-datastream._tcp.local', '_printer._tcp.local'];

const TYPE = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33 };

function encName(name) {
  const parts = name.split('.').filter(Boolean).map((l) => {
    const b = Buffer.from(l, 'utf8');
    return Buffer.concat([Buffer.from([b.length]), b]);
  });
  return Buffer.concat([...parts, Buffer.from([0])]);
}

/** Pergunta PTR para cada serviço (id 0, como manda o mDNS). */
function encodeQuery(services = SERVICES) {
  const head = Buffer.alloc(12);
  head.writeUInt16BE(services.length, 4);
  const qs = services.map((s) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(TYPE.PTR, 0);
    tail.writeUInt16BE(1, 2); // IN; resposta unicast porque a porta de origem não é a 5353 (RFC 6762 §6.7)
    return Buffer.concat([encName(s), tail]);
  });
  return Buffer.concat([head, ...qs]);
}

/** Lê um nome com ponteiros de compressão. Retorna [nome, próximo offset]. */
function readName(buf, offset) {
  const labels = [];
  let o = offset;
  let next = -1;
  for (let guard = 0; guard < 128; guard++) {
    if (o >= buf.length) throw new Error('DNS: nome truncado');
    const len = buf[o];
    if (len === 0) { o++; break; }
    if ((len & 0xc0) === 0xc0) {
      if (next < 0) next = o + 2;
      o = ((len & 0x3f) << 8) | buf[o + 1];
      continue;
    }
    labels.push(buf.subarray(o + 1, o + 1 + len).toString('utf8'));
    o += 1 + len;
  }
  return [labels.join('.'), next >= 0 ? next : o];
}

function readTxt(buf) {
  const txt = {};
  let o = 0;
  while (o < buf.length) {
    const len = buf[o];
    const s = buf.subarray(o + 1, o + 1 + len).toString('utf8');
    o += 1 + len;
    if (!s) continue;
    const i = s.indexOf('=');
    if (i < 0) txt[s.toLowerCase()] = true;
    else txt[s.slice(0, i).toLowerCase()] = s.slice(i + 1);
  }
  return txt;
}

/** Pacote → lista de registros { name, type, data }. */
function decodePacket(buf) {
  if (buf.length < 12) throw new Error('DNS: pacote curto');
  const qd = buf.readUInt16BE(4);
  const total = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let o = 12;
  for (let i = 0; i < qd; i++) { o = readName(buf, o)[1] + 4; }
  const records = [];
  for (let i = 0; i < total; i++) {
    const [name, after] = readName(buf, o);
    o = after;
    const type = buf.readUInt16BE(o);
    const len = buf.readUInt16BE(o + 8);
    const start = o + 10;
    const rdata = buf.subarray(start, start + len);
    let data = null;
    if (type === TYPE.PTR) data = readName(buf, start)[0];
    else if (type === TYPE.SRV) data = { priority: rdata.readUInt16BE(0), weight: rdata.readUInt16BE(2), port: rdata.readUInt16BE(4), target: readName(buf, start + 6)[0] };
    else if (type === TYPE.TXT) data = readTxt(rdata);
    else if (type === TYPE.A && len === 4) data = [...rdata].join('.');
    if (data != null) records.push({ name, type, data });
    o = start + len;
  }
  return records;
}

/**
 * Registros (de vários pacotes) → instâncias anunciadas:
 * [{ instance, service, host, port, ip, txt }]. Uma impressora aparece uma vez por serviço.
 */
function collect(records) {
  const lc = (s) => String(s).toLowerCase();
  const ptr = records.filter((r) => r.type === TYPE.PTR && SERVICES.includes(lc(r.name)));
  const srv = new Map(records.filter((r) => r.type === TYPE.SRV).map((r) => [lc(r.name), r.data]));
  const txt = new Map(records.filter((r) => r.type === TYPE.TXT).map((r) => [lc(r.name), r.data]));
  const a = new Map(records.filter((r) => r.type === TYPE.A).map((r) => [lc(r.name), r.data]));
  const seen = new Map();
  for (const p of ptr) {
    const key = lc(p.data);
    if (seen.has(key)) continue;
    const s = srv.get(key);
    const service = lc(p.name).replace(/\.local$/, '');
    const instance = p.data.slice(0, p.data.length - p.name.length - 1) || p.data;
    seen.set(key, {
      instance,
      service,
      host: s ? s.target : null,
      port: s ? s.port : null,
      ip: s ? a.get(lc(s.target)) || null : null,
      txt: txt.get(key) || {},
    });
  }
  return [...seen.values()];
}

/** TXT de impressora → { model, make, rp, adminUrl, pdl, uuid }. */
function printerFromTxt(txt = {}) {
  const model = txt.ty || txt.product?.replace(/^\((.*)\)$/, '$1') || txt.usb_mdl || '';
  return {
    model,
    make: txt.usb_mfg || '',
    rp: txt.rp || '',
    adminUrl: txt.adminurl || '',
    pdl: String(txt.pdl || '').split(',').filter(Boolean),
    uuid: txt.uuid || '',
    note: txt.note || '',
  };
}

module.exports = { encodeQuery, decodePacket, collect, printerFromTxt, readName, encName, SERVICES, TYPE };

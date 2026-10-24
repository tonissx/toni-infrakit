'use strict';
// Rede: portas de impressão (TCP), IPP (HTTP), SNMP (UDP 161), mDNS (UDP 5353) e DNS reverso.
// Só leitura: nenhuma destas chamadas muda nada no aparelho.
const net = require('node:net');
const http = require('node:http');
const dgram = require('node:dgram');
const dns = require('node:dns/promises');
const os = require('node:os');
const ipp = require('../../src/printers/ipp.js');
const snmp = require('../../src/printers/snmp.js');
const mdns = require('../../src/printers/mdns.js');

/** Portas de impressão: RAW/JetDirect, IPP e LPD. */
const PRINT_PORTS = [9100, 631, 515];

/** A porta TCP aceita conexão? */
function probePort(ip, port, timeout = 450) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port });
    let done = false;
    const end = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeout, () => end(false));
    s.once('connect', () => end(true));
    s.once('error', () => end(false));
  });
}

/** Executa fn em cada item com no máximo `limit` ao mesmo tempo. Para cedo se shouldStop() for true. */
async function pool(items, limit, fn, shouldStop = () => false) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !shouldStop()) {
      const idx = i++;
      await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** POST IPP → Buffer da resposta. */
function ippPost(ip, port, pathName, body, timeout = 2500) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: ip, port, path: pathName, method: 'POST', timeout,
      headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length } }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => { size += c.length; if (size > 2 * 1024 * 1024) req.destroy(new Error('resposta grande demais')); else chunks.push(c); });
      res.on('end', () => (res.statusCode === 200 ? resolve(Buffer.concat(chunks)) : reject(new Error('HTTP ' + res.statusCode))));
    });
    req.on('timeout', () => req.destroy(new Error('tempo esgotado')));
    req.on('error', reject);
    req.end(body);
  });
}

/** Pergunta à impressora seus atributos IPP, tentando os caminhos mais comuns. */
async function ippQuery(ip, { paths = [], port = 631 } = {}) {
  const tries = [...new Set([...paths.map((p) => (p.startsWith('/') ? p : '/' + p)), '/ipp/print', '/ipp', '/'])];
  for (const p of tries) {
    const uri = `ipp://${ip}:${port}${p}`;
    try {
      const buf = await ippPost(ip, port, p, ipp.encodeGetPrinterAttributes(uri, 1));
      const res = ipp.decodeResponse(buf);
      if (res.ok && Object.keys(res.printer).length) return { uri, summary: ipp.summarize(res.printer) };
    } catch { /* próximo caminho */ }
  }
  return null;
}

/** SNMP GET (v2c; se o aparelho não responder, tenta v1 só com o essencial). */
function snmpGetRaw(ip, oids, { community, version, timeout }) {
  return new Promise((resolve) => {
    const sock = dgram.createSocket('udp4');
    const requestId = Math.floor(Math.random() * 0x7fffffff);
    const timer = setTimeout(() => { sock.close(); resolve(null); }, timeout);
    sock.on('message', (msg) => {
      try {
        const r = snmp.decodeResponse(msg);
        if (r.requestId !== requestId) return;
        clearTimeout(timer);
        sock.close();
        resolve(r);
      } catch { /* pacote estranho: ignora */ }
    });
    sock.on('error', () => { clearTimeout(timer); try { sock.close(); } catch { /* já fechado */ } resolve(null); });
    sock.send(snmp.encodeGet(oids, { community, version, requestId }), 161, ip);
  });
}

async function snmpQuery(ip, { community = 'public', timeout = 1200 } = {}) {
  const v2 = await snmpGetRaw(ip, snmp.defaultOids(), { community, version: 1, timeout });
  if (v2 && v2.errorStatus === 0) return snmp.summarize(v2.values);
  const v1 = await snmpGetRaw(ip, [snmp.OID.sysDescr], { community, version: 0, timeout });
  if (v1 && v1.errorStatus === 0) return snmp.summarize(v1.values);
  return null;
}

async function reverseName(ip, timeout = 1200) {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
    return names[0] || null;
  } catch { return null; }
}

/** IPv4 das interfaces ativas (sem loopback nem link-local). */
function localIPv4() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address, netmask: a.netmask });
    }
  }
  return out;
}

/** Pergunta mDNS por `ms` milissegundos em cada interface. Retorna as instâncias anunciadas. */
async function mdnsBrowse(ms = 2500) {
  const records = [];
  const socks = [];
  const query = mdns.encodeQuery();
  for (const iface of localIPv4()) {
    await new Promise((resolve) => {
      const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      s.on('message', (msg) => { try { records.push(...mdns.decodePacket(msg)); } catch { /* ignora */ } });
      s.on('error', () => resolve());
      s.bind(0, iface.address, () => {
        try {
          s.setMulticastInterface(iface.address);
          s.setMulticastTTL(255);
          s.send(query, 5353, '224.0.0.251');
          setTimeout(() => { try { s.send(query, 5353, '224.0.0.251'); } catch { /* fechado */ } }, 700);
        } catch { /* interface sem multicast */ }
        socks.push(s);
        resolve();
      });
    });
  }
  await new Promise((r) => setTimeout(r, ms));
  for (const s of socks) { try { s.close(); } catch { /* já fechado */ } }
  return mdns.collect(records);
}

/**
 * Varre os IPs: portas de impressão e, nos que responderem, IPP + SNMP + nome.
 * onProgress({ phase, done, total, found }); shouldStop() interrompe entre um host e outro.
 */
async function scan(ips, { community, onProgress = () => {}, shouldStop = () => false, extraHosts = [] } = {}) {
  const hits = new Map();
  let done = 0;
  onProgress({ phase: 'ports', done, total: ips.length, found: 0 });
  await pool(ips, 96, async (ip) => {
    const open = [];
    await Promise.all(PRINT_PORTS.map(async (p) => { if (await probePort(ip, p)) open.push(p); }));
    if (open.length) hits.set(ip, { ip, ports: open.sort((a, b) => a - b) });
    done++;
    if (done % 8 === 0 || done === ips.length) onProgress({ phase: 'ports', done, total: ips.length, found: hits.size });
  }, shouldStop);

  // Aparelhos anunciados por mDNS fora da faixa também são consultados.
  for (const h of extraHosts) {
    if (!hits.has(h.ip)) hits.set(h.ip, { ip: h.ip, ports: h.port ? [h.port] : [], rp: h.rp });
    else if (h.rp) hits.get(h.ip).rp = h.rp;
  }

  const list = [...hits.values()];
  let enriched = 0;
  onProgress({ phase: 'details', done: 0, total: list.length, found: list.length });
  await pool(list, 16, async (h) => {
    const [ippRes, snmpRes, hostname] = await Promise.all([
      h.ports.includes(631) ? ippQuery(h.ip, { paths: h.rp ? [h.rp] : [] }) : null,
      snmpQuery(h.ip, { community }),
      reverseName(h.ip),
    ]);
    if (ippRes) { h.ipp = ippRes.summary; h.ippUri = ippRes.uri; }
    if (snmpRes) h.snmp = snmpRes;
    if (hostname) h.hostname = hostname;
    enriched++;
    onProgress({ phase: 'details', done: enriched, total: list.length, found: list.length });
  }, shouldStop);
  return list;
}

module.exports = { scan, mdnsBrowse, ippQuery, snmpQuery, probePort, localIPv4, PRINT_PORTS };

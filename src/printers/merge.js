'use strict';
// Junta o que cada fonte viu (filas do Windows, dispositivos PnP/USB, varredura de rede, mDNS) numa lista única de
// impressoras. Puro: recebe os dados já coletados e devolve os dispositivos que a tela mostra.
const { parseDeviceId, joinMakeModel, languages, vendorOf } = require('./model.js');
const { printerFromTxt } = require('./mdns.js');
const { supportsIppClassDriver } = require('./ipp.js');

const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Portas/filas que não são uma impressora física (PDF, XPS, OneNote, fax, arquivo). */
const VIRTUAL_PORT = /^(portprompt:|nul:|file:|xps|onenote|shrfax:|microsoft\.|ne\d\d:|lpt\d:?$|com\d:?$)/i;
const VIRTUAL_DRIVER = /print to pdf|xps document|onenote|fax|send to|pdf creator|pdf24|cutepdf|bullzip|nitro pdf|adobe pdf|foxit|microsoft software printer/i;

const IPV4 = /\b(\d{1,3}(?:\.\d{1,3}){3})\b/;

/** Status de fila do Get-Printer (texto) → { tone, label }. */
function queueStatus(q, win) {
  const s = String((q && q.Status) || '').toLowerCase();
  if (win && win.WorkOffline) return { tone: 'warn', label: 'offline' };
  if (!s || s === 'normal' || s === '0') return { tone: 'ok', label: 'pronta' };
  if (/error|paperjam|paperout|nottoner|tonerlow|dooropen|offline|useri?ntervention/i.test(s)) return { tone: 'error', label: s };
  return { tone: 'warn', label: s };
}

/** Problema do Gerenciador de Dispositivos (ConfigManagerErrorCode) → texto. */
function pnpProblem(code) {
  const c = Number(code || 0);
  if (!c) return null;
  if (c === 28) return 'sem driver instalado';
  if (c === 10) return 'não consegue iniciar';
  if (c === 22) return 'desativado';
  if (c === 24) return 'desconectado ou com problema';
  if (c === 1) return 'configuração incorreta';
  return 'problema no dispositivo (código ' + c + ')';
}

/** Filas instaladas, já com a porta e o status do Win32_Printer. */
function buildQueues(local) {
  const ports = new Map(arr(local.ports).map((p) => [String(p.Name).toLowerCase(), p]));
  const win = new Map(arr(local.win).map((w) => [String(w.Name).toLowerCase(), w]));
  return arr(local.printers).map((q) => {
    const port = ports.get(String(q.PortName || '').toLowerCase()) || null;
    const w = win.get(String(q.Name).toLowerCase()) || null;
    const host = (port && port.PrinterHostAddress) || ((IPV4.exec(String(q.PortName || '')) || [])[1]) || null;
    const virtual = VIRTUAL_PORT.test(String(q.PortName || '')) || VIRTUAL_DRIVER.test(String(q.DriverName || '')) || VIRTUAL_DRIVER.test(String(q.Name || ''));
    const portName = String(q.PortName || '');
    const connection = /^usb\d+/i.test(portName) ? 'usb' : /^wsd-/i.test(portName) ? 'wsd' : /^https?:\/\/|^ipps?:\/\//i.test(portName) ? 'ipp'
      : host ? 'tcp' : q.Type === 'Connection' || /^\\\\/.test(String(q.Name)) ? 'shared' : 'other';
    return {
      name: q.Name,
      driver: q.DriverName || '',
      port: portName,
      host,
      connection,
      shared: !!q.Shared,
      isDefault: !!(w && w.Default),
      offline: !!(w && w.WorkOffline),
      virtual,
      location: q.Location || '',
      status: queueStatus(q, w),
    };
  });
}

/** Dispositivo PnP (USB/WSD) → modelo legível e IDs de hardware. */
function pnpDevice(d) {
  const hwids = arr(d.HardwareID).map(String);
  const compat = arr(d.CompatibleID).map(String);
  const id = String(d.PNPDeviceID || '');
  const isUsbPrint = /^USBPRINT\\/i.test(id);
  const isWsd = /^(WSDPRINT|SWD\\DAFWSDPROVIDER|SWD\\WSDPRINT)/i.test(id) || hwids.some((h) => /^WSDPRINT\\/i.test(h));
  const isUsbRaw = /^USB\\/i.test(id) && compat.some((c) => /^USB\\Class_07/i.test(c));
  return { id, hwids, compat, isUsbPrint, isWsd, isUsbRaw, name: String(d.Name || ''), make: String(d.Manufacturer || ''), problem: pnpProblem(d.ConfigManagerErrorCode), code: Number(d.ConfigManagerErrorCode || 0) };
}

/** Nome "genérico" que o Windows dá antes de identificar o aparelho — não serve como modelo. */
const GENERIC_PNP = /^(usb printing support|suporte para impress[aã]o usb|dispositivo usb|usb device|unknown device|dispositivo desconhecido|impressora usb|usb printer)$/i;

/** Modelo a partir de um ID USBPRINT ("USBPRINT\HPLaserJet_P1102D8AE" → "HPLaserJet P1102"). Último recurso. */
function modelFromUsbPrintId(hwid) {
  const m = /^USBPRINT\\(.+?)([0-9A-F]{4})?$/i.exec(hwid);
  return m ? m[1].replace(/_/g, ' ') : '';
}

/**
 * Junta tudo. Retorna [{ id, kind, name, make, model, ip, hostname, ports, ipp, snmp, mdns, usb, queues, languages,
 * ippClass, sources, virtual }].
 * kind: 'network' (achada na rede), 'usb', 'wsd' ou 'queue' (só a fila, aparelho não encontrado agora).
 */
function mergeDevices({ local = {}, network = [], mdns = [] } = {}) {
  const queues = buildQueues(local);
  const usedQueues = new Set();
  const byIp = new Map();
  const devices = [];

  const netDevice = (ip) => {
    if (!byIp.has(ip)) {
      const d = { id: 'net:' + ip, kind: 'network', ip, hostname: null, ports: [], ipp: null, ippUri: null, snmp: null, mdns: [], usb: null, queues: [], sources: [] };
      byIp.set(ip, d);
      devices.push(d);
    }
    return byIp.get(ip);
  };

  for (const n of network) {
    const d = netDevice(n.ip);
    d.ports = [...new Set([...d.ports, ...arr(n.ports)])].sort((a, b) => a - b);
    if (n.hostname) d.hostname = n.hostname;
    if (n.ipp) { d.ipp = n.ipp; d.ippUri = n.ippUri || null; }
    if (n.snmp) d.snmp = n.snmp;
    if (!d.sources.includes('rede')) d.sources.push('rede');
  }
  for (const m of mdns) {
    if (!m.ip) continue;
    const d = netDevice(m.ip);
    d.mdns.push(m);
    if (m.port && !d.ports.includes(m.port)) d.ports = [...d.ports, m.port].sort((a, b) => a - b);
    if (!d.hostname && m.host) d.hostname = m.host.replace(/\.local\.?$/i, '.local');
    if (!d.sources.includes('bonjour')) d.sources.push('bonjour');
  }

  // Filas TCP/IP e IPP apontando para um IP: vão junto do aparelho daquele IP (ou criam um, se ele não respondeu).
  for (const q of queues) {
    if (q.virtual || !q.host || !/tcp|ipp/.test(q.connection)) continue;
    const d = byIp.get(q.host);
    if (d) { d.queues.push(q); usedQueues.add(q.name); }
  }

  // USB e WSD (PnP).
  const pnp = arr(local.pnp).map(pnpDevice);
  const hasUsbPrint = pnp.some((p) => p.isUsbPrint);
  for (const p of pnp) {
    if (/^SWD\\PRINTENUM\\/i.test(p.id)) continue; // filas, não aparelhos
    if (p.isUsbRaw && (p.code === 0 || hasUsbPrint)) continue; // "Suporte para impressão USB": o filho USBPRINT já representa o aparelho
    if (!p.isUsbPrint && !p.isWsd && !p.isUsbRaw) continue;
    const kind = p.isWsd ? 'wsd' : 'usb';
    const model = GENERIC_PNP.test(p.name) ? modelFromUsbPrintId(p.hwids[0] || p.id) : p.name;
    const d = { id: 'pnp:' + p.id, kind, ip: null, hostname: null, ports: [], ipp: null, ippUri: null, snmp: null, mdns: [], queues: [], sources: ['windows'],
      usb: { instanceId: p.id, hwids: p.hwids, compat: p.compat, problem: p.problem, code: p.code, pnpName: p.name, make: p.make }, pnpModel: model };
    // Fila do mesmo aparelho: USB → mesmo nome de modelo; WSD → porta WSD com o mesmo nome.
    for (const q of queues) {
      if (q.virtual || usedQueues.has(q.name)) continue;
      const sameName = model && (q.name.toLowerCase().startsWith(model.toLowerCase()) || q.driver.toLowerCase().includes(model.toLowerCase()));
      if ((kind === 'usb' && q.connection === 'usb' && sameName) || (kind === 'wsd' && q.connection === 'wsd' && sameName)) {
        d.queues.push(q);
        usedQueues.add(q.name);
      }
    }
    devices.push(d);
  }

  // Filas que sobraram (aparelho não respondeu agora, compartilhada de servidor, USB desconectada).
  for (const q of queues) {
    if (usedQueues.has(q.name)) continue;
    devices.push({ id: 'queue:' + q.name, kind: 'queue', ip: q.host || null, hostname: null, ports: [], ipp: null, ippUri: null, snmp: null, mdns: [], usb: null, queues: [q], sources: ['windows'], virtual: q.virtual });
  }

  for (const d of devices) describe(d);
  return devices.sort(order);
}

/** Preenche name/make/model/languages/ippClass a partir da melhor fonte disponível. */
function describe(d) {
  const mdnsInfo = d.mdns.map((m) => printerFromTxt(m.txt)).find((x) => x.model) || null;
  const ippId = d.ipp && d.ipp.deviceId ? parseDeviceId(d.ipp.deviceId) : null;
  const candidates = [
    ippId && ippId.mdl ? joinMakeModel(ippId.mfg, ippId.mdl) : '',
    d.ipp && d.ipp.makeModel,
    mdnsInfo && joinMakeModel(mdnsInfo.make, mdnsInfo.model),
    d.snmp && d.snmp.model,
    d.pnpModel,
    d.snmp && d.snmp.sysDescr && d.snmp.sysDescr.length < 80 ? d.snmp.sysDescr : '',
    d.queues[0] && d.queues[0].driver,
  ].filter((x) => x && String(x).trim());
  d.model = candidates[0] || '';
  d.make = (ippId && ippId.mfg) || (mdnsInfo && mdnsInfo.make) || (d.usb && d.usb.make && !/^\(|^microsoft$/i.test(d.usb.make) ? d.usb.make : '') || vendorOf(d.model) || '';
  d.name = (d.queues[0] && d.queues[0].name) || (d.mdns[0] && d.mdns[0].instance) || d.model || d.ip || 'Impressora';
  d.languages = languages({ cmd: ippId ? ippId.cmd || [] : [], formats: d.ipp ? d.ipp.formats : (mdnsInfo ? mdnsInfo.pdl : []) });
  d.ippClass = supportsIppClassDriver(d.ipp);
  d.installed = d.queues.length > 0;
  if (d.virtual === undefined) d.virtual = d.queues.length > 0 && d.queues.every((q) => q.virtual);
  d.state = deviceState(d);
  return d;
}

/** Situação resumida para a lista: { tone, label }. */
function deviceState(d) {
  if (d.usb && d.usb.problem) return { tone: d.usb.code === 28 ? 'warn' : 'error', label: d.usb.problem };
  const q = d.queues.find((x) => x.status.tone !== 'ok');
  if (q) return q.status;
  if (d.ipp && d.ipp.state === 'stopped') return { tone: 'error', label: 'parada' + (d.ipp.reasons[0] ? ': ' + d.ipp.reasons[0] : '') };
  if (d.kind === 'queue' && !d.virtual && d.queues[0] && d.queues[0].connection === 'usb') return { tone: 'neutral', label: 'instalada (aparelho não detectado)' };
  if (d.kind === 'queue') return { tone: 'neutral', label: 'instalada' };
  if (!d.installed) return { tone: 'info', label: 'disponível para instalar' };
  return { tone: 'ok', label: 'instalada' };
}

const KIND_ORDER = { network: 0, usb: 1, wsd: 2, queue: 3 };
function order(a, b) {
  if (!!a.virtual !== !!b.virtual) return a.virtual ? 1 : -1;
  if (a.installed !== b.installed) return a.installed ? 1 : -1; // disponíveis primeiro: é o que a pessoa veio fazer
  if (KIND_ORDER[a.kind] !== KIND_ORDER[b.kind]) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
  if (a.ip && b.ip) return ipNum(a.ip) - ipNum(b.ip);
  return String(a.name).localeCompare(String(b.name));
}
const ipNum = (ip) => ip.split('.').reduce((n, x) => n * 256 + Number(x), 0);

module.exports = { mergeDevices, buildQueues, pnpDevice, pnpProblem, modelFromUsbPrintId, describe };

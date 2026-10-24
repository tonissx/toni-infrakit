'use strict';
/**
 * Impressoras (processo principal): inventário local, varredura de rede, escolha de driver, instalação, página de
 * teste e histórico. As dependências de sistema (PowerShell, rede, repositório) são injetadas — os testes usam falsos.
 *
 * Arquivos em %APPDATA%/Toni Infra Kit:
 *  - printers.json: { v: 1, settings, network, mdns, lastScan, log }
 *  - printers-repo.json: índice do repositório de drivers (pode ser grande, por isso separado)
 */
const fs = require('node:fs/promises');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { mergeDevices } = require('../../src/printers/merge.js');
const { candidates, externalLinks } = require('../../src/printers/drivers.js');
const { expand, defaultRanges } = require('../../src/printers/ranges.js');
const ps = require('../../src/printers/ps.js');

const LOG_MAX = 300;
const DEFAULT_SETTINGS = { repoDirs: [], ranges: '', community: 'public' };

function createPrintersService({
  file,
  repoFile,
  platform = process.platform,
  run,          // (script) => Promise<json> — usuário atual
  runElevated,  // (script) => Promise<json | { cancelled: true }>
  net,          // { scan, mdnsBrowse, localIPv4 }
  repo,         // { indexRepo, stageDriver }
  broadcast = () => {},
  now = () => Date.now(),
}) {
  const supported = platform === 'win32';
  const queue = createQueue();
  let data = { v: 1, settings: { ...DEFAULT_SETTINGS }, network: [], mdns: [], lastScan: null, log: [] };
  let repoIndex = { entries: [], errors: [], scanned: 0, at: null };
  let local = null;           // último inventário do Windows
  let localError = null;
  let devices = [];
  let scanning = null;        // { phase, done, total, found, stop }
  let indexing = null;        // { done, total, stop }
  let busy = null;            // { action, target } — instalação/remoção em andamento
  let loaded = null;

  const load = () => loaded || (loaded = (async () => {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      data = { ...data, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }, log: Array.isArray(raw.log) ? raw.log : [] };
    } catch (e) { if (e.code !== 'ENOENT') console.error('[printers] estado ilegível, começando do zero:', e.message); }
    try { repoIndex = { ...repoIndex, ...JSON.parse(await fs.readFile(repoFile, 'utf8')) }; } catch { /* sem índice ainda */ }
    recompute();
  })());

  const persist = () => queue.run('state', () => atomicWrite(file, JSON.stringify(data)));
  const persistRepo = () => queue.run('repo', () => atomicWrite(repoFile, JSON.stringify(repoIndex)));

  function recompute() {
    devices = mergeDevices({ local: local || {}, network: data.network, mdns: data.mdns });
  }

  function snapshot() {
    return {
      supported,
      settings: data.settings,
      devices,
      local: local ? { isAdmin: !!local.isAdmin, os: local.os || null, computer: local.computer || '', drivers: (local.drivers || []).length } : null,
      localError,
      scanning: scanning && { phase: scanning.phase, done: scanning.done, total: scanning.total, found: scanning.found },
      lastScan: data.lastScan,
      repo: {
        dirs: data.settings.repoDirs,
        infs: repoIndex.entries.length,
        models: repoIndex.entries.reduce((n, e) => n + e.models.length, 0),
        scanned: repoIndex.scanned,
        errors: repoIndex.errors,
        at: repoIndex.at,
        indexing: indexing && { done: indexing.done, total: indexing.total },
      },
      busy,
      defaultRanges: supported ? defaultRanges(net.localIPv4()).join(', ') : '',
    };
  }
  const changed = () => broadcast(snapshot());

  function addLog(entry) {
    data.log = [{ id: now().toString(36) + Math.random().toString(36).slice(2, 6), at: now(), ...entry }, ...data.log].slice(0, LOG_MAX);
    persist();
  }

  const findDevice = (id) => {
    const d = devices.find((x) => x.id === id);
    if (!d) throw new Error('A impressora não está mais na lista. Atualize e tente de novo.');
    return d;
  };
  const ensureSupported = () => { if (!supported) throw new Error('Impressoras: disponível só no Windows'); };
  const queueNames = () => new Set(((local && local.printers) || []).map((p) => String(p.Name).toLowerCase()));
  const arr = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

  /** Inventário do Windows (filas, portas, drivers, PnP). */
  async function refreshLocal() {
    await load();
    if (!supported) return snapshot();
    try {
      const inv = await run(ps.inventoryScript());
      local = { ...inv, printers: arr(inv.printers), ports: arr(inv.ports), drivers: arr(inv.drivers), win: arr(inv.win), pnp: arr(inv.pnp) };
      localError = null;
    } catch (e) {
      localError = e.message;
    }
    recompute();
    changed();
    return snapshot();
  }

  /** Varredura de rede + mDNS. ranges vazio = a /24 de cada interface. */
  async function scan({ ranges } = {}) {
    await load();
    ensureSupported();
    if (scanning) return snapshot();
    const text = String(ranges ?? data.settings.ranges ?? '').trim() || defaultRanges(net.localIPv4()).join(', ');
    if (!text) throw new Error('Nenhuma rede local encontrada. Informe uma faixa de IPs (ex.: 192.168.0.0/24).');
    const ips = expand(text);
    if (ranges !== undefined && String(ranges).trim() !== data.settings.ranges) { data.settings = { ...data.settings, ranges: String(ranges).trim() }; }
    const state = { phase: 'ports', done: 0, total: ips.length, found: 0, stopped: false };
    scanning = state;
    changed();
    const started = now();
    let lastEmit = 0;
    try {
      const [found] = await Promise.all([
        (async () => {
          const mdnsList = await net.mdnsBrowse(2500).catch(() => []);
          data.mdns = mdnsList;
          return null;
        })().then(() => net.scan(ips, {
          community: data.settings.community,
          extraHosts: data.mdns.filter((m) => m.ip && !ips.includes(m.ip)).map((m) => ({ ip: m.ip, port: m.port, rp: m.txt && m.txt.rp })),
          shouldStop: () => state.stopped,
          onProgress: (p) => {
            Object.assign(state, p);
            if (now() - lastEmit > 150 || p.done === p.total) { lastEmit = now(); changed(); }
          },
        })),
        refreshLocal(),
      ]);
      if (!state.stopped) {
        data.network = found;
        data.lastScan = { at: now(), ranges: text, hosts: ips.length, found: found.length, ms: now() - started };
        addLog({ action: 'scan', target: text, ok: true, detail: `${found.length} aparelho(s) com porta de impressão em ${ips.length} endereço(s)` });
      }
    } finally {
      scanning = null;
      recompute();
      await persist();
      changed();
    }
    return snapshot();
  }

  function cancelScan() { if (scanning) scanning.stopped = true; }

  /** Drivers possíveis + links externos + nome sugerido para a fila. */
  async function driverOptions(deviceId) {
    await load();
    const d = findDevice(deviceId);
    const list = candidates(d, { installed: (local && local.drivers) || [], repo: repoIndex.entries });
    const names = queueNames();
    let base = (d.model || d.name || 'Impressora').replace(/[\\/,!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    let suggested = base;
    for (let i = 2; names.has(suggested.toLowerCase()); i++) suggested = `${base} (${i})`;
    const connection = d.kind === 'usb' ? 'usb' : d.kind === 'wsd' ? 'wsd' : d.ip ? 'tcp' : null;
    return { candidates: list, links: externalLinks(d), suggestedName: suggested, connection, canRaw: d.ports.includes(9100), canLpr: d.ports.includes(515) };
  }

  /**
   * Instala. req: { deviceId, key (candidato), queue, location, setDefault }.
   * O plano é montado aqui a partir do estado do processo principal — o renderer só escolhe entre as opções.
   */
  async function install(req) {
    await load();
    ensureSupported();
    if (busy) throw new Error('Já existe uma instalação em andamento');
    const d = findDevice(req.deviceId);
    const opts = await driverOptions(d.id);
    const c = opts.candidates.find((x) => x.key === req.key);
    if (!c) throw new Error('Esse driver não está mais disponível. Atualize a lista.');
    const queueName = String(req.queue || '').trim();
    if (!queueName || /[\\,!]/.test(queueName) || queueName.length > 200) throw new Error('Nome de fila inválido (não use \\ , !)');
    if (queueNames().has(queueName.toLowerCase())) throw new Error(`Já existe uma fila chamada "${queueName}"`);
    if (!opts.connection) throw new Error('Não sei como conectar nesse aparelho');
    if (opts.connection === 'tcp' && c.method !== 'ipp' && !opts.canRaw && !opts.canLpr) throw new Error('O aparelho não respondeu nas portas 9100 (RAW) nem 515 (LPR)');

    const target = `${queueName} (${c.driver})`;
    busy = { action: 'install', target: queueName, step: c.source === 'repo' ? 'Copiando o driver do repositório…' : 'Aguardando permissão de administrador…' };
    changed();
    try {
      let inf = null;
      if (c.source === 'repo') {
        inf = await repo.stageDriver(c.inf);
        busy = { ...busy, step: 'Aguardando permissão de administrador…' };
        changed();
      }
      const plan = {
        queue: queueName, method: c.method, driver: c.driver, source: c.source, inf,
        connection: opts.connection, ip: d.ip, port: opts.canRaw ? 'raw' : 'lpr', ippUri: d.ippUri,
        location: String(req.location || '').trim(),
      };
      const res = await runElevated(ps.installScript(plan));
      if (res.cancelled) {
        addLog({ action: 'install', target, ok: false, detail: 'Cancelado na permissão de administrador', cancelled: true });
        return { ok: false, cancelled: true };
      }
      let defaultResult = null;
      if (res.ok && req.setDefault) defaultResult = await run(ps.setDefaultScript(queueName)).catch((e) => ({ ok: false, error: e.message }));
      addLog({ action: 'install', target, ok: !!res.ok, detail: res.ok ? (res.reboot ? 'Instalada; o Windows pede reinício para concluir o driver' : 'Instalada') : res.error, steps: res.steps || [], device: { model: d.model, ip: d.ip, kind: d.kind } });
      return { ...res, queue: res.ok ? queueName : null, defaultResult };
    } finally {
      busy = null;
      await refreshLocal();
    }
  }

  /** Página de teste e acompanhamento do trabalho na fila. */
  async function testPage(queueName) {
    await load();
    ensureSupported();
    if (busy) throw new Error('Aguarde a tarefa em andamento');
    busy = { action: 'test', target: queueName, step: 'Enviando a página de teste…' };
    changed();
    try {
      const r = await run(ps.testPageScript(queueName), { timeout: 60_000 });
      const detail = r.error ? r.error
        : r.ok ? `Página enviada e saiu da fila em ${r.seconds}s`
        : r.sent && !r.cleared ? `Página enviada, mas continua na fila após ${r.seconds}s (${(r.jobs[0] && r.jobs[0].status) || 'aguardando'})`
        : 'A página não foi enviada';
      addLog({ action: 'test', target: queueName, ok: !!r.ok, detail, result: r });
      return { ...r, detail };
    } finally {
      busy = null;
      await refreshLocal();
    }
  }

  async function remove(queueName) {
    await load();
    ensureSupported();
    if (busy) throw new Error('Aguarde a tarefa em andamento');
    busy = { action: 'remove', target: queueName, step: 'Aguardando permissão de administrador…' };
    changed();
    try {
      const r = await runElevated(ps.removeScript(queueName));
      if (r.cancelled) return { ok: false, cancelled: true };
      addLog({ action: 'remove', target: queueName, ok: !!r.ok, detail: r.ok ? 'Fila removida' : r.error, steps: r.steps || [] });
      return r;
    } finally {
      busy = null;
      await refreshLocal();
    }
  }

  async function setDefault(queueName) {
    ensureSupported();
    const r = await run(ps.setDefaultScript(queueName));
    addLog({ action: 'default', target: queueName, ok: !!r.ok, detail: r.ok ? 'Definida como padrão' : r.error });
    await refreshLocal();
    return r;
  }

  async function openQueue(queueName) {
    ensureSupported();
    return run(ps.openQueueScript(queueName));
  }

  async function setSettings(patch = {}) {
    await load();
    const next = { ...data.settings };
    if (Array.isArray(patch.repoDirs)) next.repoDirs = [...new Set(patch.repoDirs.map((x) => String(x).trim()).filter(Boolean))];
    if (typeof patch.ranges === 'string') {
      if (patch.ranges.trim()) expand(patch.ranges); // valida antes de gravar
      next.ranges = patch.ranges.trim();
    }
    if (typeof patch.community === 'string') next.community = patch.community.trim() || 'public';
    const dirsChanged = JSON.stringify(next.repoDirs) !== JSON.stringify(data.settings.repoDirs);
    data.settings = next;
    await persist();
    changed();
    if (dirsChanged) reindex().catch(() => {});
    return snapshot();
  }

  /** Relê o repositório de drivers. */
  async function reindex() {
    await load();
    if (indexing) return snapshot();
    const state = { done: 0, total: 0, stopped: false };
    indexing = state;
    changed();
    try {
      const res = await repo.indexRepo(data.settings.repoDirs, {
        onProgress: (p) => { Object.assign(state, p); changed(); },
        shouldStop: () => state.stopped,
      });
      repoIndex = res;
      await persistRepo();
    } finally {
      indexing = null;
      changed();
    }
    return snapshot();
  }

  async function getLog() { await load(); return data.log; }
  async function clearLog() { await load(); data.log = []; await persist(); return []; }

  async function get() { await load(); return snapshot(); }

  return {
    get, refreshLocal, scan, cancelScan, driverOptions, install, testPage, remove, setDefault, openQueue,
    setSettings, reindex, getLog, clearLog,
    flush: () => queue.flush(),
  };
}

module.exports = { createPrintersService };

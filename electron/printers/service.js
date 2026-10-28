'use strict';
/**
 * Impressoras (processo principal): inventário local, varredura de rede, escolha de driver, instalação, página de
 * teste e histórico. As dependências de sistema (PowerShell, rede, repositório) são injetadas — os testes usam falsos.
 *
 * Arquivos em %APPDATA%/Toni Infrakit:
 *  - printers.json: { v: 1, settings, network, mdns, lastScan, log }
 *  - printers-repo.json: índice do repositório de drivers (pode ser grande, por isso separado)
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, createQueue } = require('../lib/fsx');
const { mergeDevices } = require('../../src/printers/merge.js');
const { candidates, externalLinks } = require('../../src/printers/drivers.js');
const { expand, defaultRanges } = require('../../src/printers/ranges.js');
const ps = require('../../src/printers/ps.js');
const { normalizeProfile, parseImport, forModel, sameModel } = require('../../src/printers/profiles.js');

const LOG_MAX = 300;
const DEFAULT_SETTINGS = { repoDirs: [], ranges: '', community: 'public' };

const COMPUTER_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
const REMOTE_MAX = 50;      // computadores por vez
const REMOTE_PARALLEL = 4;  // instalações simultâneas
const REMOTE_DIR = 'C:\\ProgramData\\Toni Infrakit\\drivers'; // onde o driver é copiado no computador remoto (apagado no fim)

/** Erro do PowerShell Remoting em palavras que o suporte entende. */
function friendlyRemoteError(msg) {
  const m = String(msg || '');
  if (/access is denied|acesso negado/i.test(m)) return 'Acesso negado: seu usuário não é administrador nesse computador';
  if (/no such host|could not be resolved|cannot be resolved|não foi possível resolver|nome.*não.*encontrad/i.test(m)) return 'Nome não encontrado na rede';
  if (/winrm|ws-management|wsman|cannot connect|não pode se conectar|não foi possível conectar/i.test(m)) return 'Sem resposta do WinRM (computador desligado, firewall ou WinRM desativado)';
  return m.split(/\r?\n/)[0].trim().slice(0, 240) || 'Falhou sem mensagem';
}

function cleanComputers(list) {
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const n = String(raw || '').trim();
    if (!COMPUTER_RE.test(n)) throw new Error(`Nome de computador inválido: "${n}"`);
    if (!out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  }
  if (!out.length) throw new Error('Escolha ao menos um computador');
  if (out.length > REMOTE_MAX) throw new Error(`No máximo ${REMOTE_MAX} computadores por vez`);
  return out;
}

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
  let data = { v: 1, settings: { ...DEFAULT_SETTINGS }, network: [], mdns: [], lastScan: null, log: [], profiles: [] };
  let repoIndex = { entries: [], errors: [], scanned: 0, at: null };
  let local = null;           // último inventário do Windows
  let localError = null;
  let devices = [];
  let scanning = null;        // { phase, done, total, found, stop }
  let indexing = null;        // { done, total, stop }
  let busy = null;            // { action, target } — instalação/remoção em andamento
  let loaded = null;
  let remoteRun = null;       // instalação em vários computadores: { id, queue, items, cancel, done }

  const load = () => loaded || (loaded = (async () => {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8'));
      data = { ...data, ...raw, settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }, log: Array.isArray(raw.log) ? raw.log : [], profiles: Array.isArray(raw.profiles) ? raw.profiles : [] };
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
      remote: remoteRun && { id: remoteRun.id, queue: remoteRun.queue, device: remoteRun.device, done: remoteRun.done, cancelled: remoteRun.cancel, items: remoteRun.items },
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
    let list = candidates(d, { installed: (local && local.drivers) || [], repo: repoIndex.entries });
    // Perfis deste modelo (o último usado primeiro). O driver do primeiro, se estiver entre as opções, sobe para o topo.
    const profiles = forModel(data.profiles, d.model || d.name);
    const suggestedProfile = profiles[0] || null;
    const wanted = suggestedProfile && suggestedProfile.driver.name && suggestedProfile.driver.name.toLowerCase();
    const hit = wanted && list.find((c) => String(c.driver).toLowerCase() === wanted);
    if (hit) list = [{ ...hit, score: 1, recommended: true, matchedBy: 'profile' }, ...list.filter((c) => c !== hit)];
    const names = queueNames();
    let base = (d.model || d.name || 'Impressora').replace(/[\\/,!]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
    let suggested = base;
    for (let i = 2; names.has(suggested.toLowerCase()); i++) suggested = `${base} (${i})`;
    const connection = d.kind === 'usb' ? 'usb' : d.kind === 'wsd' ? 'wsd' : d.ip ? 'tcp' : null;
    return { profiles, suggestedProfileId: suggestedProfile && suggestedProfile.id, candidates: list,
      model: d.model || d.name, links: externalLinks(d), suggestedName: suggested, connection, canRaw: d.ports.includes(9100), canLpr: d.ports.includes(515) };
  }

  /** Valida a escolha (aparelho, driver, nome da fila). remote: instala em outros computadores, então só TCP/IP e IPP. */
  async function prepare(req, { remote = false } = {}) {
    const d = findDevice(req.deviceId);
    const opts = await driverOptions(d.id);
    const c = opts.candidates.find((x) => x.key === req.key);
    if (!c) throw new Error('Esse driver não está mais disponível. Atualize a lista.');
    const queueName = String(req.queue || '').trim();
    if (!queueName || /[\\,!]/.test(queueName) || queueName.length > 200) throw new Error('Nome de fila inválido (não use \\ , !)');
    if (!remote && queueNames().has(queueName.toLowerCase())) throw new Error(`Já existe uma fila chamada "${queueName}"`);
    if (!opts.connection) throw new Error('Não sei como conectar nesse aparelho');
    if (remote && opts.connection !== 'tcp') throw new Error('Instalar em outros computadores só funciona para impressoras de rede (TCP/IP ou IPP). USB e WSD precisam ser instalados no próprio computador.');
    if (opts.connection === 'tcp' && c.method !== 'ipp' && !opts.canRaw && !opts.canLpr) throw new Error('O aparelho não respondeu nas portas 9100 (RAW) nem 515 (LPR)');
    return { d, opts, c, queueName };
  }

  /**
   * Instala. req: { deviceId, key (candidato), queue, location, setDefault, profileId? }.
   * O plano é montado aqui a partir do estado do processo principal — o renderer só escolhe entre as opções.
   */
  async function install(req) {
    await load();
    ensureSupported();
    if (busy) throw new Error('Já existe uma instalação em andamento');
    const { d, opts, c, queueName } = await prepare(req);

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
        prefs: (data.profiles.find((x) => x.id === req.profileId) || {}).prefs,
      };
      const res = await runElevated(ps.installScript(plan));
      if (res.cancelled) {
        addLog({ action: 'install', target, ok: false, detail: 'Cancelado na permissão de administrador', cancelled: true });
        return { ok: false, cancelled: true };
      }
      const used = data.profiles.find((x) => x.id === req.profileId);
      if (used && res.ok) { used.usedAt = now(); persist(); }
      let defaultResult = null;
      if (res.ok && req.setDefault) defaultResult = await run(ps.setDefaultScript(queueName)).catch((e) => ({ ok: false, error: e.message }));
      addLog({ action: 'install', target, ok: !!res.ok, detail: res.ok ? (res.reboot ? 'Instalada; o Windows pede reinício para concluir o driver' : 'Instalada') : res.error, steps: res.steps || [], device: { model: d.model, ip: d.ip, kind: d.kind } });
      return { ...res, queue: res.ok ? queueName : null, defaultResult };
    } finally {
      busy = null;
      await refreshLocal();
    }
  }

  /** Computadores do domínio (Active Directory). */
  async function listComputers() {
    ensureSupported();
    const r = await run(ps.adComputersScript(), { timeout: 60_000 });
    return { ok: !!r.ok, computers: arr(r.computers), error: r.error || null };
  }

  /** Confere cada computador (WinRM, 64 bits, fila/driver já existentes). req: { computers, deviceId?, key?, queue? }. */
  async function preflight(req = {}) {
    await load();
    ensureSupported();
    const computers = cleanComputers(req.computers);
    let driver = '';
    if (req.deviceId && req.key) {
      const c = (await driverOptions(req.deviceId)).candidates.find((x) => x.key === req.key);
      driver = c && c.method !== 'ipp' ? c.driver : '';
    }
    const res = arr(await run(ps.preflightScript(computers, { queue: String(req.queue || '').trim(), driver }), { timeout: 150_000 }));
    return res.map((x) => ({ ...x, error: x.ok ? null : friendlyRemoteError(x.error) }));
  }

  /**
   * Instala a mesma fila em vários computadores, até REMOTE_PARALLEL por vez, com o usuário atual (PowerShell Remoting).
   * O andamento chega pelo snapshot (remote.items); aqui só volta no fim. req: { computers, deviceId, key, queue, location, profileId }.
   */
  async function remoteInstall(req) {
    await load();
    ensureSupported();
    if (remoteRun && !remoteRun.done) throw new Error('Já existe uma instalação em vários computadores em andamento');
    const computers = cleanComputers(req.computers);
    const { d, opts, c, queueName } = await prepare(req, { remote: true });
    const prof = data.profiles.find((x) => x.id === req.profileId);
    const state = remoteRun = { id: now().toString(36), queue: queueName, device: d.model || d.name, done: false, cancel: false,
      items: computers.map((computer) => ({ computer, state: 'wait', detail: '', steps: [] })) };
    changed();
    try {
      let remote = {};
      let inf = null;
      if (c.source === 'repo') {
        const local = await repo.stageDriver(c.inf);
        const srcDir = path.win32.dirname(local);
        remote = { srcDir, dir: `${REMOTE_DIR}\\${path.win32.basename(srcDir)}` };
        inf = `${remote.dir}\\${path.win32.basename(local)}`;
      }
      const plan = {
        queue: queueName, method: c.method, driver: c.driver, source: c.source, inf,
        connection: 'tcp', ip: d.ip, port: opts.canRaw ? 'raw' : 'lpr', ippUri: d.ippUri,
        location: String(req.location || '').trim(), prefs: prof && prof.prefs,
      };
      let next = 0;
      const worker = async () => {
        while (next < state.items.length) {
          const item = state.items[next++];
          if (state.cancel) { item.state = 'skipped'; item.detail = 'Cancelado antes de começar'; changed(); continue; }
          item.state = 'running';
          changed();
          let res;
          try { res = await run(ps.remoteInstallScript(item.computer, plan, remote), { timeout: 10 * 60_000 }); }
          catch (e) { res = { ok: false, error: e.message, steps: [] }; }
          item.steps = arr(res.steps);
          item.ok = !!res.ok;
          item.state = res.ok ? 'ok' : 'fail';
          item.detail = res.ok ? (res.reboot ? 'Instalada; o Windows pede reinício para concluir o driver' : 'Instalada') : friendlyRemoteError(res.error);
          addLog({ action: 'remote-install', target: `${queueName} em ${item.computer}`, ok: item.ok, detail: item.detail, steps: item.steps, device: { model: d.model, ip: d.ip, kind: d.kind } });
          changed();
        }
      };
      await Promise.all(Array.from({ length: Math.min(REMOTE_PARALLEL, state.items.length) }, worker));
      if (prof && state.items.some((i) => i.ok)) prof.usedAt = now();
      await persist();
      return { ok: state.items.every((i) => i.ok), items: state.items };
    } finally {
      for (const i of state.items) if (i.state === 'wait' || i.state === 'running') { i.state = 'fail'; i.detail = i.detail || 'Interrompida'; }
      state.done = true;
      changed();
    }
  }

  function cancelRemote() { if (remoteRun && !remoteRun.done) remoteRun.cancel = true; }
  function clearRemote() { if (remoteRun && remoteRun.done) { remoteRun = null; changed(); } }

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

  /** Nomes de driver que o campo de busca do perfil pode oferecer: instalados + modelos do repositório da equipe. */
  async function driverNames() {
    await load();
    const names = new Set(((local && local.drivers) || []).map((x) => String(x.Name)));
    for (const e of repoIndex.entries) for (const m of e.models) names.add(String(m.name));
    return [...names].sort((a, b) => a.localeCompare(b));
  }

  async function listProfiles() { await load(); return data.profiles; }

  async function saveProfile(p) {
    await load();
    const prof = normalizeProfile(p);
    const i = data.profiles.findIndex((x) => x.id === prof.id);
    if (data.profiles.some((x) => x.id !== prof.id && x.name.toLowerCase() === prof.name.toLowerCase() && sameModel(x.model, prof.model))) throw new Error(`Já existe um perfil "${prof.name}" para esse modelo`);
    if (i >= 0) data.profiles[i] = prof; else data.profiles.push(prof);
    await persist();
    return data.profiles;
  }

  async function deleteProfile(id) {
    await load();
    data.profiles = data.profiles.filter((x) => x.id !== id);
    await persist();
    return data.profiles;
  }

  async function exportProfiles() { await load(); return JSON.stringify({ app: 'toni-infrakit', profiles: data.profiles }, null, 2); }

  /** Importa perfis de um JSON; nome repetido ganha sufixo para não perder nenhum dos dois. */
  async function importProfiles(text) {
    await load();
    for (const p of parseImport(text)) {
      let name = p.name;
      for (let n = 2; data.profiles.some((x) => x.name.toLowerCase() === name.toLowerCase() && sameModel(x.model, p.model)); n++) name = `${p.name} (${n})`;
      data.profiles.push({ ...p, name });
    }
    await persist();
    return data.profiles;
  }

  /** Papéis e bandejas que a fila suporta (para a UI oferecer só opções válidas). */
  async function capabilities(queueName) {
    ensureSupported();
    return run(ps.capabilitiesScript(queueName));
  }

  /** Aplica as preferências de um perfil a uma fila já instalada (padrão da fila; pede administrador). */
  async function applyProfile(queueName, profileId) {
    await load();
    ensureSupported();
    if (busy) throw new Error('Aguarde a tarefa em andamento');
    const prof = data.profiles.find((x) => x.id === profileId);
    if (!prof) throw new Error('Perfil não encontrado');
    if (!queueNames().has(String(queueName).toLowerCase())) throw new Error('A fila não está mais na lista. Atualize e tente de novo.');
    if (!Object.keys(prof.prefs).length) throw new Error('Esse perfil não tem preferências de impressão');
    busy = { action: 'profile', target: queueName, step: 'Aguardando permissão de administrador…' };
    changed();
    try {
      const r = await runElevated(ps.applyPrefsScript(queueName, prof.prefs));
      if (r.cancelled) return { ok: false, cancelled: true };
      if (r.ok) { prof.usedAt = now(); persist(); }
      const failed = (r.steps || []).filter((s) => !s.ok).length;
      addLog({ action: 'profile', target: `${queueName} (${prof.name})`, ok: !!r.ok && !failed, detail: r.ok ? (failed ? `Aplicado com ${failed} item(ns) não suportado(s)` : 'Preferências aplicadas') : r.error, steps: r.steps || [] });
      return r;
    } finally {
      busy = null;
      changed();
    }
  }

  async function getLog() { await load(); return data.log; }
  async function clearLog() { await load(); data.log = []; await persist(); return []; }

  async function get() { await load(); return snapshot(); }

  return {
    get, refreshLocal, scan, cancelScan, driverOptions, install, testPage, remove, setDefault, openQueue,
    setSettings, reindex, getLog, clearLog,
    listComputers, preflight, remoteInstall, cancelRemote, clearRemote,
    driverNames, listProfiles, saveProfile, deleteProfile, exportProfiles, importProfiles, capabilities, applyProfile,
    flush: () => queue.flush(),
  };
}

module.exports = { createPrintersService };

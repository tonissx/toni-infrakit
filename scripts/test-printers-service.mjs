// Testes do serviço de impressoras (com PowerShell, rede e repositório falsos): node --test scripts/test-printers-service.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { createPrintersService } = require('../electron/printers/service.js');

const INVENTORY = {
  printers: [{ Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:' }],
  ports: [], drivers: [{ Name: 'Microsoft IPP Class Driver' }], win: [], pnp: [], isAdmin: false, computer: 'PC-01',
};

async function setup({ elevated = async () => ({ ok: true, steps: [{ label: 'x', ok: true }] }), runExtra = null } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ik-test-'));
  const calls = { run: [], elevated: [], staged: [] };
  let inventory = structuredClone(INVENTORY);
  const svc = createPrintersService({
    file: path.join(dir, 'printers.json'),
    repoFile: path.join(dir, 'printers-repo.json'),
    platform: 'win32',
    run: async (script) => {
      calls.run.push(script);
      if (runExtra) { const r = await runExtra(script); if (r !== undefined) return r; }
      if (script.includes('Get-PrinterPort')) return inventory;
      if (script.includes('PrintTestPage')) return { ok: true, sent: true, cleared: true, jobs: [], seconds: 2.4 };
      if (script.includes('SetDefaultPrinter')) return { ok: true };
      return {};
    },
    runElevated: async (script) => { calls.elevated.push(script); return elevated(script); },
    net: {
      localIPv4: () => [{ address: '10.0.0.10', netmask: '255.255.255.0' }],
      mdnsBrowse: async () => [],
      scan: async (ips, { onProgress }) => {
        onProgress({ phase: 'ports', done: ips.length, total: ips.length, found: 1 });
        return [{ ip: '10.0.0.25', ports: [631, 9100], ipp: { makeModel: 'HP LaserJet Pro M404dn', formats: ['image/pwg-raster'], versions: ['2.0'], supplies: [], reasons: [], state: 'idle', deviceId: '' }, ippUri: 'ipp://10.0.0.25:631/ipp/print' }];
      },
    },
    repo: {
      indexRepo: async () => ({ entries: [{ inf: '\\\\srv\\d\\hp.inf', provider: 'HP', driverVer: '1', models: [{ name: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', hwids: [] }] }], errors: [], scanned: 1, at: 1 }),
      stageDriver: async (inf) => { calls.staged.push(inf); return 'C:\\Temp\\stage\\hp.inf'; },
    },
  });
  return { svc, calls, dir, setInventory: (x) => { inventory = x; } };
}

test('scan usa a /24 da interface, junta com o inventário e registra no histórico', async () => {
  const { svc } = await setup();
  const s = await svc.scan();
  assert.equal(s.lastScan.ranges, '10.0.0.0/24');
  assert.equal(s.lastScan.hosts, 254);
  const hp = s.devices.find((d) => d.ip === '10.0.0.25');
  assert.ok(hp && !hp.installed);
  const log = await svc.getLog();
  assert.equal(log[0].action, 'scan');
});

test('opções de driver: repositório + IPP; nome sugerido único', async () => {
  const { svc } = await setup();
  await svc.setSettings({ repoDirs: ['\\\\srv\\d'] });
  await svc.reindex();
  await svc.scan();
  const o = await svc.driverOptions('net:10.0.0.25');
  assert.equal(o.connection, 'tcp');
  assert.ok(o.canRaw);
  assert.equal(o.candidates[0].source, 'repo');
  assert.ok(o.candidates.some((c) => c.method === 'ipp'));
  assert.equal(o.suggestedName, 'HP LaserJet Pro M404dn');
});

test('instalar copia o driver, roda elevado e registra os passos', async () => {
  const { svc, calls } = await setup();
  await svc.setSettings({ repoDirs: ['\\\\srv\\d'] });
  await svc.reindex();
  await svc.scan();
  const o = await svc.driverOptions('net:10.0.0.25');
  const r = await svc.install({ deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'Financeiro', setDefault: true });
  assert.ok(r.ok);
  assert.equal(r.queue, 'Financeiro');
  assert.deepEqual(calls.staged, ['\\\\srv\\d\\hp.inf']);
  assert.match(calls.elevated[0], /C:\\Temp\\stage\\hp\.inf/); // instala da cópia local, nunca do caminho de rede
  assert.ok(calls.run.some((s) => s.includes('SetDefaultPrinter')));
  const log = await svc.getLog();
  assert.equal(log[0].action, 'install');
  assert.ok(log[0].ok);
});

test('o plano não aceita driver inventado pelo renderer nem nome repetido', async () => {
  const { svc, setInventory } = await setup();
  await svc.scan();
  await assert.rejects(svc.install({ deviceId: 'net:10.0.0.25', key: 'repo:C:\\evil.inf:x', queue: 'X' }), /não está mais disponível/);
  setInventory({ ...INVENTORY, printers: [...INVENTORY.printers, { Name: 'Financeiro', DriverName: 'x', PortName: 'IP_1.1.1.1' }] });
  await svc.refreshLocal();
  const o = await svc.driverOptions('net:10.0.0.25');
  await assert.rejects(svc.install({ deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'financeiro' }), /Já existe/);
  await assert.rejects(svc.install({ deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'a\\b' }), /inválido/);
});

test('UAC cancelado vira { cancelled } e fica no histórico como cancelado', async () => {
  const { svc } = await setup({ elevated: async () => ({ cancelled: true }) });
  await svc.scan();
  const o = await svc.driverOptions('net:10.0.0.25');
  const r = await svc.install({ deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'Teste' });
  assert.deepEqual(r, { ok: false, cancelled: true });
  const log = await svc.getLog();
  assert.ok(log[0].cancelled);
});

test('página de teste registra o resultado', async () => {
  const { svc } = await setup();
  const r = await svc.testPage('Financeiro');
  assert.ok(r.ok);
  assert.match(r.detail, /saiu da fila em 2\.4s/);
});

test('estado sobrevive a reiniciar o serviço', async () => {
  const { svc, dir } = await setup();
  await svc.setSettings({ ranges: '10.0.0.0/28', community: 'infra' });
  await svc.flush();
  const again = createPrintersService({ file: path.join(dir, 'printers.json'), repoFile: path.join(dir, 'printers-repo.json'), platform: 'linux', run: null, runElevated: null, net: null, repo: null });
  const s = await again.get();
  assert.equal(s.settings.ranges, '10.0.0.0/28');
  assert.equal(s.settings.community, 'infra');
  assert.equal(s.supported, false);
  await assert.rejects(again.scan(), /só no Windows/);
});

test('faixa inválida não é gravada', async () => {
  const { svc } = await setup();
  await assert.rejects(svc.setSettings({ ranges: '10.0.0.0/8' }), /grande demais/);
});

test('perfis: salvar, nome repetido, exportar/importar e sobreviver a reiniciar', async () => {
  const { svc } = await setup();
  await svc.saveProfile({ name: 'A4 duplex', model: 'M404', prefs: { paperSize: 'ISOA4', duplex: 'TwoSidedLongEdge', lixo: 1, orientation: 'x; Remove-Item' } });
  const [p] = await svc.listProfiles();
  assert.deepEqual(p.prefs, { paperSize: 'ISOA4', duplex: 'TwoSidedLongEdge' }); // valor desconhecido é descartado
  await assert.rejects(() => svc.saveProfile({ name: 'a4 DUPLEX', model: 'M404' }), /Já existe um perfil/);
  const text = await svc.exportProfiles();
  const list = await svc.importProfiles(text);
  assert.equal(list.length, 2);
  assert.equal(list[1].name, 'A4 duplex (2)');
  assert.notEqual(list[1].id, list[0].id);
  await assert.rejects(() => svc.importProfiles('nao e json'), /JSON/);
});

test('instalar com perfil leva as preferências ao script; aplicar perfil em fila existente', async () => {
  const { svc, calls, setInventory } = await setup();
  await svc.setSettings({ repoDirs: ['\\\\srv\\d'] });
  await svc.reindex();
  await svc.scan();
  await svc.saveProfile({ name: 'P', model: 'HP LaserJet Pro M404dn', prefs: { paperSize: 'ISOA4', inputBin: 'Cassette', color: false } });
  const [prof] = await svc.listProfiles();
  const o = await svc.driverOptions('net:10.0.0.25');
  assert.equal(o.suggestedProfileId, prof.id); // casou pelo modelo
  await svc.install({ deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'Financeiro', profileId: prof.id });
  assert.match(calls.elevated[0], /PageMediaSizeName\]::ISOA4/);
  assert.match(calls.elevated[0], /InputBin\]::Cassette/);
  assert.match(calls.elevated[0], /-Color \$false/);

  setInventory({ ...INVENTORY, printers: [...INVENTORY.printers, { Name: 'Fila 2', DriverName: 'D', PortName: 'IP_1' }] });
  await svc.refreshLocal();
  const r = await svc.applyProfile('Fila 2', prof.id);
  assert.ok(r.ok);
  assert.match(calls.elevated[1], /Set-PrintConfiguration -PrinterName 'Fila 2' -Color \$false/);
  assert.equal((await svc.getLog())[0].action, 'profile');
  await assert.rejects(() => svc.applyProfile('Fantasma', prof.id), /não está mais na lista/);
});

test('instalação em vários computadores: paralelo, um falha e os outros seguem, histórico por máquina', async () => {
  const seen = [];
  const { svc, calls } = await setup({
    runExtra: async (script) => {
      if (script.includes('# IK-RTEST')) {
        const c = /-ComputerName '([^']*)'/.exec(script)[1];
        return c === 'PC-02' ? { ok: false, sent: true, cleared: false, jobs: [{ status: 'PaperOut' }], seconds: 20 } : { ok: true, sent: true, cleared: true, jobs: [], seconds: 2 };
      }
      if (!script.includes('# IK-REMOTE')) return undefined;
      const computer = /\$computer = '([^']*)'/.exec(script)[1];
      seen.push(computer);
      if (computer === 'PC-DESLIGADO') return { computer, ok: false, error: 'The client cannot connect to the destination (WinRM)', steps: [{ label: 'Conectar ao computador (WinRM)', ok: false, detail: 'x' }] };
      return { computer, ok: true, queue: 'Financeiro', reboot: false, error: null, steps: [{ label: 'Criar a fila de impressão', ok: true, detail: 'ok' }] };
    },
  });
  await svc.setSettings({ repoDirs: ['\\\\srv\\d'] });
  await svc.reindex();
  await svc.scan();
  const o = await svc.driverOptions('net:10.0.0.25');
  const r = await svc.remoteInstall({ computers: ['PC-01', 'PC-DESLIGADO', 'PC-02', 'pc-01'], deviceId: 'net:10.0.0.25', key: o.candidates[0].key, queue: 'Financeiro' });
  assert.deepEqual(seen.sort(), ['PC-01', 'PC-02', 'PC-DESLIGADO']); // pc-01 repetido não conta
  assert.equal(r.ok, false);
  assert.deepEqual(r.items.map((i) => i.state).sort(), ['fail', 'ok', 'ok']);
  assert.match(r.items.find((i) => i.computer === 'PC-DESLIGADO').detail, /WinRM/);
  assert.deepEqual(calls.staged, ['\\\\srv\\d\\hp.inf']); // o driver é copiado uma vez só
  assert.equal(calls.elevated.length, 0); // remoto não pede UAC local
  const snap = await svc.get();
  assert.ok(snap.remote.done);
  const log = (await svc.getLog()).filter((e) => e.action === 'remote-install');
  assert.equal(log.length, 3);
  // página de teste: só nas que instalaram; cada resultado vai para a linha da máquina e para o histórico
  const t = await svc.remoteTest();
  assert.deepEqual(t.items.map((i) => i.computer).sort(), ['PC-01', 'PC-02']);
  assert.equal(t.ok, false);
  const items = (await svc.get()).remote.items;
  assert.equal(items.find((i) => i.computer === 'PC-01').test.state, 'ok');
  assert.match(items.find((i) => i.computer === 'PC-02').test.detail, /continua na fila/);
  assert.equal(items.find((i) => i.computer === 'PC-DESLIGADO').test, undefined);
  assert.equal((await svc.getLog()).filter((e) => e.action === 'remote-test').length, 2);
  svc.clearRemote();
  assert.equal((await svc.get()).remote, null);
});

test('instalação remota recusa nome de computador inválido, lista vazia e excesso', async () => {
  const { svc } = await setup();
  await svc.scan();
  const base = { deviceId: 'net:10.0.0.25', key: 'x', queue: 'Q' };
  await assert.rejects(() => svc.remoteInstall({ ...base, computers: ["PC'; Remove-Item C:\\ -Recurse; '"] }), /inválido/);
  await assert.rejects(() => svc.remoteInstall({ ...base, computers: [] }), /ao menos um/);
  await assert.rejects(() => svc.remoteInstall({ ...base, computers: Array.from({ length: 51 }, (_, i) => 'PC' + i) }), /No máximo/);
});

test('verificar computadores traduz o erro do WinRM', async () => {
  const { svc, calls } = await setup({
    runExtra: async (script) => (script.includes('# IK-PREFLIGHT') ? [
      { computer: 'A', ok: true, x64: true, queueExists: false, driverInstalled: true },
      { computer: 'B', ok: false, error: 'WinRM cannot complete the operation.' },
      { computer: 'C', ok: false, error: 'Access is denied.' },
    ] : undefined),
  });
  const r = await svc.preflight({ computers: ['A', 'B', 'C'], queue: 'Q' });
  assert.equal(r[0].ok, true);
  assert.match(r[1].error, /Sem resposta do WinRM/);
  assert.match(r[2].error, /não é administrador/);
  assert.match(calls.run[calls.run.length - 1], /@\('A', 'B', 'C'\)/);
});

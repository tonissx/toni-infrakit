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

async function setup({ elevated = async () => ({ ok: true, steps: [{ label: 'x', ok: true }] }) } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ik-test-'));
  const calls = { run: [], elevated: [], staged: [] };
  let inventory = structuredClone(INVENTORY);
  const svc = createPrintersService({
    file: path.join(dir, 'printers.json'),
    repoFile: path.join(dir, 'printers-repo.json'),
    platform: 'win32',
    run: async (script) => {
      calls.run.push(script);
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

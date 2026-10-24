// Testes da junção das fontes: node --test scripts/test-printers-merge.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { mergeDevices, buildQueues, modelFromUsbPrintId } = require('../src/printers/merge.js');

const LOCAL = {
  printers: [
    { Name: 'Financeiro', DriverName: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', PortName: 'IP_10.0.0.25', Status: 'Normal' },
    { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', Status: 'Normal' },
    { Name: 'Epson Recepção', DriverName: 'EPSON L3250 Series', PortName: 'USB001', Status: 'Normal' },
    { Name: 'Antiga', DriverName: 'Brother HL-1200 series', PortName: 'IP_10.0.0.99', Status: 'Offline' },
  ],
  ports: [
    { Name: 'IP_10.0.0.25', PrinterHostAddress: '10.0.0.25' },
    { Name: 'IP_10.0.0.99', PrinterHostAddress: '10.0.0.99' },
    { Name: 'USB001' },
    { Name: 'PORTPROMPT:' },
  ],
  win: [{ Name: 'Financeiro', Default: true, WorkOffline: false }],
  pnp: [
    { Name: 'EPSON L3250 Series', PNPDeviceID: 'USBPRINT\\EPSONL3250_SERIES\\7&1', HardwareID: ['USBPRINT\\EPSONL3250_SERIESE0A1'], ConfigManagerErrorCode: 0 },
    { Name: 'Suporte para impressão USB', PNPDeviceID: 'USB\\VID_04B8&PID_1188&MI_01\\6&2', CompatibleID: ['USB\\Class_07&SubClass_01&Prot_02', 'USB\\Class_07'], ConfigManagerErrorCode: 0 },
    { Name: 'Suporte para impressão USB', PNPDeviceID: 'USBPRINT\\HPLASERJET_P11027B39\\7&9', HardwareID: ['USBPRINT\\HPLaserJet_P11027B39'], ConfigManagerErrorCode: 28 },
    { Name: 'Financeiro', PNPDeviceID: 'SWD\\PRINTENUM\\{ABC}', PNPClass: 'PrintQueue' },
  ],
};

const NETWORK = [
  { ip: '10.0.0.25', ports: [631, 9100], ipp: { makeModel: 'HP LaserJet Pro M404dn', formats: ['application/pdf', 'image/pwg-raster'], versions: ['1.1', '2.0'], deviceId: 'MFG:HP;MDL:HP LaserJet Pro M404dn;CMD:PCLXL,PWG;', supplies: [], reasons: [], state: 'idle' }, ippUri: 'ipp://10.0.0.25:631/ipp/print' },
  { ip: '10.0.0.40', ports: [9100], snmp: { model: 'Brother HL-L2350DW series', sysDescr: 'Brother NC-8300w', supplies: [] } },
];

test('buildQueues: porta, padrão, virtual e tipo de conexão', () => {
  const q = buildQueues(LOCAL);
  const fin = q.find((x) => x.name === 'Financeiro');
  assert.equal(fin.host, '10.0.0.25');
  assert.equal(fin.connection, 'tcp');
  assert.ok(fin.isDefault);
  assert.ok(q.find((x) => x.name === 'Microsoft Print to PDF').virtual);
  assert.equal(q.find((x) => x.name === 'Epson Recepção').connection, 'usb');
  assert.equal(q.find((x) => x.name === 'Antiga').status.tone, 'error');
});

test('mergeDevices junta rede, filas e USB', () => {
  const list = mergeDevices({ local: LOCAL, network: NETWORK, mdns: [] });
  const hp = list.find((d) => d.ip === '10.0.0.25');
  assert.equal(hp.kind, 'network');
  assert.equal(hp.model, 'HP LaserJet Pro M404dn');
  assert.equal(hp.name, 'Financeiro'); // nome da fila instalada
  assert.ok(hp.installed);
  assert.ok(hp.ippClass);

  const brother = list.find((d) => d.ip === '10.0.0.40');
  assert.ok(!brother.installed);
  assert.equal(brother.model, 'Brother HL-L2350DW series');
  assert.equal(brother.state.label, 'disponível para instalar');

  // USB com driver: a fila USB001 vai junto; o "Suporte para impressão USB" (pai) não vira aparelho separado.
  const epson = list.find((d) => d.kind === 'usb' && /EPSON/.test(d.model));
  assert.equal(epson.queues.length, 1);
  assert.equal(list.filter((d) => d.kind === 'usb').length, 2);

  // USB sem driver (código 28) com nome genérico: o modelo sai do ID de hardware.
  const p1102 = list.find((d) => d.usb && d.usb.code === 28);
  assert.equal(p1102.model, 'HPLaserJet P1102');
  assert.equal(p1102.state.tone, 'warn');

  // Fila de IP que não respondeu continua na lista; a do PDF é virtual.
  assert.ok(list.find((d) => d.kind === 'queue' && d.name === 'Antiga'));
  assert.ok(list.find((d) => d.name === 'Microsoft Print to PDF').virtual);
  // Filas do PrintEnum não viram aparelhos.
  assert.ok(!list.some((d) => d.usb && /PRINTENUM/.test(d.usb.instanceId)));

  // Ordem: disponíveis primeiro, virtuais no fim.
  assert.ok(!list[0].installed);
  assert.ok(list[list.length - 1].virtual);
});

test('mDNS sozinho cria o aparelho com o modelo do TXT', () => {
  const list = mergeDevices({ local: {}, network: [], mdns: [{ instance: 'EPSON L4260 Series', service: '_ipp._tcp', host: 'EPSON1.local', port: 631, ip: '10.0.0.77', txt: { ty: 'EPSON L4260 Series', usb_mfg: 'EPSON' } }] });
  assert.equal(list.length, 1);
  assert.equal(list[0].model, 'EPSON L4260 Series');
  assert.deepEqual(list[0].ports, [631]);
  assert.deepEqual(list[0].sources, ['bonjour']);
});

test('modelFromUsbPrintId', () => {
  assert.equal(modelFromUsbPrintId('USBPRINT\\HPLaserJet_P11027B39'), 'HPLaserJet P1102');
  assert.equal(modelFromUsbPrintId('nada'), '');
});

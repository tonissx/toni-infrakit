// Testes da escolha de driver: node --test scripts/test-printers-drivers.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { candidates, externalLinks, IPP_CLASS, PCL6_CLASS } = require('../src/printers/drivers.js');

const net = (extra = {}) => ({ id: 'net:10.0.0.25', kind: 'network', ip: '10.0.0.25', ports: [631, 9100], model: 'HP LaserJet Pro M404dn', make: 'HP', languages: ['PCL6'], ippClass: false, ipp: null, snmp: null, usb: null, ...extra });

const REPO = [
  { inf: '\\\\srv\\drivers\\HP\\M404\\hpm404.inf', provider: 'HP Inc.', driverVer: '1.0', models: [
    { name: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', hwids: ['USBPRINT\\HPHP_LaserJet_Pro_M40C2E8'] },
    { name: 'HP LaserJet Pro M402 PCL 6', hwids: [] },
  ] },
  { inf: '\\\\srv\\drivers\\HP\\UPD\\hpcu.inf', provider: 'HP', driverVer: '7.0', models: [{ name: 'HP Universal Printing PCL 6', hwids: [] }] },
  { inf: '\\\\srv\\drivers\\Epson\\e_l3250.inf', provider: 'Epson', driverVer: '3.0', models: [{ name: 'EPSON L3250 Series', hwids: ['USBPRINT\\EPSONL3250_SERIESE0A1'] }] },
];

test('modelo do repositório vem antes do universal; outro modelo do mesmo .inf fica de fora', () => {
  const list = candidates(net(), { repo: REPO });
  assert.equal(list[0].driver, 'HP LaserJet Pro M404-M405 PCL 6 (V3)');
  assert.equal(list[0].source, 'repo');
  assert.ok(!list.some((c) => /M402/.test(c.driver)));
  assert.ok(list.some((c) => c.matchedBy === 'universal' && /Universal/.test(c.driver)));
  assert.ok(!list.some((c) => /EPSON/.test(c.driver)));
  // PCL6 genérico sempre por último, com 9100 aberta
  assert.equal(list[list.length - 1].driver, PCL6_CLASS);
});

test('USB: ID de hardware igual ganha com score 1 e recomendado', () => {
  const d = { id: 'pnp:x', kind: 'usb', ip: null, ports: [], model: 'EPSON L3250 Series', make: 'EPSON', languages: [], ippClass: false, usb: { hwids: ['USBPRINT\\EPSONL3250_SERIESE0A1'], pnpName: 'EPSON L3250 Series' } };
  const list = candidates(d, { repo: REPO });
  assert.equal(list[0].matchedBy, 'hwid');
  assert.equal(list[0].score, 1);
  assert.ok(list[0].recommended);
  assert.ok(!list.some((c) => c.driver === PCL6_CLASS)); // sem IP, sem PCL6 de rede
});

test('driver já instalado entra e não precisa do repositório', () => {
  const list = candidates(net(), { installed: [{ Name: 'HP LaserJet Pro M404-M405 PCL 6 (V3)' }, { Name: IPP_CLASS }, { Name: 'Canon Generic Plus UFR II' }] });
  assert.equal(list[0].source, 'installed');
  assert.ok(!list.some((c) => /Canon/.test(c.driver)));
});

test('IPP Everywhere oferece o driver de classe IPP (método ipp)', () => {
  const list = candidates(net({ ippClass: true, model: 'Marca Desconhecida X1', make: '' }), {});
  const ipp = list.find((c) => c.driver === IPP_CLASS);
  assert.equal(ipp.method, 'ipp');
  assert.ok(ipp.recommended);
});

test('externalLinks: catálogo com o ID de hardware e suporte do fabricante', () => {
  const links = externalLinks({ model: 'HP LaserJet P1102', make: 'HP', usb: { hwids: ['USBPRINT\\HPLaserJet_P11027B39'] } });
  assert.ok(links[0].url.includes(encodeURIComponent('USBPRINT\\HPLaserJet_P11027B39')));
  assert.ok(links.some((l) => /support\.hp\.com/.test(l.url)));
});

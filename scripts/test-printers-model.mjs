// Testes de nomes de modelo: node --test scripts/test-printers-model.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { vendorOf, stripVendor, modelTokens, similarity, isGenericDriver, parseDeviceId, joinMakeModel, languages } = require('../src/printers/model.js');

test('vendorOf reconhece apelidos e IDs colados', () => {
  assert.equal(vendorOf('Hewlett-Packard LaserJet 4250'), 'hp');
  assert.equal(vendorOf('HP LaserJet Pro M404dn'), 'hp');
  assert.equal(vendorOf('HPLaserJet P1102'), null); // "hp" colado e curto: não arrisca
  assert.equal(vendorOf('HewlettPackardHP_LaserJet'), 'hp');
  assert.equal(vendorOf('KYOCERA ECOSYS M2040dn'), 'kyocera');
  assert.equal(vendorOf('Brother MFC-L2710DW series'), 'brother');
  assert.equal(vendorOf('Impressora do financeiro'), null);
});

test('stripVendor e modelTokens tiram fabricante e ruído', () => {
  assert.equal(stripVendor('HP LaserJet Pro M404dn'), 'laserjet pro m404dn');
  assert.deepEqual(modelTokens('Brother MFC-L2710DW series'), ['l2710dw']);
  assert.deepEqual(modelTokens('HP LaserJet Pro M404-M405 PCL 6 (V3)'), ['laserjet', 'pro', 'm404', 'm405']);
});

test('similarity: mesmo modelo casa alto, outro número zera', () => {
  assert.equal(similarity('HP LaserJet Pro M404dn', 'HP LaserJet Pro M404dn'), 1);
  assert.ok(similarity('HP LaserJet Pro M404dn', 'HP LaserJet Pro M404-M405 PCL 6 (V3)') >= 0.7);
  assert.equal(similarity('HP LaserJet Pro M404dn', 'HP LaserJet Pro M402 PCL 6'), 0);
  assert.equal(similarity('Brother HL-L2350DW', 'Epson L3150 Series'), 0); // fabricantes diferentes
  assert.ok(similarity('EPSON L3250 Series', 'EPSON L3250 Series') >= 0.99);
  assert.ok(similarity('Kyocera ECOSYS M2040dn', 'Kyocera ECOSYS M2040dn KX') >= 0.9);
});

test('isGenericDriver', () => {
  assert.ok(isGenericDriver('HP Universal Printing PCL 6'));
  assert.ok(isGenericDriver('Microsoft IPP Class Driver'));
  assert.ok(!isGenericDriver('HP LaserJet Pro M404-M405 PCL 6'));
});

test('parseDeviceId lê chaves curtas e longas', () => {
  const id = parseDeviceId('MFG:HP;MDL:HP LaserJet Pro M404dn;CMD:PJL,PCL,PCLXL,POSTSCRIPT,PWG;CLS:PRINTER;SN:PHBXX123;');
  assert.equal(id.mfg, 'HP');
  assert.equal(id.mdl, 'HP LaserJet Pro M404dn');
  assert.deepEqual(id.cmd, ['PJL', 'PCL', 'PCLXL', 'POSTSCRIPT', 'PWG']);
  assert.equal(id.sn, 'PHBXX123');
  const long = parseDeviceId('MANUFACTURER:EPSON;MODEL:L3250 Series;COMMAND SET:ESCPL2,BDC;');
  assert.equal(long.mfg, 'EPSON');
  assert.equal(long.mdl, 'L3250 Series');
});

test('joinMakeModel não repete o fabricante', () => {
  assert.equal(joinMakeModel('HP', 'HP LaserJet Pro M404dn'), 'HP LaserJet Pro M404dn');
  assert.equal(joinMakeModel('EPSON', 'L3250 Series'), 'EPSON L3250 Series');
  assert.equal(joinMakeModel('', 'X'), 'X');
});

test('languages junta 1284 e IPP', () => {
  assert.deepEqual(languages({ cmd: ['PJL', 'PCLXL', 'POSTSCRIPT'], formats: ['image/pwg-raster', 'application/pdf'] }).sort(),
    ['IPP Everywhere', 'PCL6', 'PDF', 'PostScript'].sort());
  assert.deepEqual(languages({ cmd: ['ESCPL2'] }), ['ESC/P']);
});

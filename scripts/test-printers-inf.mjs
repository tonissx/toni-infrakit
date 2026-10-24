// Testes do leitor de .inf: node --test scripts/test-printers-inf.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { decodeInf, parseInf, isPrinterInf } = require('../src/printers/inf.js');

const SAMPLE = `; Driver de exemplo
[Version]
Signature="$Windows NT$"
Class=Printer
ClassGuid={4D36E979-E325-11CE-BFC1-08002BE10318}
Provider=%HP%
DriverVer=05/12/2023,61.280.1.25123

[Manufacturer]
%HP%=HP,NTamd64,NTx86,NTarm64

[HP.NTamd64]
"HP LaserJet Pro M404-M405 PCL 6 (V3)" = HPM404.GPD, USBPRINT\\HPHP_LaserJet_Pro_M40C2E8, WSDPRINT\\HPHP_LaserJet_Pro_M40C2E8
"HP LaserJet Pro M404-M405 PCL 6 (V3)" = HPM404.GPD, USBPRINT\\HPHP_LaserJet_ProBB30
%M428% = HPM428.GPD, \\
  USBPRINT\\HPHP_LaserJet_MFP_M42A7F2 ; continuação

[HP.NTx86]
"HP LaserJet só x86" = X86.GPD, USBPRINT\\X86ONLY

[HP.NTarm64]
"HP LaserJet ARM" = ARM.GPD

[Strings]
HP="HP Inc."
M428="HP LaserJet Pro MFP M428f PCL 6"
`;

test('parseInf lê classe, fornecedor, versão e modelos da arquitetura x64', () => {
  const inf = parseInf(SAMPLE);
  assert.equal(inf.cls, 'Printer');
  assert.equal(inf.provider, 'HP Inc.');
  assert.equal(inf.driverVer, '05/12/2023,61.280.1.25123');
  assert.ok(isPrinterInf(inf));
  assert.deepEqual(inf.models.map((m) => m.name), ['HP LaserJet Pro M404-M405 PCL 6 (V3)', 'HP LaserJet Pro MFP M428f PCL 6']);
  // linhas repetidas do mesmo modelo juntam os IDs
  assert.deepEqual(inf.models[0].hwids, ['USBPRINT\\HPHP_LaserJet_Pro_M40C2E8', 'WSDPRINT\\HPHP_LaserJet_Pro_M40C2E8', 'USBPRINT\\HPHP_LaserJet_ProBB30']);
  // continuação com "\" no fim da linha
  assert.deepEqual(inf.models[1].hwids, ['USBPRINT\\HPHP_LaserJet_MFP_M42A7F2']);
});

test('INF sem decoração usa a seção base', () => {
  const inf = parseInf('[Version]\nClass=Printer\n[Manufacturer]\n"Zebra"=Zebra\n[Zebra]\n"ZDesigner GC420t" = ZD.inst, USBPRINT\\ZEBRAGC420T\n');
  assert.equal(inf.models.length, 1);
  assert.equal(inf.models[0].name, 'ZDesigner GC420t');
});

test('INF de outra classe não é de impressora', () => {
  const inf = parseInf('[Version]\nClass=Net\nClassGuid={4d36e972-e325-11ce-bfc1-08002be10318}\n');
  assert.ok(!isPrinterInf(inf));
});

test('decodeInf entende UTF-16 LE com e sem BOM, UTF-8 com BOM e ANSI', () => {
  const text = '[Version]\r\nClass=Printer\r\n; ação\r\n';
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
  assert.equal(decodeInf(le), text);
  assert.equal(decodeInf(Buffer.from(text, 'utf16le')), text);
  assert.equal(decodeInf(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])), text);
  assert.equal(decodeInf(Buffer.from(text, 'latin1')), text);
});

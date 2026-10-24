// Testes do mDNS: node --test scripts/test-printers-mdns.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encodeQuery, decodePacket, collect, printerFromTxt, encName, TYPE, SERVICES } = require('../src/printers/mdns.js');

function rr(name, type, rdata) {
  const tail = Buffer.alloc(10);
  tail.writeUInt16BE(type, 0);
  tail.writeUInt16BE(1, 2);
  tail.writeUInt32BE(120, 4);
  tail.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encName(name), tail, rdata]);
}
const txt = (pairs) => Buffer.concat(pairs.map((p) => { const b = Buffer.from(p); return Buffer.concat([Buffer.from([b.length]), b]); }));
const srv = (port, target) => { const h = Buffer.alloc(6); h.writeUInt16BE(port, 4); return Buffer.concat([h, encName(target)]); };

test('encodeQuery pergunta PTR para os serviços de impressão', () => {
  const q = encodeQuery();
  assert.equal(q.readUInt16BE(4), SERVICES.length);
  assert.ok(q.includes(Buffer.from('_ipp')));
});

test('decodePacket + collect montam a impressora anunciada', () => {
  const inst = 'HP LaserJet M404 [A1B2C3]._ipp._tcp.local';
  const records = [
    rr('_ipp._tcp.local', TYPE.PTR, encName(inst)),
    rr(inst, TYPE.SRV, srv(631, 'NPIA1B2C3.local')),
    rr(inst, TYPE.TXT, txt(['txtvers=1', 'ty=HP LaserJet Pro M404dn', 'rp=ipp/print', 'usb_MFG=HP', 'pdl=application/pdf,image/pwg-raster', 'adminurl=http://NPIA1B2C3.local./'])),
    rr('NPIA1B2C3.local', TYPE.A, Buffer.from([10, 0, 0, 25])),
  ];
  const head = Buffer.alloc(12);
  head.writeUInt16BE(0x8400, 2);
  head.writeUInt16BE(1, 6);
  head.writeUInt16BE(3, 10);
  const packet = Buffer.concat([head, ...records]);
  const list = collect(decodePacket(packet));
  assert.equal(list.length, 1);
  assert.equal(list[0].instance, 'HP LaserJet M404 [A1B2C3]');
  assert.equal(list[0].ip, '10.0.0.25');
  assert.equal(list[0].port, 631);
  const p = printerFromTxt(list[0].txt);
  assert.equal(p.model, 'HP LaserJet Pro M404dn');
  assert.equal(p.make, 'HP');
  assert.equal(p.rp, 'ipp/print');
  assert.deepEqual(p.pdl, ['application/pdf', 'image/pwg-raster']);
});

test('nomes com ponteiro de compressão', () => {
  // cabeçalho + "local" no offset 12, depois um nome "a" + ponteiro para 12
  const head = Buffer.alloc(12);
  const local = encName('local');
  const ptrName = Buffer.concat([Buffer.from([1, 0x61, 0xc0, 12])]);
  const tail = Buffer.alloc(10);
  tail.writeUInt16BE(TYPE.A, 0);
  tail.writeUInt16BE(4, 8);
  head.writeUInt16BE(1, 6);
  // a 1ª "resposta" precisa começar logo após o cabeçalho: usamos uma pergunta falsa para guardar o "local"
  head.writeUInt16BE(1, 4);
  const question = Buffer.concat([local, Buffer.from([0, 1, 0, 1])]);
  const packet = Buffer.concat([head, question, ptrName, tail, Buffer.from([192, 168, 0, 9])]);
  const recs = decodePacket(packet);
  assert.equal(recs[0].name, 'a.local');
  assert.equal(recs[0].data, '192.168.0.9');
});

// Testes do IPP: node --test scripts/test-printers-ipp.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encodeGetPrinterAttributes, decodeResponse, summarize, supportsIppClassDriver, TAG } = require('../src/printers/ipp.js');

/** Monta uma resposta IPP como a impressora mandaria. */
function attr(tag, name, value) {
  const n = Buffer.from(name);
  const v = Buffer.isBuffer(value) ? value : typeof value === 'number' ? (() => { const b = Buffer.alloc(4); b.writeInt32BE(value); return b; })() : Buffer.from(value);
  const b = Buffer.alloc(5 + n.length + v.length);
  b[0] = tag; b.writeUInt16BE(n.length, 1); n.copy(b, 3); b.writeUInt16BE(v.length, 3 + n.length); v.copy(b, 5 + n.length);
  return b;
}
function response(parts, status = 0) {
  const head = Buffer.alloc(8);
  head[0] = 2; head.writeUInt16BE(status, 2); head.writeInt32BE(1, 4);
  return Buffer.concat([head, Buffer.from([TAG.operation]), attr(TAG.charset, 'attributes-charset', 'utf-8'), Buffer.from([TAG.printer]), ...parts, Buffer.from([TAG.end])]);
}

test('encodeGetPrinterAttributes monta cabeçalho e atributos de operação', () => {
  const b = encodeGetPrinterAttributes('ipp://10.0.0.5:631/ipp/print', 7, ['printer-make-and-model', 'printer-state']);
  assert.equal(b[0], 2);
  assert.equal(b.readUInt16BE(2), 0x000b);
  assert.equal(b.readInt32BE(4), 7);
  assert.equal(b[8], TAG.operation);
  assert.ok(b.includes(Buffer.from('ipp://10.0.0.5:631/ipp/print')));
  assert.equal(b[b.length - 1], TAG.end);
  // o 2º valor de requested-attributes vem com nome vazio
  const second = b.indexOf(Buffer.from('printer-state'));
  assert.equal(b.readUInt16BE(second - 2), 'printer-state'.length);
  assert.equal(b.readUInt16BE(second - 4), 0);
});

test('decodeResponse lê textos, enum, listas e pula coleções', () => {
  const buf = response([
    attr(TAG.text, 'printer-make-and-model', 'HP LaserJet Pro M404dn'),
    attr(TAG.enum, 'printer-state', 3),
    attr(TAG.keyword, 'printer-state-reasons', 'none'),
    attr(TAG.keyword, 'ipp-versions-supported', '1.1'),
    attr(TAG.keyword, '', '2.0'),
    attr(TAG.mimeMediaType, 'document-format-supported', 'application/pdf'),
    attr(TAG.mimeMediaType, '', 'image/pwg-raster'),
    attr(TAG.begCollection, 'media-col-default', Buffer.alloc(0)),
    attr(TAG.memberAttrName, '', 'media-size'),
    attr(TAG.begCollection, '', Buffer.alloc(0)),
    attr(TAG.endCollection, '', Buffer.alloc(0)),
    attr(TAG.endCollection, '', Buffer.alloc(0)),
    attr(TAG.name, 'marker-names', 'Toner preto'),
    attr(TAG.integer, 'marker-levels', 42),
    attr(TAG.text, 'printer-device-id', 'MFG:HP;MDL:LaserJet Pro M404dn;CMD:PCLXL,PWG;'),
  ]);
  const r = decodeResponse(buf);
  assert.ok(r.ok);
  assert.equal(r.printer['printer-make-and-model'], 'HP LaserJet Pro M404dn');
  assert.deepEqual(r.printer['ipp-versions-supported'], ['1.1', '2.0']);
  assert.equal(r.printer['media-col-default'], undefined);
  const s = summarize(r.printer);
  assert.equal(s.state, 'idle');
  assert.deepEqual(s.reasons, []);
  assert.deepEqual(s.supplies, [{ name: 'Toner preto', level: 42, color: null }]);
  assert.ok(supportsIppClassDriver(s));
});

test('sem IPP 2.0 ou sem formato aberto não serve para o driver de classe', () => {
  assert.ok(!supportsIppClassDriver({ versions: ['1.1'], formats: ['application/pdf'] }));
  assert.ok(!supportsIppClassDriver({ versions: ['2.0'], formats: ['application/vnd.hp-PCL'] }));
  assert.ok(!supportsIppClassDriver(null));
});

test('status de erro IPP não é ok', () => {
  assert.ok(!decodeResponse(response([], 0x0400)).ok);
  assert.throws(() => decodeResponse(Buffer.alloc(3)));
});

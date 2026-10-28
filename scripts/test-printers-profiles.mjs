// Testes dos perfis por modelo: node --test scripts/test-printers-profiles.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { sameModel, forModel, normalizeProfile, parseImport } = require('../src/printers/profiles.js');

test('o mesmo aparelho escrito de jeitos diferentes casa; modelos diferentes não', () => {
  assert.ok(sameModel('HP LaserJet Pro M404dn', 'HP LaserJet Pro M404-M405 PCL 6 (V3)'));
  assert.ok(sameModel('EPSON L3250 Series', 'L3250'));
  assert.ok(sameModel('Brother HL-L2350DW series', 'HL-L2350DW'));
  assert.ok(!sameModel('HP LaserJet Pro M404dn', 'HP LaserJet Pro M428fdw'));
  assert.ok(!sameModel('EPSON L3250 Series', 'EPSON L4260 Series'));
  assert.ok(!sameModel('', 'M404'));
});

test('forModel: só os do modelo, o usado mais recentemente primeiro', () => {
  const l = [
    { id: 'a', model: 'HP M404dn', usedAt: 1 }, { id: 'b', model: 'HP M404dn', usedAt: 9 }, { id: 'c', model: 'EPSON L4260', usedAt: 99 },
  ];
  assert.deepEqual(forModel(l, 'HP LaserJet Pro M404dn').map((p) => p.id), ['b', 'a']);
});

test('perfil exige nome e modelo; perfil da primeira versão (match.model) é aceito', () => {
  assert.throws(() => normalizeProfile({ name: 'x' }), /modelo/);
  assert.throws(() => normalizeProfile({ model: 'M404' }), /nome/);
  assert.equal(normalizeProfile({ name: 'x', match: { model: 'M404' } }).model, 'M404');
});

test('importar zera id e uso', () => {
  const [p] = parseImport(JSON.stringify({ profiles: [{ id: 'orig', name: 'x', model: 'M404', usedAt: 5 }] }), () => 'novo');
  assert.equal(p.id, 'novo');
  assert.equal(p.usedAt, undefined);
});

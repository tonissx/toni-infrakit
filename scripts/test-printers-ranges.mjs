// Testes das faixas de IP: node --test scripts/test-printers-ranges.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { expand, parseOne, defaultRanges, toInt, toIp } = require('../src/printers/ranges.js');

test('CIDR tira rede e broadcast', () => {
  const ips = expand('192.168.0.0/24');
  assert.equal(ips.length, 254);
  assert.equal(ips[0], '192.168.0.1');
  assert.equal(ips[253], '192.168.0.254');
  assert.deepEqual(expand('10.0.0.7/30'), ['10.0.0.5', '10.0.0.6']);
  assert.deepEqual(expand('10.0.0.7/32'), ['10.0.0.7']);
});

test('intervalos completos e curtos, IP solto e mistura', () => {
  assert.deepEqual(expand('10.0.0.10-10.0.0.12'), ['10.0.0.10', '10.0.0.11', '10.0.0.12']);
  assert.deepEqual(expand('10.0.0.250-252'), ['10.0.0.250', '10.0.0.251', '10.0.0.252']);
  assert.deepEqual(expand('10.0.0.5, 10.0.0.5; 10.0.0.6'), ['10.0.0.5', '10.0.0.6']);
});

test('erros e limite', () => {
  assert.throws(() => parseOne('10.0.0.300'), /inválida/);
  assert.throws(() => parseOne('10.0.0.9-10.0.0.1'), /inválida/);
  assert.throws(() => parseOne('banana'), /inválida/);
  assert.throws(() => expand('10.0.0.0/16'), /grande demais/);
  assert.equal(expand('10.0.0.0/20').length, 4094);
});

test('defaultRanges: /24 das redes privadas, nunca maior que /24', () => {
  assert.deepEqual(defaultRanges([
    { address: '192.168.15.33', netmask: '255.255.255.0' },
    { address: '10.20.30.40', netmask: '255.255.0.0' },
    { address: '200.1.2.3', netmask: '255.255.255.0' },
    { address: '172.16.5.9', netmask: '255.255.255.192' },
  ]), ['192.168.15.0/24', '10.20.30.0/24', '172.16.5.0/26']);
});

test('toInt/toIp', () => {
  assert.equal(toIp(toInt('255.255.255.255')), '255.255.255.255');
  assert.equal(toInt('1.2.3'), null);
});

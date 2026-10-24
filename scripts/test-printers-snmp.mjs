// Testes do SNMP: node --test scripts/test-printers-snmp.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { encodeGet, decodeResponse, summarize, OID, encOid, decOid, tlv, encInt } = require('../src/printers/snmp.js');

test('OID vai e volta (incluindo números > 127)', () => {
  for (const o of ['1.3.6.1.2.1.1.1.0', '1.3.6.1.2.1.43.11.1.1.9.1.1', '1.3.6.1.4.1.11.2.3.9.1.1.7.0', '1.3.6.1.4.1.2435.2.3.9.4.2.1.5.5.1.0']) {
    const b = encOid(o);
    assert.equal(decOid(b.subarray(2)), o);
  }
});

test('encodeGet monta uma GetRequest v2c', () => {
  const b = encodeGet([OID.sysDescr], { community: 'public', version: 1, requestId: 99 });
  assert.equal(b[0], 0x30);
  assert.ok(b.includes(Buffer.from('public')));
  assert.ok(b.includes(Buffer.from([0xa0])));
});

/** Resposta como o aparelho mandaria. */
function reply(values, { requestId = 5, errorStatus = 0 } = {}) {
  const vb = values.map(([oid, tag, body]) => tlv(0x30, Buffer.concat([encOid(oid), tlv(tag, body)])));
  const pdu = tlv(0xa2, Buffer.concat([encInt(requestId), encInt(errorStatus), encInt(0), tlv(0x30, Buffer.concat(vb))]));
  return tlv(0x30, Buffer.concat([encInt(1), tlv(0x04, Buffer.from('public')), pdu]));
}
const int = (n) => encInt(n).subarray(2);

test('decodeResponse lê texto, inteiros negativos e ignora noSuchObject', () => {
  const buf = reply([
    [OID.sysDescr, 0x04, Buffer.from('HP ETHERNET MULTI-ENVIRONMENT\0')],
    [OID.hrDeviceDescr, 0x04, Buffer.from('HP LaserJet Pro M404dn')],
    [OID.serial, 0x80, Buffer.alloc(0)],
    [OID.supplyDescr(1), 0x04, Buffer.from('Black Cartridge HP CF258A')],
    [OID.supplyMax(1), 0x02, int(3000)],
    [OID.supplyLevel(1), 0x02, int(750)],
    [OID.supplyDescr(2), 0x04, Buffer.from('Fusor')],
    [OID.supplyMax(2), 0x02, int(-2)],
    [OID.supplyLevel(2), 0x02, int(-3)],
  ]);
  const r = decodeResponse(buf);
  assert.equal(r.requestId, 5);
  assert.equal(r.values[OID.sysDescr], 'HP ETHERNET MULTI-ENVIRONMENT');
  assert.ok(!(OID.serial in r.values));
  const s = summarize(r.values);
  assert.equal(s.model, 'HP LaserJet Pro M404dn');
  assert.deepEqual(s.supplies[0], { name: 'Black Cartridge HP CF258A', level: 750, max: 3000, pct: 25, some: false });
  assert.deepEqual(s.supplies[1], { name: 'Fusor', level: -3, max: -2, pct: null, some: true });
});

test('inteiros com bit alto ganham zero à esquerda', () => {
  assert.deepEqual([...encInt(128)], [0x02, 0x02, 0x00, 0x80]);
  assert.deepEqual([...encInt(-1)], [0x02, 0x01, 0xff]);
});

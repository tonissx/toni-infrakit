'use strict';
// Faixas de IP para a varredura: "192.168.0.0/24", "10.0.0.10-10.0.0.60", "10.0.0.10-60" e IPs soltos.
// Puro. O limite evita que um /16 digitado sem querer vire 65 mil conexões.

const MAX_HOSTS = 4096;

const toInt = (ip) => {
  const p = String(ip).trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const x of p) {
    if (!/^\d{1,3}$/.test(x) || Number(x) > 255) return null;
    n = n * 256 + Number(x);
  }
  return n;
};
const toIp = (n) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');

/** Uma faixa → [início, fim] (inteiros) ou erro. Em /N, tira rede e broadcast. */
function parseOne(spec) {
  const s = spec.trim();
  let m = /^([\d.]+)\/(\d{1,2})$/.exec(s);
  if (m) {
    const ip = toInt(m[1]);
    const bits = Number(m[2]);
    if (ip == null || bits < 8 || bits > 32) throw new Error(`Faixa inválida: ${s}`);
    if (bits >= 31) return [ip, ip];
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    const net = (ip & mask) >>> 0;
    const bcast = (net | (~mask >>> 0)) >>> 0;
    return [net + 1, bcast - 1];
  }
  m = /^([\d.]+)\s*-\s*([\d.]+)$/.exec(s);
  if (m) {
    const a = toInt(m[1]);
    // "10.0.0.10-60": o fim herda os três primeiros octetos do início.
    const b = m[2].includes('.') ? toInt(m[2]) : (a == null ? null : ((a >>> 8) << 8 >>> 0) + Number(m[2]));
    if (a == null || b == null || b < a || (!m[2].includes('.') && Number(m[2]) > 255)) throw new Error(`Faixa inválida: ${s}`);
    return [a, b];
  }
  const one = toInt(s);
  if (one == null) throw new Error(`Faixa inválida: ${s}`);
  return [one, one];
}

/** Texto com faixas separadas por vírgula, ponto e vírgula ou espaço → lista de IPs (sem repetir). */
function expand(text, { max = MAX_HOSTS } = {}) {
  const specs = String(text ?? '').split(/[,;\s]+/).filter(Boolean);
  const out = new Set();
  for (const spec of specs) {
    const [a, b] = parseOne(spec);
    if (out.size + (b - a + 1) > max) throw new Error(`Faixa grande demais (máximo ${max} endereços por varredura)`);
    for (let n = a; n <= b; n++) out.add(toIp(n));
  }
  return [...out];
}

/**
 * Faixas padrão a partir das interfaces locais ({ address, netmask }): a /24 de cada IPv4 privado.
 * Redes maiores que /24 ficam só na /24 do próprio computador (é onde as impressoras do setor costumam estar).
 */
function defaultRanges(ifaces) {
  const out = new Set();
  for (const i of ifaces) {
    const ip = toInt(i.address);
    if (ip == null) continue;
    const first = ip >>> 24;
    const second = (ip >>> 16) & 255;
    const priv = first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
    if (!priv) continue;
    const maskBits = i.netmask ? String(i.netmask).split('.').reduce((n, x) => n + (Number(x) >>> 0).toString(2).replace(/0/g, '').length, 0) : 24;
    const bits = Math.max(24, Math.min(30, maskBits));
    out.add(toIp((ip & ((~0 << (32 - bits)) >>> 0)) >>> 0) + '/' + bits);
  }
  return [...out];
}

module.exports = { expand, parseOne, defaultRanges, toInt, toIp, MAX_HOSTS };

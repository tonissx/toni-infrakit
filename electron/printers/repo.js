'use strict';
// Repositório de drivers da equipe: pastas (locais ou de rede, \\servidor\drivers) com drivers já extraídos.
// O app procura os .inf de impressora, lê os modelos e IDs de hardware de cada um e guarda um índice.
// Nada é baixado da internet: o que a equipe colocou na pasta é o que pode ser instalado.
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { decodeInf, parseInf, isPrinterInf } = require('../../src/printers/inf.js');

const MAX_DEPTH = 8;
const MAX_INF_BYTES = 8 * 1024 * 1024;
const MAX_ENTRIES = 50_000; // pasta gigante por engano não trava o app

/** Lista os .inf sob `root` (sem seguir atalhos). */
async function findInfs(root, { shouldStop = () => false } = {}) {
  const out = [];
  let seen = 0;
  const walk = async (dir, depth) => {
    if (depth > MAX_DEPTH || shouldStop() || seen > MAX_ENTRIES) return;
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      seen++;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p, depth + 1);
      else if (e.isFile() && /\.inf$/i.test(e.name)) out.push(p);
    }
  };
  await walk(root, 0);
  return out;
}

/**
 * Indexa as pastas. Retorna { entries: [{ inf, provider, driverVer, models }], errors: [{ dir, error }], scanned }.
 * onProgress({ done, total }) a cada arquivo lido.
 */
async function indexRepo(dirs, { onProgress = () => {}, shouldStop = () => false } = {}) {
  const errors = [];
  const files = [];
  for (const d of dirs) {
    try {
      const st = await fs.stat(d);
      if (!st.isDirectory()) throw new Error('não é uma pasta');
      files.push(...await findInfs(d, { shouldStop }));
    } catch (e) {
      errors.push({ dir: d, error: e.code === 'ENOENT' ? 'pasta não encontrada' : e.code === 'EACCES' || e.code === 'EPERM' ? 'sem permissão de leitura' : e.message });
    }
  }
  const entries = [];
  let done = 0;
  for (const f of files) {
    if (shouldStop()) break;
    try {
      const st = await fs.stat(f);
      if (st.size <= MAX_INF_BYTES) {
        const inf = parseInf(decodeInf(await fs.readFile(f)));
        if (isPrinterInf(inf) && inf.models.length) entries.push({ inf: f, provider: inf.provider, driverVer: inf.driverVer, models: inf.models.map((m) => ({ name: m.name, hwids: m.hwids })) });
      }
    } catch { /* .inf ilegível: segue */ }
    done++;
    if (done % 10 === 0 || done === files.length) onProgress({ done, total: files.length });
  }
  return { entries, errors, scanned: files.length, at: Date.now() };
}

/**
 * Copia a pasta do .inf para uma pasta local antes de instalar. A instalação roda elevada, e o processo elevado
 * não enxerga unidades de rede mapeadas (Z:) do usuário; com a cópia local, o pnputil sempre acha os arquivos.
 */
async function stageDriver(infPath) {
  const src = path.dirname(infPath);
  const id = crypto.createHash('sha1').update(src.toLowerCase()).digest('hex').slice(0, 12);
  const dest = path.join(os.tmpdir(), 'infrakit-drivers', id);
  await fs.rm(dest, { recursive: true, force: true });
  await fs.cp(src, dest, { recursive: true });
  return path.join(dest, path.basename(infPath));
}

module.exports = { indexRepo, findInfs, stageDriver };

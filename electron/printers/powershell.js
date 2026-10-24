'use strict';
// Executa scripts do Windows PowerShell 5.1 e lê a última linha JSON da saída.
// - run(): no usuário atual, via -EncodedCommand (nada vai para o disco).
// - runElevated(): como administrador. Grava o script num .ps1 temporário (pasta nova, só deste processo), sobe com
//   Start-Process -Verb RunAs (o Windows mostra o UAC) e lê o resultado de um arquivo. Cancelar o UAC vira
//   { cancelled: true } — sem exceção, para a interface tratar como escolha do usuário e não como erro.
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { q } = require('../../src/printers/ps.js');

const PS = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const BASE_ARGS = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass'];

const encode = (script) => Buffer.from(script, 'utf16le').toString('base64');

/** Última linha da saída que é JSON (scripts podem imprimir avisos antes). */
function lastJson(stdout) {
  const lines = String(stdout || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l[0] === '{' || l[0] === '[') {
      try { return JSON.parse(l); } catch { /* linha cortada: tenta a anterior */ }
    }
  }
  return null;
}

function exec(args, { timeout = 60_000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(PS, args, { windowsHide: true, timeout, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const json = lastJson(stdout);
      if (json) return resolve(json);
      const msg = (stderr || '').trim() || (err && err.message) || 'O PowerShell não devolveu resultado';
      reject(new Error(msg.split(/\r?\n/).slice(0, 6).join('\n')));
    });
  });
}

/** Roda no usuário atual. */
function run(script, opts) {
  return exec([...BASE_ARGS, '-EncodedCommand', encode(script)], opts);
}

/** Roda como administrador (UAC). Retorna o JSON do script, ou { cancelled: true }. */
async function runElevated(script, { timeout = 10 * 60_000 } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'infrakit-'));
  const file = path.join(dir, 'tarefa.ps1');
  const out = path.join(dir, 'resultado.json');
  try {
    // Envolve o script para gravar a saída num arquivo (o processo elevado não tem como devolver stdout para nós).
    const body = `$__r = & {\n${script}\n}\n[IO.File]::WriteAllText(${q(out)}, ((@($__r) | ForEach-Object { "$_" }) -join "\`n"), (New-Object System.Text.UTF8Encoding $false))\n`;
    await fs.writeFile(file, '\ufeff' + body, 'utf8'); // BOM: o PowerShell 5.1 lê .ps1 sem BOM como ANSI
    const launcher = `
$ErrorActionPreference = 'Stop'
try {
  $p = Start-Process -FilePath ${q(PS)} -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @('-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-WindowStyle','Hidden','-File',('"' + ${q(file)} + '"'))
  '{"code":' + $p.ExitCode + '}'
} catch {
  $e = $_.Exception; $cancel = $false
  while ($e) { if ($e -is [System.ComponentModel.Win32Exception] -and $e.NativeErrorCode -eq 1223) { $cancel = $true }; $e = $e.InnerException }
  '{"cancelled":' + $cancel.ToString().ToLower() + ',"error":' + ($_.Exception.Message | ConvertTo-Json) + '}'
}`;
    const launched = await exec([...BASE_ARGS, '-EncodedCommand', encode(launcher)], { timeout });
    if (launched.cancelled) return { cancelled: true };
    if (launched.error) throw new Error(launched.error);
    let text;
    try { text = await fs.readFile(out, 'utf8'); } catch { throw new Error('A tarefa como administrador terminou sem resultado (código ' + launched.code + ')'); }
    const json = lastJson(text);
    if (!json) throw new Error('Resultado ilegível da tarefa como administrador');
    return json;
  } finally {
    fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { run, runElevated, lastJson };

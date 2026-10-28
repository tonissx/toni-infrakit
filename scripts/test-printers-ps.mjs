// Testes dos scripts PowerShell gerados: node --test scripts/test-printers-ps.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { q, installScript, testPageScript, removeScript, setDefaultScript, ippHttpUrl, inventoryScript } = require('../src/printers/ps.js');

test('q escapa aspas simples (inclusive as tipográficas)', () => {
  assert.equal(q("Sala d'Água"), "'Sala d''Água'");
  assert.equal(q('Sala d’Água'), "'Sala d’’Água'");
  assert.equal(q('$(Remove-Item C:\\)'), "'$(Remove-Item C:\\)'"); // aspas simples: nada é interpretado
});

test('instalação TCP/IP com driver do repositório', () => {
  const s = installScript({ queue: 'Financeiro', method: 'driver', driver: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', source: 'repo',
    inf: 'C:\\Temp\\infrakit-drivers\\abc\\hpm404.inf', connection: 'tcp', ip: '10.0.0.25', port: 'raw', location: '2º andar' });
  assert.match(s, /pnputil\.exe \/add-driver 'C:\\Temp\\infrakit-drivers\\abc\\hpm404\.inf' \/install/);
  assert.match(s, /Add-PrinterDriver -Name 'HP LaserJet Pro M404-M405 PCL 6 \(V3\)'/);
  assert.match(s, /Add-PrinterPort -Name 'IP_10\.0\.0\.25' -PrinterHostAddress '10\.0\.0\.25'/);
  assert.match(s, /Add-Printer -Name 'Financeiro' -DriverName 'HP LaserJet Pro M404-M405 PCL 6 \(V3\)' -PortName 'IP_10\.0\.0\.25'/);
  assert.match(s, /Set-Printer -Name 'Financeiro' -Location '2º andar'/);
  assert.match(s, /ConvertTo-Json/);
});

test('driver já instalado não chama pnputil nem Add-PrinterDriver', () => {
  const s = installScript({ queue: 'X', method: 'driver', driver: 'D', source: 'installed', connection: 'tcp', ip: '10.0.0.5', port: 'raw' });
  assert.doesNotMatch(s, /pnputil\.exe \/add-driver/);
  assert.doesNotMatch(s, /Add-PrinterDriver/);
});

test('IPP usa Add-Printer -IppURL com http', () => {
  const s = installScript({ queue: 'Epson', method: 'ipp', connection: 'tcp', ip: '10.0.0.77', ippUri: 'ipp://10.0.0.77:631/ipp/print' });
  assert.match(s, /Add-Printer -Name 'Epson' -IppURL 'http:\/\/10\.0\.0\.77:631\/ipp\/print'/);
  assert.equal(ippHttpUrl('ipps://h:443/ipp/print'), 'https://h:443/ipp/print');
  assert.equal(ippHttpUrl(null, '10.0.0.1'), 'http://10.0.0.1:631/ipp/print');
});

test('LPR, USB e WSD', () => {
  assert.match(installScript({ queue: 'L', method: 'driver', driver: 'D', source: 'installed', connection: 'tcp', ip: '10.0.0.8', port: 'lpr' }),
    /Add-PrinterPort -Name 'LPR_10\.0\.0\.8' -LprHostAddress '10\.0\.0\.8' -LprQueueName 'lp'/);
  const usb = installScript({ queue: 'U', method: 'driver', driver: 'D', source: 'repo', inf: 'C:\\x.inf', connection: 'usb' });
  assert.match(usb, /pnputil\.exe \/scan-devices/);
  assert.match(usb, /Name -like 'USB\*'/);
  const wsd = installScript({ queue: 'W', method: 'driver', driver: 'D', source: 'repo', inf: 'C:\\x.inf', connection: 'wsd' });
  assert.match(wsd, /não criou a fila WSD/);
  assert.doesNotMatch(wsd, /Name -like 'USB\*'/);
});

test('nome de fila com aspas não quebra o script', () => {
  const s = installScript({ queue: "Sala d'Água", method: 'ipp', connection: 'tcp', ip: '10.0.0.1' });
  assert.match(s, /Add-Printer -Name 'Sala d''Água'/);
});

test('teste, remoção, padrão e inventário', () => {
  assert.match(testPageScript('Financeiro', 15), /PrintTestPage/);
  assert.match(testPageScript('Financeiro', 15), /-lt 15\)/);
  assert.match(removeScript('Financeiro'), /Remove-Printer -Name 'Financeiro'/);
  assert.match(setDefaultScript('Financeiro'), /SetDefaultPrinter\('Financeiro'\)/);
  const inv = inventoryScript();
  for (const cmd of ['Get-Printer', 'Get-PrinterPort', 'Get-PrinterDriver', 'Win32_PnPEntity']) assert.ok(inv.includes(cmd), cmd);
});

test('preferências: um passo por item, valores escapados, enum inválido descartado', async () => {
  const { applyPrefsScript, installScript: inst } = require('../src/printers/ps.js');
  const s = applyPrefsScript("Fila d'Água", { paperSize: 'ISOA4', inputBin: 'Cassette; calc', orientation: 'Landscape', duplex: 'TwoSidedLongEdge', color: true });
  assert.match(s, /Set-PrintConfiguration -PrinterName 'Fila d''Água' -DuplexingMode 'TwoSidedLongEdge'/);
  assert.match(s, /-Color \$true/);
  assert.match(s, /PageMediaSizeName\]::ISOA4/);
  assert.match(s, /PageOrientation\]::Landscape/);
  assert.doesNotMatch(s, /calc/); // nome de enum com ; nunca entra no script
  assert.match(s, /SoftStep 'Preferência: tamanho do papel'/);
  assert.doesNotMatch(inst({ queue: 'X', method: 'ipp', ip: '1.1.1.1' }), /SoftStep/); // sem perfil, nada muda
});

test('instalação remota: copia o driver, roda o script dentro da sessão e limpa no fim', async () => {
  const { remoteInstallScript, preflightScript } = require('../src/printers/ps.js');
  const plan = { queue: "Fila d'Água", method: 'driver', driver: 'D', source: 'repo', inf: 'C:\\ProgramData\\Toni Infrakit\\drivers\\h\\a.inf',
    connection: 'tcp', ip: '10.0.0.5', port: 'raw', prefs: { duplex: 'OneSided' } };
  const s = remoteInstallScript('PC-01', plan, { srcDir: 'C:\\Temp\\h', dir: 'C:\\ProgramData\\Toni Infrakit\\drivers\\h' });
  assert.match(s, /^# IK-REMOTE$/m);
  assert.match(s, /New-PSSession -ComputerName \$computer/);
  assert.match(s, /Copy-Item -Path \(Join-Path 'C:\\Temp\\h' '\*'\) -Destination 'C:\\ProgramData\\Toni Infrakit\\drivers\\h' -ToSession \$s/);
  assert.match(s, /Remove-Item -Recurse -Force/);
  assert.match(s, /Fila d''''Água/); // aspas dobradas duas vezes: valor dentro do script que vai dentro de uma string
  const inner = s.slice(s.indexOf('[scriptblock]::Create('));
  assert.doesNotMatch(inner, /OutputEncoding/); // não existe console numa sessão remota
  assert.ok(s.includes("-match '^\\s*\\{'")); // a regex que acha o JSON de volta sobrevive ao template
  const noCopy = remoteInstallScript('PC-01', { ...plan, source: 'installed', inf: null }, {});
  assert.doesNotMatch(noCopy, /Copy-Item/);
  // WinRM: só liga quando não responde, pelo WMI, e antes de abrir a sessão
  assert.match(s, /if \(-not \(Test-WSMan -ComputerName \$computer/);
  assert.match(s, /Invoke-WmiMethod -ComputerName \$computer -Class Win32_Process -Name Create -ArgumentList 'cmd \/c winrm quickconfig -q'/);
  assert.ok(s.indexOf('Invoke-WmiMethod') < s.indexOf('New-PSSession'));
  assert.match(preflightScript(["A'B", 'C'], { queue: 'Q' }), /@\('A''B', 'C'\)/);
});

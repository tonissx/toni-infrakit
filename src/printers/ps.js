'use strict';
// Scripts PowerShell (Windows PowerShell 5.1) gerados a partir de dados: inventário, instalação, página de teste,
// remoção e impressora padrão. Puro e testável; quem executa é electron/printers/powershell.js.
// Todo valor vindo de fora (nome de fila, driver, caminho, IP) entra como string entre aspas simples via q().
// Cada script termina escrevendo UMA linha JSON (a última da saída).

/** Literal PowerShell entre aspas simples. O PowerShell também fecha a string com ‘ ’ ‚ ‛: todas são dobradas. */
const q = (s) => "'" + String(s ?? '').replace(/['‘’‚‛]/g, '$&$&') + "'";

const PRELUDE = [
  "$ErrorActionPreference = 'Stop'",
  '$ProgressPreference = \'SilentlyContinue\'',
  '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
].join('\n');

/** Filas, portas, drivers e dispositivos PnP de impressora deste computador. Não precisa de admin. */
function inventoryScript() {
  return `${PRELUDE}
$ErrorActionPreference = 'SilentlyContinue'
$printers = @(Get-Printer | Select-Object Name, DriverName, PortName, Shared, ShareName, Location, Comment,
  @{n='Type';e={"$($_.Type)"}}, @{n='Status';e={"$($_.PrinterStatus)"}})
$ports = @(Get-PrinterPort | Select-Object Name, PrinterHostAddress, PortMonitor, Description)
$drivers = @(Get-PrinterDriver | Select-Object Name, Manufacturer, InfPath, PrinterEnvironment, @{n='Version';e={"$($_.MajorVersion)"}})
$win = @(Get-CimInstance Win32_Printer | Select-Object Name, Default, WorkOffline, PrinterStatus, DetectedErrorState)
$pnp = @(Get-CimInstance Win32_PnPEntity | Where-Object {
    $_.PNPDeviceID -match '^(USBPRINT|WSDPRINT)\\\\' -or $_.PNPClass -eq 'Printer' -or
    (@($_.CompatibleID) -match '^USB\\\\Class_07').Count -gt 0
  } | Select-Object Name, Manufacturer, PNPDeviceID, PNPClass, Status, ConfigManagerErrorCode, HardwareID, CompatibleID)
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$os = Get-CimInstance Win32_OperatingSystem | Select-Object Caption, Version, BuildNumber
[ordered]@{ printers = $printers; ports = $ports; drivers = $drivers; win = $win; pnp = $pnp; isAdmin = $isAdmin; os = $os; computer = $env:COMPUTERNAME } | ConvertTo-Json -Depth 4 -Compress`;
}

/** Cabeçalho comum dos scripts que executam passos: cada passo registra ok/erro e o primeiro erro interrompe. */
const STEPS_HEAD = `${PRELUDE}
$steps = New-Object System.Collections.ArrayList
$result = [ordered]@{ ok = $false; queue = $null; reboot = $false; error = $null }
function Step([string]$label, [scriptblock]$body) {
  try {
    $out = & $body
    [void]$steps.Add([ordered]@{ label = $label; ok = $true; detail = (($out | Out-String).Trim()) })
  } catch {
    [void]$steps.Add([ordered]@{ label = $label; ok = $false; detail = $_.Exception.Message })
    throw
  }
}`;

const STEPS_TAIL = `$result.steps = @($steps)
$result | ConvertTo-Json -Depth 5 -Compress`;

/** URI IPP para o Add-Printer -IppURL (ele quer http/https). */
function ippHttpUrl(uri, ip) {
  if (uri) return String(uri).replace(/^ipps:/i, 'https:').replace(/^ipp:/i, 'http:');
  return 'http://' + ip + ':631/ipp/print';
}

/**
 * Instalação. plan: {
 *   queue, method: 'driver'|'ipp', driver, source: 'repo'|'installed'|'class', inf (local, já copiado),
 *   connection: 'tcp'|'usb', ip, port: 'raw'|'lpr', lprQueue, ippUri, location, comment
 * }
 * Precisa rodar como administrador (pnputil, Add-PrinterDriver, Add-Printer de fila local).
 */
function installScript(plan) {
  const lines = [STEPS_HEAD, 'try {'];
  const queue = q(plan.queue);
  lines.push(`  if (Get-Printer -Name ${queue} -ErrorAction SilentlyContinue) { throw ('Já existe uma fila chamada ' + ${queue} + '. Escolha outro nome.') }`);

  if (plan.method === 'ipp') {
    const url = ippHttpUrl(plan.ippUri, plan.ip);
    lines.push(`  Step 'Criar fila IPP (driver de classe da Microsoft)' { Add-Printer -Name ${queue} -IppURL ${q(url)}; ${q(url)} }`);
  } else {
    const drv = q(plan.driver);
    if (plan.source === 'repo') {
      lines.push(`  Step 'Adicionar o pacote do driver ao Windows (pnputil)' {
    $o = & pnputil.exe /add-driver ${q(plan.inf)} /install 2>&1 | Out-String
    if ($LASTEXITCODE -eq 3010) { $result.reboot = $true }
    elseif ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 259) { throw ("pnputil terminou com código $LASTEXITCODE. " + $o.Trim()) }
    $o.Trim()
  }`);
    }
    if (plan.source !== 'installed') {
      lines.push(`  Step 'Registrar o driver de impressora' {
    if (-not (Get-PrinterDriver -Name ${drv} -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name ${drv} }
    ${drv}
  }`);
    }
    if (plan.connection === 'wsd') {
      // WSD: a fila nasce do próprio aparelho anunciado; só dá para pedir ao Windows que reenumere.
      lines.push(`  Step 'Pedir ao Windows para criar a fila (WSD)' {
    $before = @(Get-Printer | ForEach-Object { $_.Name })
    $null = & pnputil.exe /scan-devices 2>&1
    $found = $null
    for ($i = 0; $i -lt 10 -and -not $found; $i++) {
      Start-Sleep -Seconds 1
      $found = Get-Printer | Where-Object { $before -notcontains $_.Name -and $_.DriverName -eq ${drv} } | Select-Object -First 1
    }
    if (-not $found) { throw 'O driver foi instalado, mas o Windows não criou a fila WSD. Se a impressora tem IP, instale pela rede (TCP/IP).' }
    if ($found.Name -ne ${queue}) { Rename-Printer -Name $found.Name -NewName ${queue} }
    'Fila criada pelo Windows'
  }`);
    } else if (plan.connection === 'usb') {
      // O Windows costuma criar a fila sozinho quando o driver chega e o aparelho é reenumerado.
      lines.push(`  Step 'Criar a fila na porta USB' {
    $before = @(Get-Printer | ForEach-Object { $_.Name })
    $null = & pnputil.exe /scan-devices 2>&1
    $found = $null
    for ($i = 0; $i -lt 8 -and -not $found; $i++) {
      Start-Sleep -Seconds 1
      $found = Get-Printer | Where-Object { $before -notcontains $_.Name -and $_.DriverName -eq ${drv} } | Select-Object -First 1
    }
    if ($found) {
      if ($found.Name -ne ${queue}) { Rename-Printer -Name $found.Name -NewName ${queue} }
      'O Windows criou a fila ao reconhecer o aparelho'
    } else {
      $used = @(Get-Printer | ForEach-Object { $_.PortName })
      $free = Get-PrinterPort | Where-Object { $_.Name -like 'USB*' -and $used -notcontains $_.Name } | Sort-Object Name | Select-Object -First 1
      if (-not $free) { throw 'Nenhuma porta USB livre. Confira o cabo e se o aparelho está ligado, e tente de novo.' }
      Add-Printer -Name ${queue} -DriverName ${drv} -PortName $free.Name
      'Fila criada na porta ' + $free.Name
    }
  }`);
    } else {
      const lpr = plan.port === 'lpr';
      const portName = q((lpr ? 'LPR_' : 'IP_') + plan.ip);
      const add = lpr
        ? `Add-PrinterPort -Name ${portName} -LprHostAddress ${q(plan.ip)} -LprQueueName ${q(plan.lprQueue || 'lp')} -LprByteCounting`
        : `Add-PrinterPort -Name ${portName} -PrinterHostAddress ${q(plan.ip)}`;
      lines.push(`  Step 'Criar a porta TCP/IP' {
    if (-not (Get-PrinterPort -Name ${portName} -ErrorAction SilentlyContinue)) { ${add}; 'Porta criada' } else { 'Porta já existia' }
  }`);
      lines.push(`  Step 'Criar a fila de impressão' { Add-Printer -Name ${queue} -DriverName ${drv} -PortName ${portName}; ${queue} }`);
    }
  }
  if (plan.location || plan.comment) {
    const args = [plan.location ? `-Location ${q(plan.location)}` : '', plan.comment ? `-Comment ${q(plan.comment)}` : ''].filter(Boolean).join(' ');
    lines.push(`  Step 'Gravar local e comentário' { Set-Printer -Name ${queue} ${args}; 'ok' }`);
  }
  lines.push(`  $result.queue = ${queue}`, '  $result.ok = $true', '} catch {', '  $result.error = $_.Exception.Message', '}', STEPS_TAIL);
  return lines.join('\n');
}

/**
 * Página de teste do Windows na fila e acompanha o trabalho por até `waitSeconds`.
 * Retorna { ok, sent, cleared, jobs: [{ status, pages }], printerStatus, error }. Não precisa de admin.
 */
function testPageScript(queue, waitSeconds = 20) {
  return `${PRELUDE}
$r = [ordered]@{ ok = $false; sent = $false; cleared = $false; jobs = @(); printerStatus = $null; error = $null; seconds = 0 }
try {
  $p = Get-CimInstance Win32_Printer | Where-Object { $_.Name -eq ${q(queue)} } | Select-Object -First 1
  if (-not $p) { throw 'Fila não encontrada' }
  $ret = Invoke-CimMethod -InputObject $p -MethodName PrintTestPage
  if ($ret.ReturnValue -ne 0) { throw ('O Windows recusou a página de teste (código ' + $ret.ReturnValue + ')') }
  $r.sent = $true
  $sw = [Diagnostics.Stopwatch]::StartNew()
  do {
    Start-Sleep -Milliseconds 800
    $jobs = @(Get-PrintJob -PrinterName ${q(queue)} -ErrorAction SilentlyContinue)
    $bad = @($jobs | Where-Object { "$($_.JobStatus)" -match 'Error|Offline|PaperOut|Blocked|UserIntervention' })
    if ($bad.Count) { break }
  } while ($jobs.Count -gt 0 -and $sw.Elapsed.TotalSeconds -lt ${Number(waitSeconds) || 20})
  $r.seconds = [math]::Round($sw.Elapsed.TotalSeconds, 1)
  $r.jobs = @($jobs | ForEach-Object { [ordered]@{ status = "$($_.JobStatus)"; pages = $_.PagesPrinted; total = $_.TotalPages } })
  $r.cleared = ($jobs.Count -eq 0)
  $r.printerStatus = "$((Get-Printer -Name ${q(queue)}).PrinterStatus)"
  $r.ok = $r.cleared -and -not $bad.Count
} catch { $r.error = $_.Exception.Message }
$r | ConvertTo-Json -Depth 4 -Compress`;
}

/** Remove a fila (e a porta TCP/IP, se nenhuma outra fila usa). Precisa de admin. */
function removeScript(queue) {
  return `${STEPS_HEAD}
try {
  $p = Get-Printer -Name ${q(queue)}
  $port = $p.PortName
  Step 'Cancelar trabalhos pendentes' { Get-PrintJob -PrinterName ${q(queue)} -ErrorAction SilentlyContinue | Remove-PrintJob; 'ok' }
  Step 'Remover a fila' { Remove-Printer -Name ${q(queue)}; ${q(queue)} }
  if ($port -match '^(IP|LPR)_') {
    Step 'Remover a porta sem uso' {
      if (-not (Get-Printer | Where-Object { $_.PortName -eq $port })) { Remove-PrinterPort -Name $port; $port } else { 'Porta mantida (outra fila usa)' }
    }
  }
  $result.ok = $true
} catch { $result.error = $_.Exception.Message }
${STEPS_TAIL}`;
}

/** Impressora padrão do usuário atual (por isso roda sem elevação). */
function setDefaultScript(queue) {
  return `${PRELUDE}
$r = [ordered]@{ ok = $false; error = $null }
try { (New-Object -ComObject WScript.Network).SetDefaultPrinter(${q(queue)}); $r.ok = $true } catch { $r.error = $_.Exception.Message }
$r | ConvertTo-Json -Compress`;
}

/** Abre a fila de impressão do Windows (janela "Ver o que está sendo impresso"). */
function openQueueScript(queue) {
  return `${PRELUDE}
Start-Process rundll32.exe -ArgumentList ('printui.dll,PrintUIEntry /o /n "' + ${q(queue)} + '"')
'{"ok":true}'`;
}

module.exports = { q, inventoryScript, installScript, testPageScript, removeScript, setDefaultScript, openQueueScript, ippHttpUrl };

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
 * Passos "moleculares" das preferências (cada um falha sozinho, sem interromper o script: nem todo driver suporta tudo).
 * prefs já normalizado (profiles.normalizePrefs); os valores ainda passam por q().
 */
function prefsLines(queue, prefs, indent = '  ') {
  const qn = q(queue);
  const out = [`${indent}function SoftStep([string]$label, [scriptblock]$body) {
${indent}  try { $o = & $body; [void]$steps.Add([ordered]@{ label = $label; ok = $true; detail = (($o | Out-String).Trim()) }) }
${indent}  catch { [void]$steps.Add([ordered]@{ label = $label; ok = $false; detail = 'Não aplicado: ' + $_.Exception.Message }) }
${indent}}`];
  const items = [
    ['duplex', 'frente e verso', (v) => `-DuplexingMode ${q(v)}`],
    ['color', 'cor', (v) => `-Color $${!!v}`],
    ['collate', 'agrupar cópias', (v) => `-Collate $${!!v}`],
  ];
  // Um Set-PrintConfiguration por item, para que o driver que não suporta um deles não derrube os outros.
  for (const [k, label, arg] of items) {
    if (prefs[k] === undefined) continue;
    out.push(`${indent}SoftStep ${q('Preferência: ' + label)} { Set-PrintConfiguration -PrinterName ${qn} ${arg(prefs[k])}; 'ok' }`);
  }
  // Papel, orientação e bandeja vão pelo PrintTicket padrão da fila (os nomes são os da própria fila, ex. ISOA4).
  // Nomes de enum entram sem aspas no script: só passam se forem identificadores simples.
  const ident = (v) => (/^[A-Za-z0-9_]{1,40}$/.test(String(v || '')) ? v : null);
  const tickets = [
    [ident(prefs.paperSize), 'tamanho do papel', (v) => `$t.PageMediaSize = New-Object System.Printing.PageMediaSize([System.Printing.PageMediaSizeName]::${v})`],
    [ident(prefs.orientation), 'orientação', (v) => `$t.PageOrientation = [System.Printing.PageOrientation]::${v}`],
    [ident(prefs.inputBin), 'origem do papel', (v) => `$t.InputBin = [System.Printing.InputBin]::${v}`],
  ];
  if (tickets.some(([v]) => v)) {
    out.push(`${indent}function TicketSet([scriptblock]$edit) {
${indent}  Add-Type -AssemblyName System.Printing
${indent}  $pq = (New-Object System.Printing.LocalPrintServer).GetPrintQueue(${qn}, [string[]]@(), [System.Printing.PrintSystemDesiredAccess]::AdministratePrinter)
${indent}  $t = $pq.DefaultPrintTicket
${indent}  & $edit
${indent}  $pq.DefaultPrintTicket = $t
${indent}  $pq.Commit()
${indent}  'ok'
${indent}}`);
    for (const [v, label, set] of tickets) if (v) out.push(`${indent}SoftStep ${q('Preferência: ' + label)} { TicketSet { ${set(v)} } }`);
  }
  return out;
}

/** Aplica as preferências de um perfil a uma fila existente. Precisa de admin. Nunca falha como um todo: veja os passos. */
function applyPrefsScript(queue, prefs) {
  return `${STEPS_HEAD}
try {
  if (-not (Get-Printer -Name ${q(queue)} -ErrorAction SilentlyContinue)) { throw 'Fila não encontrada' }
${prefsLines(queue, prefs).join('\n')}
  $result.ok = $true
} catch { $result.error = $_.Exception.Message }
${STEPS_TAIL}`;
}

/** Tamanhos de papel e bandejas que a fila declara suportar. Não precisa de admin. */
function capabilitiesScript(queue) {
  return `${PRELUDE}
$r = [ordered]@{ ok = $false; paperSizes = @(); inputBins = @(); duplex = $false; color = $false; error = $null }
try {
  Add-Type -AssemblyName System.Printing
  $srv = New-Object System.Printing.LocalPrintServer
  $pq = $srv.GetPrintQueue(${q(queue)})
  $c = $pq.GetPrintCapabilities()
  $r.paperSizes = @($c.PageMediaSizeCapability | ForEach-Object { "$($_.PageMediaSizeName)" } | Where-Object { $_ -and $_ -ne 'Unknown' } | Select-Object -Unique)
  $r.inputBins = @($c.InputBinCapability | ForEach-Object { "$_" } | Select-Object -Unique)
  $r.duplex = (@($c.DuplexingCapability) -contains [System.Printing.Duplexing]::TwoSidedLongEdge)
  $r.color = (@($c.OutputColorCapability) -contains [System.Printing.OutputColor]::Color)
  $r.ok = $true
} catch { $r.error = $_.Exception.Message }
$r | ConvertTo-Json -Depth 3 -Compress`;
}

/**
 * Computadores do domínio (Active Directory) via ADSI: não precisa do RSAT. Só máquinas Windows habilitadas.
 * Retorna { ok, computers: [{ name, dns, os, lastLogon (ISO) }], error }. Não precisa de admin.
 */
function adComputersScript() {
  return `${PRELUDE}
$r = [ordered]@{ ok = $false; computers = @(); error = $null }
try {
  $s = [adsisearcher]'(&(objectCategory=computer)(operatingSystem=*Windows*)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))'
  $s.PageSize = 1000
  [void]$s.PropertiesToLoad.AddRange(@('name', 'dnshostname', 'operatingsystem', 'lastlogontimestamp'))
  $list = New-Object System.Collections.ArrayList
  foreach ($x in $s.FindAll()) {
    $p = $x.Properties
    $ll = $null
    if ($p['lastlogontimestamp'].Count) { $ll = [DateTime]::FromFileTime([int64]$p['lastlogontimestamp'][0]).ToString('o') }
    [void]$list.Add([ordered]@{ name = "$($p['name'][0])"; dns = "$($p['dnshostname'][0])"; os = "$($p['operatingsystem'][0])"; lastLogon = $ll })
  }
  $r.computers = @($list | Sort-Object { $_.name })
  $r.ok = $true
} catch { $r.error = $_.Exception.Message }
$r | ConvertTo-Json -Depth 4 -Compress`;
}

/**
 * Confere se dá para instalar nos computadores: WinRM responde, 64 bits, spooler, fila/driver já existentes.
 * Tudo em paralelo (Invoke-Command com vários destinos). Retorna uma lista [{ computer, ok, error, x64, os, queueExists, driverInstalled }].
 */
function preflightScript(computers, { queue = '', driver = '' } = {}) {
  return `${PRELUDE}
# IK-PREFLIGHT
$names = @(${computers.map(q).join(', ')})
$errs = @()
$res = @(Invoke-Command -ComputerName $names -ErrorAction SilentlyContinue -ErrorVariable errs -SessionOption (New-PSSessionOption -OpenTimeout 15000) -ArgumentList ${q(queue)}, ${q(driver)} -ScriptBlock {
  param($queue, $driver)
  [pscustomobject]@{
    x64 = [Environment]::Is64BitOperatingSystem
    os = (Get-CimInstance Win32_OperatingSystem).Caption
    spooler = "$((Get-Service Spooler).Status)"
    queueExists = [bool]($queue -and (Get-Printer -Name $queue -ErrorAction SilentlyContinue))
    driverInstalled = [bool]($driver -and (Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue))
  }
})
$fail = @{}
foreach ($e in $errs) { $t = "$($e.TargetObject)"; if ($t -and -not $fail.ContainsKey($t)) { $fail[$t] = ("$($e.Exception.Message)" -split "\\r?\\n")[0] } }
$out = foreach ($n in $names) {
  $hit = $res | Where-Object { $_.PSComputerName -eq $n } | Select-Object -First 1
  if ($hit) { [ordered]@{ computer = $n; ok = $true; error = $null; x64 = $hit.x64; os = $hit.os; spooler = $hit.spooler; queueExists = $hit.queueExists; driverInstalled = $hit.driverInstalled } }
  else { [ordered]@{ computer = $n; ok = $false; error = $(if ($fail.ContainsKey($n)) { $fail[$n] } else { 'Sem resposta' }) } }
}
ConvertTo-Json -InputObject @($out) -Depth 3 -Compress`;
}

/**
 * Instala a fila em UM computador remoto (PowerShell Remoting, com o usuário atual: sem UAC nem senha).
 * plan é o mesmo do installScript, mas só TCP/IP ou IPP, com plan.inf já apontando para remote.dir.
 * remote: { srcDir, dir } — pasta do driver nesta máquina e onde ela será copiada lá (removida no fim).
 * Retorna { computer, ok, queue, reboot, error, steps }.
 */
function remoteInstallScript(computer, plan, remote = {}) {
  // [Console]::OutputEncoding falha numa sessão remota sem console; o resto do script de instalação roda igual.
  const inner = installScript(plan).replace(/\[Console\]::OutputEncoding[^\n]*\n/, '');
  const copy = remote.srcDir ? `
  Step 'Copiar o driver para o computador' {
    Invoke-Command -Session $s -ScriptBlock { param($d) New-Item -ItemType Directory -Force -Path $d | Out-Null } -ArgumentList ${q(remote.dir)}
    Copy-Item -Path (Join-Path ${q(remote.srcDir)} '*') -Destination ${q(remote.dir)} -ToSession $s -Recurse -Force
    ${q(remote.dir)}
  }` : '';
  return `${PRELUDE}
# IK-REMOTE
$computer = ${q(computer)}
$steps = New-Object System.Collections.ArrayList
$r = [ordered]@{ computer = $computer; ok = $false; queue = $null; reboot = $false; error = $null }
function Step([string]$label, [scriptblock]$body) {
  try { $o = & $body; [void]$steps.Add([ordered]@{ label = $label; ok = $true; detail = (($o | Out-String).Trim()) }) }
  catch { [void]$steps.Add([ordered]@{ label = $label; ok = $false; detail = $_.Exception.Message }); throw }
}
$s = $null
try {
  # WinRM desligado: liga pelo WMI (DCOM), que não depende dele, e espera passar a responder. Se já responde, esta etapa nem aparece.
  if (-not (Test-WSMan -ComputerName $computer -ErrorAction SilentlyContinue)) {
    Step 'Ativar o WinRM (estava desligado)' {
      $w = Invoke-WmiMethod -ComputerName $computer -Class Win32_Process -Name Create -ArgumentList 'cmd /c winrm quickconfig -q' -ErrorAction Stop
      if ($w.ReturnValue -ne 0) { throw "O Windows recusou iniciar o comando (código $($w.ReturnValue))" }
      $up = $false
      for ($i = 0; $i -lt 10 -and -not $up; $i++) { Start-Sleep -Seconds 2; $up = [bool](Test-WSMan -ComputerName $computer -ErrorAction SilentlyContinue) }
      if (-not $up) { throw 'O comando rodou, mas o WinRM não passou a responder (rede com perfil público ou política do domínio?)' }
      'WinRM ativado'
    }
  }
  Step 'Conectar ao computador (WinRM)' {
    $script:s = New-PSSession -ComputerName $computer -SessionOption (New-PSSessionOption -OpenTimeout 15000) -ErrorAction Stop
    $computer
  }${copy}
  $out = Invoke-Command -Session $s -ScriptBlock ([scriptblock]::Create(${q(inner)}))
  $line = @($out | ForEach-Object { "$_" } | Where-Object { $_ -match '^\\s*\\{' }) | Select-Object -Last 1
  if (-not $line) { throw 'O computador não devolveu resultado da instalação' }
  $in = $line | ConvertFrom-Json
  foreach ($x in @($in.steps)) { [void]$steps.Add([ordered]@{ label = $x.label; ok = [bool]$x.ok; detail = "$($x.detail)" }) }
  $r.ok = [bool]$in.ok; $r.queue = $in.queue; $r.reboot = [bool]$in.reboot; $r.error = $in.error
} catch { $r.error = $_.Exception.Message }
finally {
  if ($s) {${remote.srcDir ? `
    try { Invoke-Command -Session $s -ScriptBlock { param($d) Remove-Item -Recurse -Force -Path $d -ErrorAction SilentlyContinue } -ArgumentList ${q(remote.dir)} } catch {}` : ''}
    Remove-PSSession $s -ErrorAction SilentlyContinue
  }
}
$r.steps = @($steps)
$r | ConvertTo-Json -Depth 6 -Compress`;
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
  if (plan.prefs && Object.keys(plan.prefs).length) lines.push(...prefsLines(plan.queue, plan.prefs));
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

/**
 * Página de teste numa fila de OUTRO computador (PowerShell Remoting, usuário atual): o mesmo testPageScript, rodando lá dentro.
 * Retorna o mesmo formato do testPageScript, ou { ok:false, error } se não conseguiu conectar.
 */
function remoteTestScript(computer, queue, waitSeconds = 20) {
  const inner = testPageScript(queue, waitSeconds).replace(/\[Console\]::OutputEncoding[^\n]*\n/, '');
  return `${PRELUDE}
# IK-RTEST
try {
  $out = Invoke-Command -ComputerName ${q(computer)} -SessionOption (New-PSSessionOption -OpenTimeout 15000) -ErrorAction Stop -ScriptBlock ([scriptblock]::Create(${q(inner)}))
  $line = @($out | ForEach-Object { "$_" } | Where-Object { $_ -match '^\\s*\\{' }) | Select-Object -Last 1
  if (-not $line) { throw 'O computador não devolveu resultado do teste' }
  $line
} catch { [ordered]@{ ok = $false; sent = $false; cleared = $false; jobs = @(); error = $_.Exception.Message } | ConvertTo-Json -Compress }`;
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

module.exports = { q, adComputersScript, preflightScript, remoteInstallScript, remoteTestScript, inventoryScript, applyPrefsScript, capabilitiesScript, installScript, testPageScript, removeScript, setDefaultScript, openQueueScript, ippHttpUrl };

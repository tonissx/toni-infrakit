'use strict';
// Modo demonstração (npm run demo): PowerShell, rede e repositório simulados, com um parque de impressoras fictício.
// Nada toca no Windows: instalar, testar, remover e definir padrão só mudam o inventário em memória.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const supplies = (list) => list.map(([name, pct]) => ({ name, level: pct, max: 100, pct, some: false }));

function createDemo() {
  const inventory = {
    computer: 'SUPORTE-01',
    isAdmin: false,
    os: { Caption: 'Microsoft Windows 11 Pro', Version: '10.0.26200', BuildNumber: '26200' },
    printers: [
      { Name: 'Financeiro - HP M404', DriverName: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', PortName: 'IP_10.0.10.21', Status: 'Normal', Location: 'Financeiro, 2º andar' },
      { Name: 'RH - Brother', DriverName: 'Brother HL-L2350DW series', PortName: 'IP_10.0.10.34', Status: 'PaperOut', Location: 'RH' },
      { Name: 'Diretoria (antiga)', DriverName: 'HP LaserJet P2055 PCL6', PortName: 'IP_10.0.10.90', Status: 'Offline' },
      { Name: 'Microsoft Print to PDF', DriverName: 'Microsoft Print To PDF', PortName: 'PORTPROMPT:', Status: 'Normal' },
      { Name: 'Microsoft XPS Document Writer', DriverName: 'Microsoft XPS Document Writer v4', PortName: 'PORTPROMPT:', Status: 'Normal' },
    ],
    ports: [
      { Name: 'IP_10.0.10.21', PrinterHostAddress: '10.0.10.21' },
      { Name: 'IP_10.0.10.34', PrinterHostAddress: '10.0.10.34' },
      { Name: 'IP_10.0.10.90', PrinterHostAddress: '10.0.10.90' },
      { Name: 'USB001' },
      { Name: 'PORTPROMPT:' },
    ],
    drivers: [
      { Name: 'HP LaserJet Pro M404-M405 PCL 6 (V3)' },
      { Name: 'Brother HL-L2350DW series' },
      { Name: 'HP LaserJet P2055 PCL6' },
      { Name: 'Microsoft IPP Class Driver' },
      { Name: 'Microsoft Print To PDF' },
      { Name: 'Microsoft XPS Document Writer v4' },
    ],
    win: [{ Name: 'Financeiro - HP M404', Default: true, WorkOffline: false }],
    pnp: [
      // USB sem driver (código 28): o Windows só sabe o nome pelo 1284.
      { Name: 'EPSON L3250 Series', Manufacturer: 'EPSON', PNPDeviceID: 'USBPRINT\\EPSONL3250_SERIESE0A1\\7&2F1A3C&0&USB001', HardwareID: ['USBPRINT\\EPSONL3250_SERIESE0A1', 'EPSONL3250_SERIESE0A1'], ConfigManagerErrorCode: 28 },
      { Name: 'Zebra ZD220', Manufacturer: '', PNPDeviceID: 'USBPRINT\\ZEBRA_TECHNOLOGIESZTC_ZD220-203DPI_ZPLB0C4\\7&11&0&USB002', HardwareID: ['USBPRINT\\ZEBRA_TECHNOLOGIESZTC_ZD220-203DPI_ZPLB0C4'], ConfigManagerErrorCode: 28 },
    ],
  };

  const ipp = (makeModel, extra = {}) => ({
    makeModel, name: '', info: '', location: '', state: 'idle', reasons: [], deviceId: '', uris: [], uuid: '', moreInfo: '', color: false, duplex: true,
    formats: ['application/pdf', 'image/pwg-raster', 'image/urf'], versions: ['1.1', '2.0'], supplies: [], ...extra,
  });

  const network = [
    { ip: '10.0.10.21', ports: [631, 9100], hostname: 'npi-financeiro.empresa.local', ippUri: 'ipp://10.0.10.21:631/ipp/print',
      ipp: ipp('HP LaserJet Pro M404dn', { deviceId: 'MFG:HP;MDL:HP LaserJet Pro M404dn;CMD:PJL,PCL,PCLXL,POSTSCRIPT,PWG;', location: 'Financeiro, 2º andar' }),
      snmp: { sysDescr: 'HP ETHERNET MULTI-ENVIRONMENT', sysName: 'NPI8A1B2C', location: 'Financeiro', model: 'HP LaserJet Pro M404dn', serial: 'PHBQK12345', supplies: supplies([['Toner preto HP 58A', 34]]) } },
    { ip: '10.0.10.34', ports: [515, 9100], hostname: 'brw-rh.empresa.local',
      snmp: { sysDescr: 'Brother NC-8300w, Firmware Ver.1.20', sysName: 'BRW-RH', location: 'RH', model: 'Brother HL-L2350DW series', serial: 'E78123A0N456', supplies: supplies([['Toner preto TN-2370', 8], ['Cilindro DR-2370', 61]]) } },
    { ip: '10.0.10.40', ports: [631, 9100], hostname: 'epson-recepcao.empresa.local', ippUri: 'ipp://10.0.10.40:631/ipp/print',
      ipp: ipp('EPSON L4260 Series', { color: true, deviceId: 'MFG:EPSON;MDL:L4260 Series;CMD:ESCPL2,BDC,D4,ESCPR1,PWGRaster;', location: 'Recepção',
        supplies: [{ name: 'Black ink', level: 72, color: '#000000' }, { name: 'Cyan ink', level: 45, color: '#00FFFF' }, { name: 'Magenta ink', level: 18, color: '#FF00FF' }, { name: 'Yellow ink', level: 90, color: '#FFFF00' }] }) },
    { ip: '10.0.10.52', ports: [9100], hostname: null,
      snmp: { sysDescr: 'KYOCERA Document Solutions Printing System', sysName: 'KM-COMPRAS', location: 'Compras', model: 'ECOSYS M2040dn', serial: 'VCF8Z12345', supplies: supplies([['TK-1175', 55]]) } },
    { ip: '10.0.10.61', ports: [631, 9100], hostname: 'rnp-expedicao.empresa.local', ippUri: 'ipp://10.0.10.61:631/ipp/print',
      ipp: ipp('RICOH IM 430F', { state: 'stopped', reasons: ['media-empty-error'], location: 'Expedição' }),
      snmp: { sysDescr: 'RICOH IM 430F 1.02 / RICOH Network Printer C model', sysName: 'RNP-EXPEDICAO', location: 'Expedição', model: 'RICOH IM 430F', serial: '3110R123456', supplies: supplies([['Toner preto', 27]]) } },
    { ip: '10.0.10.77', ports: [9100], hostname: null, snmp: null },
  ];

  const mdns = [
    { instance: 'EPSON L4260 Series', service: '_ipp._tcp', host: 'EPSON-RECEPCAO.local', port: 631, ip: '10.0.10.40', txt: { ty: 'EPSON L4260 Series', usb_mfg: 'EPSON', rp: 'ipp/print' } },
  ];

  const repoEntries = [
    { inf: '\\\\fs01\\drivers\\HP\\LaserJet Pro M404\\hpm404.inf', provider: 'HP Inc.', driverVer: '06/14/2023,61.285.1.25172', models: [
      { name: 'HP LaserJet Pro M404-M405 PCL 6 (V3)', hwids: ['USBPRINT\\HPHP_LaserJet_Pro_M40C2E8'] },
      { name: 'HP LaserJet Pro M402-M403 PCL 6 (V3)', hwids: [] } ] },
    { inf: '\\\\fs01\\drivers\\HP\\Universal\\hpcu270u.inf', provider: 'HP', driverVer: '03/02/2024,61.270.1.24983', models: [{ name: 'HP Universal Printing PCL 6', hwids: [] }] },
    { inf: '\\\\fs01\\drivers\\Epson\\L3250\\E_WF1QBE.INF', provider: 'SEIKO EPSON', driverVer: '09/20/2022,3.0.0.0', models: [{ name: 'EPSON L3250 Series', hwids: ['USBPRINT\\EPSONL3250_SERIESE0A1', 'WSDPRINT\\EPSONL3250_SERIESE0A1'] }] },
    { inf: '\\\\fs01\\drivers\\Kyocera\\KX\\OEMSETUP.INF', provider: 'Kyocera', driverVer: '11/08/2023,8.4.1108', models: [
      { name: 'Kyocera ECOSYS M2040dn KX', hwids: [] }, { name: 'Kyocera ECOSYS M2540dn KX', hwids: [] }, { name: 'Kyocera Classic Universaldriver', hwids: [] } ] },
    { inf: '\\\\fs01\\drivers\\Ricoh\\PCL6\\oemsetup.inf', provider: 'RICOH', driverVer: '01/15/2024,4.36.0.0', models: [{ name: 'RICOH PCL6 UniversalDriver V4.36', hwids: [] }] },
  ];

  const known = () => new Set(inventory.printers.map((p) => p.Name.toLowerCase()));

  /** Lê o nome entre aspas simples depois de `prefix` num script gerado. */
  const arg = (script, prefix) => {
    const m = new RegExp(prefix + " '((?:[^']|'')*)'").exec(script);
    return m ? m[1].replace(/''/g, "'") : null;
  };

  async function run(script) {
    await sleep(250);
    if (script.includes('Get-PrinterPort')) return JSON.parse(JSON.stringify(inventory));
    if (script.includes('PrintTestPage')) {
      const name = /\$_\.Name -eq '((?:[^']|'')*)'/.exec(script)[1].replace(/''/g, "'");
      const q = inventory.printers.find((p) => p.Name === name);
      await sleep(1800);
      if (!q) return { ok: false, sent: false, cleared: false, jobs: [], error: 'Fila não encontrada', seconds: 0 };
      if (q.Status !== 'Normal') return { ok: false, sent: true, cleared: false, jobs: [{ status: 'Error, ' + q.Status, pages: 0, total: 1 }], printerStatus: q.Status, seconds: 20 };
      return { ok: true, sent: true, cleared: true, jobs: [], printerStatus: 'Normal', seconds: 2.6 };
    }
    if (script.includes('SetDefaultPrinter')) {
      const name = /SetDefaultPrinter\('((?:[^']|'')*)'\)/.exec(script)[1].replace(/''/g, "'");
      inventory.win = inventory.printers.map((p) => ({ Name: p.Name, Default: p.Name === name, WorkOffline: false }));
      return { ok: true };
    }
    return { ok: true };
  }

  async function runElevated(script) {
    await sleep(900); // "UAC"
    const steps = [];
    const step = async (label, detail, ms = 500) => { await sleep(ms); steps.push({ label, ok: true, detail }); };
    if (script.includes('Remove-Printer')) {
      const name = arg(script, 'Remove-Printer -Name');
      await step('Cancelar trabalhos pendentes', 'ok', 200);
      inventory.printers = inventory.printers.filter((p) => p.Name !== name);
      await step('Remover a fila', name);
      return { ok: true, queue: null, reboot: false, error: null, steps };
    }
    const queue = /Get-Printer -Name '((?:[^']|'')*)' -ErrorAction SilentlyContinue\) \{ throw/.exec(script)[1].replace(/''/g, "'");
    if (known().has(queue.toLowerCase())) return { ok: false, queue: null, reboot: false, error: `Já existe uma fila chamada ${queue}. Escolha outro nome.`, steps };
    let driver;
    let port;
    if (script.includes('-IppURL')) {
      driver = 'Microsoft IPP Class Driver';
      port = arg(script, '-IppURL');
      await step('Criar fila IPP (driver de classe da Microsoft)', port, 1200);
    } else {
      driver = arg(script, 'Add-PrinterDriver -Name');
      if (script.includes('/add-driver')) await step('Adicionar o pacote do driver ao Windows (pnputil)', 'Pacote de driver adicionado com êxito.\nNome Publicado: oem42.inf\nDriver instalado em dispositivo correspondente.', 1500);
      if (driver) { await step('Registrar o driver de impressora', driver); if (!inventory.drivers.some((d) => d.Name === driver)) inventory.drivers.push({ Name: driver }); }
      if (script.includes("Step 'Criar a fila na porta USB'")) {
        driver = driver || /DriverName -eq '((?:[^']|'')*)'/.exec(script)[1].replace(/''/g, "'");
        port = 'USB001';
        await step('Criar a fila na porta USB', 'O Windows criou a fila ao reconhecer o aparelho', 1400);
        inventory.pnp = inventory.pnp.map((p) => (/EPSONL3250/.test(p.PNPDeviceID) && /EPSON/i.test(driver) ? { ...p, ConfigManagerErrorCode: 0 } : p));
      } else if (script.includes("Step 'Criar a porta TCP/IP'")) {
        port = arg(script, 'Add-PrinterPort -Name');
        const ip = arg(script, '-PrinterHostAddress') || arg(script, '-LprHostAddress');
        driver = driver || arg(script, '-DriverName');
        await step('Criar a porta TCP/IP', inventory.ports.some((p) => p.Name === port) ? 'Porta já existia' : 'Porta criada');
        if (!inventory.ports.some((p) => p.Name === port)) inventory.ports.push({ Name: port, PrinterHostAddress: ip });
        await step('Criar a fila de impressão', queue);
      }
    }
    const location = arg(script, '-Location');
    if (location) await step('Gravar local e comentário', 'ok', 200);
    inventory.printers.push({ Name: queue, DriverName: driver, PortName: port, Status: 'Normal', Location: location || '' });
    return { ok: true, queue, reboot: false, error: null, steps };
  }

  const net = {
    localIPv4: () => [{ name: 'Ethernet', address: '10.0.10.15', netmask: '255.255.255.0' }],
    mdnsBrowse: async () => { await sleep(800); return mdns; },
    async scan(ips, { onProgress = () => {}, shouldStop = () => false } = {}) {
      const total = ips.length;
      for (let done = 0; done <= total; done += 16) {
        if (shouldStop()) return [];
        onProgress({ phase: 'ports', done: Math.min(done, total), total, found: network.filter((n) => ips.indexOf(n.ip) > -1 && ips.indexOf(n.ip) <= done).length });
        await sleep(90);
      }
      const found = network.filter((n) => ips.includes(n.ip));
      for (let i = 0; i <= found.length; i++) { onProgress({ phase: 'details', done: i, total: found.length, found: found.length }); await sleep(250); }
      return JSON.parse(JSON.stringify(found));
    },
  };

  const repo = {
    async indexRepo(dirs, { onProgress = () => {} } = {}) {
      const entries = dirs.length ? repoEntries : [];
      for (let i = 1; i <= 38; i += 4) { onProgress({ done: i, total: 38 }); await sleep(60); }
      return { entries, errors: [], scanned: dirs.length ? 38 : 0, at: Date.now() };
    },
    stageDriver: async (inf) => { await sleep(600); return 'C:\\Users\\suporte\\AppData\\Local\\Temp\\infrakit-drivers\\demo\\' + inf.split('\\').pop(); },
  };

  return { run, runElevated, net, repo };
}

module.exports = { createDemo };

'use strict';
// Quais drivers servem para um aparelho, em ordem de confiança:
//  1. ID de hardware igual a um modelo de um .inf do repositório da equipe (casamento exato);
//  2. driver já instalado neste Windows com o mesmo modelo;
//  3. .inf do repositório com o mesmo modelo (por nome);
//  4. driver de classe IPP da Microsoft (sem driver do fabricante — impressoras IPP Everywhere/Mopria);
//  5. driver universal do fabricante já instalado ou no repositório;
//  6. driver de classe PCL6 da Microsoft (genérico, recursos limitados).
// Nada aqui baixa coisa alguma da internet: os links do fabricante e do Microsoft Update Catalog só abrem no navegador.
const { similarity, isGenericDriver, vendorOf, parseDeviceId } = require('./model.js');

const MIN_SCORE = 0.6;
const STRONG = 0.85;

const IPP_CLASS = 'Microsoft IPP Class Driver';
const PCL6_CLASS = 'Microsoft PCL6 Class Driver';

/** Textos do aparelho usados para casar por nome (o mais confiável primeiro). */
function modelNames(d) {
  const out = [];
  const add = (s) => { if (s && !out.some((x) => x.toLowerCase() === String(s).toLowerCase())) out.push(String(s)); };
  if (d.ipp && d.ipp.deviceId) {
    const id = parseDeviceId(d.ipp.deviceId);
    if (id.mdl) add((id.mfg ? id.mfg + ' ' : '') + id.mdl);
  }
  add(d.ipp && d.ipp.makeModel);
  add(d.model);
  add(d.snmp && d.snmp.model);
  if (d.usb) add(d.usb.pnpName);
  return out;
}

const best = (names, driverName) => Math.max(0, ...names.map((n) => similarity(n, driverName)));

/**
 * Candidatos de driver para o aparelho.
 * installed: [{ Name, Manufacturer, InfPath }] (Get-PrinterDriver); repo: [{ inf, provider, driverVer, models: [{ name, hwids }] }].
 * Retorna [{ key, source, driver, inf, score, matchedBy, label, note, recommended, method }].
 * method: 'driver' (porta TCP/USB + driver) ou 'ipp' (Add-Printer -IppURL, driver de classe).
 */
function candidates(d, { installed = [], repo = [] } = {}) {
  const names = modelNames(d);
  const vendor = vendorOf(d.make) || vendorOf(d.model);
  const hwids = new Set(((d.usb && d.usb.hwids) || []).map((h) => h.toLowerCase()));
  const out = [];
  const push = (c) => {
    const key = c.source + ':' + (c.inf || '') + ':' + c.driver.toLowerCase();
    if (out.some((x) => x.key === key)) return;
    out.push({ key, method: 'driver', ...c });
  };

  // 1 e 3: repositório.
  for (const entry of repo) {
    for (const m of entry.models) {
      const hw = m.hwids.find((h) => hwids.has(h.toLowerCase()));
      if (hw) {
        push({ source: 'repo', driver: m.name, inf: entry.inf, score: 1, matchedBy: 'hwid', label: 'Repositório da equipe', note: 'ID de hardware igual (' + hw + ')', version: entry.driverVer, provider: entry.provider });
        continue;
      }
      const s = best(names, m.name);
      if (s >= MIN_SCORE) push({ source: 'repo', driver: m.name, inf: entry.inf, score: s, matchedBy: 'model', label: 'Repositório da equipe', note: 'Mesmo modelo pelo nome', version: entry.driverVer, provider: entry.provider });
      else if (vendor && isGenericDriver(m.name) && vendorOf(m.name) === vendor) {
        push({ source: 'repo', driver: m.name, inf: entry.inf, score: 0.55, matchedBy: 'universal', label: 'Repositório da equipe', note: 'Driver universal do fabricante', version: entry.driverVer, provider: entry.provider });
      }
    }
  }

  // 2: já instalado neste computador.
  for (const drv of installed) {
    const name = String(drv.Name || '');
    if (!name || name === IPP_CLASS) continue;
    const s = best(names, name);
    if (s >= MIN_SCORE) push({ source: 'installed', driver: name, score: Math.min(0.99, s), matchedBy: 'model', label: 'Já instalado neste Windows', note: 'Não precisa baixar nada' });
    else if (vendor && isGenericDriver(name) && vendorOf(name) === vendor) push({ source: 'installed', driver: name, score: 0.56, matchedBy: 'universal', label: 'Já instalado neste Windows', note: 'Driver universal do fabricante' });
  }

  // 4: IPP Everywhere / Mopria.
  if (d.ippClass && d.ip) {
    push({ source: 'class', driver: IPP_CLASS, score: 0.8, matchedBy: 'class', label: 'Driver de classe IPP (Microsoft)', note: 'Sem driver do fabricante. Recursos básicos (frente e verso, cor, bandejas) pelo próprio IPP', method: 'ipp' });
  }

  // 6: PCL6 genérico — só rede com porta 9100 e aparelho que fala PCL (ou não disse).
  if (d.ip && d.ports.includes(9100) && (!d.languages.length || d.languages.some((l) => /PCL/.test(l)))) {
    push({ source: 'class', driver: PCL6_CLASS, score: 0.3, matchedBy: 'class', label: 'Genérico PCL6 (Microsoft)', note: 'Último recurso: imprime texto e imagens, sem recursos específicos do modelo' });
  }

  // Ordem: score; no empate, o que não exige instalar nada vem primeiro.
  const weight = { installed: 0, repo: 1, class: 2 };
  out.sort((a, b) => b.score - a.score || weight[a.source] - weight[b.source]);
  if (out[0] && out[0].score >= STRONG) out[0].recommended = true;
  else if (out[0] && out[0].method === 'ipp') out[0].recommended = true;
  return out;
}

/** Páginas de suporte por fabricante (abrem no navegador; nada é baixado pelo app). */
const VENDOR_SUPPORT = {
  hp: (q) => 'https://support.hp.com/br-pt/search?q=' + encodeURIComponent(q),
  epson: (q) => 'https://epson.com.br/Suporte/sl/s?q=' + encodeURIComponent(q),
  brother: () => 'https://support.brother.com/g/b/productsearch.aspx?c=br&lang=pt',
  canon: (q) => 'https://www.canon.com.br/suporte/?q=' + encodeURIComponent(q),
  ricoh: () => 'https://support.ricoh.com/',
  kyocera: () => 'https://www.kyoceradocumentsolutions.com.br/pt/support/downloads.html',
  samsung: (q) => 'https://support.hp.com/br-pt/search?q=' + encodeURIComponent(q), // impressoras Samsung são da HP desde 2017
  lexmark: () => 'https://support.lexmark.com/pt_BR/drivers-downloads.html',
  xerox: () => 'https://www.support.xerox.com/pt-br',
  'konica minolta': () => 'https://www.konicaminolta.com.br/pt-br/suporte/download-center',
  sharp: () => 'https://global.sharp/products/copier/downloads/',
  oki: () => 'https://www.oki.com/br/printing/support/drivers-and-utilities/',
  zebra: () => 'https://www.zebra.com/br/pt/support-downloads.html',
  pantum: () => 'https://global.pantum.com/download/',
  elgin: () => 'https://www.elgin.com.br/automacao/downloads',
  bematech: () => 'https://www.bematech.com.br/suporte',
};

/** Links para procurar o driver fora do app: Microsoft Update Catalog e a página do fabricante. */
function externalLinks(d) {
  const names = modelNames(d);
  const model = names[0] || d.model || '';
  const hw = d.usb && d.usb.hwids && d.usb.hwids[0];
  const links = [];
  if (hw || model) links.push({ label: 'Microsoft Update Catalog', url: 'https://www.catalog.update.microsoft.com/Search.aspx?q=' + encodeURIComponent(hw || model) });
  const vendor = vendorOf(d.make) || vendorOf(model);
  if (vendor && VENDOR_SUPPORT[vendor]) links.push({ label: 'Suporte ' + vendor.replace(/\b\w/g, (c) => c.toUpperCase()), url: VENDOR_SUPPORT[vendor](model) });
  return links;
}

module.exports = { candidates, externalLinks, modelNames, IPP_CLASS, PCL6_CLASS, MIN_SCORE, STRONG };

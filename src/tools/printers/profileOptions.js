// Opções de preferências oferecidas na UI. Os valores são nomes de enum do Windows (System.Printing).
// "none" = não alterar.
export const NONE = 'none';
const opt = (value, label) => ({ value, label });

export const PAPER = [
  opt(NONE, 'Não alterar'), opt('ISOA4', 'A4'), opt('ISOA3', 'A3'), opt('ISOA5', 'A5'),
  opt('NorthAmericaLetter', 'Carta (Letter)'), opt('NorthAmericaLegal', 'Ofício (Legal)'),
];
export const BINS = [
  opt(NONE, 'Não alterar'), opt('AutoSelect', 'Seleção automática'), opt('Cassette', 'Bandeja / cassete'),
  opt('Manual', 'Alimentação manual'), opt('AutoSheetFeeder', 'Alimentador automático'), opt('Tractor', 'Trator'),
];
export const ORIENTATION = [opt(NONE, 'Não alterar'), opt('Portrait', 'Retrato'), opt('Landscape', 'Paisagem')];
export const DUPLEX = [
  opt(NONE, 'Não alterar'), opt('OneSided', 'Só frente'), opt('TwoSidedLongEdge', 'Frente e verso (borda longa)'),
  opt('TwoSidedShortEdge', 'Frente e verso (borda curta)'),
];
export const COLOR = [opt(NONE, 'Não alterar'), opt('color', 'Colorido'), opt('mono', 'Preto e branco')];

const labelOf = (list, v) => (list.find((o) => o.value === v) || { label: v }).label;

/** Resumo curto das preferências de um perfil, para listas. */
export function prefsSummary(p = {}) {
  const out = [];
  if (p.paperSize) out.push(labelOf(PAPER, p.paperSize));
  if (p.inputBin) out.push(labelOf(BINS, p.inputBin));
  if (p.orientation) out.push(labelOf(ORIENTATION, p.orientation));
  if (p.duplex) out.push(labelOf(DUPLEX, p.duplex));
  if (typeof p.color === 'boolean') out.push(p.color ? 'Colorido' : 'Preto e branco');
  return out;
}

/** Formulário (strings com NONE) ⇄ prefs do perfil. */
export function formFromPrefs(p = {}) {
  return {
    paperSize: p.paperSize || NONE, inputBin: p.inputBin || NONE, orientation: p.orientation || NONE, duplex: p.duplex || NONE,
    color: typeof p.color === 'boolean' ? (p.color ? 'color' : 'mono') : NONE,
  };
}
export function prefsFromForm(f) {
  const out = {};
  for (const k of ['paperSize', 'inputBin', 'orientation', 'duplex']) if (f[k] && f[k] !== NONE) out[k] = f[k];
  if (f.color === 'color') out.color = true;
  if (f.color === 'mono') out.color = false;
  return out;
}

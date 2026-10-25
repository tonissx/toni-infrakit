// Registro de ferramentas do Toni Infrakit.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx, descreva-a em src/tools/meta.js
// e associe o componente em COMPONENTS. Ela aparece na sidebar e no Início.
import { TOOL_META } from './meta.js';
import { PrintersScreen } from './printers/PrintersScreen.jsx';

const COMPONENTS = { printers: PrintersScreen };

export const TOOLS = TOOL_META.map((t) => ({ ...t, component: COMPONENTS[t.id] }));

/** Ferramentas na ordem em que aparecem na sidebar (agrupadas por `group`) — base do Ctrl+Tab. */
export const SIDEBAR_ORDER = [...new Set(TOOLS.map((t) => t.group))].flatMap((g) => TOOLS.filter((t) => t.group === g));

export const findTool = (id) => TOOLS.find((t) => t.id === id);

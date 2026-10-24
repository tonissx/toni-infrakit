'use strict';
// Metadados das ferramentas (sem componentes): sidebar, Início e atalhos.
// Para adicionar uma ferramenta: crie src/tools/<id>/<Nome>.jsx, descreva-a aqui e associe o componente em registry.js.
const TOOL_META = [
  {
    id: 'printers',
    name: 'Impressoras',
    icon: 'printer',
    group: 'Estações',
    desc: 'Encontra impressoras na rede e no USB, escolhe o driver, instala e imprime a página de teste',
    keywords: ['impressora', 'printer', 'driver', 'usb', 'wifi', 'rede', 'ipp', 'mopria', 'snmp', 'toner', 'fila', 'spooler'],
  },
];

module.exports = { TOOL_META };

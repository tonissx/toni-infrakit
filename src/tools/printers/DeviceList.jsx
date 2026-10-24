import { DS } from '../../lib/ds.js';

const { SegmentedControl, Checkbox, Badge, Icon } = DS;

export const KIND = {
  network: { icon: 'network', label: 'Rede' },
  usb: { icon: 'usb', label: 'USB' },
  wsd: { icon: 'radio', label: 'WSD' },
  queue: { icon: 'printer', label: 'Fila' },
};

const FILTERS = [
  { value: 'all', label: 'Todas' },
  { value: 'available', label: 'Disponíveis' },
  { value: 'installed', label: 'Instaladas' },
  { value: 'usb', label: 'USB' },
  { value: 'alert', label: 'Alertas' },
];

const MATCH = {
  all: () => true,
  available: (d) => !d.installed,
  installed: (d) => d.installed,
  usb: (d) => d.kind === 'usb' || (d.queues[0] && d.queues[0].connection === 'usb'),
  alert: (d) => d.state.tone === 'error' || d.state.tone === 'warn',
};

export function DeviceList({ devices, selected, onSelect, filter, setFilter, showVirtual, setShowVirtual }) {
  const list = devices.filter(MATCH[filter] || MATCH.all);
  return (
    <div className="prn-list">
      <div className="prn-list__bar">
        <SegmentedControl size="sm" options={FILTERS} value={filter} onChange={setFilter} />
        <span className="prn-list__virt" title="PDF, XPS, OneNote, fax">
          <Checkbox checked={showVirtual} onChange={setShowVirtual} />
          <span onClick={() => setShowVirtual(!showVirtual)}>virtuais</span>
        </span>
      </div>
      <div className="prn-list__items tk-scroll" role="listbox">
        {list.map((d) => {
          const k = KIND[d.kind] || KIND.queue;
          const sub = [d.model && d.model !== d.name ? d.model : null, d.ip, d.queues.length > 1 ? d.queues.length + ' filas' : null].filter(Boolean).join(' · ');
          return (
            <button key={d.id} type="button" role="option" aria-selected={selected === d.id}
              className={'prn-item' + (selected === d.id ? ' is-selected' : '') + (d.installed ? '' : ' is-new')} onClick={() => onSelect(d.id)}>
              <span className="prn-item__icon"><Icon name={k.icon} size={16} /></span>
              <span className="prn-item__main">
                <span className="prn-item__name">{d.name}</span>
                {sub && <span className="prn-item__sub">{sub}</span>}
              </span>
              <Badge size="sm" variant={d.state.tone} dot>{d.state.label}</Badge>
            </button>
          );
        })}
        {!list.length && <div className="prn-list__none">Nada neste filtro.</div>}
      </div>
    </div>
  );
}

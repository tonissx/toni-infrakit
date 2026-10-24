import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { usePrinters } from './usePrinters.js';
import { DeviceList } from './DeviceList.jsx';
import { DeviceDetail } from './DeviceDetail.jsx';
import { InstallModal } from './InstallModal.jsx';
import { DriversTab } from './DriversTab.jsx';
import { LogTab } from './LogTab.jsx';
import { timeAgo } from '../../lib/fmt.js';

const { PageHeader, Tabs, Button, IconButton, Input, ProgressBar, Alert, EmptyState, Badge } = DS;

const PHASE = { ports: 'Procurando portas de impressão (9100, 631, 515)…', details: 'Perguntando modelo, status e toner (IPP/SNMP)…' };

export function PrintersScreen({ toast }) {
  const s = usePrinters();
  const [prefs, setPrefs] = usePersisted('printers', { tab: 'devices', filter: 'all', showVirtual: false });
  const [selected, setSelected] = React.useState(null);
  const [ranges, setRanges] = React.useState(null);
  const [installFor, setInstallFor] = React.useState(null);
  const setTab = (tab) => setPrefs((p) => ({ ...p, tab }));

  React.useEffect(() => { if (s && ranges === null) setRanges(s.settings.ranges || ''); }, [s]);

  const scan = () => {
    if (!s || s.scanning) return;
    window.devkit.printers.scan({ ranges: ranges ?? '' })
      .then((r) => toast('Varredura concluída', r.lastScan ? `${r.lastScan.found} aparelho(s) na rede` : ''))
      .catch((e) => toast('Não deu para procurar', e.message, 'error'));
  };

  React.useEffect(() => {
    const h = (e) => { if (e.key === 'F5') { e.preventDefault(); scan(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  if (!s) return <div style={{ padding: 24 }}><ProgressBar indeterminate label="Lendo as impressoras deste computador…" /></div>;
  if (!s.supported) {
    return (
      <div>
        <PageHeader icon="printer" title="Impressoras" />
        <div style={{ padding: 24 }}><Alert variant="warn" title="Só no Windows">A instalação de impressoras usa o spooler e o PowerShell do Windows.</Alert></div>
      </div>
    );
  }

  const devices = s.devices.filter((d) => prefs.showVirtual || !d.virtual);
  const sel = devices.find((d) => d.id === selected) || null;
  const counts = { all: devices.length, available: devices.filter((d) => !d.installed).length };

  const header = (
    <PageHeader icon="printer" title="Impressoras"
      subtitle={s.lastScan ? `Última varredura ${timeAgo(s.lastScan.at)} · ${s.lastScan.ranges}` : 'Rede (TCP/IP, IPP, Bonjour), USB e WSD'}
      actions={<div className="prn-head">
        <Input size="sm" mono icon="network" placeholder={s.defaultRanges || '192.168.0.0/24'} value={ranges ?? ''}
          onChange={(e) => setRanges(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') scan(); }} style={{ width: 240 }}
          title="Faixas de IP separadas por vírgula. Vazio = a rede deste computador (/24)" />
        {s.scanning
          ? <Button variant="secondary" icon="square" onClick={() => window.devkit.printers.cancelScan()}>Parar</Button>
          : <Button variant="primary" icon="radar" kbd="F5" onClick={scan}>Procurar</Button>}
        <IconButton icon="refresh-cw" label="Reler filas e USB deste computador" onClick={() => window.devkit.printers.refresh()} />
      </div>} />
  );

  return (
    <div className="prn">
      {header}
      <div className="prn-tabs">
        <Tabs value={prefs.tab} onChange={setTab} items={[
          { value: 'devices', label: 'Dispositivos', icon: 'printer', count: counts.all },
          { value: 'drivers', label: 'Drivers', icon: 'package', count: s.repo.models || undefined },
          { value: 'log', label: 'Histórico', icon: 'history' },
        ]} />
      </div>
      {s.scanning && (
        <div className="prn-progress">
          <ProgressBar value={s.scanning.total ? (s.scanning.done / s.scanning.total) * 100 : 0}
            label={PHASE[s.scanning.phase] || 'Procurando…'} showValue />
          <Badge size="sm" mono>{s.scanning.found} encontrada(s)</Badge>
        </div>
      )}
      {s.localError && <div style={{ padding: '0 24px' }}><Alert variant="error" title="Não consegui ler as impressoras do Windows">{s.localError}</Alert></div>}
      {s.busy && <div className="prn-busy"><Alert variant="info" title={s.busy.step || 'Trabalhando…'}>{s.busy.target}</Alert></div>}

      {prefs.tab === 'devices' && (
        devices.length === 0 && !s.scanning
          ? <EmptyState title="Nenhuma impressora ainda" description="Procure na rede deste computador ou informe uma faixa de IPs. Impressoras USB conectadas aparecem sozinhas."
              action={<Button variant="primary" icon="radar" onClick={scan}>Procurar agora</Button>} />
          : <div className="prn-split">
              <DeviceList devices={devices} selected={sel && sel.id} onSelect={setSelected}
                filter={prefs.filter} setFilter={(filter) => setPrefs((p) => ({ ...p, filter }))}
                showVirtual={prefs.showVirtual} setShowVirtual={(showVirtual) => setPrefs((p) => ({ ...p, showVirtual }))} />
              {sel
                ? <DeviceDetail device={sel} busy={!!s.busy} toast={toast} onInstall={() => setInstallFor(sel)} />
                : <div className="prn-detail prn-detail--empty"><EmptyState compact title="Escolha uma impressora" description={`${counts.available} disponível(is) para instalar`} /></div>}
            </div>
      )}
      {prefs.tab === 'drivers' && <DriversTab state={s} toast={toast} />}
      {prefs.tab === 'log' && <LogTab />}

      {installFor && <InstallModal device={installFor} toast={toast} onClose={() => setInstallFor(null)} goDrivers={() => { setInstallFor(null); setTab('drivers'); }} />}
    </div>
  );
}

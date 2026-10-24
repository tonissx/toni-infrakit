import { DS } from '../lib/ds.js';
import { TOOLS } from '../tools/registry.js';
import { usePrinters } from '../tools/printers/usePrinters.js';
import { timeAgo } from '../lib/fmt.js';

const { PageHeader, Card, Button, Badge, KpiCard, ToolCard } = DS;

/** Início: números do parque de impressoras e atalhos para as ferramentas. */
export function Home({ go }) {
  const s = usePrinters();
  const devices = s ? s.devices.filter((d) => !d.virtual) : [];
  const available = devices.filter((d) => !d.installed).length;
  const installed = devices.filter((d) => d.installed).length;
  const problems = devices.filter((d) => d.state.tone === 'error' || d.state.tone === 'warn').length;

  return (
    <div>
      <PageHeader icon="layout-grid" title="Início" subtitle={s && s.local ? 'Computador ' + s.local.computer : 'Toni Infra Kit'}
        actions={<Button variant="primary" icon="radar" onClick={() => go('printers')}>Procurar impressoras</Button>} />
      <div className="home">
        <div className="home-kpis">
          <KpiCard label="Disponíveis para instalar" icon="printer" value={s ? available : '—'} spinner={false} />
          <KpiCard label="Instaladas neste Windows" icon="circle-check" value={s ? installed : '—'} spinner={false} />
          <KpiCard label="Com alerta" icon="triangle-alert" value={s ? problems : '—'} spinner={false} />
          <KpiCard label="Drivers no repositório" icon="package" value={s ? s.repo.models : '—'} spinner={false} />
        </div>
        <Card padding={20} title="Última varredura" icon="radar"
          actions={s && s.lastScan ? <Badge size="sm" mono>{timeAgo(s.lastScan.at)}</Badge> : null}>
          {s && s.lastScan
            ? <div className="home-msg">{s.lastScan.found} aparelho(s) com porta de impressão em {s.lastScan.hosts} endereço(s) — <code>{s.lastScan.ranges}</code></div>
            : <div className="home-msg">Ainda não houve varredura neste computador. Abra <b>Impressoras</b> e clique em <b>Procurar</b>.</div>}
        </Card>
        <div className="home-section__title">Ferramentas</div>
        <div className="home-grid">
          {TOOLS.map((t) => <ToolCard key={t.id} icon={t.icon} name={t.name} description={t.desc} category={t.group} onClick={() => go(t.id)} />)}
        </div>
      </div>
    </div>
  );
}

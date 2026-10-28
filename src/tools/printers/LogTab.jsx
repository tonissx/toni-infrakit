import { DS } from '../../lib/ds.js';
import { fmtDate } from '../../lib/fmt.js';

const { Button, Badge, Icon, EmptyState } = DS;

const ACTION = {
  scan: { icon: 'radar', label: 'Varredura' },
  install: { icon: 'download', label: 'Instalação' },
  test: { icon: 'file-check', label: 'Página de teste' },
  remove: { icon: 'trash-2', label: 'Remoção' },
  default: { icon: 'star', label: 'Padrão' },
  profile: { icon: 'sliders-horizontal', label: 'Perfil' },
  'remote-install': { icon: 'monitor-up', label: 'Instalação remota' },
  'remote-test': { icon: 'printer', label: 'Teste remoto' },
};

/** Histórico do que foi feito neste computador (útil para chamado/ticket). */
export function LogTab() {
  const [log, setLog] = React.useState(null);
  const [open, setOpen] = React.useState(null);
  const load = () => window.devkit.printers.log().then(setLog);
  React.useEffect(() => {
    load();
    // Durante a varredura chegam dezenas de avisos de progresso; o histórico só muda quando ela termina.
    return window.devkit.printers.onChanged((s) => { if (!s.scanning && !s.repo.indexing) load(); });
  }, []);
  if (!log) return null;
  if (!log.length) return <EmptyState title="Nada por aqui ainda" description="Varreduras, instalações e testes ficam registrados aqui." />;

  const copy = (e) => {
    const text = [`${fmtDate(e.at)} — ${(ACTION[e.action] || {}).label || e.action}: ${e.target}`, `Resultado: ${e.ok ? 'ok' : 'falhou'} — ${e.detail || ''}`,
      ...(e.steps || []).map((s) => `  ${s.ok ? '✓' : '✗'} ${s.label}${s.detail ? ': ' + s.detail : ''}`)].join('\n');
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="prn-log tk-scroll">
      <div className="prn-log__bar">
        <span className="prn-muted">{log.length} registro(s), mais recentes primeiro</span>
        <Button size="sm" variant="ghost" icon="trash-2" onClick={() => { if (confirm('Apagar o histórico?')) window.devkit.printers.clearLog().then(setLog); }}>Limpar</Button>
      </div>
      {log.map((e) => {
        const a = ACTION[e.action] || { icon: 'circle', label: e.action };
        const expandable = (e.steps && e.steps.length) || e.result;
        return (
          <div key={e.id} className="prn-logrow">
            <button type="button" className="prn-logrow__head" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <Icon name={a.icon} size={14} />
              <span className="prn-logrow__when tk-mono">{fmtDate(e.at)}</span>
              <span className="prn-logrow__what">{a.label}: <b>{e.target}</b></span>
              <span className="prn-logrow__detail">{e.detail}</span>
              <Badge size="sm" variant={e.cancelled ? 'neutral' : e.ok ? 'ok' : 'error'} dot>{e.cancelled ? 'cancelado' : e.ok ? 'ok' : 'falhou'}</Badge>
              {expandable ? <Icon name={open === e.id ? 'chevron-up' : 'chevron-down'} size={14} /> : <span style={{ width: 14 }} />}
            </button>
            {open === e.id && (
              <div className="prn-logrow__body">
                {(e.steps || []).map((s, i) => (
                  <div key={i} className={'prn-logstep ' + (s.ok ? 'is-ok' : 'is-fail')}>
                    <Icon name={s.ok ? 'circle-check' : 'circle-x'} size={13} /> {s.label}{s.detail ? <span className="tk-mono"> — {s.detail}</span> : null}
                  </div>
                ))}
                <Button size="sm" variant="ghost" icon="copy" onClick={() => copy(e)}>Copiar para o chamado</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

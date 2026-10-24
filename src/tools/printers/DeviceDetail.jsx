import { DS } from '../../lib/ds.js';
import { KIND } from './DeviceList.jsx';

const { Card, Button, Badge, LabelValue, ProgressBar, Alert, Tag } = DS;

const CONNECTION = { tcp: 'TCP/IP', ipp: 'IPP', usb: 'USB', wsd: 'WSD', shared: 'Compartilhada', other: 'Outra' };

/** Nível de suprimento: SNMP (pct) ou IPP (0..100). */
function supplies(d) {
  if (d.snmp && d.snmp.supplies.length) return d.snmp.supplies.map((x) => ({ name: x.name, pct: x.pct, some: x.some }));
  if (d.ipp && d.ipp.supplies.length) return d.ipp.supplies.map((x) => ({ name: x.name, pct: typeof x.level === 'number' && x.level >= 0 ? x.level : null, some: x.level === -3 }));
  return [];
}

function QueueRow({ q, busy, toast }) {
  const [running, setRunning] = React.useState(null);
  const act = (name, fn, ok) => {
    setRunning(name);
    fn().then((r) => {
      if (r && r.cancelled) toast('Cancelado', 'A permissão de administrador não foi dada', 'warn');
      else if (r && r.ok === false) toast('Não deu certo', r.error || r.detail || '', 'error');
      else if (ok) ok(r);
    }, (e) => toast('Erro', e.message, 'error')).finally(() => setRunning(null));
  };
  const p = window.devkit.printers;
  return (
    <div className="prn-queue">
      <div className="prn-queue__head">
        <span className="prn-queue__name">{q.name}</span>
        {q.isDefault && <Badge size="sm" variant="accent">padrão</Badge>}
        <Badge size="sm" variant={q.status.tone} dot>{q.status.label}</Badge>
      </div>
      <div className="prn-queue__meta">{q.driver} · {CONNECTION[q.connection] || q.connection} · <span className="tk-mono">{q.port}</span></div>
      <div className="prn-queue__actions">
        <Button size="sm" variant="primary" icon="file-check" loading={running === 'test'} disabled={busy && running !== 'test'}
          onClick={() => act('test', () => p.test(q.name), (r) => toast(r.ok ? 'Página de teste impressa' : 'Página enviada', r.detail, r.ok ? 'ok' : 'warn'))}>Página de teste</Button>
        {!q.isDefault && <Button size="sm" variant="secondary" icon="star" loading={running === 'default'} disabled={busy}
          onClick={() => act('default', () => p.setDefault(q.name), () => toast('Impressora padrão', q.name))}>Definir padrão</Button>}
        <Button size="sm" variant="ghost" icon="list" onClick={() => p.openQueue(q.name)}>Ver fila</Button>
        <Button size="sm" variant="ghost" icon="trash-2" loading={running === 'remove'} disabled={busy}
          onClick={() => { if (confirm(`Remover a fila "${q.name}" deste computador?`)) act('remove', () => p.remove(q.name), () => toast('Fila removida', q.name)); }}>Remover</Button>
      </div>
    </div>
  );
}

export function DeviceDetail({ device: d, busy, toast, onInstall }) {
  const k = KIND[d.kind] || KIND.queue;
  const sup = supplies(d);
  const info = [
    d.ip && { label: 'IP', value: d.ip },
    d.hostname && { label: 'Nome na rede', value: d.hostname },
    d.ports.length && { label: 'Portas', value: d.ports.join(', ') },
    d.languages.length && { label: 'Linguagens', value: d.languages.join(', ') },
    d.snmp && d.snmp.serial && { label: 'Serial', value: d.snmp.serial },
    ((d.ipp && d.ipp.location) || (d.snmp && d.snmp.location)) && { label: 'Local', value: (d.ipp && d.ipp.location) || d.snmp.location },
    d.ipp && { label: 'IPP', value: (d.ipp.versions.join(', ') || 'sim') + (d.ippClass ? ' · IPP Everywhere' : '') },
    d.usb && { label: 'ID de hardware', value: d.usb.hwids[0] || d.usb.instanceId },
    { label: 'Encontrada por', value: d.sources.join(', ') },
  ].filter(Boolean);
  const canInstall = d.kind !== 'queue' && !(d.kind === 'network' && !d.ports.some((p) => [9100, 515, 631].includes(p)));
  const admin = d.ip ? 'http://' + d.ip : null;

  return (
    <div className="prn-detail tk-scroll">
      <div className="prn-detail__head">
        <div className="prn-detail__title">
          <span className="prn-detail__name">{d.name}</span>
          {d.model && d.model !== d.name && <span className="prn-detail__model">{d.model}</span>}
        </div>
        <div className="prn-detail__badges">
          <Tag>{k.label}</Tag>
          <Badge variant={d.state.tone} dot>{d.state.label}</Badge>
        </div>
      </div>

      {d.usb && d.usb.code === 28 && (
        <Alert variant="warn" title="O Windows reconheceu o aparelho, mas não tem driver">
          Instale um driver abaixo. Se ele vier do repositório da equipe, o Windows cria a fila sozinho ao reconhecer o aparelho.
        </Alert>
      )}

      {canInstall && (
        <Card padding={16} className="prn-cta">
          <div className="prn-cta__row">
            <div className="prn-cta__text">
              <b>{d.installed ? 'Instalar outra fila para este aparelho' : 'Pronta para instalar'}</b>
              <span>Escolha o driver (repositório da equipe, já instalado ou IPP sem driver), instale e teste.</span>
            </div>
            <Button variant={d.installed ? 'secondary' : 'primary'} icon="download" disabled={busy} onClick={onInstall}>Instalar…</Button>
          </div>
        </Card>
      )}

      {d.queues.length > 0 && (
        <Card padding={16} title={d.queues.length > 1 ? `Filas instaladas (${d.queues.length})` : 'Fila instalada'} icon="printer">
          {d.queues.map((q) => <QueueRow key={q.name} q={q} busy={busy} toast={toast} />)}
        </Card>
      )}

      <Card padding={16} title="Detalhes" icon="info">
        <LabelValue items={info} columns={2} />
        {admin && (
          <div className="prn-links">
            <Button size="sm" variant="ghost" icon="external-link" onClick={() => window.devkit.shell.openUrl(admin).catch((e) => toast('Erro', e.message, 'error'))}>Página da impressora</Button>
          </div>
        )}
      </Card>

      {sup.length > 0 && (
        <Card padding={16} title="Suprimentos" icon="droplet">
          <div className="prn-supplies">
            {sup.map((x, i) => (
              <div key={i} className="prn-supply">
                {x.pct != null
                  ? <ProgressBar value={x.pct} label={x.name} showValue size="sm" tone={x.pct <= 10 ? 'danger' : x.pct <= 25 ? 'warn' : 'accent'} />
                  : <div className="prn-supply__na"><span>{x.name}</span><span>{x.some ? 'tem, nível não informado' : 'nível desconhecido'}</span></div>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {d.snmp && d.snmp.sysDescr && <div className="prn-sysdescr tk-mono" title="sysDescr (SNMP)">{d.snmp.sysDescr}</div>}
    </div>
  );
}

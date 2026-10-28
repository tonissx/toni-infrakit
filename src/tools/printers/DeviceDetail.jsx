import { DS } from '../../lib/ds.js';
import { KIND } from './DeviceList.jsx';
import { prefsSummary } from './profileOptions.js';
import { forModel } from '../../printers/profiles.js';
import { ProfileEditor, loadDriverNames } from './ProfileEditor.jsx';
import { ProfileRow } from './ProfilesTab.jsx';

const { Card, Button, Badge, LabelValue, ProgressBar, Alert, Tag, Modal, Field, Select, Icon } = DS;

const CONNECTION = { tcp: 'TCP/IP', ipp: 'IPP', usb: 'USB', wsd: 'WSD', shared: 'Compartilhada', other: 'Outra' };

/** Nível de suprimento: SNMP (pct) ou IPP (0..100). */
function supplies(d) {
  if (d.snmp && d.snmp.supplies.length) return d.snmp.supplies.map((x) => ({ name: x.name, pct: x.pct, some: x.some }));
  if (d.ipp && d.ipp.supplies.length) return d.ipp.supplies.map((x) => ({ name: x.name, pct: typeof x.level === 'number' && x.level >= 0 ? x.level : null, some: x.level === -3 }));
  return [];
}

function QueueRow({ q, model, busy, toast }) {
  const [running, setRunning] = React.useState(null);
  const [picking, setPicking] = React.useState(false);
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
        <Button size="sm" variant="secondary" icon="sliders-horizontal" disabled={busy} onClick={() => setPicking(true)}>Aplicar perfil…</Button>
        <Button size="sm" variant="ghost" icon="list" onClick={() => p.openQueue(q.name)}>Ver fila</Button>
        <Button size="sm" variant="ghost" icon="trash-2" loading={running === 'remove'} disabled={busy}
          onClick={() => { if (confirm(`Remover a fila "${q.name}" deste computador?`)) act('remove', () => p.remove(q.name), () => toast('Fila removida', q.name)); }}>Remover</Button>
      </div>
      {picking && <ApplyProfileModal queue={q.name} model={model} toast={toast} onClose={() => setPicking(false)} />}
    </div>
  );
}

/** Aplica um perfil de preferências a uma fila já instalada (pede administrador). */
function ApplyProfileModal({ queue, model, toast, onClose }) {
  const [profiles, setProfiles] = React.useState(null);
  const [id, setId] = React.useState(null);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState(null);
  React.useEffect(() => {
    window.devkit.printers.profiles().then((all) => {
      // Os do modelo da fila primeiro (o último usado no topo); os de outros modelos ficam disponíveis, marcados.
      const own = forModel(all, model);
      const l = [...own, ...all.filter((x) => !own.includes(x))].map((x) => ({ ...x, other: !own.includes(x) }));
      setProfiles(l);
      if (l[0]) setId(l[0].id);
    });
  }, []);

  const apply = () => {
    setRunning(true);
    window.devkit.printers.applyProfile(queue, id).then((r) => {
      setRunning(false);
      if (r.cancelled) { toast('Cancelado', 'A permissão de administrador não foi dada', 'warn'); return; }
      setResult(r);
    }, (e) => { setRunning(false); setResult({ ok: false, error: e.message, steps: [] }); });
  };

  const prof = profiles && profiles.find((x) => x.id === id);
  return (
    <Modal open onClose={running ? undefined : onClose} width={520} icon="sliders-horizontal" title="Aplicar perfil" description={queue}
      footer={result
        ? <Button variant="primary" onClick={onClose}>Fechar</Button>
        : <>
            <Button variant="ghost" disabled={running} onClick={onClose}>Cancelar</Button>
            <Button variant="primary" icon="shield-check" loading={running} disabled={!prof || !Object.keys(prof.prefs).length} onClick={apply}>Aplicar como administrador</Button>
          </>}>
      {profiles && profiles.length === 0 && <Alert variant="info" title="Nenhum perfil ainda">Use Adicionar perfil no detalhe do aparelho.</Alert>}
      {profiles && profiles.length > 0 && !result && (
        <div className="prn-install">
          <Field label="Perfil">
            <Select value={id} onChange={setId} options={profiles.map((p) => ({ value: p.id, label: p.other ? `${p.name} — ${p.model}` : p.name }))} />
          </Field>
          {prof && <div className="prn-repostat">{prefsSummary(prof.prefs).map((t) => <Badge key={t} size="sm">{t}</Badge>)}</div>}
          {prof && !Object.keys(prof.prefs).length && <Alert variant="warn" title="Esse perfil não tem preferências">Ele só define o driver; edite-o na aba Perfis.</Alert>}
          <p className="prn-hint">Muda o padrão da fila para todos os usuários deste computador. Não troca o driver.</p>
        </div>
      )}
      {result && (
        <div className="prn-install">
          {result.ok
            ? <Alert variant={(result.steps || []).some((s) => !s.ok) ? 'warn' : 'ok'} title={(result.steps || []).some((s) => !s.ok) ? 'Aplicado em parte' : 'Preferências aplicadas'}>
                {(result.steps || []).some((s) => !s.ok) ? 'O driver não aceitou alguns itens (veja abaixo).' : queue}
              </Alert>
            : <Alert variant="error" title="Não consegui aplicar">{result.error}</Alert>}
          <ol className="prn-steps">
            {(result.steps || []).map((s, i) => (
              <li key={i} className={s.ok ? 'is-ok' : 'is-fail'}>
                <Icon name={s.ok ? 'circle-check' : 'circle-x'} size={14} />
                <span className="prn-steps__label">{s.label}</span>
                {s.detail && <span className="prn-steps__detail">{s.detail}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Modal>
  );
}

/** Perfis deste modelo: criar, editar, apagar. Novos nascem aqui, com o modelo do aparelho. */
function ModelProfiles({ model, deviceId, toast }) {
  const [all, setAll] = React.useState(null);
  const [editing, setEditing] = React.useState(null);
  const [drivers, setDrivers] = React.useState(null);
  const p = window.devkit.printers;
  React.useEffect(() => { p.profiles().then(setAll); }, []);
  if (!all) return null;
  const mine = forModel(all, model);
  const open = (profile) => { setDrivers(null); setEditing(profile); loadDriverNames(deviceId).then(setDrivers); };
  const remove = (x) => { if (confirm(`Apagar o perfil "${x.name}"?`)) p.deleteProfile(x.id).then(setAll, (e) => toast('Erro', e.message, 'error')); };
  return (
    <Card padding={16} title={mine.length ? `Perfis deste modelo (${mine.length})` : 'Perfis deste modelo'} icon="sliders-horizontal"
      actions={<Button size="sm" variant="secondary" icon="plus" onClick={() => open({})}>Adicionar perfil</Button>}>
      {mine.length === 0
        ? <p className="prn-hint">Salve o driver e as preferências de impressão (papel, bandeja, frente e verso, cor) deste modelo. Na próxima instalação, eles já aparecem.</p>
        : <div className="prn-dirs">{mine.map((x) => <ProfileRow key={x.id} x={x} onEdit={() => open(x)} onDelete={() => remove(x)} />)}</div>}
      {editing && drivers && <ProfileEditor profile={editing} model={editing.model || model} drivers={drivers} toast={toast}
        onClose={() => setEditing(null)} onSaved={setAll} />}
    </Card>
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
          {d.queues.map((q) => <QueueRow key={q.name} q={q} model={d.model || d.name} busy={busy} toast={toast} />)}
        </Card>
      )}

      <ModelProfiles key={d.id} model={d.model || d.name} deviceId={d.id} toast={toast} />

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

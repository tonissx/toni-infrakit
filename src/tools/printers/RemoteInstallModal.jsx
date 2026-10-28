import { DS } from '../../lib/ds.js';
import { NONE } from './profileOptions.js';

const { Modal, Button, Badge, Field, Input, Select, Alert, ProgressBar, Icon } = DS;

const SOURCE_ICON = { repo: 'folder-down', installed: 'circle-check', class: 'globe' };

/** Aparelhos que dá para instalar de longe: só rede (TCP/IP ou IPP). USB e WSD são do próprio computador. */
const remotable = (d) => !d.virtual && d.ip && d.kind !== 'usb' && d.kind !== 'wsd';

/**
 * Instala a mesma impressora em vários computadores ao mesmo tempo (PowerShell Remoting, com o seu usuário).
 * Ao confirmar, a janela fecha e o andamento aparece na aba Computadores.
 */
export function RemoteInstallModal({ computers, devices, onClose, toast }) {
  const list = devices.filter(remotable);
  const [deviceId, setDeviceId] = React.useState(list[0] ? list[0].id : null);
  const [opts, setOpts] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [key, setKey] = React.useState(null);
  const [queue, setQueue] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [others, setOthers] = React.useState([]);
  const [profileId, setProfileId] = React.useState(NONE);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => {
    if (!deviceId) return undefined;
    let alive = true;
    setOpts(null); setErr(null); setKey(null); setProfileId(NONE);
    window.devkit.printers.driverOptions(deviceId).then((o) => {
      if (!alive) return;
      setOpts(o);
      setQueue(o.suggestedName);
      const first = o.candidates.find((c) => c.recommended) || o.candidates[0];
      if (first) setKey(first.key);
      if (o.suggestedProfileId) setProfileId(o.suggestedProfileId);
      window.devkit.printers.profiles().then((all) => alive && setOthers(all.filter((x) => !o.profiles.some((m) => m.id === x.id))), () => {});
    }, (e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [deviceId]);

  const pickProfile = (id) => {
    setProfileId(id);
    const x = [...opts.profiles, ...others].find((y) => y.id === id);
    const hit = x && x.driver && x.driver.name && opts.candidates.find((c) => c.driver.toLowerCase() === x.driver.name.toLowerCase());
    if (hit) setKey(hit.key);
  };

  const notRemote = opts && opts.connection !== 'tcp';
  const ready = opts && !notRemote && key && queue.trim();

  const start = () => {
    setStarting(true);
    window.devkit.printers.remoteInstall({ computers, deviceId, key, queue, location, profileId: profileId === NONE ? undefined : profileId })
      .then((r) => toast(r.ok ? 'Instalada em todos os computadores' : 'Instalação remota terminou', `${r.items.filter((i) => i.ok).length} de ${r.items.length} com sucesso`, r.ok ? 'ok' : 'warn'),
        (e) => toast('Não consegui instalar', e.message, 'error'));
    // O andamento vem pelo estado da aba; a janela não precisa ficar aberta.
    setTimeout(onClose, 150);
  };

  return (
    <Modal open onClose={starting ? undefined : onClose} width={680} icon="monitor-up" title={`Instalar em ${computers.length} computador(es)`}
      description={computers.length <= 4 ? computers.join(', ') : `${computers.slice(0, 3).join(', ')} e mais ${computers.length - 3}`}
      footer={<>
        <Button variant="ghost" disabled={starting} onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="send" disabled={!ready} loading={starting} onClick={start}>Instalar em {computers.length} computador(es)</Button>
      </>}>
      <div className="prn-install">
        {list.length === 0 && <Alert variant="warn" title="Nenhuma impressora de rede na lista">Procure na rede (aba Dispositivos) para escolher o aparelho que será instalado.</Alert>}
        {list.length > 0 && (
          <Field label="Impressora" hint="Só impressoras de rede (TCP/IP ou IPP); USB e WSD são instaladas no próprio computador">
            <Select value={deviceId} onChange={setDeviceId} options={list.map((d) => ({ value: d.id, label: `${d.model || d.name} — ${d.ip}` }))} />
          </Field>
        )}
        {err && <Alert variant="error" title="Não consegui montar as opções">{err}</Alert>}
        {deviceId && !opts && !err && <ProgressBar indeterminate label="Procurando drivers compatíveis…" />}
        {notRemote && <Alert variant="warn" title="Esse aparelho não é de rede">Instalação em vários computadores só funciona para TCP/IP ou IPP.</Alert>}

        {opts && !notRemote && <>
          {opts.candidates.length === 0
            ? <Alert variant="warn" title="Nenhum driver compatível encontrado">Coloque o driver no repositório da equipe (aba Drivers) e reindexe.</Alert>
            : <div className="prn-cands" role="radiogroup">
                {opts.candidates.map((c) => (
                  <button key={c.key} type="button" role="radio" aria-checked={key === c.key}
                    className={'prn-cand' + (key === c.key ? ' is-on' : '')} onClick={() => setKey(c.key)}>
                    <span className="prn-cand__icon"><Icon name={SOURCE_ICON[c.source] || 'package'} size={16} /></span>
                    <span className="prn-cand__main">
                      <span className="prn-cand__name">{c.driver}</span>
                      <span className="prn-cand__note">{c.label} · {c.note}</span>
                    </span>
                    {c.recommended ? <Badge size="sm" variant="ok">recomendado</Badge> : <Badge size="sm" mono>{Math.round(c.score * 100)}%</Badge>}
                  </button>
                ))}
              </div>}
          {chosenInstalledNote(opts, key)}
          <div className="prn-form">
            <Field label="Nome da fila" hint="Igual em todos os computadores">
              <Input value={queue} onChange={(e) => setQueue(e.target.value)} maxLength={120} />
            </Field>
            <Field label="Local (opcional)">
              <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
            </Field>
          </div>
          {(opts.profiles.length > 0 || others.length > 0) && (
            <Field label="Perfil de preferências (opcional)" hint={opts.profiles.length ? `Perfis salvos para ${opts.model}` : 'Nenhum perfil salvo para este modelo; dá para usar o de outro'}>
              <Select value={profileId} onChange={pickProfile}
                options={[{ value: NONE, label: 'Nenhum' }, ...opts.profiles.map((p) => ({ value: p.id, label: p.name })),
                  ...others.map((p) => ({ value: p.id, label: `${p.name} — ${p.model}` }))]} />
            </Field>
          )}
          <Alert variant="info" title="Como funciona">
            Roda com o seu usuário, sem pedir senha, e precisa que você seja administrador de cada computador e que o WinRM esteja ativo.
            Se o WinRM estiver desligado em algum computador, ele é ativado automaticamente (via WMI) antes de instalar e fica ligado.
            O driver do repositório é copiado para o computador e apagado depois. A impressora padrão não muda (ela é de cada usuário).
          </Alert>
        </>}
      </div>
    </Modal>
  );
}

/** Aviso quando o driver escolhido ainda não está em cada computador (vai ser instalado). */
function chosenInstalledNote(opts, key) {
  const c = opts.candidates.find((x) => x.key === key);
  if (!c || c.source !== 'repo') return null;
  return <div className="prn-muted">O driver "{c.driver}" será copiado do repositório da equipe para cada computador.</div>;
}

import { DS } from '../../lib/ds.js';

const { Modal, Button, Badge, Field, Input, Toggle, Alert, ProgressBar, Icon, Tag } = DS;

const SOURCE_ICON = { repo: 'folder-down', installed: 'circle-check', class: 'globe' };

/** Como a fila vai se conectar ao aparelho, em palavras. */
function connectionText(opts, device, c) {
  if (c && c.method === 'ipp') return `IPP em ${device.ip} (porta 631), sem driver do fabricante`;
  if (opts.connection === 'tcp') return opts.canRaw ? `TCP/IP RAW em ${device.ip}:9100` : `LPR em ${device.ip}:515`;
  if (opts.connection === 'usb') return 'USB — o Windows cria a fila ao reconhecer o aparelho com o driver';
  if (opts.connection === 'wsd') return 'WSD — o Windows cria a fila a partir do anúncio do aparelho';
  return '—';
}

function Steps({ steps }) {
  return (
    <ol className="prn-steps">
      {steps.map((s, i) => (
        <li key={i} className={s.ok ? 'is-ok' : 'is-fail'}>
          <Icon name={s.ok ? 'circle-check' : 'circle-x'} size={14} />
          <span className="prn-steps__label">{s.label}</span>
          {s.detail && <span className="prn-steps__detail">{s.detail}</span>}
        </li>
      ))}
    </ol>
  );
}

/**
 * Instalar: escolher o driver → nome da fila → instalar (UAC) → página de teste.
 * Quem monta o plano de verdade é o processo principal; aqui só vão as escolhas.
 */
export function InstallModal({ device, onClose, toast, goDrivers }) {
  const [opts, setOpts] = React.useState(null);
  const [err, setErr] = React.useState(null);
  const [key, setKey] = React.useState(null);
  const [queue, setQueue] = React.useState('');
  const [location, setLocation] = React.useState('');
  const [setDefault, setSetDefault] = React.useState(false);
  const [phase, setPhase] = React.useState('choose'); // choose → installing → done → testing → tested
  const [result, setResult] = React.useState(null);
  const [test, setTest] = React.useState(null);

  React.useEffect(() => {
    window.devkit.printers.driverOptions(device.id).then((o) => {
      setOpts(o);
      setQueue(o.suggestedName);
      const first = o.candidates.find((c) => c.recommended) || o.candidates[0];
      if (first) setKey(first.key);
    }, (e) => setErr(e.message));
  }, [device.id]);

  const chosen = opts && opts.candidates.find((c) => c.key === key);

  const install = () => {
    setPhase('installing');
    window.devkit.printers.install({ deviceId: device.id, key, queue, location, setDefault }).then((r) => {
      if (r.cancelled) { setPhase('choose'); toast('Cancelado', 'A permissão de administrador não foi dada', 'warn'); return; }
      setResult(r);
      setPhase('done');
      if (r.ok) toast('Impressora instalada', r.queue);
    }, (e) => { setResult({ ok: false, error: e.message, steps: [] }); setPhase('done'); });
  };

  const runTest = () => {
    setPhase('testing');
    window.devkit.printers.test(result.queue).then((r) => { setTest(r); setPhase('tested'); },
      (e) => { setTest({ ok: false, detail: e.message }); setPhase('tested'); });
  };

  const footer = phase === 'choose'
    ? <>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="shield-check" disabled={!chosen || !queue.trim()} onClick={install}>Instalar como administrador</Button>
      </>
    : phase === 'installing' || phase === 'testing'
      ? <Button variant="ghost" disabled>Aguarde…</Button>
      : <>
          {result && result.ok && phase === 'done' && <Button variant="primary" icon="file-check" onClick={runTest}>Imprimir página de teste</Button>}
          {result && !result.ok && <Button variant="secondary" onClick={() => { setPhase('choose'); setResult(null); }}>Voltar</Button>}
          {phase === 'tested' && !test.ok && <Button variant="secondary" icon="refresh-cw" onClick={runTest}>Testar de novo</Button>}
          <Button variant={phase === 'tested' && test.ok ? 'primary' : 'ghost'} onClick={onClose}>Fechar</Button>
        </>;

  return (
    <Modal open onClose={phase === 'installing' || phase === 'testing' ? undefined : onClose} width={640} icon="printer"
      title={'Instalar ' + (device.model || device.name)} description={device.ip || (device.usb && 'USB') || ''} footer={footer}>
      {err && <Alert variant="error" title="Não consegui montar as opções">{err}</Alert>}
      {!opts && !err && <ProgressBar indeterminate label="Procurando drivers compatíveis…" />}

      {opts && phase === 'choose' && (
        <div className="prn-install">
          {opts.candidates.length === 0 ? (
            <Alert variant="warn" title="Nenhum driver compatível encontrado"
              action={<Button size="sm" variant="secondary" icon="folder-plus" onClick={goDrivers}>Configurar repositório</Button>}>
              Coloque o driver extraído (com o arquivo .inf) no repositório da equipe e reindexe. Para achar o driver:
              <div className="prn-ext">
                {opts.links.map((l) => <a key={l.url} href="#" onClick={(e) => { e.preventDefault(); window.devkit.shell.openUrl(l.url); }}>{l.label} ↗</a>)}
              </div>
            </Alert>
          ) : (
            <div className="prn-cands" role="radiogroup">
              {opts.candidates.map((c) => (
                <button key={c.key} type="button" role="radio" aria-checked={key === c.key}
                  className={'prn-cand' + (key === c.key ? ' is-on' : '')} onClick={() => setKey(c.key)}>
                  <span className="prn-cand__icon"><Icon name={SOURCE_ICON[c.source] || 'package'} size={16} /></span>
                  <span className="prn-cand__main">
                    <span className="prn-cand__name">{c.driver}</span>
                    <span className="prn-cand__note">{c.label} · {c.note}{c.version ? ' · ' + c.version : ''}</span>
                  </span>
                  {c.recommended ? <Badge size="sm" variant="ok">recomendado</Badge> : <Badge size="sm" mono>{Math.round(c.score * 100)}%</Badge>}
                </button>
              ))}
            </div>
          )}

          {opts.candidates.length > 0 && <>
            <div className="prn-conn"><Icon name="cable" size={14} /> {connectionText(opts, device, chosen)}</div>
            <div className="prn-form">
              <Field label="Nome da fila" hint="Como a impressora aparece no Windows">
                <Input value={queue} onChange={(e) => setQueue(e.target.value)} maxLength={120} />
              </Field>
              <Field label="Local (opcional)" hint="Ex.: Financeiro — 2º andar">
                <Input value={location} onChange={(e) => setLocation(e.target.value)} maxLength={120} />
              </Field>
            </div>
            <label className="prn-default"><Toggle checked={setDefault} onChange={setSetDefault} /> Definir como impressora padrão deste usuário</label>
            {opts.links.length > 0 && (
              <div className="prn-ext prn-ext--muted">Outros drivers: {opts.links.map((l) => <a key={l.url} href="#" onClick={(e) => { e.preventDefault(); window.devkit.shell.openUrl(l.url); }}>{l.label} ↗</a>)}</div>
            )}
          </>}
        </div>
      )}

      {phase === 'installing' && <ProgressBar indeterminate label="Instalando… confirme a permissão de administrador (UAC) se o Windows pedir" />}

      {(phase === 'done' || phase === 'testing' || phase === 'tested') && result && (
        <div className="prn-install">
          {result.ok
            ? <Alert variant="ok" title={'Fila "' + result.queue + '" criada'}>{result.reboot ? 'O Windows pediu reinício para concluir o driver; a fila já pode ser testada.' : 'Agora imprima a página de teste para confirmar.'}</Alert>
            : <Alert variant="error" title="A instalação não terminou">{result.error}</Alert>}
          {result.steps && result.steps.length > 0 && <Steps steps={result.steps} />}
          {result.defaultResult && !result.defaultResult.ok && <Alert variant="warn" title="Não consegui definir como padrão">{result.defaultResult.error}</Alert>}
          {phase === 'testing' && <ProgressBar indeterminate label="Enviando a página de teste e acompanhando a fila…" />}
          {phase === 'tested' && (
            <Alert variant={test.ok ? 'ok' : 'warn'} title={test.ok ? 'Página de teste impressa' : 'A página de teste não saiu da fila'}>
              {test.detail}{!test.ok && ' — confira se a impressora está ligada, com papel e sem erro no painel.'}
            </Alert>
          )}
          {phase === 'tested' && test.ok && <div className="prn-ask"><Tag>Saiu no papel?</Tag> Se a página saiu em branco ou com caracteres estranhos, o driver não é o certo: remova a fila e instale com outro.</div>}
        </div>
      )}
    </Modal>
  );
}

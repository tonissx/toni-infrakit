import { DS } from '../../lib/ds.js';
import { usePersisted } from '../../lib/store.js';
import { timeAgo } from '../../lib/fmt.js';
import { RemoteInstallModal } from './RemoteInstallModal.jsx';

const { Card, Button, Input, Badge, Checkbox, Alert, ProgressBar, EmptyState, Icon } = DS;

const ROW_MAX = 400;
const STATE = {
  wait: { variant: 'neutral', label: 'aguardando' },
  running: { variant: 'accent', label: 'instalando…', dot: true },
  ok: { variant: 'ok', label: 'instalada' },
  fail: { variant: 'error', label: 'falhou' },
  skipped: { variant: 'warn', label: 'cancelado' },
};

/** Andamento (e resultado) da instalação em vários computadores. */
function RemoteProgress({ r }) {
  const [open, setOpen] = React.useState(null);
  const p = window.devkit.printers;
  const done = r.items.filter((i) => i.state === 'ok' || i.state === 'fail' || i.state === 'skipped').length;
  const okCount = r.items.filter((i) => i.state === 'ok').length;
  return (
    <Card padding={16} title={`Instalando "${r.queue}"`} icon="monitor-up"
      actions={r.done
        ? <Button size="sm" variant="ghost" icon="x" onClick={() => p.remoteClear()}>Fechar</Button>
        : <Button size="sm" variant="secondary" icon="square" disabled={r.cancelled} onClick={() => p.remoteCancel()}>{r.cancelled ? 'Cancelando…' : 'Parar'}</Button>}>
      <ProgressBar value={(done / r.items.length) * 100} showValue
        label={r.done ? `${okCount} de ${r.items.length} instalada(s)` : `${done} de ${r.items.length} concluída(s)`} />
      <div className="prn-dirs" style={{ marginTop: 10 }}>
        {r.items.map((i) => {
          const st = STATE[i.state] || STATE.wait;
          return (
            <div key={i.computer} className="prn-logrow" style={{ listStyle: 'none' }}>
              <button type="button" className="prn-logrow__head" style={{ gridTemplateColumns: '130px 1fr 14px' }} onClick={() => setOpen(open === i.computer ? null : i.computer)}>
                <span><b className="tk-mono">{i.computer}</b></span>
                <span className="prn-logrow__detail">{i.detail || ' '}</span>
                <Badge size="sm" variant={st.variant} dot={st.dot}>{st.label}</Badge>
              </button>
              {open === i.computer && i.steps.length > 0 && (
                <div className="prn-logrow__body">
                  {i.steps.map((s, k) => (
                    <div key={k} className={'prn-logstep ' + (s.ok ? 'is-ok' : 'is-fail')}>
                      <Icon name={s.ok ? 'circle-check' : 'circle-x'} size={13} /><span>{s.label}</span>{s.detail && <span className="tk-mono">{s.detail}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/** Computadores do domínio (ou digitados) onde instalar uma impressora de rede, todos de uma vez. */
export function ComputersTab({ state: s, toast }) {
  const [store, setStore] = usePersisted('printers-computers', { ad: [], at: 0, manual: [], selected: [] });
  const [loading, setLoading] = React.useState(false);
  const [adError, setAdError] = React.useState(null);
  const [name, setName] = React.useState('');
  const [filter, setFilter] = React.useState('');
  const [checks, setChecks] = React.useState({});
  const [checking, setChecking] = React.useState(false);
  const [installing, setInstalling] = React.useState(false);
  const p = window.devkit.printers;
  const remoteBusy = !!(s.remote && !s.remote.done);

  const all = [];
  const seen = new Set();
  for (const c of [...store.manual.map((n) => ({ name: n, manual: true })), ...store.ad]) {
    if (seen.has(c.name.toLowerCase())) continue;
    seen.add(c.name.toLowerCase());
    all.push(c);
  }
  const f = filter.trim().toLowerCase();
  const rows = all.filter((c) => !f || c.name.toLowerCase().includes(f) || (c.os || '').toLowerCase().includes(f));
  const shown = rows.slice(0, ROW_MAX);
  const selected = store.selected.filter((n) => seen.has(n.toLowerCase()));
  const isSel = (n) => selected.some((x) => x.toLowerCase() === n.toLowerCase());
  const setSelected = (list) => setStore((v) => ({ ...v, selected: list }));
  const toggle = (n) => setSelected(isSel(n) ? selected.filter((x) => x.toLowerCase() !== n.toLowerCase()) : [...selected, n]);
  const allShownSelected = shown.length > 0 && shown.every((c) => isSel(c.name));

  const fetchAd = () => {
    setLoading(true);
    setAdError(null);
    p.computers().then((r) => {
      if (!r.ok) { setAdError(r.error || 'Não consegui ler o Active Directory'); return; }
      setStore((v) => ({ ...v, ad: r.computers.map((c) => ({ name: c.name, os: c.os, lastLogon: c.lastLogon ? Date.parse(c.lastLogon) : 0 })), at: Date.now() }));
      toast('Active Directory', `${r.computers.length} computador(es)`);
    }, (e) => setAdError(e.message)).finally(() => setLoading(false));
  };

  const addManual = () => {
    const names = name.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
    if (!names.length) return;
    setStore((v) => ({ ...v, manual: [...new Set([...v.manual, ...names])], selected: [...new Set([...v.selected, ...names])] }));
    setName('');
  };

  const verify = () => {
    setChecking(true);
    setChecks((c) => { const n = { ...c }; selected.forEach((x) => { n[x] = { pending: true }; }); return n; });
    p.preflight({ computers: selected }).then((list) => {
      setChecks((c) => { const n = { ...c }; list.forEach((r) => { n[r.computer] = r; }); return n; });
      const bad = list.filter((r) => !r.ok).length;
      toast('Verificação concluída', bad ? `${bad} computador(es) sem resposta` : 'Todos responderam', bad ? 'warn' : 'ok');
    }, (e) => toast('Não deu para verificar', e.message, 'error')).finally(() => setChecking(false));
  };

  const badge = (n) => {
    const c = checks[n];
    if (!c) return null;
    if (c.pending) return <Badge size="sm" variant="neutral" dot>verificando…</Badge>;
    if (!c.ok) return <Badge size="sm" variant="error" title={c.error}>{c.error}</Badge>;
    if (c.x64 === false) return <Badge size="sm" variant="warn">32 bits</Badge>;
    return <Badge size="sm" variant="ok" dot>pronto</Badge>;
  };

  return (
    <div className="prn-drivers tk-scroll">
      {s.remote && <RemoteProgress r={s.remote} />}

      <Card padding={16} title="Computadores" icon="monitor"
        actions={<Button size="sm" variant="secondary" icon="network" loading={loading} onClick={fetchAd}>{store.at ? 'Atualizar do Active Directory' : 'Buscar no Active Directory'}</Button>}>
        <p className="prn-hint">
          Escolha os computadores e instale a mesma impressora de rede em todos de uma vez, com o seu usuário (precisa ser administrador
          neles e o WinRM precisa estar ativo). {store.at ? `Lista do domínio de ${timeAgo(store.at)}.` : ''}
        </p>
        {adError && <Alert variant="error" title="Não consegui ler o Active Directory">{adError}</Alert>}
        <div className="prn-addrow">
          <Input size="sm" mono icon="plus" placeholder="Adicionar por nome (separe vários por espaço ou vírgula)" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') addManual(); }} style={{ flex: 1 }} />
          <Button size="sm" variant="secondary" disabled={!name.trim()} onClick={addManual}>Adicionar</Button>
          <Input size="sm" icon="search" placeholder="Filtrar" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ width: 200 }} />
        </div>

        {all.length === 0
          ? <EmptyState compact title="Nenhum computador ainda" description="Busque no Active Directory ou digite os nomes." />
          : <>
              <div className="prn-addrow" style={{ marginBottom: 6 }}>
                <Checkbox checked={allShownSelected} indeterminate={!allShownSelected && shown.some((c) => isSel(c.name))}
                  label={`Selecionar ${filter ? 'os filtrados' : 'todos'} (${shown.length})`}
                  onChange={(on) => setSelected(on ? [...new Set([...selected, ...shown.map((c) => c.name)])] : selected.filter((n) => !shown.some((c) => c.name.toLowerCase() === n.toLowerCase())))} />
                <span className="prn-muted" style={{ marginLeft: 'auto' }}>{selected.length} selecionado(s)</span>
              </div>
              <div className="prn-dirs">
                {shown.map((c) => (
                  <div key={c.name} className="prn-dir" onClick={() => toggle(c.name)} style={{ cursor: 'pointer' }}>
                    <span onClick={(e) => e.stopPropagation()}><Checkbox checked={isSel(c.name)} onChange={() => toggle(c.name)} /></span>
                    <span className="tk-mono" style={{ width: 150 }}>{c.name}</span>
                    <span className="prn-muted" style={{ flex: 1 }}>{c.manual ? 'digitado' : `${c.os || ''}${c.lastLogon ? ' · logon ' + timeAgo(c.lastLogon) : ''}`}</span>
                    {badge(c.name)}
                  </div>
                ))}
              </div>
              {rows.length > ROW_MAX && <div className="prn-muted" style={{ marginTop: 6 }}>Mostrando {ROW_MAX} de {rows.length}; use o filtro.</div>}
            </>}

        <div className="prn-addrow" style={{ marginTop: 12, marginBottom: 0 }}>
          <Button variant="secondary" icon="radar" loading={checking} disabled={!selected.length || remoteBusy} onClick={verify}>Verificar</Button>
          <Button variant="primary" icon="monitor-up" disabled={!selected.length || remoteBusy} onClick={() => setInstalling(true)}>Instalar impressora nos selecionados…</Button>
        </div>
      </Card>

      {installing && <RemoteInstallModal computers={selected} devices={s.devices} toast={toast} onClose={() => setInstalling(false)} />}
    </div>
  );
}

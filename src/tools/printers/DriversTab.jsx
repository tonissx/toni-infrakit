import { DS } from '../../lib/ds.js';
import { timeAgo } from '../../lib/fmt.js';

const { Card, Button, IconButton, Input, Badge, Alert, ProgressBar } = DS;

/** Repositório de drivers da equipe: pastas com drivers extraídos (.inf), locais ou na rede. */
export function DriversTab({ state: s, toast }) {
  const [path, setPath] = React.useState('');
  const dirs = s.settings.repoDirs;
  const save = (next) => window.devkit.printers.setSettings({ repoDirs: next }).catch((e) => toast('Erro', e.message, 'error'));
  const add = (p) => {
    const v = String(p || '').trim();
    if (!v) return;
    if (dirs.some((d) => d.toLowerCase() === v.toLowerCase())) { toast('Essa pasta já está na lista', v, 'warn'); return; }
    save([...dirs, v]);
    setPath('');
  };
  const pick = () => window.devkit.printers.pickFolder().then((p) => p && add(p));
  const r = s.repo;

  return (
    <div className="prn-drivers tk-scroll">
      <Card padding={20} title="Repositório da equipe" icon="folder-tree"
        actions={<Button size="sm" variant="secondary" icon="refresh-cw" loading={!!r.indexing} disabled={!dirs.length}
          onClick={() => window.devkit.printers.reindex()}>Reindexar</Button>}>
        <p className="prn-hint">
          Pastas com os drivers <b>extraídos</b>, ou seja, com o arquivo <code>.inf</code> e os arquivos dele (não o instalador <code>.exe</code>).
          Pode ser uma pasta de rede, como <code>\\servidor\drivers\impressoras</code>. Só o que estiver aqui é instalado: o app não baixa
          nada da internet.
        </p>
        <div className="prn-dirs">
          {dirs.map((d) => (
            <div key={d} className="prn-dir">
              <span className="tk-mono">{d}</span>
              <IconButton size="sm" icon="x" label="Tirar da lista" onClick={() => save(dirs.filter((x) => x !== d))} />
            </div>
          ))}
          {!dirs.length && <div className="prn-dir prn-dir--empty">Nenhuma pasta ainda.</div>}
        </div>
        <div className="prn-addrow">
          <Input size="sm" mono placeholder="\\servidor\drivers ou C:\Drivers" value={path} onChange={(e) => setPath(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add(path); }} style={{ flex: 1 }} />
          <Button size="sm" variant="secondary" onClick={() => add(path)} disabled={!path.trim()}>Adicionar</Button>
          <Button size="sm" variant="ghost" icon="folder-open" onClick={pick}>Escolher pasta…</Button>
        </div>
        {r.indexing && <ProgressBar value={r.indexing.total ? (r.indexing.done / r.indexing.total) * 100 : 0} label="Lendo os .inf…" showValue />}
        {!r.indexing && r.at && (
          <div className="prn-repostat">
            <Badge size="sm" variant="ok" dot>{r.models} modelo(s)</Badge>
            <Badge size="sm">{r.infs} .inf de impressora</Badge>
            <Badge size="sm">{r.scanned} .inf lidos</Badge>
            <span className="prn-muted">indexado {timeAgo(r.at)}</span>
          </div>
        )}
        {r.errors.map((e) => <Alert key={e.dir} variant="warn" title={e.dir}>{e.error}</Alert>)}
      </Card>

      <Card padding={20} title="Como montar o repositório" icon="book-open">
        <ol className="prn-howto">
          <li>Baixe o driver no site do fabricante ou no Microsoft Update Catalog (o botão aparece ao instalar uma impressora sem driver).</li>
          <li>Extraia o pacote: os instaladores <code>.exe</code> costumam abrir com o 7-Zip, ou têm a opção "só extrair". Os <code>.cab</code> do Update Catalog abrem com <code>expand -F:* arquivo.cab pasta</code>.</li>
          <li>Coloque cada driver numa pasta própria, como <code>\\servidor\drivers\HP\LaserJet M404</code>, e clique em <b>Reindexar</b>.</li>
          <li>Prefira os drivers <b>x64</b> e os que têm assinatura do fabricante. O Windows recusa driver de impressora sem assinatura.</li>
        </ol>
      </Card>

      <Card padding={20} title="Neste Windows" icon="monitor">
        <div className="prn-repostat">
          <Badge size="sm">{s.local ? s.local.drivers : '—'} driver(s) de impressora instalados</Badge>
          {s.local && <Badge size="sm" variant={s.local.isAdmin ? 'ok' : 'neutral'} dot>{s.local.isAdmin ? 'app rodando como administrador' : 'instalar pede o UAC'}</Badge>}
        </div>
        <p className="prn-hint">
          Impressoras com IPP Everywhere / Mopria (a maioria das fabricadas desde 2016) instalam com o driver de classe IPP da Microsoft,
          sem driver do fabricante. A Microsoft está tirando o suporte aos drivers de terceiros, então esse é o caminho que vai continuar funcionando.
        </p>
      </Card>
    </div>
  );
}

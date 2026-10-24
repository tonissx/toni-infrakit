import { DS, mod } from '../lib/ds.js';
import { THEMES } from '../lib/themes.js';

const { PageHeader, Card, Select, Kbd, Badge, Toggle, Alert, Button, Input } = DS;

const Row = ({ label, hint, children }) => (
  <div className="set-row">
    <div><div className="set-row__label">{label}</div>{hint && <div className="set-row__hint">{hint}</div>}</div>
    <div className="set-row__ctl">{children}</div>
  </div>
);

/** Opções de rede usadas pela varredura de impressoras. */
function PrintersCard() {
  const [s, setS] = React.useState(null);
  const [community, setCommunity] = React.useState('');
  React.useEffect(() => {
    window.devkit.printers.get().then((x) => { setS(x); setCommunity(x.settings.community); });
  }, []);
  if (!s) return null;
  const save = () => window.devkit.printers.setSettings({ community }).then((x) => { setS(x); setCommunity(x.settings.community); });
  return (
    <Card padding={24}>
      <div className="tk-card__title">Impressoras</div>
      <Row label="Comunidade SNMP" hint="Usada só para LER modelo, serial e nível de toner (SNMP v2c/v1). O padrão de fábrica é public">
        <Input size="sm" mono value={community} onChange={(e) => setCommunity(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); }} style={{ width: 160 }} />
      </Row>
      <Row label="Este computador" hint={s.local ? (s.local.os && s.local.os.Caption) || '' : 'lendo…'}>
        {s.local && (s.local.isAdmin
          ? <Badge size="sm" variant="ok" dot>rodando como administrador</Badge>
          : <Badge size="sm" dot>usuário comum: instalar pede o UAC</Badge>)}
      </Row>
    </Card>
  );
}

/** Verificar/baixar/instalar atualizações (ver electron/updater/service.js). */
function UpdaterCard({ updater }) {
  const [busy, setBusy] = React.useState(false);
  const check = () => { setBusy(true); window.devkit.updater.check().finally(() => setBusy(false)); };

  if (!updater || updater.mode === 'unsupported') {
    return (
      <Card padding={24}>
        <div className="tk-card__title">Atualizações</div>
        <Row label="Verificar atualizações" hint="Indisponível nesta build (modo de desenvolvimento)">
          <Badge size="sm">indisponível</Badge>
        </Row>
      </Card>
    );
  }

  const checkOnly = updater.mode === 'check-only';
  return (
    <Card padding={24}>
      <div className="tk-card__title">Atualizações</div>
      {checkOnly && (
        <Row label="Modo" hint="A versão portátil não se atualiza sozinha — só avisa quando há versão nova">
          <Badge size="sm">somente aviso</Badge>
        </Row>
      )}
      <Row label="Versão instalada"><Badge size="sm" mono>v{updater.version}</Badge></Row>
      {updater.status === 'error' && <Alert variant="error" title="Erro ao verificar">{updater.error}</Alert>}
      {(updater.status === 'idle' || updater.status === 'not-available' || updater.status === 'error') && (
        <Row label="Buscar nova versão">
          <Button variant="secondary" loading={busy || updater.status === 'checking'} onClick={check}>Verificar atualizações</Button>
        </Row>
      )}
      {updater.status === 'available' && (
        <Alert variant="info" title={`Versão ${updater.latestVersion} disponível`}
          action={checkOnly
            ? <Button variant="primary" onClick={() => window.devkit.shell.openUrl(updater.releaseUrl)}>Abrir página da release</Button>
            : <Button variant="primary" onClick={() => window.devkit.updater.download()}>Baixar</Button>} />
      )}
      {updater.status === 'downloading' && (
        <Alert variant="info" title="Baixando atualização…">
          {updater.progress ? Math.round(updater.progress.percent) + '%' : ''}
        </Alert>
      )}
      {updater.status === 'downloaded' && (
        <Alert variant="ok" title="Atualização pronta"
          action={<Button variant="primary" onClick={() => window.devkit.updater.install()}>Reiniciar e instalar</Button>}>
          Versão {updater.latestVersion} baixada.
        </Alert>
      )}
    </Card>
  );
}

export function Settings({ prefs, setPrefs, info, updater }) {
  const shortcuts = [
    ['Recolher sidebar', mod('\\')],
    ['Configurações', mod(',')],
    ['Próxima ferramenta', 'Ctrl+Tab'],
    ['Ferramenta anterior', 'Ctrl+Shift+Tab'],
    ['Impressoras: procurar de novo', 'F5'],
  ];
  return (
    <div>
      <PageHeader icon="settings" title="Configurações" subtitle="Preferências salvas localmente neste computador" />
      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 820 }}>
        <Card padding={24}>
          <div className="tk-card__title">Aparência</div>
          <Row label="Tema" hint="Os mesmos temas do Toni Devkit">
            <Select options={THEMES} value={prefs.theme} onChange={(theme) => setPrefs((p) => ({ ...p, theme }))} style={{ width: 200 }} />
          </Row>
          <Row label="Sidebar recolhida" hint="Mostra só os ícones das ferramentas">
            <Toggle checked={prefs.collapsed} onChange={(collapsed) => setPrefs((p) => ({ ...p, collapsed }))} />
          </Row>
        </Card>
        <PrintersCard />
        <Card padding={24}>
          <div className="tk-card__title">Atalhos</div>
          {shortcuts.map(([a, k]) => <Row key={a} label={a}><Kbd size="sm">{k}</Kbd></Row>)}
        </Card>
        <Card padding={24}>
          <div className="tk-card__title">Sobre</div>
          <Row label="Toni Infra Kit" hint="Ferramentas para a equipe de infraestrutura"><Badge size="sm" mono>v{info?.version || '—'}</Badge></Row>
          <Row label="Desenvolvido por"><Badge size="sm">Antônio Gonçalves</Badge></Row>
          <Row label="Repositório">
            <a className="set-link" href="https://github.com/tonissx/toni-infrakit" target="_blank" rel="noreferrer">github.com/tonissx/toni-infrakit</a>
          </Row>
          <Row label="Electron"><Badge size="sm" mono>{info?.electron || '—'}</Badge></Row>
        </Card>
        <UpdaterCard updater={updater} />
      </div>
    </div>
  );
}

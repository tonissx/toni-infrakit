import { DS, isMod, isMac } from './lib/ds.js';
import { usePersisted } from './lib/store.js';
import { SIDEBAR_ORDER, findTool } from './tools/registry.js';
import { resolveTheme } from './lib/themes.js';
import { AppSidebar } from './shell/AppSidebar.jsx';
import { Home } from './screens/Home.jsx';
import { Settings } from './screens/Settings.jsx';

const { TitleBar, Toast } = DS;

const titlePlatform = isMac ? 'mac' : window.devkit.platform === 'win32' ? 'windows' : 'linux';

function applyTheme(pref) {
  document.documentElement.dataset.theme = resolveTheme(pref);
  window.devkit.theme.set(pref);
}

function App() {
  const [prefs, setPrefs] = usePersisted('prefs', { theme: 'dark', collapsed: false, route: 'home' });
  const [toasts, setToasts] = React.useState([]);
  const [info, setInfo] = React.useState(null);
  const route = prefs.route === 'home' || prefs.route === 'settings' || findTool(prefs.route) ? prefs.route : 'home';

  const go = (r) => setPrefs((p) => ({ ...p, route: r }));
  const toggleSidebar = () => setPrefs((p) => ({ ...p, collapsed: !p.collapsed }));
  const toast = (title, description, variant = 'ok') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, title, description, variant }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), variant === 'error' ? 6000 : 3500);
  };

  React.useEffect(() => { applyTheme(prefs.theme); }, [prefs.theme]);
  React.useEffect(() => { window.devkit.info().then(setInfo); }, []);

  // Atalhos globais
  React.useEffect(() => {
    const h = (e) => {
      if (!isMod(e)) return;
      if (e.key === '\\') { e.preventDefault(); toggleSidebar(); }
      else if (e.key === ',') { e.preventDefault(); go('settings'); }
      else if (e.key === 'Tab') {
        // Ctrl+Tab / Ctrl+Shift+Tab: próxima / anterior na sidebar (Início → ferramentas → Início).
        e.preventDefault();
        const ids = ['home', ...SIDEBAR_ORDER.map((t) => t.id)];
        setPrefs((p) => {
          const at = ids.indexOf(p.route);
          const next = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + ids.length) % ids.length;
          return { ...p, route: ids[next] };
        });
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Atualização automática: status + aviso quando terminar de baixar (ver electron/updater/service.js).
  const [updater, setUpdater] = React.useState(null);
  const prevUpdaterStatus = React.useRef(null);
  React.useEffect(() => {
    window.devkit.updater.status().then(setUpdater, () => {});
    return window.devkit.updater.onChanged(setUpdater);
  }, []);
  React.useEffect(() => {
    if (updater && updater.status === 'downloaded' && prevUpdaterStatus.current !== 'downloaded') {
      toast('Atualização pronta', `Reinicie o Infrakit para aplicar a versão ${updater.latestVersion || ''}`);
    }
    prevUpdaterStatus.current = updater && updater.status;
  }, [updater]);

  // Controles de janela (Windows/Linux): os botões do TitleBar do DS → IPC.
  const onTitleClick = (e) => {
    const b = e.target.closest('.tk-winctl button');
    if (!b) return;
    const a = b.getAttribute('aria-label');
    if (a === 'Minimizar') window.devkit.window.minimize();
    else if (a === 'Maximizar') window.devkit.window.toggleMaximize();
    else if (a === 'Fechar') window.devkit.window.close();
  };
  const onTitleDbl = (e) => { if (!e.target.closest('button')) window.devkit.window.toggleMaximize(); };

  const tool = findTool(route);
  const Screen = tool && tool.component;
  const screen = route === 'home' ? <Home go={go} />
    : route === 'settings' ? <Settings prefs={prefs} setPrefs={setPrefs} info={info} updater={updater} />
    : <Screen toast={toast} />;

  const title = (tool ? tool.name : route === 'settings' ? 'Configurações' : 'Início') + ' — Infrakit' + (info && info.demo ? ' (demonstração: nada é instalado de verdade)' : '');

  return (
    <div className="tk-root" style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--tk-bg)', position: 'relative', overflow: 'hidden' }}>
      <div onClick={onTitleClick} onDoubleClick={onTitleDbl}>
        <TitleBar platform={titlePlatform} title={title} />
      </div>
      <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
        <AppSidebar route={route} go={go} collapsed={prefs.collapsed} onCollapse={toggleSidebar} />
        <main className="tk-scroll" style={{ flex: 1, minWidth: 0, overflow: 'auto', background: 'var(--tk-surface-1)' }}>{screen}</main>
      </div>
      <div className="toasts">
        {toasts.map((t) => <Toast key={t.id} variant={t.variant} title={t.title} description={t.description} onClose={() => setToasts((x) => x.filter((y) => y.id !== t.id))} />)}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);

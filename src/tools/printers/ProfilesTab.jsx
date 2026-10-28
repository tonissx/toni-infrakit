import { DS } from '../../lib/ds.js';
import { prefsSummary } from './profileOptions.js';
import { ProfileEditor, loadDriverNames } from './ProfileEditor.jsx';

const { Card, Button, IconButton, Badge, EmptyState } = DS;

/** Linha de um perfil (lista da aba e do detalhe do aparelho). */
export function ProfileRow({ x, onEdit, onCopy, onDelete }) {
  return (
    <div className="prn-dir">
      <span style={{ flex: 1, minWidth: 0 }}>
        <b>{x.name}</b>
        {x.driver && x.driver.name && <span className="prn-muted"> {x.driver.name}</span>}
        <span className="prn-repostat" style={{ margin: '4px 0 0' }}>
          {prefsSummary(x.prefs).map((t) => <Badge key={t} size="sm">{t}</Badge>)}
          {!Object.keys(x.prefs).length && <span className="prn-muted">sem preferências, só o driver</span>}
        </span>
      </span>
      <IconButton size="sm" icon="pencil" label="Editar" onClick={onEdit} />
      {onCopy && <IconButton size="sm" icon="copy" label="Copiar para outro modelo" onClick={onCopy} />}
      <IconButton size="sm" icon="trash-2" label="Apagar" onClick={onDelete} />
    </div>
  );
}

/** Todos os perfis, agrupados por modelo. Novos perfis nascem no detalhe do aparelho ("Adicionar perfil"). */
export function ProfilesTab({ toast }) {
  const [list, setList] = React.useState(null);
  const [editing, setEditing] = React.useState(null); // { profile, modelEditable }
  const [drivers, setDrivers] = React.useState(null);
  const p = window.devkit.printers;
  React.useEffect(() => { p.profiles().then(setList); }, []);
  const edit = (profile, modelEditable) => { setDrivers(null); setEditing({ profile, modelEditable }); loadDriverNames().then(setDrivers); };
  if (!list) return null;

  const remove = (x) => { if (confirm(`Apagar o perfil "${x.name}"?`)) p.deleteProfile(x.id).then(setList, (e) => toast('Erro', e.message, 'error')); };
  const exportAll = () => p.exportProfiles().then((r) => r.ok && toast('Perfis exportados', r.file), (e) => toast('Erro', e.message, 'error'));
  const importAll = () => p.importProfiles().then((r) => {
    if (!r.ok) return;
    setList(r.profiles);
    toast('Perfis importados', `${r.added} novo(s)`);
  }, (e) => toast('Não importei', e.message, 'error'));

  const groups = [];
  for (const x of [...list].sort((a, b) => a.model.localeCompare(b.model) || a.name.localeCompare(b.name))) {
    const g = groups.find((y) => y.model.toLowerCase() === x.model.toLowerCase());
    if (g) g.items.push(x); else groups.push({ model: x.model, items: [x] });
  }

  return (
    <div className="prn-drivers tk-scroll">
      <Card padding={20} title="Perfis de impressora" icon="sliders-horizontal"
        actions={<div className="prn-addrow" style={{ margin: 0 }}>
          <Button size="sm" variant="ghost" icon="upload" onClick={importAll}>Importar…</Button>
          <Button size="sm" variant="ghost" icon="download" disabled={!list.length} onClick={exportAll}>Exportar…</Button>
        </div>}>
        <p className="prn-hint">
          Cada perfil pertence a um modelo e guarda o driver e as preferências de impressão (papel, origem do papel, orientação, frente e
          verso, cor). Para criar um, abra o aparelho na aba Dispositivos e clique em <b>Adicionar perfil</b>. Ao instalar esse modelo, os
          perfis dele aparecem na hora. Exporte para compartilhar com a equipe.
        </p>
        {list.length === 0
          ? <EmptyState compact title="Nenhum perfil ainda" description="Abra um aparelho em Dispositivos e use Adicionar perfil." />
          : groups.map((g) => (
              <div key={g.model} style={{ marginBottom: 14 }}>
                <div className="prn-muted" style={{ margin: '0 0 6px' }}>{g.model}</div>
                <div className="prn-dirs">
                  {g.items.map((x) => <ProfileRow key={x.id} x={x} onEdit={() => edit(x, false)} onDelete={() => remove(x)}
                    onCopy={() => edit({ name: x.name + ' (cópia)', driver: x.driver, prefs: x.prefs }, true)} />)}
                </div>
              </div>
            ))}
      </Card>
      {editing && drivers && (
        <ProfileEditor profile={editing.profile} model={editing.profile.model || ''} modelEditable={editing.modelEditable} drivers={drivers}
          toast={toast} onClose={() => setEditing(null)} onSaved={setList} />
      )}
    </div>
  );
}

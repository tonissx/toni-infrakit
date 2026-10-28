import { DS } from '../../lib/ds.js';
import { PAPER, BINS, ORIENTATION, DUPLEX, COLOR, formFromPrefs, prefsFromForm } from './profileOptions.js';

const { Button, IconButton, Input, Field, Select, Modal, Combobox, Alert } = DS;

/**
 * Cria/edita um perfil. `model` vem do aparelho (fixo); só a cópia para outro modelo (`modelEditable`) pede o texto.
 * O driver é escolhido numa busca entre os do repositório da equipe e os já instalados (`drivers`).
 */
export function ProfileEditor({ profile, model, modelEditable, drivers, onClose, onSaved, toast }) {
  const [name, setName] = React.useState(profile.name || '');
  const [modelText, setModelText] = React.useState(model || '');
  const [driver, setDriver] = React.useState((profile.driver && profile.driver.name) || '');
  const [form, setForm] = React.useState(formFromPrefs(profile.prefs));
  const [saving, setSaving] = React.useState(false);
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const unknownDriver = driver && drivers && !drivers.includes(driver);

  const save = () => {
    setSaving(true);
    window.devkit.printers.saveProfile({ id: profile.id, name, model: modelText, driver: { name: driver }, prefs: prefsFromForm(form), usedAt: profile.usedAt })
      .then((list) => { onSaved(list); onClose(); toast('Perfil salvo', name); },
        (e) => { toast('Não salvei o perfil', e.message, 'error'); setSaving(false); });
  };

  return (
    <Modal open onClose={onClose} width={620} icon="sliders-horizontal" title={profile.id ? 'Editar perfil' : 'Novo perfil'}
      description={modelEditable ? undefined : modelText}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancelar</Button>
        <Button variant="primary" icon="check" loading={saving} disabled={!name.trim() || !modelText.trim()} onClick={save}>Salvar</Button>
      </>}>
      <div className="prn-install">
        <Field label="Nome do perfil" hint="Ex.: A4 frente e verso, bandeja 2">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />
        </Field>
        {modelEditable && (
          <Field label="Modelo da impressora" hint="O perfil aparece ao instalar ou configurar esse modelo">
            <Input value={modelText} onChange={(e) => setModelText(e.target.value)} maxLength={120} />
          </Field>
        )}
        <Field label="Driver (opcional)" hint="Busque entre os drivers do repositório da equipe e os já instalados">
          <div className="prn-addrow" style={{ margin: 0 }}>
            <Combobox mono options={drivers || []} value={driver} onChange={setDriver} placeholder="Digite o nome ou o modelo do driver…" style={{ flex: 1 }} />
            {driver && <IconButton size="sm" icon="x" label="Sem driver no perfil" onClick={() => setDriver('')} />}
          </div>
          {driver && <div className="prn-muted" style={{ marginTop: 4 }}>Escolhido: <span className="tk-mono">{driver}</span></div>}
        </Field>
        {unknownDriver && <Alert variant="warn" title="Esse driver não está no repositório nem instalado">Ao instalar, o perfil só vale se o driver estiver disponível.</Alert>}
        <div className="prn-form">
          <Field label="Tamanho do papel"><Select options={PAPER} value={form.paperSize} onChange={set('paperSize')} /></Field>
          <Field label="Origem do papel"><Select options={BINS} value={form.inputBin} onChange={set('inputBin')} /></Field>
          <Field label="Orientação"><Select options={ORIENTATION} value={form.orientation} onChange={set('orientation')} /></Field>
          <Field label="Frente e verso"><Select options={DUPLEX} value={form.duplex} onChange={set('duplex')} /></Field>
          <Field label="Cor"><Select options={COLOR} value={form.color} onChange={set('color')} /></Field>
        </div>
        <p className="prn-hint">
          Vale como padrão da fila, para todos os usuários deste computador. Nem todo driver aceita todas as opções; o que não for
          aceito aparece no Histórico como "não aplicado".
        </p>
      </div>
    </Modal>
  );
}

/** Nomes de driver para a busca: os do aparelho primeiro (se houver), depois instalados + repositório. */
export async function loadDriverNames(deviceId) {
  const all = await window.devkit.printers.driverNames().catch(() => []);
  if (!deviceId) return all;
  const o = await window.devkit.printers.driverOptions(deviceId).catch(() => null);
  const own = o ? o.candidates.map((c) => c.driver) : [];
  return [...new Set([...own, ...all])];
}

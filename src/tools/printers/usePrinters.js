// Estado das impressoras vindo do processo principal (ver electron/printers/service.js), sempre atualizado.
export function usePrinters() {
  const [s, setS] = React.useState(null);
  React.useEffect(() => {
    let alive = true;
    window.devkit.printers.get().then((x) => { if (alive) setS(x); }, () => {});
    const off = window.devkit.printers.onChanged((x) => setS(x));
    return () => { alive = false; off(); };
  }, []);
  return s;
}

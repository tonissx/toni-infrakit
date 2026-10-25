# Avisos de terceiros

O Toni Infrakit é distribuído sob a licença MIT (ver `LICENSE`). Ele inclui ou carrega os componentes abaixo, cada um
com a sua própria licença. Os textos completos estão na pasta [`licenses/`](licenses), que também acompanha o app
instalado, ao lado do `LICENSE`.

| Componente | Uso | Licença | Texto |
| --- | --- | --- | --- |
| [Electron](https://www.electronjs.org) | Runtime do app (inclui o Chromium; os avisos dele vão em `LICENSE.electron.txt` e `LICENSES.chromium.html`) | MIT | no app instalado |
| [React](https://react.dev) e React DOM | Interface | MIT | `licenses/LICENSE.react.txt` |
| [Lucide](https://lucide.dev) | Ícones (`renderer/vendor/lucide.min.js`); parte deles vem do Feather (MIT), coberto no mesmo arquivo | ISC | `licenses/LICENSE.lucide.txt` |
| [Geist e Geist Mono](https://vercel.com/font) | Fontes (`renderer/ds/fonts`) | SIL OFL 1.1 | `licenses/LICENSE.geist-OFL-1.1.txt` e `renderer/ds/fonts/OFL.txt` |
| Toni Devkit Design System | Componentes e estilos da interface (`renderer/ds`), do [Toni Devkit](https://github.com/tonissx/toni-devkit) | MIT | `LICENSE` |
| [electron-updater](https://www.electron.build) | Atualização automática | MIT | no `app.asar` |
| [esbuild](https://esbuild.github.io) e [electron-builder](https://www.electron.build) | Build e empacotamento (desenvolvimento) | MIT | — |

## Dependências indiretas

O `electron-updater` traz outras bibliotecas (por exemplo `js-yaml`, `semver`, `lazy-val`, `builder-util-runtime`).
Todas são permissivas (MIT, ISC, Apache-2.0). O texto de cada uma acompanha o pacote em `node_modules/<pacote>/`
dentro do `app.asar`.

## Drivers de impressora

O app não inclui nem baixa drivers. Ele instala o que a equipe colocou no repositório de drivers configurado, os
drivers que já estão no Windows ou os drivers de classe da Microsoft que vêm com o sistema. Cada driver segue a
licença do seu fabricante.

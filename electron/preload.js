'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listen = (channel) => (cb) => {
  const h = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, h);
  return () => ipcRenderer.removeListener(channel, h);
};

/** API mínima e explícita exposta ao renderer (window.devkit — mesmo nome do Toni Devkit, para o DS e o código compartilhado). */
contextBridge.exposeInMainWorld('devkit', {
  platform: process.platform,
  info: () => ipcRenderer.invoke('app:info'),
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    onState: listen('win:state'),
  },
  theme: {
    set: (t) => ipcRenderer.invoke('theme:set', t),
  },
  shell: {
    openUrl: (url) => ipcRenderer.invoke('shell:open-url', url),
  },
  /** Impressoras (ver electron/printers/service.js). */
  printers: {
    get: () => ipcRenderer.invoke('printers:get'),
    refresh: () => ipcRenderer.invoke('printers:refresh'),
    scan: (opts) => ipcRenderer.invoke('printers:scan', opts),
    cancelScan: () => ipcRenderer.invoke('printers:cancel-scan'),
    driverOptions: (id) => ipcRenderer.invoke('printers:driver-options', id),
    computers: () => ipcRenderer.invoke('printers:computers'),
    preflight: (req) => ipcRenderer.invoke('printers:preflight', req),
    /** req: { computers: string[], deviceId, key, queue, location, profileId? } — o andamento vem em onChanged (remote). */
    remoteInstall: (req) => ipcRenderer.invoke('printers:remote-install', req),
    remoteCancel: () => ipcRenderer.invoke('printers:remote-cancel'),
    remoteClear: () => ipcRenderer.invoke('printers:remote-clear'),
    driverNames: () => ipcRenderer.invoke('printers:driver-names'),
    profiles: () => ipcRenderer.invoke('printers:profiles'),
    saveProfile: (p) => ipcRenderer.invoke('printers:profile-save', p),
    deleteProfile: (id) => ipcRenderer.invoke('printers:profile-delete', id),
    applyProfile: (queue, id) => ipcRenderer.invoke('printers:profile-apply', queue, id),
    capabilities: (queue) => ipcRenderer.invoke('printers:capabilities', queue),
    exportProfiles: () => ipcRenderer.invoke('printers:profiles-export'),
    importProfiles: () => ipcRenderer.invoke('printers:profiles-import'),
    /** req: { deviceId, key, queue, location, setDefault, profileId? } */
    install: (req) => ipcRenderer.invoke('printers:install', req),
    test: (queue) => ipcRenderer.invoke('printers:test', queue),
    remove: (queue) => ipcRenderer.invoke('printers:remove', queue),
    setDefault: (queue) => ipcRenderer.invoke('printers:set-default', queue),
    openQueue: (queue) => ipcRenderer.invoke('printers:open-queue', queue),
    setSettings: (patch) => ipcRenderer.invoke('printers:set-settings', patch),
    reindex: () => ipcRenderer.invoke('printers:reindex'),
    log: () => ipcRenderer.invoke('printers:log'),
    clearLog: () => ipcRenderer.invoke('printers:clear-log'),
    pickFolder: () => ipcRenderer.invoke('printers:pick-folder'),
    onChanged: listen('printers:changed'),
  },
  updater: {
    status: () => ipcRenderer.invoke('updater:status'),
    check: () => ipcRenderer.invoke('updater:check'),
    download: () => ipcRenderer.invoke('updater:download'),
    install: () => ipcRenderer.invoke('updater:install'),
    onChanged: listen('updater:changed'),
  },
});

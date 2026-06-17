const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fluxAPI', {
  onUsageUpdate:       (cb) => ipcRenderer.on('usage-update',       (_e, data) => cb(data)),
  onTokenMissing:      (cb) => ipcRenderer.on('token-missing',      ()          => cb()),
  onFetchError:        (cb) => ipcRenderer.on('fetch-error',        (_e, msg)   => cb(msg)),
  onToggleMinimized:   (cb) => ipcRenderer.on('toggle-minimized',   (_e, mini)  => cb(mini)),
  saveToken:  (token) => ipcRenderer.invoke('save-token', token),
  refreshNow: ()      => ipcRenderer.invoke('refresh-now'),
  minimize:   ()      => ipcRenderer.send('minimize-window'),
  quit:       ()      => ipcRenderer.send('quit-app'),
});

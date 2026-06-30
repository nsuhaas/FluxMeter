const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('fluxAPI', {
  onUsageUpdate:       (cb) => ipcRenderer.on('usage-update',       (_e, data) => cb(data)),
  onTokenMissing:      (cb) => ipcRenderer.on('token-missing',      ()          => cb()),
  onFetchError:        (cb) => ipcRenderer.on('fetch-error',        (_e, msg)   => cb(msg)),
  onToggleMinimized:   (cb) => ipcRenderer.on('toggle-minimized',   (_e, mini)  => cb(mini)),
  onReportData:        (cb) => ipcRenderer.on('report-data',        (_e, data)  => cb(data)),
  saveToken:      (token) => ipcRenderer.invoke('save-token', token),
  refreshNow:     ()      => ipcRenderer.invoke('refresh-now'),
  getReportData:  ()      => ipcRenderer.invoke('get-report-data'),
  minimize:       ()      => ipcRenderer.send('minimize-window'),
  openReport:     ()      => ipcRenderer.send('open-report'),
  quit:           ()      => ipcRenderer.send('quit-app'),
});

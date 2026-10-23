const { contextBridge, ipcRenderer } = require('electron');

const toolsApi = {
  detectAll: (toolKeys) => ipcRenderer.invoke('tools:detectAll', toolKeys),

  detectForStep: (stepType, command) =>
    ipcRenderer.invoke('tools:detectForStep', stepType, command),

  getPlatform: () => ipcRenderer.invoke('tools:getPlatform'),

  copyToClipboard: (text) => ipcRenderer.send('tools:copyToClipboard', text),

  rescan: (toolKey) => ipcRenderer.invoke('tools:rescan', toolKey),

  getToolDefinition: (toolKey) => ipcRenderer.invoke('tools:getToolDefinition', toolKey),

  preDeployCheck: (projectId) => ipcRenderer.invoke('tools:preDeployCheck', projectId),
};

const appApi = {
  getProjects: () => ipcRenderer.invoke('projects:get'),

  saveProject: (projectData) => ipcRenderer.invoke('projects:save', projectData),

  deleteProject: (id) => ipcRenderer.invoke('projects:delete', id),

  getServers: () => ipcRenderer.invoke('servers:get'),

  getServerCredentials: (sourceType, id) =>
    ipcRenderer.invoke('servers:getCredentials', sourceType, id),

  saveServerPreset: (serverData) => ipcRenderer.invoke('servers:save', serverData),

  deleteServerPreset: (id) => ipcRenderer.invoke('servers:delete', id),

  testConnection: (projectId) => ipcRenderer.invoke('connection:test', projectId),

  previewDeploy: (projectData) => ipcRenderer.invoke('deploy:preview', projectData),

  validatePaths: (projectId) => ipcRenderer.invoke('deploy:validatePaths', projectId),

  readyCheck: (projectData) => ipcRenderer.invoke('deploy:readyCheck', projectData),

  startDeploy: (projectId) => ipcRenderer.invoke('deploy:start', projectId),

  cancelDeploy: (projectId) => ipcRenderer.invoke('deploy:cancel', projectId),

  startPm2Logs: (projectId) => ipcRenderer.invoke('pm2Logs:start', projectId),

  stopPm2Logs: (projectId) => ipcRenderer.invoke('pm2Logs:stop', projectId),

  getLogs: (limit) => ipcRenderer.invoke('logs:get', limit),

  getLogsByProject: (projectId, limit) =>
    ipcRenderer.invoke('logs:getByProject', projectId, limit),

  getLogDetail: (logId) => ipcRenderer.invoke('logs:getDetail', logId),

  clearLogs: (projectId) => ipcRenderer.invoke('logs:clear', projectId),

  getSettings: () => ipcRenderer.invoke('settings:get'),

  saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),

  resetAllData: () => ipcRenderer.invoke('settings:reset'),

  openFilePicker: () => ipcRenderer.invoke('dialog:openFile'),

  openFolderPicker: () => ipcRenderer.invoke('dialog:openDirectory'),

  getAppVersion: () => ipcRenderer.invoke('app:version'),

  diagnosticComplete: () => ipcRenderer.send('diagnostic:complete'),

  onDeployOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('deploy:output', handler);
    return () => ipcRenderer.removeListener('deploy:output', handler);
  },

  onDeployDone: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('deploy:done', handler);
    return () => ipcRenderer.removeListener('deploy:done', handler);
  },

  onDeployBlocked: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('deploy:blocked', handler);
    return () => ipcRenderer.removeListener('deploy:blocked', handler);
  },

  onPm2LogsOutput: (callback) => {
    const handler = (_event, data) => callback(data);
    ipcRenderer.on('pm2Logs:output', handler);
    return () => ipcRenderer.removeListener('pm2Logs:output', handler);
  },

  minimizeWindow: () => ipcRenderer.send('window:minimize'),

  maximizeWindow: () => ipcRenderer.send('window:maximize'),

  closeWindow: () => ipcRenderer.send('window:close'),

  tools: toolsApi,
};

contextBridge.exposeInMainWorld('techlapse', appApi);
contextBridge.exposeInMainWorld('jarvis', appApi);

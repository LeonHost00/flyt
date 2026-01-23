const { contextBridge, ipcRenderer } = require('electron');

// Auth API - exposed to renderer for authentication
contextBridge.exposeInMainWorld('authAPI', {
  signup: (email, password) => ipcRenderer.invoke('auth:signup', { email, password }),
  login: (email, password) => ipcRenderer.invoke('auth:login', { email, password }),
  logout: () => ipcRenderer.invoke('auth:logout'),
  getUser: () => ipcRenderer.invoke('auth:getUser'),
  resetPassword: (email) => ipcRenderer.invoke('auth:resetPassword', { email }),
  complete: () => ipcRenderer.invoke('auth:complete'),
  logoutAndShowAuth: () => ipcRenderer.invoke('auth:logoutAndShowAuth'),
  googleLogin: () => ipcRenderer.invoke('auth:googleLogin'),
  onStatusChanged: (callback) => {
    ipcRenderer.on('auth:status-changed', (event, data) => callback(data));
  },
  removeStatusListener: () => {
    ipcRenderer.removeAllListeners('auth:status-changed');
  }
});

// LLM API - exposed to renderer for AI chat
// Note: Model is controlled server-side via Supabase app_settings
contextBridge.exposeInMainWorld('llmAPI', {
  chat: (options) => ipcRenderer.invoke('llm:chat', options),
  onToolProgress: (callback) => {
    ipcRenderer.on('llm:toolProgress', (event, data) => callback(data));
  },
  removeToolProgressListener: () => {
    ipcRenderer.removeAllListeners('llm:toolProgress');
  }
});

// Token API - exposed to renderer for token management
contextBridge.exposeInMainWorld('tokenAPI', {
  getBalance: () => ipcRenderer.invoke('tokens:getBalance'),
  getHistory: (options = {}) => ipcRenderer.invoke('tokens:getHistory', options),
  onUpdated: (callback) => {
    ipcRenderer.on('tokens:updated', (event, data) => callback(data));
  },
  removeUpdateListener: () => {
    ipcRenderer.removeAllListeners('tokens:updated');
  }
});

// System API - exposed to renderer for system information
contextBridge.exposeInMainWorld('systemAPI', {
  getInfo: () => ipcRenderer.invoke('system:getInfo'),
  refreshProcesses: () => ipcRenderer.invoke('system:refreshProcesses')
});

// Snipping Tool API - exposed to renderer for screen capture
contextBridge.exposeInMainWorld('snipAPI', {
  openOverlay: () => ipcRenderer.invoke('snip:openOverlay'),
  cancel: () => ipcRenderer.invoke('snip:cancel'),
  complete: (data) => ipcRenderer.invoke('snip:complete', data),
  onScreenshotData: (callback) => {
    ipcRenderer.on('snip:screenshotData', (event, data) => callback(data));
  },
  onCaptured: (callback) => {
    ipcRenderer.on('snip:captured', (event, data) => callback(data));
  },
  removeListeners: () => {
    ipcRenderer.removeAllListeners('snip:screenshotData');
    ipcRenderer.removeAllListeners('snip:captured');
  }
});

// App Control API - exposed to renderer for app settings and controls
contextBridge.exposeInMainWorld('appAPI', {
  // Auto-launch controls
  getAutoLaunchStatus: () => ipcRenderer.invoke('autoLaunch:getStatus'),
  enableAutoLaunch: () => ipcRenderer.invoke('autoLaunch:enable'),
  disableAutoLaunch: () => ipcRenderer.invoke('autoLaunch:disable'),
  // Minimize to tray
  minimizeToTray: () => ipcRenderer.invoke('app:minimizeToTray')
});

// Window Control API - exposed to renderer for frameless window controls
contextBridge.exposeInMainWorld('windowAPI', {
  close: () => ipcRenderer.invoke('window:close'),
  minimize: () => ipcRenderer.invoke('window:minimize'),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('window:toggleAlwaysOnTop'),
  getAlwaysOnTop: () => ipcRenderer.invoke('window:getAlwaysOnTop'),
  setWindowMode: (mode) => ipcRenderer.invoke('window:setMode', mode)
});

// Settings API - exposed to renderer for app settings from Supabase
contextBridge.exposeInMainWorld('settingsAPI', {
  getSystemPrompt: (options) => ipcRenderer.invoke('settings:getSystemPrompt', options)
});

// Tools API - exposed to renderer for tool information
contextBridge.exposeInMainWorld('toolsAPI', {
  getAvailable: () => ipcRenderer.invoke('tools:getAvailable'),
  getHistory: (options = {}) => ipcRenderer.invoke('tools:getHistory', options)
});

// Shell API - exposed to renderer for opening external links
contextBridge.exposeInMainWorld('shellAPI', {
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url)
});

// User Input API - exposed to renderer for agent user interaction
contextBridge.exposeInMainWorld('userInputAPI', {
  onRequest: (callback) => {
    ipcRenderer.on('user_input:request', (event, data) => callback(data));
  },
  sendResponse: (data) => ipcRenderer.send('user_input:response', data),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('user_input:request');
  }
});

// User Interface API - exposed for agent display actions
contextBridge.exposeInMainWorld('userInterfaceAPI', {
  onPresent: (callback) => {
    ipcRenderer.on('user_interface:present', (event, data) => callback(data));
  },
  sendAck: (data) => ipcRenderer.send('user_interface:ack', data),
  removeListeners: () => {
    ipcRenderer.removeAllListeners('user_interface:present');
  }
});

// Chat History API - exposed for local chat history storage
contextBridge.exposeInMainWorld('chatHistoryAPI', {
  save: (conversation) => ipcRenderer.invoke('chatHistory:save', conversation),
  load: (id) => ipcRenderer.invoke('chatHistory:load', id),
  delete: (id) => ipcRenderer.invoke('chatHistory:delete', id),
  list: () => ipcRenderer.invoke('chatHistory:list'),
  clearAll: () => ipcRenderer.invoke('chatHistory:clearAll')
});

// Generic Electron API for renderer communication
contextBridge.exposeInMainWorld('electronAPI', {
  receive: (channel, func) => {
    const validChannels = [];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => func(...args));
    }
  }
});

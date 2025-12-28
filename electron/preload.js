const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  saveFile: (content) => ipcRenderer.invoke('save-file', content),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),

  // Directory operations
  readDirectory: (dirPath) => ipcRenderer.invoke('read-directory', dirPath),
  openFolder: (folderPath) => ipcRenderer.invoke('open-folder', folderPath),

  // Agent operations (similar to VSCode extension)
  executeTask: (instruction, context) => ipcRenderer.invoke('execute-task', instruction, context),
  cancelTask: (taskId) => ipcRenderer.invoke('cancel-task', taskId),
  applyDiff: (filePath, diff) => ipcRenderer.invoke('write-file', filePath, diff), // Simplified for now

  // Editor State updates from Renderer to Main (for Agent access)
  updateEditorState: (state) => ipcRenderer.send('update-editor-state', state),

  // Event listeners
  on: (channel, callback) => {
    const validChannels = [
      'open-file',
      'open-folder',
      'file-changed',
      'agent-response',
      'terminal-data',
      'editor-state-changed',
      'chat-window-closed',
      'save-file',
      'llm-connection',
      'update-status',
      'open-settings'
    ];

    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, callback);
    }
  },

  // Generic send
  send: (channel, data) => {
    const validChannels = ['popout-chat', 'update-editor-state', 'terminal-input', 'set-model'];
    if (validChannels.includes(channel)) {
      ipcRenderer.send(channel, data);
    }
  },

  // Terminal operations
  sendTerminalInput: (input) => ipcRenderer.send('terminal-input', input),
  onTerminalData: (callback) => ipcRenderer.on('terminal-data', (event, data) => callback(data)),

  // Clipboard operations
  clipboard: {
    writeText: (text) => ipcRenderer.send('clipboard-write', text),
    readText: () => ipcRenderer.invoke('clipboard-read')
  },

  // Get platform info
  platform: process.platform,

  // Development helpers
  isDev: () => process.env.ELECTRON_IS_DEV === 'true'
  ,

  // Settings (LLM endpoints)
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSettings: (settings) => ipcRenderer.invoke('set-settings', settings)
});

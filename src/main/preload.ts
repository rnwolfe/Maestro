import { contextBridge, ipcRenderer } from 'electron';

// Type definitions that match renderer types
interface ProcessConfig {
  sessionId: string;
  toolType: string;
  cwd: string;
  command: string;
  args: string[];
}

interface AgentConfig {
  id: string;
  name: string;
  available: boolean;
  path?: string;
}

interface DirectoryEntry {
  name: string;
  isDirectory: boolean;
  path: string;
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('maestro', {
  // Settings API
  settings: {
    get: (key: string) => ipcRenderer.invoke('settings:get', key),
    set: (key: string, value: unknown) => ipcRenderer.invoke('settings:set', key, value),
    getAll: () => ipcRenderer.invoke('settings:getAll'),
  },

  // Process/Session API
  process: {
    spawn: (config: ProcessConfig) => ipcRenderer.invoke('process:spawn', config),
    write: (sessionId: string, data: string) => ipcRenderer.invoke('process:write', sessionId, data),
    kill: (sessionId: string) => ipcRenderer.invoke('process:kill', sessionId),
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('process:resize', sessionId, cols, rows),

    // Event listeners
    onData: (callback: (sessionId: string, data: string) => void) => {
      ipcRenderer.on('process:data', (_, sessionId, data) => callback(sessionId, data));
    },
    onExit: (callback: (sessionId: string, code: number) => void) => {
      ipcRenderer.on('process:exit', (_, sessionId, code) => callback(sessionId, code));
    },
  },

  // Git API
  git: {
    status: (cwd: string) => ipcRenderer.invoke('git:status', cwd),
    diff: (cwd: string, file?: string) => ipcRenderer.invoke('git:diff', cwd, file),
    isRepo: (cwd: string) => ipcRenderer.invoke('git:isRepo', cwd),
  },

  // File System API
  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke('fs:readDir', dirPath),
    readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  },

  // Web Server API
  webserver: {
    getUrl: () => ipcRenderer.invoke('webserver:getUrl'),
  },

  // Agent API
  agents: {
    detect: () => ipcRenderer.invoke('agents:detect'),
    get: (agentId: string) => ipcRenderer.invoke('agents:get', agentId),
  },

  // Dialog API
  dialog: {
    selectFolder: () => ipcRenderer.invoke('dialog:selectFolder'),
  },

  // Font API
  fonts: {
    detect: () => ipcRenderer.invoke('fonts:detect'),
  },

  // Shell API
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },

  // DevTools API
  devtools: {
    open: () => ipcRenderer.invoke('devtools:open'),
    close: () => ipcRenderer.invoke('devtools:close'),
    toggle: () => ipcRenderer.invoke('devtools:toggle'),
  },
});

// Type definitions for TypeScript
export interface MaestroAPI {
  settings: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<boolean>;
    getAll: () => Promise<Record<string, unknown>>;
  };
  process: {
    spawn: (config: ProcessConfig) => Promise<{ pid: number; success: boolean }>;
    write: (sessionId: string, data: string) => Promise<boolean>;
    kill: (sessionId: string) => Promise<boolean>;
    resize: (sessionId: string, cols: number, rows: number) => Promise<boolean>;
    onData: (callback: (sessionId: string, data: string) => void) => void;
    onExit: (callback: (sessionId: string, code: number) => void) => void;
  };
  git: {
    status: (cwd: string) => Promise<string>;
    diff: (cwd: string, file?: string) => Promise<string>;
    isRepo: (cwd: string) => Promise<boolean>;
  };
  fs: {
    readDir: (dirPath: string) => Promise<DirectoryEntry[]>;
    readFile: (filePath: string) => Promise<string>;
  };
  webserver: {
    getUrl: () => Promise<string>;
  };
  agents: {
    detect: () => Promise<AgentConfig[]>;
    get: (agentId: string) => Promise<AgentConfig | null>;
  };
  dialog: {
    selectFolder: () => Promise<string | null>;
  };
  fonts: {
    detect: () => Promise<string[]>;
  };
  shell: {
    openExternal: (url: string) => Promise<void>;
  };
  devtools: {
    open: () => Promise<void>;
    close: () => Promise<void>;
    toggle: () => Promise<void>;
  };
}

declare global {
  interface Window {
    maestro: MaestroAPI;
  }
}

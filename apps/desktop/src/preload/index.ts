import { contextBridge, ipcRenderer } from 'electron'
import { createAmctkApi } from '@amctk/shared/bridge'

const role: 'control' | 'stage' = /stage\.html/.test(location.pathname) ? 'stage' : 'control'

/**
 * Electron の IPC で通信の取り決め（@amctk/shared/bridge）を実装し、window.amctk として渡す。
 * API の中身は createAmctkApi にあり、基盤を変えるときはこの送受信部分だけを差し替える。
 */
contextBridge.exposeInMainWorld(
  'amctk',
  createAmctkApi(
    {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      send: (channel, ...args) => ipcRenderer.send(channel, ...args),
      subscribe: (channel, cb) => {
        const listener = (_e: unknown, payload: unknown) => cb(payload)
        ipcRenderer.on(channel, listener)
        return () => {
          ipcRenderer.removeListener(channel, listener)
        }
      },
    },
    role,
  ),
)

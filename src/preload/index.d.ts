import type { TickFlowApi } from '../shared/ipc'

declare global {
  interface Window {
    api: TickFlowApi
  }
}

export {}

import { beforeEach } from 'vitest'

type Store = Record<string, unknown>
type Listener = (changes: Record<string, { oldValue?: unknown; newValue?: unknown }>, area: string) => void

function makeArea(name: string, listeners: Listener[]) {
  const store: Store = {}
  return {
    store,
    async get(keys?: string | string[] | null) {
      if (keys == null) return { ...store }
      const list = typeof keys === 'string' ? [keys] : keys
      const out: Store = {}
      for (const k of list) if (k in store) out[k] = store[k]
      return out
    },
    async set(items: Store) {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {}
      for (const [k, v] of Object.entries(items)) {
        changes[k] = { oldValue: store[k], newValue: v }
        store[k] = v
      }
      for (const l of [...listeners]) l(changes, name)
    },
  }
}

function makeChrome() {
  const changeListeners: Listener[] = []
  const messageListeners: Array<(...a: unknown[]) => unknown> = []
  const alarmListeners: Array<(alarm: unknown) => void> = []
  const alarms: Record<string, unknown> = {}
  return {
    storage: {
      sync: makeArea('sync', changeListeners),
      local: makeArea('local', changeListeners),
      onChanged: {
        addListener: (l: Listener) => void changeListeners.push(l),
        removeListener: (l: Listener) => {
          const i = changeListeners.indexOf(l)
          if (i >= 0) changeListeners.splice(i, 1)
        },
      },
    },
    runtime: {
      getURL: (p: string) => `chrome-extension://test/${p}`,
      sendMessage: async (_msg: unknown) => undefined,
      onMessage: { addListener: (l: (...a: unknown[]) => unknown) => void messageListeners.push(l) },
      onInstalled: { addListener: (_l: unknown) => {} },
    },
    alarms: {
      create: (name: string, info: unknown) => void (alarms[name] = info),
      onAlarm: { addListener: (l: (alarm: unknown) => void) => void alarmListeners.push(l) },
    },
  }
}

;(globalThis as unknown as { chrome: unknown }).chrome = makeChrome()

beforeEach(() => {
  ;(globalThis as unknown as { chrome: unknown }).chrome = makeChrome()
})

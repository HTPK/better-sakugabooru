import { refreshDict } from './refresh'

const ALARM = 'bsb-dict-refresh'

chrome.runtime.onInstalled.addListener(() => {
  void refreshDict()
  chrome.alarms.create(ALARM, { periodInMinutes: 1440 })
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM) void refreshDict()
})

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'bsb:refresh-now') {
    void refreshDict().then(sendResponse)
    return true
  }
  return false
})

import { ensureAlarm, handleAlarm, handleInstalled, handleMessage } from './handlers'

chrome.runtime.onInstalled.addListener(() => handleInstalled())
chrome.alarms.onAlarm.addListener((alarm) => handleAlarm(alarm))
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => handleMessage(msg, sendResponse))

// Self-heal: re-create the alarm on every service-worker start if it was lost.
ensureAlarm()

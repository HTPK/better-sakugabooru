// Content script entry (document_start). All sequencing lives in boot.ts.
import { loadSettings, onSettingsChange, saveSettings } from '../settings'
import { getDict } from '../dict'
import { boot } from './boot'
import { runEarly } from './early'
import { applyTheme, markReady } from './theme'
import { renderHeader } from './header'
import { renderList } from './list'
import { attachHoverPlay } from './hover'
import { renderShow } from './show'
import { attachSearch } from './search'

void boot({
  doc: document,
  win: window,
  loadSettings,
  saveSettings,
  onSettingsChange,
  getDict,
  runEarly,
  applyTheme,
  markReady,
  renderHeader,
  renderList,
  attachHoverPlay,
  renderShow,
  attachSearch,
})

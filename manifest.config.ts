import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'Better Sakugabooru',
  version: '1.0.0',
  description: 'Sakugabooru を日本語で。タグの日本語表示・日本語検索・見やすい一覧。',
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  permissions: ['storage', 'alarms'],
  host_permissions: ['https://www.sakugabooru.com/*', 'https://cdn.jsdelivr.net/*'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  action: { default_popup: 'src/popup/index.html', default_title: 'Better Sakugabooru' },
  content_scripts: [
    {
      matches: ['https://www.sakugabooru.com/*'],
      js: ['src/content/index.ts'],
      css: ['src/theme/early.css'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    { resources: ['fonts/*'], matches: ['https://www.sakugabooru.com/*'] },
  ],
})

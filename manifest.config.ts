import { defineManifest } from '@crxjs/vite-plugin'

export default defineManifest({
  manifest_version: 3,
  name: 'SakuView for Sakugabooru',
  version: '1.1.0',
  default_locale: 'en',
  description: '__MSG_description__',
  icons: { 16: 'icons/16.png', 48: 'icons/48.png', 128: 'icons/128.png' },
  permissions: ['storage', 'alarms'],
  // No jsDelivr permission: it serves Access-Control-Allow-Origin: *, so the worker's plain fetch works via CORS.
  host_permissions: ['https://www.sakugabooru.com/*'],
  background: { service_worker: 'src/background/index.ts', type: 'module' },
  action: { default_popup: 'src/popup/index.html', default_title: 'SakuView' },
  content_scripts: [
    {
      matches: ['https://www.sakugabooru.com/*'],
      // API responses are rendered as raw JSON/XML documents; nothing for us to do there.
      exclude_matches: ['https://www.sakugabooru.com/*.json', 'https://www.sakugabooru.com/*.xml'],
      js: ['src/content/index.ts'],
      css: ['src/theme/early.css'],
      run_at: 'document_start',
    },
  ],
  web_accessible_resources: [
    { resources: ['fonts/*'], matches: ['https://www.sakugabooru.com/*'], use_dynamic_url: true },
  ],
})

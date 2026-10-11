// Copies ../sakugabooru-ja-dict/dist/dict.json to src/dict/snapshot.json after validating its shape.
// Usage: pnpm sync-snapshot [path/to/dict.json]
import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const src = resolve(root, process.argv[2] ?? '../sakugabooru-ja-dict/dist/dict.json')
const dest = resolve(root, 'src/dict/snapshot.json')
const MAPS = ['artists', 'copyrights', 'general']

function fail(msg) {
  console.error(`sync-snapshot: ${msg}`)
  process.exit(1)
}

if (!existsSync(src)) fail(`source not found: ${src}`)

let dict
try {
  dict = JSON.parse(readFileSync(src, 'utf8'))
} catch (err) {
  fail(`invalid JSON in ${src}: ${err.message}`)
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const optStr = (v) => v === undefined || typeof v === 'string'
if (!isObj(dict)) fail('top level is not an object')
if (dict.v !== 1) fail(`expected v === 1, got ${JSON.stringify(dict.v)}`)
if (typeof dict.updated !== 'string') fail('missing "updated" string')
for (const m of MAPS) {
  if (!isObj(dict[m])) fail(`"${m}" is not an object`)
  for (const [tag, e] of Object.entries(dict[m])) {
    if (!isObj(e) || typeof e.ja !== 'string' || !e.ja) fail(`${m}.${tag}: entry needs a non-empty string "ja"`)
    if (!optStr(e.kana) || !optStr(e.src)) fail(`${m}.${tag}: "kana"/"src" must be strings when present`)
  }
}
if (dict.counts !== undefined) {
  if (!isObj(dict.counts) || !Object.values(dict.counts).every((n) => typeof n === 'number' && Number.isFinite(n))) {
    fail('"counts" must map tags to finite numbers')
  }
}

copyFileSync(src, dest)
const counts = MAPS.map((m) => `${m}=${Object.keys(dict[m]).length}`).join(' ')
console.log(`sync-snapshot: ${dict.updated} ${counts} -> ${dest}`)

// Zips dist/ into release/sakuview-<version>.zip for the Chrome Web Store.
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver' // archiver >= 8 is ESM with named classes

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dist = resolve(root, 'dist')
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const outDir = resolve(root, 'release')
const out = resolve(outDir, `sakuview-${version}.zip`)

if (!existsSync(resolve(dist, 'manifest.json'))) {
  console.error('zip: dist/manifest.json not found; run pnpm build first')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const output = createWriteStream(out)
const archive = new ZipArchive({ zlib: { level: 9 } })
output.on('close', () => {
  const kb = (statSync(out).size / 1024).toFixed(1)
  console.log(`zip: ${out} (${kb} KB, ${archive.pointer()} bytes)`)
})
archive.on('warning', (err) => console.warn('zip:', err))
archive.on('error', (err) => {
  console.error('zip:', err)
  process.exit(1)
})
archive.pipe(output)
// Files at the zip root (manifest.json must not be nested in a folder).
archive.directory(dist, false)
await archive.finalize()

// Generates flat PNG icons (red square + white "S") with no dependencies.
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type), data])
  const c = Buffer.alloc(4)
  c.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, c])
}

// "S" as 5x7 bitmap
const S = ['01110', '10001', '10000', '01110', '00001', '10001', '01110']

function icon(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const r = size * 0.18
  const gw = 5, gh = 7
  const cell = Math.floor((size * 0.6) / gh)
  const ox = Math.floor((size - cell * gw) / 2)
  const oy = Math.floor((size - cell * gh) / 2)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      // rounded corners
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y)
      let inside = true
      if (cx < r && cy < r) inside = (r - cx) ** 2 + (r - cy) ** 2 <= r * r
      let px = [0, 0, 0, 0]
      if (inside) {
        px = [0xdc, 0x00, 0x0c, 255]
        const gx = Math.floor((x - ox) / cell), gy = Math.floor((y - oy) / cell)
        if (gx >= 0 && gx < gw && gy >= 0 && gy < gh && S[gy][gx] === '1') px = [255, 255, 255, 255]
      }
      raw.set(px, y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync('public/icons', { recursive: true })
for (const s of [16, 48, 128]) writeFileSync(`public/icons/${s}.png`, icon(s))

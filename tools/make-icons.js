// 生成 PWA 图标：纯 Node，无第三方依赖
const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

function crcTable() {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
}
const TBL = crcTable();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TBL[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

function png(size, painter) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  let p = 0;
  for (let y = 0; y < size; y++) {
    raw[p++] = 0;
    for (let x = 0; x < size; x++) {
      const c = painter(x, y);
      raw[p++] = c[0]; raw[p++] = c[1]; raw[p++] = c[2]; raw[p++] = c[3];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const BG = [47, 110, 212, 255];
const FG = [246, 244, 239, 255];

function make(size, file) {
  const s = size / 512;
  const bars = [
    [118, 152, 394, 190],
    [118, 238, 330, 276],
    [118, 324, 266, 362]
  ];
  const buf = png(size, (x, y) => {
    const X = x / s, Y = y / s;
    for (const b of bars) {
      const r = 10;
      if (X >= b[0] && X <= b[2] && Y >= b[1] && Y <= b[3]) {
        const nearL = X - b[0] < r, nearR = b[2] - X < r;
        const nearT = Y - b[1] < r, nearB = b[3] - Y < r;
        if ((nearL && nearT) || (nearL && nearB) || (nearR && nearT) || (nearR && nearB)) {
          const cx = nearL ? b[0] + r : b[2] - r;
          const cy = nearT ? b[1] + r : b[3] - r;
          const d = Math.hypot(X - cx, Y - cy);
          if (d > r) continue;
        }
        return FG;
      }
    }
    return BG;
  });
  fs.writeFileSync(file, buf);
  console.log(file, buf.length + ' bytes');
}

const dir = path.join(__dirname, '..', 'assets');
make(192, path.join(dir, 'icon-192.png'));
make(512, path.join(dir, 'icon-512.png'));

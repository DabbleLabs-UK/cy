// One-off: regenerate the CY favicon set from the stencil logo source.
// Rounded corners with transparent corners for the browser PNG/ICO set;
// opaque square apple-touch-icon (iOS masks its own corners).
import sharp from 'sharp';
import { writeFileSync } from 'fs';

const SRC = 'assets/red_dot.png';
const OUT = 'public/assets';
const RADIUS_PCT = 0.22; // superellipse-ish app-icon corner

function roundedMask(size) {
  const r = Math.round(size * RADIUS_PCT);
  return Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}"/></svg>`
  );
}

async function roundedPng(size) {
  const base = await sharp(SRC).resize(size, size, { fit: 'cover' }).png().toBuffer();
  return sharp(base)
    .composite([{ input: roundedMask(size), blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Minimal ICO container embedding PNG images (Vista+ PNG-in-ICO).
function buildIco(pngs) {
  const count = pngs.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dir = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  pngs.forEach((p, i) => {
    const b = 16 * i;
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 0); // width (0 == 256)
    dir.writeUInt8(p.size >= 256 ? 0 : p.size, b + 1); // height
    dir.writeUInt8(0, b + 2); // palette
    dir.writeUInt8(0, b + 3); // reserved
    dir.writeUInt16LE(1, b + 4); // color planes
    dir.writeUInt16LE(32, b + 6); // bpp
    dir.writeUInt32LE(p.data.length, b + 8); // size
    dir.writeUInt32LE(offset, b + 12); // offset
    offset += p.data.length;
  });
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)]);
}

const png512 = await roundedPng(512);
const png32 = await roundedPng(32);
const png16 = await roundedPng(16);

writeFileSync(`${OUT}/favicon.png`, png512);
writeFileSync(`${OUT}/favicon-32.png`, png32);
writeFileSync(`${OUT}/favicon-16.png`, png16);
writeFileSync(`${OUT}/favicon.ico`, buildIco([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
]));

// apple-touch-icon: opaque square, no rounding (iOS applies its own mask).
const apple = await sharp(SRC)
  .resize(180, 180, { fit: 'cover' })
  .flatten({ background: '#000000' })
  .png({ compressionLevel: 9 })
  .toBuffer();
writeFileSync(`${OUT}/apple-touch-icon.png`, apple);

console.log('favicon.png', png512.length);
console.log('favicon-32.png', png32.length);
console.log('favicon-16.png', png16.length);
console.log('apple-touch-icon.png', apple.length);

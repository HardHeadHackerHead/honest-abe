/**
 * Generate branded NSIS installer images from the app icon.
 *
 * Produces:
 *   src-tauri/nsis/sidebar.bmp   — 164 x 314  (Welcome & Finish pages)
 *   src-tauri/nsis/header.bmp    — 150 x 57   (page header banner)
 *
 * Uses the existing src-tauri/icons/icon.png as the source.
 * Run: node scripts/generate-nsis-images.mjs
 */

import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const iconPath = path.join(root, "src-tauri", "icons", "icon.png");
const nsisDir = path.join(root, "src-tauri", "nsis");

// Brand colors matching the icon
const BG = { r: 38, g: 38, b: 42 };

/**
 * Convert a sharp image pipeline to a 24-bit BMP buffer.
 * BMP stores rows bottom-to-top in BGR order, padded to 4-byte boundaries.
 */
async function toBmp(pipeline, width, height) {
  const raw = await pipeline
    .flatten({ background: BG })
    .removeAlpha()
    .raw()
    .toBuffer();

  const rowBytes = width * 3;
  const rowPadding = (4 - (rowBytes % 4)) % 4;
  const paddedRowBytes = rowBytes + rowPadding;
  const pixelDataSize = paddedRowBytes * height;
  const fileSize = 14 + 40 + pixelDataSize;

  const buf = Buffer.alloc(fileSize);
  let o = 0;

  // -- File header (14 bytes) --
  buf.write("BM", o); o += 2;              // signature
  buf.writeUInt32LE(fileSize, o); o += 4;   // file size
  buf.writeUInt32LE(0, o); o += 4;          // reserved
  buf.writeUInt32LE(54, o); o += 4;         // pixel data offset

  // -- Info header (40 bytes, BITMAPINFOHEADER) --
  buf.writeUInt32LE(40, o); o += 4;         // header size
  buf.writeInt32LE(width, o); o += 4;       // width
  buf.writeInt32LE(height, o); o += 4;      // height (positive = bottom-up)
  buf.writeUInt16LE(1, o); o += 2;          // color planes
  buf.writeUInt16LE(24, o); o += 2;         // bits per pixel
  buf.writeUInt32LE(0, o); o += 4;          // compression (BI_RGB)
  buf.writeUInt32LE(pixelDataSize, o); o += 4;
  buf.writeInt32LE(2835, o); o += 4;        // h pixels/meter (~72 dpi)
  buf.writeInt32LE(2835, o); o += 4;        // v pixels/meter
  buf.writeUInt32LE(0, o); o += 4;          // colors in palette
  buf.writeUInt32LE(0, o); o += 4;          // important colors

  // -- Pixel data (bottom-to-top, BGR) --
  const padBytes = Buffer.alloc(rowPadding);
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 3;
      buf[o++] = raw[srcIdx + 2]; // B
      buf[o++] = raw[srcIdx + 1]; // G
      buf[o++] = raw[srcIdx + 0]; // R
    }
    padBytes.copy(buf, o);
    o += rowPadding;
  }

  return buf;
}

async function generateSidebar() {
  const width = 164;
  const height = 314;
  const iconSize = 100;
  const iconTop = 60;

  const iconBuf = await sharp(iconPath)
    .resize(iconSize, iconSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const textSvg = Buffer.from(`
    <svg width="${width}" height="40">
      <text x="${width / 2}" y="28" font-family="Segoe UI, Arial, sans-serif" font-size="24" font-weight="bold"
            fill="white" text-anchor="middle">Abe</text>
    </svg>
  `);

  const subtitleSvg = Buffer.from(`
    <svg width="${width}" height="24">
      <text x="${width / 2}" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="12"
            fill="#AAAAAA" text-anchor="middle">Voice Transcription</text>
    </svg>
  `);

  // Thin accent line
  const lineSvg = Buffer.from(`
    <svg width="${width}" height="2">
      <rect x="40" y="0" width="84" height="1" fill="#555555" rx="0.5"/>
    </svg>
  `);

  const composed = sharp({
    create: { width, height, channels: 4, background: { ...BG, alpha: 1 } },
  }).composite([
    { input: iconBuf, left: Math.round((width - iconSize) / 2), top: iconTop },
    { input: await sharp(textSvg).png().toBuffer(), left: 0, top: iconTop + iconSize + 16 },
    { input: await sharp(lineSvg).png().toBuffer(), left: 0, top: iconTop + iconSize + 54 },
    { input: await sharp(subtitleSvg).png().toBuffer(), left: 0, top: iconTop + iconSize + 62 },
  ]);

  const bmp = await toBmp(composed, width, height);
  fs.writeFileSync(path.join(nsisDir, "sidebar.bmp"), bmp);
  console.log("  Created sidebar.bmp (164x314)");
}

async function generateHeader() {
  const width = 150;
  const height = 57;
  const iconSize = 36;

  const iconBuf = await sharp(iconPath)
    .resize(iconSize, iconSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const textSvg = Buffer.from(`
    <svg width="90" height="${height}">
      <text x="0" y="35" font-family="Segoe UI, Arial, sans-serif" font-size="18" font-weight="bold"
            fill="white">Abe</text>
    </svg>
  `);

  const composed = sharp({
    create: { width, height, channels: 4, background: { ...BG, alpha: 1 } },
  }).composite([
    { input: iconBuf, left: 10, top: Math.round((height - iconSize) / 2) },
    { input: await sharp(textSvg).png().toBuffer(), left: 52, top: 0 },
  ]);

  const bmp = await toBmp(composed, width, height);
  fs.writeFileSync(path.join(nsisDir, "header.bmp"), bmp);
  console.log("  Created header.bmp (150x57)");
}

console.log("Generating NSIS installer images...");
await generateSidebar();
await generateHeader();
console.log("Done!");

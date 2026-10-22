import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');

const sourceIcon = path.join(rootDir, 'Abe Icon.png');

async function main() {
  console.log('Resizing icons from:', sourceIcon);

  // Create Tauri icons
  const tauriIconsDir = path.join(rootDir, 'src-tauri', 'icons');

  // 512x512 PNG for Tauri
  console.log('Creating 512x512 icon.png...');
  await sharp(sourceIcon)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(tauriIconsDir, 'icon.png'));

  // Create multiple sizes for ICO
  const icoSizes = [16, 24, 32, 48, 64, 128, 256];
  const tempPngs = [];

  for (const size of icoSizes) {
    const tempPath = path.join(tauriIconsDir, `temp-${size}.png`);
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(tempPath);
    tempPngs.push(tempPath);
  }

  // Create ICO from PNGs
  console.log('Creating icon.ico...');
  const icoBuffer = await pngToIco(tempPngs);
  await fs.writeFile(path.join(tauriIconsDir, 'icon.ico'), icoBuffer);

  // Cleanup temp files
  for (const tempPath of tempPngs) {
    await fs.unlink(tempPath);
  }

  // Create web favicons
  const webPublicDir = path.join(rootDir, 'web', 'public');

  // favicon.ico (16, 32, 48)
  console.log('Creating web favicon.ico...');
  const faviconSizes = [16, 32, 48];
  const faviconPngs = [];

  for (const size of faviconSizes) {
    const tempPath = path.join(webPublicDir, `temp-${size}.png`);
    await sharp(sourceIcon)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(tempPath);
    faviconPngs.push(tempPath);
  }

  const faviconBuffer = await pngToIco(faviconPngs);
  await fs.writeFile(path.join(webPublicDir, 'favicon.ico'), faviconBuffer);

  // Cleanup temp files
  for (const tempPath of faviconPngs) {
    await fs.unlink(tempPath);
  }

  // Apple touch icon (180x180)
  console.log('Creating apple-touch-icon.png...');
  await sharp(sourceIcon)
    .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(webPublicDir, 'apple-touch-icon.png'));

  // icon-192.png for PWA
  console.log('Creating icon-192.png...');
  await sharp(sourceIcon)
    .resize(192, 192, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(webPublicDir, 'icon-192.png'));

  // icon-512.png for PWA
  console.log('Creating icon-512.png...');
  await sharp(sourceIcon)
    .resize(512, 512, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(webPublicDir, 'icon-512.png'));

  // Also create a logo.png for the web app (used in UI)
  console.log('Creating logo.png...');
  await sharp(sourceIcon)
    .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(webPublicDir, 'logo.png'));

  // Create a larger version for OG image usage
  console.log('Creating og-logo.png...');
  await sharp(sourceIcon)
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(webPublicDir, 'og-logo.png'));

  console.log('Done! All icons created successfully.');
}

main().catch(console.error);

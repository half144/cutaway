// Imports the macOS wallpapers installed on this Mac as render presets (assets/wallpapers, kept out of
// git: they are Apple's, licensed with the Mac, and not ours to redistribute). Video wallpapers such as
// Tahoe contribute a still frame. `--download` also fetches the ones macOS downloads on demand, from
// the same Apple asset catalog System Settings uses (about 1.5 GB for all of them).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { ffmpeg } from '../src/ffmpeg.mjs';

const run = promisify(execFile);
const output = fileURLToPath(new URL('../assets/wallpapers/', import.meta.url));
const system = '/System/Library/Desktop Pictures';
const force = process.argv.includes('--force');
const catalog = 'https://mesu.apple.com/assets/macos/com_apple_MobileAsset_DesktopPicture/com_apple_MobileAsset_DesktopPicture.xml';
const cache = join(homedir(), 'Library/Caches/cutaway/wallpapers');

async function files(directory, pattern) {
  if (!existsSync(directory)) return [];
  const entries = await readdir(directory, { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    // `.thumbnails` holds 214-pixel previews, not wallpapers.
    if (entry.isDirectory() && entry.name !== '.thumbnails') found.push(...await files(path, pattern));
    else if (pattern.test(entry.name) && !/thumbnail|portrait/i.test(entry.name)) found.push(path);
  }
  return found;
}

const slug = path => basename(path, extname(path)).replace(/ Landscape$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

async function dimensions(path) {
  const { stdout } = await run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path]);
  const [width, height] = [/pixelWidth: (\d+)/, /pixelHeight: (\d+)/].map(pattern => Number(stdout.match(pattern)[1]));
  return { width, height };
}

async function plistValue(file, key) {
  const { stdout } = await run('plutil', ['-extract', key, 'raw', '-o', '-', file]);
  return stdout.trim();
}

// Downloads the catalog's wallpapers that are not imported yet; returns the extracted image paths.
async function download() {
  await mkdir(cache, { recursive: true });
  const index = join(cache, 'catalog.xml');
  await writeFile(index, Buffer.from(await (await fetch(catalog)).arrayBuffer()));
  const count = Number(await plistValue(index, 'Assets'));
  const images = [];
  for (let i = 0; i < count; i++) {
    const name = await plistValue(index, `Assets.${i}.DesktopPictureID`);
    const folder = join(cache, name);
    if (existsSync(join(output, `${slug(name)}.jpg`)) || existsSync(folder)) {
      if (existsSync(folder)) images.push(...await files(folder, /\.heic$/i));
      continue;
    }
    const url = await plistValue(index, `Assets.${i}.__BaseURL`) + await plistValue(index, `Assets.${i}.__RelativePath`);
    process.stderr.write(`Downloading ${name}…\n`);
    const archive = `${folder}.zip`;
    await writeFile(archive, Buffer.from(await (await fetch(url)).arrayBuffer()));
    await run('ditto', ['-x', '-k', archive, folder]);
    await rm(archive);
    // Name the image after the wallpaper, whatever the archive calls it.
    const [largest] = (await Promise.all((await files(folder, /\.heic$/i)).map(async path => [path, (await stat(path)).size])))
      .sort((a, b) => b[1] - a[1]);
    if (!largest) continue;
    const named = join(folder, `${name}.heic`);
    if (largest[0] !== named) await rename(largest[0], named);
    images.push(named);
  }
  return images;
}

const stills = [
  ...process.argv.includes('--download') ? await download() : [],
  ...await files(system, /\.heic$/i),
  ...await files(join(homedir(), 'Library/Application Support/com.apple.mobileAssetDesktop'), /\.heic$/i),
];
const videos = await files(join(system, '.wallpapers'), /\.mov$/i);

await mkdir(output, { recursive: true });
const imported = [];
for (const path of [...stills, ...videos]) {
  const name = slug(path);
  const target = join(output, `${name}.jpg`);
  if (existsSync(target) && !force) {
    imported.push(name);
    continue;
  }
  if (extname(path).toLowerCase() === '.mov') {
    // The opening frame of a video wallpaper is its resting state.
    await run(ffmpeg, ['-v', 'error', '-y', '-i', path, '-frames:v', '1', '-vf', 'scale=3840:-2', '-q:v', '2', target]);
  } else {
    const { width, height } = await dimensions(path);
    if (height > width || width < 2560) continue;
    await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '92', '-Z', '3840', path, '--out', target]);
  }
  imported.push(name);
}
console.log(`${imported.length} wallpapers in ${output}\n${imported.sort().join(', ')}`);

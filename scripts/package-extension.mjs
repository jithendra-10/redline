// Builds the extension for judges/testers and zips it into release/.
// Uses `.env.judges` (gitignored) if present, so the shipped App Check debug token
// is a separate one you can revoke after judging without touching your own.
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mode = existsSync(resolve(root, '.env.judges')) ? 'judges' : 'production';
if (mode !== 'judges') {
  console.warn('! .env.judges not found: the zip will contain the debug token from .env. See docs/JUDGES.md.');
}
execSync(`npx vite build --mode ${mode}`, { cwd: resolve(root, 'apps/extension'), stdio: 'inherit' });
execSync(`npx vite build --config vite.content.config.ts --mode ${mode}`, { cwd: resolve(root, 'apps/extension'), stdio: 'inherit' });

const version = JSON.parse(readFileSync(resolve(root, 'apps/extension/public/manifest.json'), 'utf8')).version;
const out = resolve(root, 'release', `redline-extension-${version}.zip`);
mkdirSync(resolve(root, 'release'), { recursive: true });
rmSync(out, { force: true });
const dist = resolve(root, 'apps/extension/dist');
if (process.platform === 'win32') {
  // Windows' bsdtar writes standard zips: forward slashes, files at the root.
  const tar = resolve(process.env.SystemRoot ?? 'C:/Windows', 'System32', 'tar.exe');
  execSync(`"${tar}" -a -c -f "${out}" -C "${dist}" *`, { stdio: 'inherit' });
} else {
  execSync(`cd "${dist}" && zip -qr "${out}" .`, { stdio: 'inherit', shell: '/bin/sh' });
}
console.log(`\n✓ ${out}`);

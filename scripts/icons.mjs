// Renders assets/logo.svg to the PNG sizes Chrome and browsers need.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const svg = readFileSync('assets/logo.svg', 'utf8');
const targets = [
  ['apps/extension/public/icons', [16, 32, 48, 128]],
  ['apps/web/public', [32, 180, 512]],
];
for (const [dir, sizes] of targets) {
  mkdirSync(dir, { recursive: true });
  for (const size of sizes) {
    const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
    writeFileSync(`${dir}/icon-${size}.png`, png);
  }
}
writeFileSync('apps/web/public/favicon.svg', svg);
console.log('icons written');

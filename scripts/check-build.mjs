import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Parser } from 'htmlparser2';

const output = resolve(fileURLToPath(new URL('../dist/paper-packer/browser/', import.meta.url)));
const html = readFileSync(resolve(output, 'index.html'), 'utf8');
const assets = [];
let appRoot = false;
let moduleScript = false;
let viewport = false;
const parser = new Parser({
  onopentag(tag, attributes) {
    if (tag === 'app-root') appRoot = true;
    if (tag === 'meta' && attributes.name === 'viewport') viewport = true;
    if (tag === 'script' && attributes.src) {
      moduleScript ||= attributes.type === 'module';
      assets.push(attributes.src);
    }
    if (tag === 'link' && ['stylesheet', 'modulepreload', 'icon'].includes(attributes.rel)) {
      assert.ok(attributes.href, 'An entry asset is missing its URL.');
      assets.push(attributes.href);
    }
  },
});
parser.end(html);
assert.ok(appRoot && moduleScript && viewport, 'Production entry HTML is incomplete.');
for (const asset of assets) {
  assert.ok(!/^[a-z]+:|^\/\//i.test(asset), `Unexpected remote entry asset: ${asset}`);
  const path = resolve(output, decodeURIComponent(asset.split(/[?#]/)[0]).replace(/^\//, ''));
  assert.ok(path.startsWith(`${output}${sep}`), 'Entry asset escapes the build directory.');
  assert.ok(statSync(path).isFile(), `Entry asset is missing: ${asset}`);
}
const files = readdirSync(output, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
for (const entry of files) {
  assert.ok(!/\.map$|\.(?:md|mdx|rst|adoc|pdf)$|^README|^\.env(?:\.|$)/i.test(entry.name),
    `Local source or documentation was included in the public build: ${entry.name}`);
}
console.log(`Production output checks passed: ${files.length} files, entry assets present, no source maps or local documentation.`);

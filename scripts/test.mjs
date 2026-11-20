import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
rmSync(new URL('../.angular/tests/', import.meta.url), { recursive: true, force: true });
execFileSync(process.execPath, [
  'node_modules/@angular/compiler-cli/bundles/src/bin/ngc.js',
  '-p', 'tsconfig.test.json',
], { cwd: root, stdio: 'inherit' });

mkdirSync(new URL('../.angular/tests/', import.meta.url), { recursive: true });
writeFileSync(new URL('../.angular/tests/package.json', import.meta.url), '{"type":"module"}\n');

const tests = readdirSync(new URL('../tests/', import.meta.url))
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => `tests/${name}`);

if (tests.length === 0) throw new Error('No tests were found.');
execFileSync(process.execPath, ['--test', '--test-reporter=spec', ...tests], { cwd: root, stdio: 'inherit' });

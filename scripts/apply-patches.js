#!/usr/bin/env node
/**
 * Applies patches/<package>+<version>.patch to node_modules/<package> after every install
 * (root `postinstall`). Uses the system `patch`, so there is no extra dependency. A patch for a
 * version that isn't installed fails the install: re-check it before upgrading the package.
 * Each patch is listed in docs/workarounds.md.
 */
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const patchesDir = path.join(root, 'patches');

for (const file of fs.readdirSync(patchesDir).filter((f) => f.endsWith('.patch')).sort()) {
  const match = /^(.+)\+([^+]+)\.patch$/.exec(file);
  if (!match) throw new Error(`patches/${file}: expected <package>+<version>.patch`);
  const [, fileName, version] = match;
  // Scoped packages: "@scope+name" in the file name stands for "@scope/name".
  const name = fileName.startsWith('@') ? fileName.replace('+', '/') : fileName;
  const pkgDir = path.join(root, 'node_modules', name);
  const installed = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).version;
  if (installed !== version) {
    throw new Error(`patches/${file} is for ${name}@${version}, but ${installed} is installed`);
  }
  const patchFile = path.join(patchesDir, file);
  const run = (...args) => execFileSync('patch', ['-p1', '-d', pkgDir, '-i', patchFile, ...args], { stdio: 'pipe' });
  try {
    run('--dry-run', '--reverse', '--force');
    console.log(`patches: ${name}@${version} already patched`);
    continue;
  } catch {
    // not applied yet
  }
  run('--forward');
  console.log(`patches: applied ${file}`);
}

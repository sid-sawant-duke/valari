#!/usr/bin/env node
// Generates every importable workflow in workflows/ from src/, prompts/ and the builders in scripts/.
// Run: npm run build   (CI checks that the committed files match.)
const fs = require('fs');
const path = require('path');
const { ROOT } = require('./lib');
const core = require('./core');
const connectors = require('./connectors');
const templates = require('./template');

const check = process.argv.includes('--check');
let stale = 0;
const outputs = [
  ...Object.entries({ ...core, ...connectors }).map(([f, b]) => [path.join('workflows', f), b]),
  ...Object.entries(templates),
];
for (const [file, build] of outputs) {
  const target = path.join(ROOT, file);
  const json = JSON.stringify(build(), null, 2) + '\n';
  if (check) {
    const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : '';
    if (current !== json) { console.error(`out of date: ${file}`); stale++; }
    continue;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json);
  console.log(`wrote ${file} (${JSON.parse(json).nodes.length} nodes)`);
}
if (check && stale) { console.error('Run `npm run build` and commit the result.'); process.exit(1); }
if (check) console.log('workflows/ and templates/ are up to date');

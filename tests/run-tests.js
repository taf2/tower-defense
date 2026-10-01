#!/usr/bin/env node
// Headless test runner for Desktop Tower Defense.
//
// Injects tests/tests.js into a copy of index.html, opens it in headless
// Chrome/Chromium, and prints the PASS/FAIL results. Exits non-zero on failure.
//
// Usage:  node tests/run-tests.js
// Env:    CHROME_BIN=/path/to/chrome   (optional)
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const injected = indexHtml.replace(
    '</body>',
    '    <script src="tests/tests.js"></script>\n</body>'
);
const runFile = path.join(root, '.tests-run.html');
fs.writeFileSync(runFile, injected);

const candidates = [
    process.env.CHROME_BIN,
    'google-chrome',
    'google-chrome-stable',
    'chromium',
    'chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
].filter(Boolean);

let chrome = null;
for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!probe.error) {
        chrome = candidate;
        break;
    }
}

if (!chrome) {
    console.error('Could not find Chrome/Chromium. Set CHROME_BIN to your browser binary.');
    cleanup();
    process.exit(2);
}

const args = [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--virtual-time-budget=8000',
    '--dump-dom',
    'file://' + runFile,
];

const run = spawnSync(chrome, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
cleanup();

const dom = run.stdout || '';
const match = dom.match(/<pre id="testResults">([\s\S]*?)<\/pre>/);
if (!match) {
    console.error('No test results found in the rendered page.');
    if (run.stderr) console.error(run.stderr.split('\n').slice(0, 20).join('\n'));
    process.exit(2);
}

const text = match[1]
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

console.log(text);
console.log('');

const failed = (text.match(/^FAIL:/gm) || []).length;
const passed = (text.match(/^PASS:/gm) || []).length;
console.log(`${passed} passed, ${failed} failed`);

function cleanup() {
    try { fs.unlinkSync(runFile); } catch (_) { /* already gone */ }
}

process.exit(failed ? 1 : 0);
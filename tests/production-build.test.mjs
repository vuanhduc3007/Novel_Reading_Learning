import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
const productionApiUrl = 'https://chinese-reader-api.onrender.com';

function runProductionBuild(outDir, environment) {
  return spawnSync(
    process.execPath,
    [viteBin, 'build', '--mode', 'production', '--outDir', outDir, '--emptyOutDir'],
    {
      cwd: projectRoot,
      encoding: 'utf8',
      env: { ...process.env, ...environment },
    },
  );
}

function readJavaScriptFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).map((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return readJavaScriptFiles(entryPath);
    return entry.name.endsWith('.js') ? readFileSync(entryPath, 'utf8') : '';
  }).join('\n');
}

test('production bundle uses the configured translation gateway and excludes frontend mock output', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'chinese-reader-production-build-'));
  try {
    const result = runProductionBuild(outDir, {
      VITE_USE_MOCK_API: 'false',
      VITE_API_BASE_URL: productionApiUrl,
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);

    const bundle = readJavaScriptFiles(outDir);
    assert.ok(bundle.includes('/api/translate'), 'Production bundle does not contain the translation API route');
    assert.ok(bundle.includes(productionApiUrl), 'Production bundle does not contain the configured API URL');
    assert.ok(!bundle.includes('[Bản dịch Mock]'), 'Production bundle still contains frontend mock translation output');
    assert.ok(!bundle.includes('Mock translation network error'), 'Production bundle still contains the mock translation provider');
    assert.ok(!bundle.includes('[Generated] Mock meaning for'), 'Production bundle still contains the frontend mock dictionary provider');
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

test('production build fails clearly when the API URL is missing', () => {
  const outDir = mkdtempSync(path.join(tmpdir(), 'chinese-reader-missing-api-build-'));
  try {
    const result = runProductionBuild(outDir, {
      VITE_USE_MOCK_API: 'false',
      VITE_API_BASE_URL: '',
    });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.notEqual(result.status, 0, 'Production build unexpectedly succeeded without VITE_API_BASE_URL');
    assert.match(output, /VITE_API_BASE_URL is required/);
  } finally {
    rmSync(outDir, { recursive: true, force: true });
  }
});

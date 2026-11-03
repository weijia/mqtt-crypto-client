import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { encryptPayload as nodeEncrypt, decryptPayload as nodeDecrypt, deriveKeyAndIv } from '../src/crypto.js';
import { findNodeBuiltinImports, scanFreeReferences } from '../scripts/lib/scan-artifact.mjs';

const packageJson = JSON.parse(readFileSync(path.resolve('package.json'), 'utf8'));
const browserBundlePath = path.resolve('dist/index.browser.js');
const browserBundleExists = existsSync(browserBundlePath);
const iifePath = path.resolve('dist/index.iife.js');

test('package.json 通过 browser 条件/字段把 bundler 解析指向浏览器产物', () => {
  assert.equal(packageJson.browser, './dist/index.browser.js');
  assert.equal(packageJson.exports['.'].browser, './dist/index.browser.js');
  assert.ok(existsSync(path.resolve('dist/index.browser.js')), '缺少 dist/index.browser.js');
  // Node 侧解析不变
  assert.equal(packageJson.exports['.'].import, './src/index.js');
  assert.equal(packageJson.exports['.'].require, './dist/index.cjs');
});

test('浏览器 ESM 产物不含自由 process/global 引用，也不引用 Node 内置模块', {
  skip: browserBundleExists ? false : '先运行 npm run build 生成 dist/index.browser.js',
}, () => {
  const code = readFileSync(browserBundlePath, 'utf8');
  const { refs, declarations } = scanFreeReferences(code, ['process', 'Buffer', 'global']);

  assert.deepEqual(
    refs.filter((ref) => ref.name === 'process'),
    [],
    '浏览器产物出现自由 process 引用',
  );
  assert.deepEqual(
    refs.filter((ref) => ref.name === 'global'),
    [],
    '浏览器产物出现自由 global 引用',
  );

  const bufferRefs = refs.filter((ref) => ref.name === 'Buffer');
  if (bufferRefs.length > 0) {
    assert.ok(
      declarations.some((decl) => decl.name === 'Buffer'),
      'Buffer 引用应来自产物内置的 polyfill 定义',
    );
  }

  assert.deepEqual(findNodeBuiltinImports(code), [], '浏览器产物不应引用 Node 内置模块');
  assert.equal(code.includes('node:crypto'), false);
});

test('浏览器 ESM 产物可直接 import，加解密与 Node 端互通', {
  skip: browserBundleExists ? false : '先运行 npm run build 生成 dist/index.browser.js',
}, async () => {
  const api = await import(pathToFileURL(browserBundlePath).href);

  for (const name of ['createClient', 'encryptPayload', 'decryptPayload', 'buildEnvelope', 'buildTopic']) {
    assert.equal(typeof api[name], 'function', `缺少导出 ${name}`);
  }

  const plaintext = JSON.stringify({ msg: '中文 😀', n: 42 });
  const ciphertext = api.encryptPayload(plaintext, 'esm-secret');
  assert.equal(api.decryptPayload(ciphertext, 'esm-secret'), plaintext);
  assert.equal(nodeDecrypt(ciphertext, 'esm-secret'), plaintext);

  const nodeCiphertext = nodeEncrypt(plaintext, 'esm-secret');
  assert.equal(api.decryptPayload(nodeCiphertext, 'esm-secret'), plaintext);

  const keyFromBrowser = api.deriveKeyAndIv('esm-secret', new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  const keyFromNode = deriveKeyAndIv('esm-secret', Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]));
  assert.deepEqual(Array.from(keyFromBrowser.key), Array.from(keyFromNode.key));
  assert.deepEqual(Array.from(keyFromBrowser.iv), Array.from(keyFromNode.iv));

  const client = api.createClient({ secret: 'esm-secret' });
  assert.equal(typeof client.on, 'function');
  assert.equal(client.listenerCount('connect'), 0);
});

test('IIFE 产物同样不含自由 process/global 引用', {
  skip: existsSync(iifePath) ? false : '先运行 npm run build 生成 dist/index.iife.js',
}, () => {
  const code = readFileSync(iifePath, 'utf8');
  const { refs } = scanFreeReferences(code, ['process', 'Buffer', 'global']);
  assert.deepEqual(
    refs.filter((ref) => ref.name === 'process'),
    [],
    'IIFE 产物出现自由 process 引用',
  );
  assert.deepEqual(
    refs.filter((ref) => ref.name === 'global'),
    [],
    'IIFE 产物出现自由 global 引用',
  );
  assert.deepEqual(findNodeBuiltinImports(code), [], 'IIFE 产物不应引用 Node 内置模块');
});

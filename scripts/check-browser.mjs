/**
 * 浏览器产物防回归检查（构建后执行，任一失败即构建失败）：
 *
 * 1. 用 AST 扫描 `dist/index.browser.js` 与 `dist/index.iife.js` 的自由全局引用
 *    （`process` / `Buffer` / `global` 的任意用法，而不只是 `process.env`）
 * 2. 确认产物没有引用 Node 内置模块（`node:crypto`、`node:events` 等）
 * 3. 在“没有 process/Buffer 全局”的 vm 沙箱中加载 IIFE，验证 API、加解密与互通
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { findNodeBuiltinImports, scanFreeReferences } from './lib/scan-artifact.mjs';
import { encryptPayload as nodeEncrypt, decryptPayload as nodeDecrypt } from '../src/crypto.js';

const artifacts = [
  { name: 'dist/index.browser.js', label: '浏览器 ESM' },
  { name: 'dist/index.iife.js', label: '浏览器 IIFE' },
];

/** @param {string} message */
function fail(message) {
  console.error(`[check-browser] FAIL: ${message}`);
  process.exit(1);
}

for (const { name, label } of artifacts) {
  const filePath = fileURLToPath(new URL(`../${name}`, import.meta.url));
  if (!fs.existsSync(filePath)) fail(`${label}产物不存在: ${name}`);
  const code = fs.readFileSync(filePath, 'utf8');

  const { refs, declarations } = scanFreeReferences(code, ['process', 'Buffer', 'global']);
  const byName = (/** @type {string} */ target) => refs.filter((ref) => ref.name === target);

  for (const target of ['process', 'global']) {
    const hits = byName(target);
    if (hits.length > 0) {
      const sample = hits
        .slice(0, 3)
        .map((hit) => `${hit.kind}@${hit.line}:${hit.col}`)
        .join(', ');
      fail(`${label}含 ${hits.length} 处自由 ${target} 引用（例如 ${sample}）`);
    }
  }

  const bufferRefs = byName('Buffer');
  if (bufferRefs.length > 0 && !declarations.some((decl) => decl.name === 'Buffer')) {
    fail(`${label}含 ${bufferRefs.length} 处自由 Buffer 引用，且无本地 buffer polyfill 定义`);
  }

  const nodeBuiltins = findNodeBuiltinImports(code);
  if (nodeBuiltins.length > 0) {
    fail(`${label}仍引用 Node 内置模块: ${nodeBuiltins.join(', ')}`);
  }

  console.log(
    `[check-browser] ${name}: ${(code.length / 1024).toFixed(1)} kB，` +
      `自由 process=0 / global=0 / Buffer=${bufferRefs.length}(本地定义 ${declarations.filter((d) => d.name === 'Buffer').length})，无 Node 内置模块`,
  );
}

const iifePath = fileURLToPath(new URL('../dist/index.iife.js', import.meta.url));
const code = fs.readFileSync(iifePath, 'utf8');

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  queueMicrotask,
  TextEncoder,
  TextDecoder,
  crypto: globalThis.crypto,
  performance: globalThis.performance,
  AbortController: globalThis.AbortController,
  AbortSignal: globalThis.AbortSignal,
  Event: globalThis.Event,
  EventTarget: globalThis.EventTarget,
  DOMException: globalThis.DOMException,
  MessageChannel: globalThis.MessageChannel,
  MessagePort: globalThis.MessagePort,
  structuredClone: globalThis.structuredClone,
  navigator: { userAgent: 'node-vm', platform: 'vm', product: 'mqtt-crypto-client' },
  URL,
  URLSearchParams,
  WebSocket: globalThis.WebSocket,
  Blob: globalThis.Blob,
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

if (vm.runInContext('typeof process', sandbox) !== 'undefined') {
  fail('沙箱意外存在 process，无法验证无 process 环境');
}
if (vm.runInContext('typeof Buffer', sandbox) !== 'undefined') {
  fail('沙箱意外存在 Buffer，无法验证无 Buffer 环境');
}

try {
  vm.runInContext(code, sandbox, { filename: 'index.iife.js' });
} catch (error) {
  fail(`在无 process 沙箱中加载失败: ${error instanceof Error ? error.stack : String(error)}`);
}

const api = sandbox.window.MqttCryptoClient;
if (!api) fail('window.MqttCryptoClient 未定义');

for (const name of ['createClient', 'encryptPayload', 'decryptPayload', 'buildEnvelope', 'buildTopic']) {
  if (typeof api[name] !== 'function') fail(`缺少导出 ${name}`);
}

try {
  const plaintext = JSON.stringify({ msg: '中文 😀', n: 42 });
  const ciphertext = api.encryptPayload(plaintext, 'check-secret');
  assert.equal(api.decryptPayload(ciphertext, 'check-secret'), plaintext);
  assert.equal(nodeDecrypt(ciphertext, 'check-secret'), plaintext);

  const nodeCiphertext = nodeEncrypt(plaintext, 'check-secret');
  assert.equal(api.decryptPayload(nodeCiphertext, 'check-secret'), plaintext);

  const client = api.createClient({ secret: 'check-secret' });
  assert.equal(typeof client.on, 'function');
  assert.equal(client.listenerCount('connect'), 0);
} catch (error) {
  fail(`无 process 沙箱运行失败: ${error instanceof Error ? error.stack : String(error)}`);
}

if (vm.runInContext('typeof process', sandbox) !== 'undefined') {
  fail('IIFE 加载后向全局注入了 process，预期为局部 shim');
}

console.log('[check-browser] OK: 无 process/Buffer/global 自由引用，无 Node 内置模块，无 process 沙箱通过');

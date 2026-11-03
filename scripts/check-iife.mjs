/**
 * IIFE 产物防回归检查：
 * 1. 静态扫描残留的 Node 全局引用（process.env / global. / process.nextTick 调用）
 * 2. 在“没有 process/Buffer 全局”的 vm 沙箱中加载，验证全局 API 与加解密
 *
 * 任一失败则构建失败（非零退出）。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { encryptPayload as nodeEncrypt, decryptPayload as nodeDecrypt } from '../src/crypto.js';

const bundlePath = fileURLToPath(new URL('../dist/index.iife.js', import.meta.url));
const code = fs.readFileSync(bundlePath, 'utf8');

/** @param {string} message */
function fail(message) {
  console.error(`[check-iife] FAIL: ${message}`);
  process.exit(1);
}

const staticChecks = [
  { pattern: /process\.env/g, label: 'process.env（应由构建期 define 消除）' },
  { pattern: /\bglobal\./g, label: 'global.（应替换为 globalThis）' },
  { pattern: /process\.nextTick\(/g, label: 'process.nextTick 调用（应被消除或由内联 shim 处理）' },
];

for (const { pattern, label } of staticChecks) {
  const count = (code.match(pattern) ?? []).length;
  if (count > 0) fail(`产物仍含 ${label}，共 ${count} 处`);
}

// 白名单理由：mqtt 浏览器构建内置 buffer polyfill，产物内会出现 Buffer 的本地定义/属性赋值。
if (/\bBuffer\b/.test(code) && !/\bBuffer\s*=/.test(code)) {
  fail('产物使用了 Buffer 但未发现内置 buffer polyfill 定义');
}

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

console.log(`[check-iife] OK: ${(code.length / 1024).toFixed(1)} kB，无 process.env/global. 残留，无 process 沙箱通过`);

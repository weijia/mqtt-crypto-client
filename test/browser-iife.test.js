import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { encryptPayload as nodeEncrypt, decryptPayload as nodeDecrypt } from '../src/crypto.js';

const bundlePath = path.resolve('dist/index.iife.js');
const bundleExists = existsSync(bundlePath);

/**
 * 模拟浏览器脚本全局：顶层 var 会挂到 window 上。
 * @returns {Record<string, any>}
 */
function loadBundle() {
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
  assert.equal(vm.runInContext('typeof process', sandbox), 'undefined', '沙箱不应有 process');
  assert.equal(vm.runInContext('typeof Buffer', sandbox), 'undefined', '沙箱不应有 Buffer');
  vm.runInContext(readFileSync(bundlePath, 'utf8'), sandbox, { filename: 'index.iife.js' });
  assert.equal(vm.runInContext('typeof process', sandbox), 'undefined', 'IIFE 不应向全局注入 process');
  return sandbox;
}

test('IIFE 加载后 window.MqttCryptoClient 可用且导出完整', {
  skip: bundleExists ? false : '先运行 npm run build 生成 dist/index.iife.js',
}, () => {
  const sandbox = loadBundle();
  const api = sandbox.window.MqttCryptoClient;
  assert.equal(typeof api, 'object');
  assert.ok(api);

  for (const name of [
    'createClient',
    'encryptPayload',
    'decryptPayload',
    'tryDecrypt',
    'isEncryptedPayload',
    'deriveKeyAndIv',
    'buildEnvelope',
    'parseEnvelope',
    'buildTopic',
    'validateTopic',
  ]) {
    assert.equal(typeof api[name], 'function', `缺少导出 ${name}`);
  }
  assert.equal(typeof api.MqttCryptoClient, 'function');

  const client = api.createClient({ secret: 'demo-secret' });
  assert.equal(typeof client.on, 'function');
  assert.equal(typeof client.emit, 'function');
  assert.equal(client.listenerCount('connect'), 0);

  const plaintext = JSON.stringify({ msg: '中文 😀', n: 42 });
  const ciphertext = api.encryptPayload(plaintext, 'demo-secret');
  assert.equal(api.decryptPayload(ciphertext, 'demo-secret'), plaintext);
  assert.equal(api.isEncryptedPayload(ciphertext), true);
  assert.equal(nodeDecrypt(ciphertext, 'demo-secret'), plaintext);

  const nodeCiphertext = nodeEncrypt(plaintext, 'demo-secret');
  assert.equal(api.decryptPayload(nodeCiphertext, 'demo-secret'), plaintext);
});

test('IIFE 产物包含 mqtt 浏览器依赖且未内联 node:crypto', {
  skip: bundleExists ? false : '先运行 npm run build 生成 dist/index.iife.js',
}, () => {
  const code = readFileSync(bundlePath, 'utf8');
  assert.ok(code.length > 100_000, `IIFE 体积异常: ${code.length}`);
  assert.equal(code.includes('require("node:crypto")'), false);
  assert.equal(code.includes("from 'node:crypto'"), false);
  assert.ok(Buffer.byteLength(code, 'utf8') > 0);
});

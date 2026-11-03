import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import {
  CryptoError,
  decryptPayload,
  deriveKeyAndIv,
  encryptPayload,
  isEncryptedPayload,
  tryDecrypt,
} from '../src/index.js';

const SECRET = 'stock_condition_order_Secret';

test('加密/解密往返：ASCII、中文、emoji', () => {
  const plaintext = JSON.stringify({ id: 'vue_abc', msg: '中文消息 😀', time: 1700000000000 });
  const ciphertext = encryptPayload(plaintext, SECRET);
  assert.equal(decryptPayload(ciphertext, SECRET), plaintext);
});

test('密文是 base64 的 OpenSSL Salted__ 格式', () => {
  const ciphertext = encryptPayload('hello', SECRET);
  const raw = Buffer.from(ciphertext, 'base64');
  assert.equal(raw.subarray(0, 8).toString('utf8'), 'Salted__');
  assert.ok(raw.length > 16);
  assert.ok(isEncryptedPayload(ciphertext));
});

test('相同明文每次加密结果不同（随机 8 字节 salt）', () => {
  const a = encryptPayload('same', SECRET);
  const b = encryptPayload('same', SECRET);
  assert.notEqual(a, b);
  assert.equal(decryptPayload(a, SECRET), 'same');
  assert.equal(decryptPayload(b, SECRET), 'same');
  const saltA = Buffer.from(a, 'base64').subarray(8, 16);
  const saltB = Buffer.from(b, 'base64').subarray(8, 16);
  assert.notDeepEqual([...saltA], [...saltB]);
});

test('固定 salt 可复现密文（便于与 CryptoJS 互通校验）', () => {
  const salt = Buffer.from('12345678', 'utf8');
  const first = encryptPayload('fixed', SECRET, { salt });
  const second = encryptPayload('fixed', SECRET, { salt });
  assert.equal(first, second);
  assert.equal(decryptPayload(first, SECRET), 'fixed');
});

test('错误口令解密失败并抛出 CryptoError', () => {
  const ciphertext = encryptPayload('secret-data', SECRET);
  assert.throws(
    () => decryptPayload(ciphertext, 'wrong-secret'),
    (error) => error instanceof CryptoError && error.code === 'DECRYPT_FAILED',
  );
  assert.equal(tryDecrypt(ciphertext, 'wrong-secret'), null);
});

test('篡改密文尾部会被发现（PKCS#7 校验失败）', () => {
  const ciphertext = encryptPayload('tamper-me', SECRET);
  const raw = Buffer.from(ciphertext, 'base64');
  raw[raw.length - 1] = raw[raw.length - 1] ^ 0xff;
  const tampered = raw.toString('base64');
  assert.throws(() => decryptPayload(tampered, SECRET), (error) => error instanceof CryptoError);
});

test('tryDecrypt 对明文/非法内容返回 null', () => {
  assert.equal(tryDecrypt('{"hello":"world"}', SECRET), null);
  assert.equal(tryDecrypt('not base64!!!', SECRET), null);
  assert.equal(tryDecrypt('', SECRET), null);
  assert.equal(tryDecrypt(encryptPayload('', SECRET), SECRET), null);
});

test('缺少口令或非法参数会报错', () => {
  assert.throws(() => encryptPayload('x', ''), (error) => error.code === 'MISSING_SECRET');
  assert.throws(() => decryptPayload('x', ''), (error) => error.code === 'MISSING_SECRET');
  assert.throws(() => encryptPayload(/** @type {any} */ (123), SECRET), (error) => error.code === 'INVALID_PLAINTEXT');
  assert.throws(() => decryptPayload('a', SECRET), (error) => error.code === 'INVALID_CIPHERTEXT');
});

test('EVP_BytesToKey 派生 32 字节 key 与 16 字节 IV', () => {
  const { key, iv } = deriveKeyAndIv(SECRET, Buffer.from('12345678', 'utf8'));
  assert.equal(key.length, 32);
  assert.equal(iv.length, 16);
  const second = deriveKeyAndIv(SECRET, Buffer.from('12345678', 'utf8'));
  assert.deepEqual([...key], [...second.key]);
  assert.deepEqual([...iv], [...second.iv]);
});

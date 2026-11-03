import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import * as nodeCrypto from '../src/crypto.js';
import * as browserCrypto from '../src/crypto-browser.js';
import { CryptoError } from '../src/errors.js';

const SECRET = 'stock_condition_order_Secret';
const FIXED_SALT = new TextEncoder().encode('12345678');

test('浏览器与 Node 固定 salt 加密结果逐字节一致', () => {
  const nodeCiphertext = nodeCrypto.encryptPayload('fixed-plaintext', SECRET, {
    salt: Buffer.from(FIXED_SALT),
  });
  const browserCiphertext = browserCrypto.encryptPayload('fixed-plaintext', SECRET, {
    salt: FIXED_SALT,
  });
  assert.equal(browserCiphertext, nodeCiphertext);
});

test('浏览器加密 -> Node 解密，Node 加密 -> 浏览器解密', () => {
  const plaintext = JSON.stringify({ id: 'vue_abc', msg: '中文消息 😀', time: 1700000000000 });

  const browserCiphertext = browserCrypto.encryptPayload(plaintext, SECRET);
  assert.equal(nodeCrypto.decryptPayload(browserCiphertext, SECRET), plaintext);

  const nodeCiphertext = nodeCrypto.encryptPayload(plaintext, SECRET);
  assert.equal(browserCrypto.decryptPayload(nodeCiphertext, SECRET), plaintext);
});

test('浏览器加解密往返：ASCII、中文、emoji、空串', () => {
  for (const plaintext of ['hello', '中文消息 😀', '', '{"a":1}']) {
    const ciphertext = browserCrypto.encryptPayload(plaintext, SECRET);
    assert.equal(browserCrypto.decryptPayload(ciphertext, SECRET), plaintext);
  }
});

test('浏览器密文是 base64 的 OpenSSL Salted__ 格式，随机 salt 每次不同', () => {
  const a = browserCrypto.encryptPayload('same', SECRET);
  const b = browserCrypto.encryptPayload('same', SECRET);
  assert.notEqual(a, b);
  const rawA = Buffer.from(a, 'base64');
  assert.equal(rawA.subarray(0, 8).toString('utf8'), 'Salted__');
  assert.ok(browserCrypto.isEncryptedPayload(a));
});

test('浏览器错误口令/篡改密文抛出 CryptoError', () => {
  const ciphertext = browserCrypto.encryptPayload('secret-data', SECRET);
  assert.throws(
    () => browserCrypto.decryptPayload(ciphertext, 'wrong-secret'),
    (error) => error instanceof CryptoError && error.code === 'DECRYPT_FAILED',
  );
  assert.equal(browserCrypto.tryDecrypt(ciphertext, 'wrong-secret'), null);

  const raw = Buffer.from(ciphertext, 'base64');
  raw[raw.length - 1] ^= 0xff;
  assert.throws(
    () => browserCrypto.decryptPayload(raw.toString('base64'), SECRET),
    (error) => error instanceof CryptoError,
  );
});

test('浏览器 tryDecrypt 对明文/非法内容返回 null', () => {
  assert.equal(browserCrypto.tryDecrypt('{"hello":"world"}', SECRET), null);
  assert.equal(browserCrypto.tryDecrypt('not base64!!!', SECRET), null);
  assert.equal(browserCrypto.tryDecrypt('', SECRET), null);
  assert.equal(browserCrypto.tryDecrypt(browserCrypto.encryptPayload('', SECRET), SECRET), null);
});

test('浏览器 deriveKeyAndIv 与 Node EVP_BytesToKey 一致', () => {
  const browserDerived = browserCrypto.deriveKeyAndIv(SECRET, FIXED_SALT);
  const nodeDerived = nodeCrypto.deriveKeyAndIv(SECRET, Buffer.from(FIXED_SALT));
  assert.equal(browserDerived.key.length, 32);
  assert.equal(browserDerived.iv.length, 16);
  assert.deepEqual([...browserDerived.key], [...nodeDerived.key]);
  assert.deepEqual([...browserDerived.iv], [...nodeDerived.iv]);
});

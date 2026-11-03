/**
 * 浏览器端加解密实现：使用 crypto-js（仅打包进 IIFE），保持与 Node 版逐字节兼容。
 *
 * 兼容格式（OpenSSL "Salted__" 格式）：
 *   密文 = base64( "Salted__"（8 字节） + salt（默认 8 字节） + AES-256-CBC 密文 )
 *   密钥/IV = EVP_BytesToKey(MD5, 1 次迭代, passphrase, salt)，key 32 字节 + IV 16 字节
 *   填充 = PKCS#7
 *
 * 与 Node 版差异：salt 参数接受 Uint8Array / crypto-js WordArray（Node 版要求 Buffer）；
 * deriveKeyAndIv 返回 Uint8Array。API 保持同步，不依赖 WebCrypto。
 */
import CryptoJS from 'crypto-js';
import { CryptoError } from './errors.js';

const SALT_HEADER = new Uint8Array([0x53, 0x61, 0x6c, 0x74, 0x65, 0x64, 0x5f, 0x5f]);
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const DEFAULT_SALT_LENGTH = 8;
const BLOCK_SIZE = 16;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * @param {unknown} secret
 */
function assertSecret(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new CryptoError('secret 必须是非空字符串', 'MISSING_SECRET');
  }
}

/**
 * @param {unknown} value
 * @returns {value is Uint8Array}
 */
function isByteView(value) {
  return ArrayBuffer.isView(value) && /** @type {any} */ (value).BYTES_PER_ELEMENT === 1;
}

/**
 * @param {unknown} value
 * @returns {value is { words: number[], sigBytes: number }}
 */
function isWordArray(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray(/** @type {any} */ (value).words) &&
      typeof /** @type {any} */ (value).sigBytes === 'number',
  );
}

/**
 * @param {{ words: number[], sigBytes: number }} wordArray
 * @returns {Uint8Array}
 */
function wordArrayToBytes(wordArray) {
  const bytes = new Uint8Array(wordArray.sigBytes);
  for (let i = 0; i < wordArray.sigBytes; i += 1) {
    bytes[i] = (wordArray.words[i >>> 2] >>> (24 - (i % 4) * 8)) & 0xff;
  }
  return bytes;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ words: number[], sigBytes: number }}
 */
function bytesToWordArray(bytes) {
  /** @type {number[]} */
  const words = [];
  for (let i = 0; i < bytes.length; i += 1) {
    words[i >>> 2] = (words[i >>> 2] ?? 0) | (bytes[i] << (24 - (i % 4) * 8));
  }
  return CryptoJS.lib.WordArray.create(words, bytes.length);
}

/**
 * @param {unknown} value
 * @param {string} name
 * @returns {Uint8Array}
 */
function toBytes(value, name) {
  if (isByteView(value)) return new Uint8Array(value);
  if (isWordArray(value)) return wordArrayToBytes(value);
  throw new CryptoError(`${name} 必须是 Uint8Array 或 crypto-js WordArray`, 'INVALID_SALT');
}

/**
 * @param {string} secret
 * @param {Uint8Array} salt
 * @param {number} [keyLength]
 * @param {number} [ivLength]
 * @returns {{ key: { words: number[], sigBytes: number }, iv: { words: number[], sigBytes: number } }}
 */
function deriveWordArrays(secret, salt, keyLength = KEY_LENGTH, ivLength = IV_LENGTH) {
  if (!Number.isInteger(keyLength) || keyLength <= 0 || keyLength % 4 !== 0) {
    throw new CryptoError('keyLength 必须是 4 的正整数倍', 'INVALID_ARGUMENT');
  }
  if (!Number.isInteger(ivLength) || ivLength <= 0 || ivLength % 4 !== 0) {
    throw new CryptoError('ivLength 必须是 4 的正整数倍', 'INVALID_ARGUMENT');
  }
  const kdf = CryptoJS.kdf.OpenSSL.execute(
    secret,
    keyLength / 4,
    ivLength / 4,
    bytesToWordArray(salt),
  );
  return { key: kdf.key, iv: kdf.iv };
}

/**
 * OpenSSL EVP_BytesToKey（MD5，count=1），与 CryptoJS 的 OpenSSLKdf 一致。
 * @param {string} secret 口令
 * @param {Uint8Array | { words: number[], sigBytes: number }} salt
 * @param {number} [keyLength]
 * @param {number} [ivLength]
 * @returns {{ key: Uint8Array, iv: Uint8Array }}
 */
export function deriveKeyAndIv(secret, salt, keyLength = KEY_LENGTH, ivLength = IV_LENGTH) {
  assertSecret(secret);
  const saltBytes = toBytes(salt, 'salt');
  const { key, iv } = deriveWordArrays(secret, saltBytes, keyLength, ivLength);
  return { key: wordArrayToBytes(key), iv: wordArrayToBytes(iv) };
}

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
function padPkcs7(bytes) {
  const padLength = BLOCK_SIZE - (bytes.length % BLOCK_SIZE);
  const padded = new Uint8Array(bytes.length + padLength);
  padded.set(bytes, 0);
  padded.fill(padLength, bytes.length);
  return padded;
}

/**
 * @param {Uint8Array} padded
 * @returns {Uint8Array}
 */
function unpadPkcs7(padded) {
  const padLength = padded[padded.length - 1];
  if (padLength === undefined || padLength < 1 || padLength > BLOCK_SIZE || padLength > padded.length) {
    throw new CryptoError('解密失败（PKCS#7 填充非法）', 'DECRYPT_FAILED');
  }
  for (let i = padded.length - padLength; i < padded.length; i += 1) {
    if (padded[i] !== padLength) {
      throw new CryptoError('解密失败（PKCS#7 填充非法）', 'DECRYPT_FAILED');
    }
  }
  return padded.subarray(0, padded.length - padLength);
}

/**
 * 加密任意字符串，返回与 Node 版 / CryptoJS 完全兼容的 base64 密文。
 * @param {string} plaintext
 * @param {string} secret
 * @param {{ saltLength?: number, salt?: Uint8Array | { words: number[], sigBytes: number } }} [options]
 * @returns {string}
 */
export function encryptPayload(plaintext, secret, options = {}) {
  if (typeof plaintext !== 'string') {
    throw new CryptoError('plaintext 必须是字符串', 'INVALID_PLAINTEXT');
  }
  assertSecret(secret);

  const saltLength = options.saltLength ?? DEFAULT_SALT_LENGTH;
  if (!Number.isInteger(saltLength) || saltLength < 0) {
    throw new CryptoError('saltLength 必须是非负整数', 'INVALID_SALT');
  }
  const salt = options.salt !== undefined
    ? toBytes(options.salt, 'salt')
    : wordArrayToBytes(CryptoJS.lib.WordArray.random(saltLength));

  try {
    const { key, iv } = deriveWordArrays(secret, salt);
    const plaintextBytes = new TextEncoder().encode(plaintext);
    const encrypted = CryptoJS.AES.encrypt(bytesToWordArray(padPkcs7(plaintextBytes)), key, {
      iv,
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.NoPadding,
    });
    const output = CryptoJS.lib.WordArray.create(
      [0x53616c74, 0x65645f5f],
      SALT_HEADER.length,
    );
    const withSalt = output.concat(bytesToWordArray(salt));
    return withSalt.concat(encrypted.ciphertext).toString(CryptoJS.enc.Base64);
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError('加密失败', 'ENCRYPT_FAILED', /** @type {Error} */ (error));
  }
}

/**
 * @param {Uint8Array} raw
 * @returns {{ salt: Uint8Array, ciphertext: Uint8Array }}
 */
function splitCiphertext(raw) {
  const hasHeader =
    raw.length >= SALT_HEADER.length &&
    SALT_HEADER.every((byte, index) => raw[index] === byte);

  if (hasHeader) {
    if (raw.length < SALT_HEADER.length + DEFAULT_SALT_LENGTH) {
      throw new CryptoError('密文缺少 salt', 'INVALID_CIPHERTEXT');
    }
    return {
      salt: raw.subarray(SALT_HEADER.length, SALT_HEADER.length + DEFAULT_SALT_LENGTH),
      ciphertext: raw.subarray(SALT_HEADER.length + DEFAULT_SALT_LENGTH),
    };
  }
  return { salt: new Uint8Array(0), ciphertext: raw };
}

/**
 * 解密并返回 UTF-8 明文；失败时抛出 CryptoError。
 * @param {string} ciphertext base64 密文
 * @param {string} secret 口令
 * @returns {string}
 */
export function decryptPayload(ciphertext, secret) {
  if (typeof ciphertext !== 'string') {
    throw new CryptoError('密文必须是字符串', 'INVALID_CIPHERTEXT');
  }
  assertSecret(secret);

  const normalized = ciphertext.trim();
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new CryptoError('密文不是合法的 base64', 'INVALID_CIPHERTEXT');
  }

  const raw = wordArrayToBytes(CryptoJS.enc.Base64.parse(normalized));
  if (raw.length < SALT_HEADER.length) {
    throw new CryptoError('密文长度不足', 'INVALID_CIPHERTEXT');
  }

  const { salt, ciphertext: body } = splitCiphertext(raw);
  if (body.length === 0 || body.length % BLOCK_SIZE !== 0) {
    throw new CryptoError('密文块长度非法', 'INVALID_CIPHERTEXT');
  }

  try {
    const { key, iv } = deriveWordArrays(secret, salt);
    const decrypted = CryptoJS.AES.decrypt(
      CryptoJS.lib.CipherParams.create({ ciphertext: bytesToWordArray(body) }),
      key,
      { iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.NoPadding },
    );
    const unpadded = unpadPkcs7(wordArrayToBytes(decrypted));
    return strictUtf8Decoder.decode(unpadded);
  } catch (error) {
    if (error instanceof CryptoError) throw error;
    throw new CryptoError(
      '解密失败（口令错误、密文损坏或不是 UTF-8）',
      'DECRYPT_FAILED',
      /** @type {Error} */ (error),
    );
  }
}

/**
 * 宽松解密：任何失败都返回 null。
 * @param {string} ciphertext
 * @param {string} secret
 * @returns {string | null}
 */
export function tryDecrypt(ciphertext, secret) {
  if (typeof ciphertext !== 'string' || !ciphertext || !secret) return null;
  try {
    const plaintext = decryptPayload(ciphertext, secret);
    return plaintext.length > 0 ? plaintext : null;
  } catch {
    return null;
  }
}

/**
 * 判断字符串是否是本库/CryptoJS 的 "Salted__" base64 密文（仅看头部）。
 * @param {string} value
 * @returns {boolean}
 */
export function isEncryptedPayload(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) return false;
  const raw = wordArrayToBytes(CryptoJS.enc.Base64.parse(normalized));
  return (
    raw.length >= SALT_HEADER.length &&
    SALT_HEADER.every((byte, index) => raw[index] === byte)
  );
}

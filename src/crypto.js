/**
 * 与原实现（CryptoJS.AES.encrypt(payload, passphrase).toString()）逐字节兼容的加解密工具。
 *
 * 兼容格式（OpenSSL "Salted__" 格式）：
 *   密文 = base64( "Salted__"（8 字节） + salt（默认 8 字节） + AES-256-CBC 密文 )
 *   密钥/IV = EVP_BytesToKey(MD5, 1 次迭代, passphrase, salt)，key 32 字节 + IV 16 字节
 *   填充 = PKCS#7
 *
 * 说明：这是"口令派生 + CBC"格式，没有完整性校验（无 MAC/AEAD），
 * 只能防旁观者直接读取明文，不能防篡改。详见 README 的安全说明。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { TextDecoder } from 'node:util';
import { CryptoError } from './errors.js';

const SALT_HEADER = Buffer.from('Salted__', 'utf8');
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const DEFAULT_SALT_LENGTH = 8;
const AES_ALGORITHM = 'aes-256-cbc';
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

const strictUtf8Decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * @param {unknown} secret
 * @returns {Buffer}
 */
function toSecretBuffer(secret) {
  if (typeof secret !== 'string' || secret.length === 0) {
    throw new CryptoError('secret 必须是非空字符串', 'MISSING_SECRET');
  }
  return Buffer.from(secret, 'utf8');
}

/**
 * OpenSSL EVP_BytesToKey（MD5，count=1），与 CryptoJS 的 OpenSSLKdf 一致。
 * @param {string} secret 口令
 * @param {Buffer} salt 盐（可以为空 Buffer，用于兼容无盐密文）
 * @param {number} [keyLength]
 * @param {number} [ivLength]
 * @returns {{ key: Buffer, iv: Buffer }}
 */
export function deriveKeyAndIv(secret, salt, keyLength = KEY_LENGTH, ivLength = IV_LENGTH) {
  const password = toSecretBuffer(secret);
  if (!Buffer.isBuffer(salt)) {
    throw new CryptoError('salt 必须是 Buffer', 'INVALID_SALT');
  }

  const targetLength = keyLength + ivLength;
  /** @type {Buffer[]} */
  const blocks = [];
  let block = Buffer.alloc(0);
  let generated = 0;

  while (generated < targetLength) {
    block = createHash('md5')
      .update(Buffer.concat([block, password, salt]))
      .digest();
    blocks.push(block);
    generated += block.length;
  }

  const derived = Buffer.concat(blocks);
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, targetLength),
  };
}

/**
 * 加密任意字符串（通常是 JSON 信封），返回与 CryptoJS 完全兼容的 base64 密文。
 * @param {string} plaintext 明文
 * @param {string} secret 口令
 * @param {{ saltLength?: number, salt?: Buffer }} [options]
 * @returns {string}
 */
export function encryptPayload(plaintext, secret, options = {}) {
  if (typeof plaintext !== 'string') {
    throw new CryptoError('plaintext 必须是字符串', 'INVALID_PLAINTEXT');
  }
  const saltLength = options.saltLength ?? DEFAULT_SALT_LENGTH;
  if (!Number.isInteger(saltLength) || saltLength < 0) {
    throw new CryptoError('saltLength 必须是非负整数', 'INVALID_SALT');
  }

  const salt = options.salt ?? randomBytes(saltLength);
  if (!Buffer.isBuffer(salt)) {
    throw new CryptoError('salt 必须是 Buffer', 'INVALID_SALT');
  }

  const { key, iv } = deriveKeyAndIv(secret, salt);
  try {
    const cipher = createCipheriv(AES_ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([SALT_HEADER, salt, ciphertext]).toString('base64');
  } catch (error) {
    throw new CryptoError('加密失败', 'ENCRYPT_FAILED', /** @type {Error} */ (error));
  }
}

/**
 * 解析 base64 密文。带 "Salted__" 头时使用其中的 salt；
 * 不含头时按 CryptoJS 的兼容行为使用空 salt。
 * @param {string} ciphertext
 * @returns {{ salt: Buffer, ciphertext: Buffer }}
 */
function parseCiphertext(ciphertext) {
  if (typeof ciphertext !== 'string') {
    throw new CryptoError('密文必须是字符串', 'INVALID_CIPHERTEXT');
  }
  const normalized = ciphertext.trim();
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) {
    throw new CryptoError('密文不是合法的 base64', 'INVALID_CIPHERTEXT');
  }

  const raw = Buffer.from(normalized, 'base64');
  if (raw.length < SALT_HEADER.length) {
    throw new CryptoError('密文长度不足', 'INVALID_CIPHERTEXT');
  }

  if (raw.subarray(0, SALT_HEADER.length).equals(SALT_HEADER)) {
    if (raw.length < SALT_HEADER.length + DEFAULT_SALT_LENGTH) {
      throw new CryptoError('密文缺少 salt', 'INVALID_CIPHERTEXT');
    }
    return {
      salt: raw.subarray(SALT_HEADER.length, SALT_HEADER.length + DEFAULT_SALT_LENGTH),
      ciphertext: raw.subarray(SALT_HEADER.length + DEFAULT_SALT_LENGTH),
    };
  }

  return { salt: Buffer.alloc(0), ciphertext: raw };
}

/**
 * 解密并返回 UTF-8 明文；失败时抛出 CryptoError。
 * @param {string} ciphertext base64 密文
 * @param {string} secret 口令
 * @returns {string}
 */
export function decryptPayload(ciphertext, secret) {
  toSecretBuffer(secret);
  const { salt, ciphertext: body } = parseCiphertext(ciphertext);
  if (body.length === 0 || body.length % 16 !== 0) {
    throw new CryptoError('密文块长度非法', 'INVALID_CIPHERTEXT');
  }

  const { key, iv } = deriveKeyAndIv(secret, salt);
  try {
    const decipher = createDecipheriv(AES_ALGORITHM, key, iv);
    const plaintext = Buffer.concat([decipher.update(body), decipher.final()]);
    return strictUtf8Decoder.decode(plaintext);
  } catch (error) {
    throw new CryptoError('解密失败（口令错误、密文损坏或不是 UTF-8）', 'DECRYPT_FAILED', /** @type {Error} */ (error));
  }
}

/**
 * 宽松解密：任何失败都返回 null，用于"先解密、失败再按明文处理"的兼容路径。
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
 * 判断字符串是否是本库/CryptoJS 的 "Salted__" base64 密文（仅看头部，不校验内容）。
 * @param {string} value
 * @returns {boolean}
 */
export function isEncryptedPayload(value) {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  if (!normalized || normalized.length % 4 !== 0 || !BASE64_PATTERN.test(normalized)) return false;
  const raw = Buffer.from(normalized, 'base64');
  return raw.length >= SALT_HEADER.length && raw.subarray(0, SALT_HEADER.length).equals(SALT_HEADER);
}

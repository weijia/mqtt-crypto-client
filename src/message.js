/**
 * 入站消息解码：先尝试 AES 解密，失败则按明文处理（原实现行为）。
 */
import { tryDecrypt } from './crypto.js';

/**
 * @param {string} text MQTT payload 的字符串形式
 * @param {string} [secret] AES 口令；为空时跳过解密
 * @returns {{ text: string, decrypted: boolean }}
 */
export function decodeIncoming(text, secret) {
  if (typeof text !== 'string') {
    return { text: String(text), decrypted: false };
  }
  if (!secret) {
    return { text, decrypted: false };
  }

  const decrypted = tryDecrypt(text, secret);
  if (decrypted === null) {
    return { text, decrypted: false };
  }
  return { text: decrypted, decrypted: true };
}

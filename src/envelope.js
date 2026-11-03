/**
 * 消息信封（envelope）构造与解析。
 * 与原实现保持一致的字段：{ id, msgId, user, msg, time }。
 */
import { EnvelopeError } from './errors.js';

/** 原 Vue 实现使用的默认 user 前缀 */
export const DEFAULT_USER = 'fangzheng-agent';
/** 默认 clientId 前缀（原 Vue 实现为 `vue_`） */
export const DEFAULT_CLIENT_ID_PREFIX = 'vue_';

/**
 * 生成客户端 ID：`前缀 + 6 位十六进制随机数`（与 Math.random().toString(16).slice(2, 8) 等价）。
 * @param {string} [prefix]
 * @param {() => number} [random] 便于测试注入
 * @returns {string}
 */
export function createClientId(prefix = DEFAULT_CLIENT_ID_PREFIX, random = Math.random) {
  return `${prefix}${random().toString(16).slice(2, 8)}`;
}

/**
 * 生成 msgId：`时间戳_4 位十六进制随机数`，可附加后缀。
 * @param {{ now?: number, suffix?: string, random?: () => number }} [options]
 * @returns {string}
 */
export function generateMsgId(options = {}) {
  const { now = Date.now(), suffix = '', random = Math.random } = options;
  const base = `${now}_${random().toString(16).slice(2, 6)}`;
  return suffix ? `${base}_${suffix}` : base;
}

/**
 * 构造信封。`msg` 可以是字符串，也可以是会被 JSON.stringify 的对象。
 * @param {{
 *   id: string,
 *   msg: string | object,
 *   user?: string,
 *   userSuffix?: string,
 *   msgId?: string,
 *   time?: number
 * }} input
 * @returns {{ id: string, msgId: string, user: string, msg: string, time: number }}
 */
export function buildEnvelope(input) {
  const { id, user = DEFAULT_USER, userSuffix = '', msgId, time = Date.now() } = input;
  if (typeof id !== 'string' || id.length === 0) {
    throw new EnvelopeError('信封 id 必须是非空字符串', 'INVALID_ENVELOPE_ID');
  }
  if (typeof user !== 'string' || typeof userSuffix !== 'string') {
    throw new EnvelopeError('user/userSuffix 必须是字符串', 'INVALID_ENVELOPE_USER');
  }

  let msg;
  if (typeof input.msg === 'string') {
    msg = input.msg;
  } else if (input.msg && typeof input.msg === 'object') {
    msg = JSON.stringify(input.msg);
  } else {
    throw new EnvelopeError('信封 msg 必须是字符串或对象', 'INVALID_ENVELOPE_MSG');
  }

  return {
    id,
    msgId: msgId || generateMsgId({ now: time }),
    user: `${user}${userSuffix}`,
    msg,
    time,
  };
}

/**
 * 解析信封及其中的命令。
 *
 * - `data`：原始信封对象
 * - `command`：`msg` 解析后的命令对象；`ping`/`pong` 或解析失败时为 null
 * - `commandError`：`msg` 非 ping/pong 但不是合法 JSON 时的错误
 *
 * @param {string | object} input JSON 字符串或已解析对象
 * @returns {{ data: Record<string, any>, command: Record<string, any> | null, commandError: Error | null }}
 */
export function parseEnvelope(input) {
  let data;
  if (typeof input === 'string') {
    try {
      data = JSON.parse(input);
    } catch (error) {
      throw new EnvelopeError('信封不是合法 JSON', 'INVALID_JSON', /** @type {Error} */ (error));
    }
  } else {
    data = input;
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new EnvelopeError('信封必须是对象', 'INVALID_ENVELOPE');
  }

  let command = null;
  let commandError = null;
  const { msg } = data;

  if (typeof msg === 'string') {
    if (msg !== 'ping' && msg !== 'pong') {
      try {
        command = JSON.parse(msg);
      } catch (error) {
        command = null;
        commandError = new EnvelopeError('信封 msg 不是合法 JSON', 'INVALID_COMMAND_JSON', /** @type {Error} */ (error));
      }
    }
  } else if (msg && typeof msg === 'object') {
    command = msg;
  }

  return { data, command, commandError };
}

/**
 * 是否为"自己发出的消息"（支持带服务器后缀的 clientId 前缀匹配）。
 * @param {{ id?: unknown } | null | undefined} data
 * @param {string} clientId
 * @returns {boolean}
 */
export function isOwnMessage(data, clientId) {
  return Boolean(data && typeof data.id === 'string' && clientId && data.id.startsWith(clientId));
}

/**
 * 是否属于响应消息（原实现会从普通消息回调中过滤掉它们）。
 * 规则：`action === 'response'`，或没有 `action` 但带有 `type`。
 * @param {Record<string, any> | null | undefined} command
 * @returns {boolean}
 */
export function isResponseCommand(command) {
  if (!command) return false;
  return command.action === 'response' || (!command.action && Boolean(command.type));
}

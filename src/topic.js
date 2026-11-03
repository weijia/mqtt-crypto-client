/**
 * Broker 预设与 topic 工具。
 * 原实现的 topic 是每个服务器配置里的单一固定 topic（默认 'secure/stock-condition-order'），
 * 没有按用户/实例再拼接后缀的规则。
 */
import { TopicError } from './errors.js';

/** 原实现默认 topic */
export const DEFAULT_TOPIC = 'secure/stock-condition-order';

/** 原实现内置的三个公共 Broker（MQTT over WebSocket） */
export const PRESET_BROKERS = Object.freeze([
  'wss://broker.emqx.io:8084/mqtt',
  'wss://test.mosquitto.org:8081/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
]);

/**
 * 校验 topic。默认拒绝通配符，因为发布/订阅业务 topic 时不应带 `+` 或 `#`。
 * @param {string} topic
 * @param {{ allowWildcards?: boolean }} [options]
 * @returns {string}
 */
export function validateTopic(topic, options = {}) {
  const { allowWildcards = false } = options;
  if (typeof topic !== 'string' || topic.length === 0) {
    throw new TopicError('topic 必须是非空字符串');
  }
  if (topic.length > 65535) {
    throw new TopicError('topic 长度超过 65535 字节上限');
  }
  if (topic.includes('\u0000')) {
    throw new TopicError('topic 不能包含空字符');
  }
  if (!allowWildcards && /[+#]/.test(topic)) {
    throw new TopicError('业务 topic 不能包含通配符 + 或 #');
  }
  return topic;
}

/**
 * 用 `/` 拼接 topic 层级并校验。空字符串、首尾斜杠、通配符都会被拒绝。
 * @param {...string} segments
 * @returns {string}
 */
export function buildTopic(...segments) {
  if (segments.length === 0) {
    throw new TopicError('至少需要一个 topic 片段');
  }

  const parts = segments.map((segment, index) => {
    if (typeof segment !== 'string' || segment.length === 0) {
      throw new TopicError(`第 ${index + 1} 个 topic 片段必须是非空字符串`);
    }
    if (segment.startsWith('/') || segment.endsWith('/')) {
      throw new TopicError(`topic 片段不能以 / 开头或结尾: "${segment}"`);
    }
    return segment;
  });

  return validateTopic(parts.join('/'));
}

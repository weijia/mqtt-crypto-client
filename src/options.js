/**
 * 配置解析与底层 mqtt.connect options 拼装。
 * 这里集中保留原实现的连接参数：每实例 clientId、5s 重连、30s 连接超时、clean session。
 */
import { InvalidConfigError } from './errors.js';
import { DEFAULT_CLIENT_ID_PREFIX, DEFAULT_USER, createClientId } from './envelope.js';
import { DEFAULT_TOPIC, validateTopic } from './topic.js';

/** 支持的 broker 协议（库以 MQTT over WebSocket 为主，同时保留 TCP/TLS 能力） */
const SUPPORTED_PROTOCOLS = new Set(['ws:', 'wss:', 'mqtt:', 'mqtts:', 'tcp:', 'tls:']);

/**
 * 默认配置。`secret` 对应原实现服务器配置里的 `password`（AES 口令）。
 * @type {Readonly<Record<string, any>>}
 */
export const DEFAULT_OPTIONS = Object.freeze({
  broker: 'wss://broker.emqx.io:8084/mqtt',
  topic: DEFAULT_TOPIC,
  secret: '',
  encrypt: true,
  clientId: '',
  clientIdPrefix: DEFAULT_CLIENT_ID_PREFIX,
  clientIdSuffix: '',
  user: DEFAULT_USER,
  userSuffix: '',
  qos: 1,
  reconnectPeriod: 5000,
  connectTimeout: 30000,
  clean: true,
  resubscribe: true,
  heartbeatInterval: 30000,
  pongTimeout: 0,
  dedupeTtl: 5000,
  requestTimeout: 5000,
  auth: null,
  protocolVersion: undefined,
});

/**
 * @param {number} value
 * @param {string} name
 * @param {{ min?: number, allowZero?: boolean }} [rules]
 * @returns {number}
 */
function requireNumber(value, name, rules = {}) {
  const { min = 0, allowZero = true } = rules;
  const validType = typeof value === 'number' && Number.isFinite(value);
  const validValue = validType && (allowZero ? value >= min : value > min);
  if (!validValue) {
    throw new InvalidConfigError(`${name} 必须是${allowZero ? ' >= ' : ' > '}${min} 的数字`);
  }
  return value;
}

/**
 * @param {string} broker
 * @returns {string}
 */
function validateBroker(broker) {
  if (typeof broker !== 'string' || broker.length === 0) {
    throw new InvalidConfigError('broker 必须是非空字符串');
  }
  let url;
  try {
    url = new URL(broker);
  } catch {
    throw new InvalidConfigError(`broker 不是合法 URL: ${broker}`);
  }
  if (!SUPPORTED_PROTOCOLS.has(url.protocol)) {
    throw new InvalidConfigError(`不支持的 broker 协议: ${url.protocol}（支持 ws/wss/mqtt/mqtts/tcp/tls）`);
  }
  if (!url.hostname) {
    throw new InvalidConfigError('broker 缺少主机名');
  }
  return broker;
}

/**
 * 合并并校验配置，返回规范化后的只读配置对象。
 * @param {Partial<typeof DEFAULT_OPTIONS> & { auth?: { username?: string, password?: string } | null }} [input]
 * @returns {Readonly<Record<string, any>>}
 */
export function resolveOptions(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new InvalidConfigError('options 必须是对象');
  }

  const options = { ...DEFAULT_OPTIONS, ...input };

  options.broker = validateBroker(options.broker);
  options.topic = validateTopic(options.topic);

  if (typeof options.secret !== 'string') {
    throw new InvalidConfigError('secret 必须是字符串');
  }
  if (options.encrypt !== false && options.secret.length === 0) {
    throw new InvalidConfigError('encrypt 为 true 时必须提供非空 secret');
  }
  if (typeof options.encrypt !== 'boolean') {
    throw new InvalidConfigError('encrypt 必须是布尔值');
  }

  if (options.clientId !== '' && typeof options.clientId !== 'string') {
    throw new InvalidConfigError('clientId 必须是字符串');
  }
  if (typeof options.clientIdPrefix !== 'string') {
    throw new InvalidConfigError('clientIdPrefix 必须是字符串');
  }
  if (typeof options.clientIdSuffix !== 'string') {
    throw new InvalidConfigError('clientIdSuffix 必须是字符串');
  }
  if (!options.clientId) {
    options.clientId = createClientId(options.clientIdPrefix);
  }
  if (!options.clientId) {
    throw new InvalidConfigError('clientId 不能为空');
  }

  if (typeof options.user !== 'string' || options.user.length === 0) {
    throw new InvalidConfigError('user 必须是非空字符串');
  }
  if (typeof options.userSuffix !== 'string') {
    throw new InvalidConfigError('userSuffix 必须是字符串');
  }

  if (![0, 1, 2].includes(options.qos)) {
    throw new InvalidConfigError('qos 只能是 0、1 或 2');
  }

  options.reconnectPeriod = requireNumber(options.reconnectPeriod, 'reconnectPeriod');
  options.connectTimeout = requireNumber(options.connectTimeout, 'connectTimeout', { allowZero: false });
  options.heartbeatInterval = requireNumber(options.heartbeatInterval, 'heartbeatInterval');
  options.pongTimeout = requireNumber(options.pongTimeout, 'pongTimeout');
  options.dedupeTtl = requireNumber(options.dedupeTtl, 'dedupeTtl');
  options.requestTimeout = requireNumber(options.requestTimeout, 'requestTimeout', { allowZero: false });

  if (typeof options.clean !== 'boolean') {
    throw new InvalidConfigError('clean 必须是布尔值');
  }
  if (typeof options.resubscribe !== 'boolean') {
    throw new InvalidConfigError('resubscribe 必须是布尔值');
  }

  if (options.protocolVersion !== undefined && ![4, 5].includes(options.protocolVersion)) {
    throw new InvalidConfigError('protocolVersion 只能是 4 或 5');
  }

  if (options.auth !== null && options.auth !== undefined) {
    const { username, password } = options.auth;
    if (typeof options.auth !== 'object' || Array.isArray(options.auth)) {
      throw new InvalidConfigError('auth 必须是对象');
    }
    if (username !== undefined && typeof username !== 'string') {
      throw new InvalidConfigError('auth.username 必须是字符串');
    }
    if (password !== undefined && typeof password !== 'string') {
      throw new InvalidConfigError('auth.password 必须是字符串');
    }
    options.auth = { username, password };
  } else {
    options.auth = null;
  }

  return Object.freeze(options);
}

/**
 * 生成传给 `mqtt.connect()` 的 options。
 * 原实现：clientId = 基础 clientId + '_' + serverId；reconnectPeriod=5000；connectTimeout=30000；clean=true。
 * @param {ReturnType<typeof resolveOptions>} options
 * @returns {Record<string, any>}
 */
export function buildMqttOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new InvalidConfigError('buildMqttOptions 需要 resolveOptions 的结果');
  }

  /** @type {Record<string, any>} */
  const mqttOptions = {
    clientId: `${options.clientId}${options.clientIdSuffix}`,
    reconnectPeriod: options.reconnectPeriod,
    connectTimeout: options.connectTimeout,
    clean: options.clean,
    resubscribe: options.resubscribe,
  };

  if (options.protocolVersion !== undefined) {
    mqttOptions.protocolVersion = options.protocolVersion;
  }
  if (options.auth) {
    if (options.auth.username !== undefined) mqttOptions.username = options.auth.username;
    if (options.auth.password !== undefined) mqttOptions.password = options.auth.password;
  }

  return mqttOptions;
}

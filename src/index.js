/**
 * mqtt-crypto-client
 * MQTT over WebSocket + CryptoJS 兼容 AES 信封加密的 Node.js 客户端。
 */
export { MqttCryptoClient, createClient } from './client.js';

export {
  decryptPayload,
  deriveKeyAndIv,
  encryptPayload,
  isEncryptedPayload,
  tryDecrypt,
} from './crypto.js';

export {
  DEFAULT_CLIENT_ID_PREFIX,
  DEFAULT_USER,
  buildEnvelope,
  createClientId,
  generateMsgId,
  isOwnMessage,
  isResponseCommand,
  parseEnvelope,
} from './envelope.js';

export { decodeIncoming } from './message.js';

export {
  DEFAULT_OPTIONS,
  buildMqttOptions,
  resolveOptions,
} from './options.js';

export { DEFAULT_TOPIC, PRESET_BROKERS, buildTopic, validateTopic } from './topic.js';

export {
  ConnectTimeoutError,
  CryptoError,
  EnvelopeError,
  InvalidConfigError,
  MqttCryptoError,
  NotConnectedError,
  RequestTimeoutError,
  TopicError,
} from './errors.js';

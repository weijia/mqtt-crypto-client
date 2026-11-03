/**
 * 库内统一错误类型。
 * 所有可预期的错误都带有稳定的 `code`，便于调用方分支处理。
 */
export class MqttCryptoError extends Error {
  /**
   * @param {string} message 错误描述
   * @param {string} [code] 稳定的错误码
   * @param {Error & {code?: string}} [cause] 原始错误
   */
  constructor(message, code = 'MQTT_CRYPTO_ERROR', cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'MqttCryptoError';
    this.code = code;
  }
}

/** 配置非法（broker/topic/qos/secret 等） */
export class InvalidConfigError extends MqttCryptoError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'INVALID_CONFIG');
    this.name = 'InvalidConfigError';
  }
}

/** 未连接时尝试执行需要连接的操作 */
export class NotConnectedError extends MqttCryptoError {
  /** @param {string} [message] */
  constructor(message = 'MQTT 客户端尚未连接') {
    super(message, 'NOT_CONNECTED');
    this.name = 'NotConnectedError';
  }
}

/** 请求等待响应超时 */
export class RequestTimeoutError extends MqttCryptoError {
  /**
   * @param {string} msgId 请求的消息 ID
   * @param {number} timeout 超时毫秒数
   */
  constructor(msgId, timeout) {
    super(`请求 ${msgId} 在 ${timeout}ms 内没有收到响应`, 'REQUEST_TIMEOUT');
    this.name = 'RequestTimeoutError';
    this.msgId = msgId;
    this.timeout = timeout;
  }
}

/** 连接就绪等待超时（底层客户端仍会按 reconnectPeriod 继续重试） */
export class ConnectTimeoutError extends MqttCryptoError {
  /** @param {number} timeout */
  constructor(timeout) {
    super(`MQTT 连接在 ${timeout}ms 内未就绪`, 'CONNECT_TIMEOUT');
    this.name = 'ConnectTimeoutError';
    this.timeout = timeout;
  }
}

/** topic 非法 */
export class TopicError extends MqttCryptoError {
  /** @param {string} message */
  constructor(message) {
    super(message, 'INVALID_TOPIC');
    this.name = 'TopicError';
  }
}

/** 加解密失败 */
export class CryptoError extends MqttCryptoError {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {Error} [cause]
   */
  constructor(message, code = 'CRYPTO_ERROR', cause) {
    super(message, code, cause);
    this.name = 'CryptoError';
  }
}

/** 信封解析失败 */
export class EnvelopeError extends MqttCryptoError {
  /**
   * @param {string} message
   * @param {string} [code]
   * @param {Error} [cause]
   */
  constructor(message, code = 'INVALID_ENVELOPE', cause) {
    super(message, code, cause);
    this.name = 'EnvelopeError';
  }
}

/**
 * MQTT over WebSocket 客户端：加密信封收发、心跳、去重、请求/响应配对。
 *
 * 事件：
 *   connect          首次/每次连接成功（已发起订阅）
 *   reconnect        底层正在重连
 *   close / offline  连接关闭 / 离线
 *   error            Error（仅在存在 error 监听器时抛出，避免未处理异常）
 *   message          { envelope, command, topic, decrypted }
 *   response         { envelope, command, topic }
 *   agentStatus      boolean（收到 pong = true；仅当配置 pongTimeout > 0 时才可能为 false）
 *   status           { connected, agentOnline }
 *   messageError     Error（信封/命令 JSON 解析失败）
 */
import { EventEmitter } from 'node:events';
import mqtt from 'mqtt';
import { encryptPayload } from './crypto.js';
import {
  buildEnvelope,
  generateMsgId,
  isOwnMessage,
  isResponseCommand,
  parseEnvelope,
} from './envelope.js';
import { ConnectTimeoutError, NotConnectedError, RequestTimeoutError } from './errors.js';
import { decodeIncoming } from './message.js';
import { buildMqttOptions, resolveOptions } from './options.js';

/**
 * @typedef {{ command: Record<string, any> | null, envelope: Record<string, any>, topic: string }} IncomingMessage
 * @typedef {{
 *   resolve: (value: IncomingMessage) => void,
 *   reject: (reason?: any) => void,
 *   timer: NodeJS.Timeout
 * }} PendingRequest
 */

export class MqttCryptoClient extends EventEmitter {
  /**
   * @param {Parameters<typeof resolveOptions>[0]} [options]
   */
  constructor(options = {}) {
    super();
    /** @type {ReturnType<typeof resolveOptions>} */
    this.options = resolveOptions(options);
    this.broker = this.options.broker;
    this.topic = this.options.topic;
    this.clientId = this.options.clientId;
    this.qos = this.options.qos;
    this.secret = this.options.secret;
    this.encrypt = this.options.encrypt;

    /** @type {import('mqtt').MqttClient | null} */
    this._client = null;
    this._connected = false;
    this._agentOnline = false;
    /** @type {Map<string, NodeJS.Timeout>} 已发送 msgId -> 去重计时器 */
    this._pendingMessages = new Map();
    /** @type {Map<string, PendingRequest>} */
    this._pendingRequests = new Map();
    /** @type {NodeJS.Timeout | null} */
    this._heartbeatTimer = null;
    /** @type {NodeJS.Timeout | null} */
    this._pongTimer = null;
    /** @type {Error | null} 最近一次连接错误（无 error 监听器时也便于排查） */
    this.lastError = null;
  }

  /** 底层 mqtt 客户端（高级用法；连接前为 null） */
  get mqttClient() {
    return this._client;
  }

  /** 是否已连接并完成订阅 */
  isConnected() {
    return this._connected;
  }

  /** 对端 agent 是否在线（收到 pong） */
  isAgentOnline() {
    return this._agentOnline;
  }

  /**
   * 建立连接。底层会按 reconnectPeriod 持续重试；
   * 该 Promise 在首次连接成功时 resolve，超过 timeout 仍未连接则 reject（但重试继续）。
   * @param {number} [timeout]
   * @returns {Promise<MqttCryptoClient>}
   */
  connect(timeout = this.options.connectTimeout) {
    if (this._connected) return Promise.resolve(this);

    try {
      if (!this._client) this._createClient();
    } catch (error) {
      return Promise.reject(error);
    }

    return new Promise((resolve, reject) => {
      let settled = false;
      /** @param {Error} error */
      const onError = (error) => {
        // 连接阶段的首个错误不立即 reject：底层会自动重试，由超时兜底。
        this.lastError = error;
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this.off('connect', onConnect);
        this.off('error', onError);
        reject(new ConnectTimeoutError(timeout));
      }, timeout);
      // 保持引用：确保 await connect() 在进程退出前能正常结算

      const onConnect = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.off('error', onError);
        resolve(this);
      };

      this.once('connect', onConnect);
      this.on('error', onError);
    });
  }

  /**
   * 断开连接并清理所有计时器与未完成的请求。
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  async disconnect(options = {}) {
    const { force = true } = options;
    this._stopHeartbeat();
    this._clearPendingMessages();
    this._rejectPendingRequests(new NotConnectedError('客户端已断开'));
    this._connected = false;
    this._agentOnline = false;

    const client = this._client;
    this._client = null;
    if (!client) {
      this._emitStatus();
      return;
    }

    await /** @type {Promise<void>} */ (new Promise((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      // 防御：end 回调在个别 broker 异常时不触发
      const guard = setTimeout(done, 1000);
      guard.unref?.();
      try {
        client.end(force, {}, done);
      } catch {
        done();
      }
    }));

    client.removeAllListeners();
    this._emitStatus();
  }

  /**
   * 订阅 topic（默认使用配置中的 topic）。
   * @param {string} [topic]
   * @param {{ qos?: number }} [options]
   * @returns {Promise<unknown>}
   */
  async subscribe(topic = this.topic, options = {}) {
    const qos = options.qos ?? this.qos;
    const client = this._client;
    if (!client || !this._connected) throw new NotConnectedError();
    return new Promise((resolve, reject) => {
      client.subscribe(topic, { qos }, (error, granted) => {
        if (error) reject(error);
        else resolve(granted);
      });
    });
  }

  /**
   * 发布一个信封（自动补齐 id/user/time/msgId，并按配置加密）。
   * @param {Record<string, any>} envelope
   * @param {{ qos?: number, track?: boolean }} [options]
   * @returns {Promise<string>} msgId
   */
  async publish(envelope, options = {}) {
    const client = this._requireConnected();
    const { qos = this.qos, track = true } = options;
    const built = this._completeEnvelope(envelope);
    const payload = this._encode(built);

    if (track) this._trackMessage(built.msgId);

    await new Promise((resolve, reject) => {
      client.publish(this.topic, payload, { qos }, (error) => {
        if (error) {
          if (track) this._untrackMessage(built.msgId);
          this._emitError(error);
          reject(error);
          return;
        }
        resolve(undefined);
      });
    });

    return built.msgId;
  }

  /**
   * 发送命令：msg = JSON.stringify({ action, data })。
   * @param {string} action
   * @param {Record<string, any>} [data]
   * @param {{ qos?: number, msgId?: string, track?: boolean }} [options]
   * @returns {Promise<string>} msgId
   */
  async sendCommand(action, data = {}, options = {}) {
    if (typeof action !== 'string' || action.length === 0) {
      throw new TypeError('action 必须是非空字符串');
    }
    const { qos = this.qos, msgId, track = true } = options;
    return this.publish(
      buildEnvelope({
        id: this.clientId,
        user: this.options.user,
        userSuffix: this.options.userSuffix,
        msg: JSON.stringify({ action, data }),
        msgId,
      }),
      { qos, track },
    );
  }

  /**
   * 回复请求：回显请求的 msgId（原实现的 msgId 关联规则）。
   * @param {Record<string, any>} requestEnvelope 请求信封（也可以是 JSON 字符串）
   * @param {string} action
   * @param {Record<string, any>} [data]
   * @param {{ qos?: number, track?: boolean }} [options]
   * @returns {Promise<string>} msgId
   */
  async reply(requestEnvelope, action, data = {}, options = {}) {
    const request = this._normalizeEnvelopeInput(requestEnvelope);
    const msgId = request.msgId;
    const { qos = this.qos, track = Boolean(msgId) } = options;

    return this.publish(
      buildEnvelope({
        id: this.clientId,
        user: this.options.user,
        userSuffix: this.options.userSuffix,
        msg: JSON.stringify({ action, data }),
        msgId,
      }),
      { qos, track },
    );
  }

  /**
   * 发送命令并等待同 msgId 的响应（响应超时 reject）。
   * 用于取价等"请求-响应"场景，原脚本按 msgId 配对。
   * @param {string} action
   * @param {Record<string, any>} [data]
   * @param {{ qos?: number, timeout?: number }} [options]
   * @returns {Promise<IncomingMessage>}
   */
  async request(action, data = {}, options = {}) {
    this._requireConnected();
    const { qos = this.qos, timeout = this.options.requestTimeout } = options;
    const msgId = generateMsgId();

    /** @type {Promise<IncomingMessage>} */
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingRequests.delete(msgId);
        reject(new RequestTimeoutError(msgId, timeout));
      }, timeout);
      this._pendingRequests.set(msgId, { resolve, reject, timer });
    });

    try {
      await this.publish(
        buildEnvelope({
          id: this.clientId,
          user: this.options.user,
          userSuffix: this.options.userSuffix,
          msg: JSON.stringify({ action, data }),
          msgId,
        }),
        { qos, track: false },
      );
    } catch (error) {
      const pending = this._pendingRequests.get(msgId);
      if (pending) {
        clearTimeout(pending.timer);
        this._pendingRequests.delete(msgId);
      }
      throw error;
    }

    return response;
  }

  // ==================== 内部实现 ====================

  /** @returns {import('mqtt').MqttClient} */
  _createClient() {
    const client = mqtt.connect(this.broker, buildMqttOptions(this.options));
    this._client = client;

    client.on('connect', () => this._handleConnect());
    client.on('reconnect', () => this._handleReconnect());
    client.on('close', () => this._handleClose());
    client.on('offline', () => this._handleOffline());
    client.on('error', (error) => {
      this.lastError = error;
      this._emitError(error);
    });

    return client;
  }

  _handleConnect() {
    this._connected = true;
    this._emitStatus();
    this.emit('connect');
    this.subscribe(this.topic, { qos: this.qos }).catch((error) => this._emitError(error));
    this._startHeartbeat();
  }

  _handleReconnect() {
    this._connected = false;
    this._agentOnline = false;
    this._stopHeartbeat();
    this._emitStatus();
    this.emit('reconnect');
  }

  _handleClose() {
    this._connected = false;
    this._agentOnline = false;
    this._stopHeartbeat();
    this._emitStatus();
    this.emit('close');
  }

  _handleOffline() {
    this._connected = false;
    this._emitStatus();
    this.emit('offline');
  }

  /**
   * @param {string} topic
   * @param {Buffer} payload
   */
  _handleMessage(topic, payload) {
    const text = payload.toString();
    const decoded = decodeIncoming(text, this.secret);

    /** @type {ReturnType<typeof parseEnvelope>} */
    let parsed;
    try {
      parsed = parseEnvelope(decoded.text);
    } catch (error) {
      this._emitMessageError(/** @type {Error} */ (error));
      return;
    }

    const { data, command, commandError } = parsed;

    // 1. 忽略自己发的消息（支持 clientId 后缀）
    if (isOwnMessage(data, this.clientId)) return;

    // 2. 心跳
    if (data.msg === 'ping') {
      this._sendPong();
      return;
    }
    if (data.msg === 'pong') {
      this._agentOnline = true;
      this._clearPongTimer();
      this.emit('agentStatus', true);
      return;
    }

    // 3. 命令 JSON 解析失败
    if (commandError) {
      this._emitMessageError(commandError);
      return;
    }

    // 4. 响应消息：先配对 request()，再从普通 message 事件中过滤
    if (isResponseCommand(command)) {
      this._resolveRequest(data.msgId, { command, envelope: data, topic });
      this.emit('response', { command, envelope: data, topic });
      return;
    }

    // 5. 去重（原实现：已发送 msgId 在 5s 内再次出现则忽略）
    if (typeof data.msgId === 'string' && this._pendingMessages.has(data.msgId)) return;

    this.emit('message', {
      command,
      envelope: data,
      topic,
      decrypted: decoded.decrypted,
    });
  }

  /**
   * @param {Record<string, any>} envelope
   * @returns {{ id: string, msgId: string, user: string, msg: string, time: number }}
   */
  _completeEnvelope(envelope) {
    if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
      throw new TypeError('envelope 必须是对象');
    }
    return buildEnvelope({
      id: /** @type {string} */ (envelope.id ?? this.clientId),
      user: /** @type {string} */ (envelope.user ?? this.options.user),
      userSuffix: /** @type {string} */ (envelope.userSuffix ?? this.options.userSuffix),
      msg: envelope.msg,
      msgId: /** @type {string | undefined} */ (envelope.msgId),
      time: /** @type {number | undefined} */ (envelope.time),
    });
  }

  /**
   * @param {{ id: string, msgId: string, user: string, msg: string, time: number }} envelope
   * @returns {string}
   */
  _encode(envelope) {
    const json = JSON.stringify(envelope);
    return this.encrypt ? encryptPayload(json, this.secret) : json;
  }

  /** @param {unknown} input @returns {Record<string, any>} */
  _normalizeEnvelopeInput(input) {
    if (typeof input === 'string') {
      return parseEnvelope(input).data;
    }
    if (!input || typeof input !== 'object') {
      throw new TypeError('requestEnvelope 必须是对象或 JSON 字符串');
    }
    return /** @type {Record<string, any>} */ (input);
  }

  /** @returns {import('mqtt').MqttClient} */
  _requireConnected() {
    if (!this._connected || !this._client) throw new NotConnectedError();
    return this._client;
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    if (!this._connected) return;

    this._sendPing();
    const interval = this.options.heartbeatInterval;
    if (interval > 0) {
      this._heartbeatTimer = setInterval(() => this._sendPing(), interval);
      this._heartbeatTimer.unref?.();
    }
  }

  _stopHeartbeat() {
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._clearPongTimer();
  }

  _clearPongTimer() {
    if (this._pongTimer) {
      clearTimeout(this._pongTimer);
      this._pongTimer = null;
    }
  }

  _sendPing() {
    if (!this._connected) return;
    this.publish(
      buildEnvelope({
        id: this.clientId,
        user: this.options.user,
        userSuffix: this.options.userSuffix,
        msg: 'ping',
        msgId: generateMsgId({ suffix: 'ping' }),
      }),
      { track: false },
    ).catch((error) => this._emitError(error));

    // 原实现的 5s pong 计时器实际是空回调；这里默认不判定离线（pongTimeout=0）。
    if (this.options.pongTimeout > 0) {
      this._clearPongTimer();
      this._pongTimer = setTimeout(() => {
        this._agentOnline = false;
        this.emit('agentStatus', false);
      }, this.options.pongTimeout);
      this._pongTimer.unref?.();
    }
  }

  _sendPong() {
    if (!this._connected) return;
    this.publish(
      buildEnvelope({
        id: this.clientId,
        user: this.options.user,
        userSuffix: this.options.userSuffix,
        msg: 'pong',
        msgId: generateMsgId({ suffix: 'pong' }),
      }),
      { track: false },
    ).catch((error) => this._emitError(error));
  }

  /** @param {string} msgId */
  _trackMessage(msgId) {
    if (this.options.dedupeTtl <= 0) return;
    this._untrackMessage(msgId);
    const timer = setTimeout(() => {
      this._pendingMessages.delete(msgId);
    }, this.options.dedupeTtl);
    timer.unref?.();
    this._pendingMessages.set(msgId, timer);
  }

  /** @param {string} msgId */
  _untrackMessage(msgId) {
    const timer = this._pendingMessages.get(msgId);
    if (timer) {
      clearTimeout(timer);
      this._pendingMessages.delete(msgId);
    }
  }

  _clearPendingMessages() {
    for (const timer of this._pendingMessages.values()) clearTimeout(timer);
    this._pendingMessages.clear();
  }

  /**
   * @param {string | undefined} msgId
   * @param {IncomingMessage} value
   * @returns {boolean}
   */
  _resolveRequest(msgId, value) {
    if (typeof msgId !== 'string') return false;
    const pending = this._pendingRequests.get(msgId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this._pendingRequests.delete(msgId);
    pending.resolve(value);
    return true;
  }

  /** @param {Error} error */
  _rejectPendingRequests(error) {
    for (const pending of this._pendingRequests.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this._pendingRequests.clear();
  }

  /** @param {Error} error */
  _emitError(error) {
    this.lastError = error;
    if (this.listenerCount('error') > 0) this.emit('error', error);
  }

  /** @param {Error} error */
  _emitMessageError(error) {
    if (this.listenerCount('messageError') > 0) this.emit('messageError', error);
  }

  _emitStatus() {
    this.emit('status', { connected: this._connected, agentOnline: this._agentOnline });
  }
}

/**
 * @param {Parameters<typeof resolveOptions>[0]} [options]
 * @returns {MqttCryptoClient}
 */
export function createClient(options = {}) {
  return new MqttCryptoClient(options);
}

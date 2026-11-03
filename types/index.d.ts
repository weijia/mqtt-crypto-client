/**
 * mqtt-crypto-client 类型声明。
 * 运行时实现位于 src/，构建后的 CommonJS 产物位于 dist/index.cjs。
 */
import { EventEmitter } from 'node:events';

export interface MqttOptions {
  broker?: string;
  topic?: string;
  /** AES 口令（对应原实现的 server.password） */
  secret?: string;
  /** 是否加密出站消息，默认 true */
  encrypt?: boolean;
  /** 指定基础 clientId；缺省用 clientIdPrefix + 随机后缀生成 */
  clientId?: string;
  clientIdPrefix?: string;
  /** 追加到 clientId 末尾（原实现用于区分服务器，如 `_default`） */
  clientIdSuffix?: string;
  /** 信封 user 前缀，默认 `fangzheng-agent` */
  user?: string;
  userSuffix?: string;
  qos?: 0 | 1 | 2;
  reconnectPeriod?: number;
  connectTimeout?: number;
  clean?: boolean;
  resubscribe?: boolean;
  heartbeatInterval?: number;
  /** > 0 时，超过该毫秒数未收到 pong 会触发 agentStatus=false；默认 0（不判定） */
  pongTimeout?: number;
  dedupeTtl?: number;
  requestTimeout?: number;
  auth?: { username?: string; password?: string } | null;
  protocolVersion?: 4 | 5;
}

export interface Envelope {
  id: string;
  msgId: string;
  user: string;
  msg: string;
  time: number;
}

export interface EnvelopeInput {
  id?: string;
  msg: string | Record<string, unknown>;
  user?: string;
  userSuffix?: string;
  msgId?: string;
  time?: number;
}

export interface ParsedEnvelope {
  data: Record<string, any>;
  command: Record<string, any> | null;
  commandError: Error | null;
}

export interface IncomingMessage {
  command: Record<string, any> | null;
  envelope: Record<string, any>;
  topic: string;
}

export interface MessageEvent extends IncomingMessage {
  decrypted: boolean;
}

export interface ClientStatus {
  connected: boolean;
  agentOnline: boolean;
}

export declare class MqttCryptoClient extends EventEmitter {
  constructor(options?: MqttOptions);

  readonly options: Readonly<Required<Omit<MqttOptions, 'auth' | 'protocolVersion'>> & {
    auth: { username?: string; password?: string } | null;
    protocolVersion?: 4 | 5;
  }>;
  readonly broker: string;
  readonly topic: string;
  readonly clientId: string;
  readonly qos: number;
  readonly secret: string;
  readonly encrypt: boolean;
  readonly lastError: Error | null;

  readonly mqttClient: import('mqtt').MqttClient | null;

  isConnected(): boolean;
  isAgentOnline(): boolean;

  connect(timeout?: number): Promise<MqttCryptoClient>;
  disconnect(options?: { force?: boolean }): Promise<void>;
  subscribe(topic?: string, options?: { qos?: number }): Promise<unknown>;

  publish(envelope: Record<string, any>, options?: { qos?: number; track?: boolean }): Promise<string>;
  sendCommand(action: string, data?: Record<string, any>, options?: {
    qos?: number;
    msgId?: string;
    track?: boolean;
  }): Promise<string>;
  reply(requestEnvelope: Record<string, any> | string, action: string, data?: Record<string, any>, options?: {
    qos?: number;
    track?: boolean;
  }): Promise<string>;
  request(action: string, data?: Record<string, any>, options?: {
    qos?: number;
    timeout?: number;
  }): Promise<IncomingMessage>;

  on(event: 'connect' | 'reconnect' | 'close' | 'offline', listener: () => void): this;
  on(event: 'error' | 'messageError', listener: (error: Error) => void): this;
  on(event: 'message', listener: (message: MessageEvent) => void): this;
  on(event: 'response', listener: (message: IncomingMessage) => void): this;
  on(event: 'agentStatus', listener: (online: boolean) => void): this;
  on(event: 'status', listener: (status: ClientStatus) => void): this;
  on(event: string | symbol, listener: (...args: any[]) => void): this;
}

export declare function createClient(options?: MqttOptions): MqttCryptoClient;

/** 默认值合并并校验；非法配置会抛出 InvalidConfigError */
export declare function resolveOptions(input?: MqttOptions): Readonly<Record<string, any>>;
/** 生成 mqtt.connect 的 options（clientId、reconnectPeriod、connectTimeout、clean、auth 等） */
export declare function buildMqttOptions(options: Record<string, any>): Record<string, any>;

export declare const DEFAULT_OPTIONS: Readonly<{
  broker: string;
  topic: string;
  secret: string;
  encrypt: boolean;
  clientId: string;
  clientIdPrefix: string;
  clientIdSuffix: string;
  user: string;
  userSuffix: string;
  qos: number;
  reconnectPeriod: number;
  connectTimeout: number;
  clean: boolean;
  resubscribe: boolean;
  heartbeatInterval: number;
  pongTimeout: number;
  dedupeTtl: number;
  requestTimeout: number;
  auth: null;
  protocolVersion: undefined;
}>;

export declare const DEFAULT_TOPIC = 'secure/stock-condition-order';
export declare const PRESET_BROKERS: readonly string[];
export declare const DEFAULT_USER = 'fangzheng-agent';
export declare const DEFAULT_CLIENT_ID_PREFIX = 'vue_';

export declare function validateTopic(topic: string, options?: { allowWildcards?: boolean }): string;
export declare function buildTopic(...segments: string[]): string;

export declare function createClientId(prefix?: string, random?: () => number): string;
export declare function generateMsgId(options?: {
  now?: number;
  suffix?: string;
  random?: () => number;
}): string;
export declare function buildEnvelope(input: EnvelopeInput): Envelope;
export declare function parseEnvelope(input: string | Record<string, any>): ParsedEnvelope;
export declare function isOwnMessage(data: { id?: unknown } | null | undefined, clientId: string): boolean;
export declare function isResponseCommand(command: Record<string, any> | null | undefined): boolean;

export declare function encryptPayload(
  plaintext: string,
  secret: string,
  options?: { saltLength?: number; salt?: Uint8Array },
): string;
export declare function decryptPayload(ciphertext: string, secret: string): string;
export declare function tryDecrypt(ciphertext: string, secret: string): string | null;
export declare function isEncryptedPayload(value: string): boolean;
/** Node 返回 Buffer；浏览器 IIFE 返回 Uint8Array（均兼容 Uint8Array 操作） */
export declare function deriveKeyAndIv(secret: string, salt: Uint8Array, keyLength?: number, ivLength?: number): {
  key: Uint8Array;
  iv: Uint8Array;
};

export declare function decodeIncoming(text: string, secret?: string): {
  text: string;
  decrypted: boolean;
};

export declare class MqttCryptoError extends Error {
  constructor(message: string, code?: string, cause?: Error);
  code: string;
}
export declare class InvalidConfigError extends MqttCryptoError {}
export declare class NotConnectedError extends MqttCryptoError {}
export declare class RequestTimeoutError extends MqttCryptoError {
  msgId: string;
  timeout: number;
}
export declare class ConnectTimeoutError extends MqttCryptoError {
  timeout: number;
}
export declare class TopicError extends MqttCryptoError {}
export declare class CryptoError extends MqttCryptoError {}
export declare class EnvelopeError extends MqttCryptoError {}

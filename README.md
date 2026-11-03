# mqtt-crypto-client

[![npm version](https://img.shields.io/npm/v/mqtt-crypto-client.svg)](https://www.npmjs.com/package/mqtt-crypto-client)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org/)

从 `vue-dialog-userscript` 中抽取的 **MQTT over WebSocket + AES 信封加密** 客户端。保留原脚本的真实协议行为：`{ id, msgId, user, msg, time }` 信封、CryptoJS 兼容的 AES 口令加密、QoS 1、30s 心跳、`ping/pong`、5s 去重、忽略自身消息、请求/响应按 `msgId` 配对。

- 仓库：<https://github.com/weijia/mqtt-crypto-client>
- 包名：`mqtt-crypto-client`
- 运行时：Node.js **18+**（CI 发布使用 Node 24）
- 依赖：仅 [`mqtt`](https://www.npmjs.com/package/mqtt)；加解密使用内置 `node:crypto`

## 安装

```bash
npm install mqtt-crypto-client
```

ESM 与 CommonJS 均可用：

```js
// ESM
import { createClient } from 'mqtt-crypto-client';

// CommonJS（构建产物 dist/index.cjs）
const { createClient } = require('mqtt-crypto-client');
```

> ESM 源码直接作为 `import` 入口发布；CJS 由 `esbuild` 打包为单文件 `dist/index.cjs`。发布前 `prepack`/`prepublishOnly` 会自动构建。

## 快速开始

```js
import { createClient, PRESET_BROKERS, DEFAULT_TOPIC } from 'mqtt-crypto-client';

const client = createClient({
  broker: process.env.MQTT_BROKER ?? PRESET_BROKERS[0], // wss://broker.emqx.io:8084/mqtt
  topic: process.env.MQTT_TOPIC ?? DEFAULT_TOPIC,        // secure/stock-condition-order
  secret: process.env.MQTT_AES_SECRET,                   // 对应原实现的 server.password
  encrypt: true,
  user: 'fangzheng-agent',
});

client.on('error', (error) => console.error('MQTT error:', error.message));
client.on('connect', () => console.log('已连接，clientId =', client.clientId));
client.on('agentStatus', (online) => console.log('对端在线:', online));

client.on('message', async ({ envelope, command, decrypted }) => {
  console.log('收到', command?.action, '解密:', decrypted, 'msgId:', envelope.msgId);

  if (command?.action === 'list') {
    // 回显请求 msgId（原实现的消息关联规则）
    await client.reply(envelope, 'response', { status: 'success', data: { items: [] } });
  }
});

await client.connect();               // 首次连接成功 / 超时 reject
await client.sendCommand('list');     // => Promise<msgId>
// await client.disconnect();
```

完整示例见 [`examples/basic.js`](./examples/basic.js) 与 [`examples/request-response.js`](./examples/request-response.js)。

## API

### 客户端

| API | 说明 |
| --- | --- |
| `createClient(options)` | 创建 `MqttCryptoClient`（`EventEmitter`） |
| `client.connect(timeout?)` | 连接并订阅；首次连接成功 resolve。超过 `timeout` reject `CONNECT_TIMEOUT`，但底层仍按 `reconnectPeriod` 重试 |
| `client.disconnect({ force })` | 断开、清理计时器并 reject 未完成的请求 |
| `client.subscribe(topic?, { qos })` | 订阅（默认配置 topic），`Promise<granted>` |
| `client.publish(envelope, { qos, track })` | 发布信封（自动补 `id/user/time/msgId`、按配置加密），`Promise<msgId>` |
| `client.sendCommand(action, data?, { qos, msgId, track })` | 发送 `{ action, data }` 命令，`Promise<msgId>` |
| `client.request(action, data?, { timeout, qos })` | 发送并按 `msgId` 等待响应，`Promise<{ command, envelope, topic }>`；超时 reject `REQUEST_TIMEOUT` |
| `client.reply(requestEnvelope, action, data?)` | 回复并回显请求的 `msgId`，`Promise<msgId>` |
| `client.isConnected()` / `client.isAgentOnline()` | 连接状态 / 是否收到过 `pong` |
| `client.mqttClient` | 底层 `mqtt.MqttClient`（高级用法） |

### 事件

| 事件 | 参数 | 说明 |
| --- | --- | --- |
| `connect` | 无 | 连接成功（已发起订阅） |
| `reconnect` / `close` / `offline` | 无 | 底层连接状态 |
| `error` | `Error` | 连接/发布错误；无监听器时不会抛出，可读 `client.lastError` |
| `message` | `{ envelope, command, topic, decrypted }` | 普通消息；响应类消息不会进入此事件 |
| `response` | `{ envelope, command, topic }` | 响应消息（`action === 'response'` 或只有 `type`） |
| `agentStatus` | `boolean` | 收到 `pong` → `true`；`pongTimeout > 0` 且超时 → `false` |
| `status` | `{ connected, agentOnline }` | 状态变化 |
| `messageError` | `Error` | 信封或命令 JSON 解析失败 |

### 工具函数

| 导出 | 说明 |
| --- | --- |
| `encryptPayload(plaintext, secret, { saltLength, salt }?)` | CryptoJS/OpenSSL 兼容的 AES 加密，返回 base64 |
| `decryptPayload(ciphertext, secret)` | 严格解密，失败抛 `CryptoError` |
| `tryDecrypt(ciphertext, secret)` | 宽松解密，失败返回 `null` |
| `isEncryptedPayload(text)` | 是否 `Salted__` base64 密文 |
| `buildEnvelope(input)` / `parseEnvelope(input)` | 信封构造/解析 |
| `buildTopic(...segments)` / `validateTopic(topic, { allowWildcards }?)` | topic 构造/校验 |
| `createClientId(prefix?)` / `generateMsgId({ now, suffix }?)` | ID 生成 |
| `buildMqttOptions(resolvedOptions)` | 底层 `mqtt.connect` 参数拼装 |
| `DEFAULT_TOPIC` / `PRESET_BROKERS` / `DEFAULT_OPTIONS` | 常量 |

错误类：`MqttCryptoError` 及子类 `InvalidConfigError`、`NotConnectedError`、`RequestTimeoutError`、`ConnectTimeoutError`、`TopicError`、`CryptoError`、`EnvelopeError`，均带稳定 `error.code`。

## 配置项

| 选项 | 默认值 | 说明 |
| --- | --- | --- |
| `broker` | `wss://broker.emqx.io:8084/mqtt` | 支持 `ws/wss/mqtt/mqtts/tcp/tls` |
| `topic` | `secure/stock-condition-order` | 单一业务 topic（原实现没有按用户再拼后缀） |
| `secret` | 无（必填） | AES 口令；对应原实现服务器配置里的 `password` |
| `encrypt` | `true` | 仅控制**出站**是否加密；入站始终先尝试解密，失败按明文处理 |
| `clientId` | 自动生成 | 基础 clientId；原实现为 `vue_` + 6 位十六进制 |
| `clientIdPrefix` | `vue_` | 自动生成 clientId 时使用的前缀 |
| `clientIdSuffix` | `''` | 拼到 clientId 末尾；原实现用 `_<serverId>` 区分服务器 |
| `user` / `userSuffix` | `fangzheng-agent` / `''` | 信封 `user = user + userSuffix` |
| `qos` | `1` | 订阅与发布默认 QoS |
| `reconnectPeriod` | `5000` | 自动重连间隔 |
| `connectTimeout` | `30000` | 底层连接超时，同时作为 `connect()` 的默认等待时间 |
| `clean` / `resubscribe` | `true` / `true` | 原实现 `clean: true` |
| `heartbeatInterval` | `30000` | 连接后立即 ping，此后每 30s 一次；`0` 关闭 |
| `pongTimeout` | `0` | `> 0` 时超过该毫秒未收到 pong 触发 `agentStatus=false`；原实现计时器为空回调，故默认关闭 |
| `dedupeTtl` | `5000` | 已发送 `msgId` 的去重保留时间 |
| `requestTimeout` | `5000` | `request()` 默认超时 |
| `auth` | `null` | 可选的 Broker 鉴权 `{ username, password }`；**与 AES `secret` 不同** |
| `protocolVersion` | 不设置 | 可显式指定 4 / 5，默认交给 mqtt |

## 协议契约（来自原实现，非臆造）

### 连接

- Broker 预设：`wss://broker.emqx.io:8084/mqtt`、`wss://test.mosquitto.org:8081/mqtt`、`wss://broker.hivemq.com:8884/mqtt`
- `clientId = 基础 ID + clientIdSuffix`；原 Vue 实现为 `vue_xxxxxx_<serverId>`
- `reconnectPeriod: 5000`、`connectTimeout: 30000`、`clean: true`
- 订阅与发布均 `QoS 1`
- 原实现没有 Broker 用户名/密码/Token；`auth` 是可选扩展

### 信封与命令

```json
{
  "id": "vue_ab12cd",
  "msgId": "1700000000000_1a2b",
  "user": "fangzheng-agent",
  "msg": "{\"action\":\"list\",\"data\":{}}",
  "time": 1700000000000
}
```

- `msg` 是**字符串**；业务命令为 `JSON.stringify({ action, data })`
- 心跳时 `msg` 直接为 `"ping"` / `"pong"`
- 响应：`{ "action": "response", "status": "success|error|partial", "data": ..., "message": ... }`
- 原实现会过滤 `action === 'response'` 或「无 `action` 但有 `type`」的响应消息；本库将其转入 `response` 事件并可被 `request()` 配对
- `id` 用于忽略自己消息：`data.id.startsWith(clientId)`

### 心跳、去重、重试

- 连接成功后立即发送 `ping`，之后每 30s 一次
- 收到 `ping` 回复 `pong`；收到 `pong` 视为对端在线
- 出站 `msgId` 在 5s 内保留；再次收到同 `msgId` 的消息会被忽略（原实现的去重逻辑）
- 底层 `mqtt` 自动重连，间隔 5s；`connect()` 超时不会停止重试

### 加密格式（与 CryptoJS 逐字节兼容）

```
密文 = base64("Salted__" + 8 字节随机 salt + AES-256-CBC 密文)
key/iv = EVP_BytesToKey(MD5, 1 次迭代, secret, salt)，key 32 字节 + IV 16 字节
填充 = PKCS#7
```

已验证双向互通（使用原项目 `crypto-js` 4.2.0）：

```
node -> CryptoJS: OK
CryptoJS -> node: OK
```

## 与原脚本的差异

| 原实现 | 本库 |
| --- | --- |
| 一个实例管理多个 Broker/server | 一个客户端对应一个 Broker；多服务器请创建多个实例（`clientIdSuffix` 区分） |
| 配置存 `localStorage`、WebDAV 环境跳过连接 | 不包含浏览器持久化/环境探测；配置由调用方提供 |
| `pong` 超时计时器为空回调 | 默认 `pongTimeout: 0`（不判定离线），可显式开启 |
| 响应消息直接丢弃 | 新增 `request()` 按 `msgId` 配对；`reply()` 回显请求 `msgId` |

## 安全说明与限制

- 该格式是**口令派生 + AES-CBC**，没有 MAC/AEAD，**不提供完整性或身份认证**；能防旁观者直接读取，不能防篡改、重放或伪造。
- KDF 为 MD5 单轮 `EVP_BytesToKey`，按现代标准偏弱；这里为兼容原协议而保留。
- 默认 Broker 是公共 Broker，任何知道 topic 与口令的人都能收发；请使用**独立且足够随机**的 `secret`，不要把生产密钥写进仓库。
- `encrypt: false` 时仍会尝试解密密文；明文回退是原实现的兼容行为，会降低安全性。
- 不要在本库之上传输高敏感数据而不额外加 MAC/签名或改用 TLS + 认证 Broker。

## 开发与验证

```bash
npm install
npm test          # node:test，36 个用例
npm run typecheck # tsc checkJs
npm run build     # ESM 源码 -> dist/index.cjs
npm pack --dry-run
```

## 发布

本项目使用 npm **Trusted Publishing (OIDC)**，不使用 `NPM_TOKEN`。发布流程与需要在 npmjs 上完成的设置见 [NPM-SETUP.md](./NPM-SETUP.md)。

## License

MIT，见 [LICENSE](./LICENSE)。当前版权主体为占位值（`weijia`），可按需替换。

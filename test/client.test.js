import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { setTimeout as delay } from 'node:timers/promises';
import { EventEmitter } from 'node:events';
import {
  MqttCryptoClient,
  NotConnectedError,
  createClient,
  encryptPayload,
} from '../src/index.js';

/**
 * 轻量 mqtt 客户端替身：同步回调、记录 publish 内容，避免测试依赖网络。
 */
function createFakeMqttClient() {
  const published = [];
  return {
    published,
    /** @type {any} */
    publish(topic, payload, options, callback) {
      published.push({ topic, payload, options });
      if (callback) callback(null);
    },
    subscribe(topic, options, callback) {
      if (callback) callback(null, [{ topic }]);
    },
    end(force, options, callback) {
      if (callback) callback();
    },
    removeAllListeners() {},
  };
}

function attachFake(client) {
  const fake = createFakeMqttClient();
  client._client = fake;
  client._connected = true;
  return fake;
}

test('createClient 返回 EventEmitter 并填充默认配置', () => {
  const client = createClient({ secret: 'pw' });
  assert.ok(client instanceof MqttCryptoClient);
  assert.ok(client instanceof EventEmitter);
  assert.match(client.clientId, /^vue_/);
  assert.equal(client.qos, 1);
  assert.equal(client.isConnected(), false);
  assert.equal(client.isAgentOnline(), false);
  assert.equal(client.mqttClient, null);
});

test('未连接时所有发送类 API 都以 NOT_CONNECTED 拒绝', async () => {
  const client = createClient({ secret: 'pw' });

  await assert.rejects(client.publish({ msg: 'x' }), (error) => error.code === 'NOT_CONNECTED');
  await assert.rejects(client.sendCommand('list'), (error) => error.code === 'NOT_CONNECTED');
  await assert.rejects(client.reply({ msgId: 'm1', msg: 'x' }, 'response'), (error) => error.code === 'NOT_CONNECTED');
  await assert.rejects(client.request('realtime'), (error) => error.code === 'NOT_CONNECTED');
  await assert.rejects(client.subscribe('secure/x'), (error) => error.code === 'NOT_CONNECTED');

  assert.ok(new NotConnectedError() instanceof Error);
  await client.disconnect();
});

test('request() 按 msgId 配对响应并返回命令', async () => {
  const client = createClient({ encrypt: false, requestTimeout: 500 });
  const fake = attachFake(client);

  const pending = client.request('realtime', { code: '600000' }, { timeout: 500 });
  await delay(0);
  assert.equal(fake.published.length, 1);

  const requestEnvelope = JSON.parse(fake.published[0].payload);
  client._handleMessage(
    'secure/test',
    Buffer.from(JSON.stringify({
      id: 'agent_001',
      msgId: requestEnvelope.msgId,
      user: 'founder-agent',
      msg: JSON.stringify({ action: 'response', status: 'success', data: { price: 10.5 } }),
      time: Date.now(),
    })),
  );

  const response = await pending;
  assert.equal(response.envelope.msgId, requestEnvelope.msgId);
  assert.equal(response.command.status, 'success');
  assert.equal(response.command.data.price, 10.5);

  let responseEvent = null;
  client.on('response', (event) => {
    responseEvent = event;
  });
  client._handleMessage(
    'secure/test',
    Buffer.from(JSON.stringify({
      id: 'agent_002',
      msgId: 'other-1',
      msg: JSON.stringify({ action: 'response', status: 'success' }),
      time: Date.now(),
    })),
  );
  assert.equal(responseEvent.command.status, 'success');
});

test('request() 超时以 REQUEST_TIMEOUT 拒绝', async () => {
  const client = createClient({ encrypt: false, requestTimeout: 50 });
  attachFake(client);

  await assert.rejects(
    client.request('realtime', { code: '600000' }, { timeout: 50 }),
    (error) => error.code === 'REQUEST_TIMEOUT' && error.msgId.length > 0,
  );
});

test('reply() 回显请求 msgId，sendCommand() 使用指定 msgId', async () => {
  const client = createClient({ encrypt: false });
  const fake = attachFake(client);

  const repliedId = await client.reply({ msgId: 'req-42' }, 'response', { status: 'success' });
  const replyEnvelope = JSON.parse(fake.published[0].payload);
  assert.equal(repliedId, 'req-42');
  assert.equal(replyEnvelope.msgId, 'req-42');
  assert.deepEqual(JSON.parse(replyEnvelope.msg), { action: 'response', data: { status: 'success' } });

  const sentId = await client.sendCommand('list', {}, { msgId: 'custom-id' });
  assert.equal(sentId, 'custom-id');
  assert.equal(JSON.parse(fake.published[1].payload).msgId, 'custom-id');
});

test('收到的消息：明文回退、密文解密、忽略自己、解析错误', () => {
  const client = createClient({ secret: 'pw', heartbeatInterval: 0, encrypt: true });
  attachFake(client);

  const messages = [];
  const errors = [];
  client.on('message', (message) => messages.push(message));
  client.on('messageError', (error) => errors.push(error));

  const envelope = {
    id: 'agent_001',
    msgId: 'm1',
    user: 'founder-agent',
    msg: JSON.stringify({ action: 'list' }),
    time: 1,
  };

  client._handleMessage('secure/test', Buffer.from(JSON.stringify(envelope)));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].decrypted, false);

  client._handleMessage('secure/test', Buffer.from(encryptPayload(JSON.stringify({ ...envelope, msgId: 'm2' }), 'pw')));
  assert.equal(messages.length, 2);
  assert.equal(messages[1].decrypted, true);

  client._handleMessage('secure/test', Buffer.from(JSON.stringify({ ...envelope, id: `${client.clientId}_default`, msgId: 'm3' })));
  assert.equal(messages.length, 2, '自己的消息应被忽略');

  client._handleMessage('secure/test', Buffer.from('not-json'));
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'INVALID_JSON');
});

test('ping/pong 心跳与 agentStatus', async () => {
  const client = createClient({ encrypt: false, heartbeatInterval: 0 });
  const fake = attachFake(client);

  const statuses = [];
  client.on('agentStatus', (online) => statuses.push(online));

  client._handleMessage(
    'secure/test',
    Buffer.from(JSON.stringify({ id: 'agent_001', msgId: 'p1', msg: 'ping', time: Date.now() })),
  );
  await delay(0);
  const pong = JSON.parse(fake.published.at(-1).payload);
  assert.equal(pong.msg, 'pong');
  assert.match(pong.msgId, /_pong$/);

  client._handleMessage(
    'secure/test',
    Buffer.from(JSON.stringify({ id: 'agent_001', msgId: 'p2', msg: 'pong', time: Date.now() })),
  );
  assert.deepEqual(statuses, [true]);
  assert.equal(client.isAgentOnline(), true);
});

test('发送后的 msgId 在 dedupeTtl 内会忽略同 msgId 的重复消息', async () => {
  const client = createClient({ encrypt: false, dedupeTtl: 5000 });
  const fake = attachFake(client);

  const messages = [];
  client.on('message', (message) => messages.push(message));

  const msgId = await client.sendCommand('list');
  assert.equal(JSON.parse(fake.published[0].payload).msgId, msgId);

  client._handleMessage(
    'secure/test',
    Buffer.from(JSON.stringify({
      id: 'agent_001',
      msgId,
      msg: JSON.stringify({ action: 'list', data: {} }),
      time: Date.now(),
    })),
  );
  assert.equal(messages.length, 0);
});

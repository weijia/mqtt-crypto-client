import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_OPTIONS,
  DEFAULT_TOPIC,
  PRESET_BROKERS,
  buildMqttOptions,
  buildTopic,
  resolveOptions,
  validateTopic,
} from '../src/index.js';

test('buildTopic 拼接层级并复现默认 topic', () => {
  assert.equal(buildTopic('secure', 'stock-condition-order'), DEFAULT_TOPIC);
  assert.equal(buildTopic('secure', 'unihub/online/2026'), 'secure/unihub/online/2026');
});

test('buildTopic 拒绝空片段、首尾斜杠、通配符与空字符', () => {
  assert.throws(() => buildTopic(), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('secure', ''), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('/secure', 'x'), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('secure/', 'x'), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('secure', 'a+'), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('secure', 'a#'), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => buildTopic('secure\u0000', 'x'), (error) => error.code === 'INVALID_TOPIC');
});

test('validateTopic 允许订阅过滤器的通配符（可选项），并限制长度', () => {
  assert.equal(validateTopic('secure/#', { allowWildcards: true }), 'secure/#');
  assert.equal(validateTopic('secure/+', { allowWildcards: true }), 'secure/+');
  assert.throws(() => validateTopic('secure/+'), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => validateTopic('a'.repeat(65536)), (error) => error.code === 'INVALID_TOPIC');
});

test('PRESET_BROKERS 与原实现一致且不可变', () => {
  assert.deepEqual([...PRESET_BROKERS], [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
  ]);
  assert.equal(Object.isFrozen(PRESET_BROKERS), true);
});

test('resolveOptions 填充原实现的默认连接参数', () => {
  const options = resolveOptions({ secret: 'pw' });
  assert.equal(options.broker, DEFAULT_OPTIONS.broker);
  assert.equal(options.topic, DEFAULT_TOPIC);
  assert.equal(options.qos, 1);
  assert.equal(options.reconnectPeriod, 5000);
  assert.equal(options.connectTimeout, 30000);
  assert.equal(options.clean, true);
  assert.equal(options.heartbeatInterval, 30000);
  assert.equal(options.dedupeTtl, 5000);
  assert.equal(options.requestTimeout, 5000);
  assert.match(options.clientId, /^vue_[0-9a-f]{1,6}$/);
});

test('resolveOptions 保留显式 clientId 与后缀', () => {
  const options = resolveOptions({ secret: 'pw', clientId: 'my_client', clientIdSuffix: '_default' });
  assert.equal(options.clientId, 'my_client');
  assert.equal(buildMqttOptions(options).clientId, 'my_client_default');
});

test('resolveOptions 校验 broker / topic / qos / secret', () => {
  assert.throws(() => resolveOptions({ broker: 'https://example.com' }), (error) => error.code === 'INVALID_CONFIG');
  assert.throws(() => resolveOptions({ broker: 'not-a-url' }), (error) => error.code === 'INVALID_CONFIG');
  assert.throws(() => resolveOptions({ secret: 'pw', topic: 'secure/#' }), (error) => error.code === 'INVALID_TOPIC');
  assert.throws(() => resolveOptions({ secret: 'pw', qos: 3 }), (error) => error.code === 'INVALID_CONFIG');
  assert.throws(() => resolveOptions({}), (error) => error.code === 'INVALID_CONFIG');
});

test('buildMqttOptions 仅按需附加鉴权字段', () => {
  const base = buildMqttOptions(resolveOptions({ secret: 'pw' }));
  assert.equal(base.clientId.startsWith('vue_'), true);
  assert.equal(base.reconnectPeriod, 5000);
  assert.equal(base.connectTimeout, 30000);
  assert.equal(base.clean, true);
  assert.equal(base.resubscribe, true);
  assert.equal('username' in base, false);
  assert.equal('password' in base, false);

  const withAuth = buildMqttOptions(resolveOptions({
    secret: 'pw',
    auth: { username: 'u', password: 'broker-pw' },
  }));
  assert.equal(withAuth.username, 'u');
  assert.equal(withAuth.password, 'broker-pw');
  // AES 口令与 broker 密码必须分开，避免混淆
  assert.notEqual(withAuth.password, 'pw');
});

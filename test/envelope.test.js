import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USER,
  EnvelopeError,
  buildEnvelope,
  createClientId,
  generateMsgId,
  isOwnMessage,
  isResponseCommand,
  parseEnvelope,
} from '../src/index.js';

test('buildEnvelope 生成完整字段与默认 user', () => {
  const time = 1700000000000;
  const envelope = buildEnvelope({ id: 'vue_abc123', msg: '{"action":"ping"}', time });
  assert.equal(envelope.id, 'vue_abc123');
  assert.equal(envelope.user, DEFAULT_USER);
  assert.equal(envelope.msg, '{"action":"ping"}');
  assert.equal(envelope.time, time);
  assert.ok(envelope.msgId.startsWith(`${time}_`));
  assert.match(envelope.msgId, /^\d+_[0-9a-f]{1,4}$/);
});

test('userSuffix 追加到 user，对象 msg 自动 JSON.stringify', () => {
  const envelope = buildEnvelope({
    id: 'vue_abc123',
    msg: { action: 'list', data: { provider: 'founder' } },
    userSuffix: '_second',
  });
  assert.equal(envelope.user, `${DEFAULT_USER}_second`);
  assert.deepEqual(JSON.parse(envelope.msg), { action: 'list', data: { provider: 'founder' } });
});

test('指定 msgId 时原样保留（响应回显场景）', () => {
  const envelope = buildEnvelope({ id: 'vue_abc', msg: 'ping', msgId: 'req-1' });
  assert.equal(envelope.msgId, 'req-1');
});

test('buildEnvelope 拒绝非法输入', () => {
  assert.throws(() => buildEnvelope({ id: '', msg: 'x' }), (error) => error.code === 'INVALID_ENVELOPE_ID');
  assert.throws(() => buildEnvelope({ id: 'a', msg: null }), (error) => error.code === 'INVALID_ENVELOPE_MSG');
});

test('generateMsgId 支持后缀且格式稳定', () => {
  assert.equal(generateMsgId({ now: 1, random: () => 0.5 }), '1_8');
  assert.equal(generateMsgId({ now: 1, random: () => 0.5, suffix: 'ping' }), '1_8_ping');
});

test('createClientId 使用前缀 + 随机十六进制', () => {
  const id = createClientId('vue_', () => 0.5);
  assert.match(id, /^vue_[0-9a-f]{1,6}$/);
  assert.ok(id.startsWith('vue_'));
});

test('parseEnvelope 支持字符串/对象与命令解析', () => {
  const data = { id: 'vue_a', msgId: 'm1', user: 'u', msg: '{"action":"list","data":{}}', time: 1 };
  const fromString = parseEnvelope(JSON.stringify(data));
  assert.deepEqual(fromString.data, data);
  assert.deepEqual(fromString.command, { action: 'list', data: {} });
  assert.equal(fromString.commandError, null);

  const fromObject = parseEnvelope({ ...data, msg: { action: 'stop' } });
  assert.deepEqual(fromObject.command, { action: 'stop' });
});

test('parseEnvelope 对 ping/pong 不产生命令', () => {
  assert.equal(parseEnvelope({ msg: 'ping' }).command, null);
  assert.equal(parseEnvelope({ msg: 'pong' }).command, null);
});

test('parseEnvelope 错误路径带稳定错误码', () => {
  assert.throws(
    () => parseEnvelope('{bad json'),
    (error) => error instanceof EnvelopeError && error.code === 'INVALID_JSON',
  );
  assert.throws(() => parseEnvelope('[]'), (error) => error.code === 'INVALID_ENVELOPE');
  const parsed = parseEnvelope({ msg: 'not-json' });
  assert.equal(parsed.command, null);
  assert.equal(parsed.commandError?.code, 'INVALID_COMMAND_JSON');
});

test('isOwnMessage 按 clientId 前缀匹配（含服务器后缀）', () => {
  assert.equal(isOwnMessage({ id: 'vue_abc_default' }, 'vue_abc'), true);
  assert.equal(isOwnMessage({ id: 'mq_abc' }, 'vue_abc'), false);
  assert.equal(isOwnMessage({}, 'vue_abc'), false);
  assert.equal(isOwnMessage(null, 'vue_abc'), false);
});

test('isResponseCommand 识别 response 与 type-only 响应', () => {
  assert.equal(isResponseCommand({ action: 'response' }), true);
  assert.equal(isResponseCommand({ type: 'order_list' }), true);
  assert.equal(isResponseCommand({ action: 'list', data: {} }), false);
  assert.equal(isResponseCommand(null), false);
});

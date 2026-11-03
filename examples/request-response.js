/**
 * 请求/响应示例：发送 realtime 命令并按 msgId 等待响应，超时后报错。
 *
 * 运行：
 *   MQTT_AES_SECRET=your-secret node examples/request-response.js
 *
 * 该示例需要 topic 上有另一个 agent 按协议回复 { action: 'response', status, data }。
 */
import { createClient, DEFAULT_TOPIC, PRESET_BROKERS } from '../src/index.js';

const secret = process.env.MQTT_AES_SECRET;
if (!secret) {
  console.error('请设置 MQTT_AES_SECRET 环境变量（AES 口令）');
  process.exit(1);
}

const client = createClient({
  broker: process.env.MQTT_BROKER ?? PRESET_BROKERS[0],
  topic: process.env.MQTT_TOPIC ?? DEFAULT_TOPIC,
  secret,
  encrypt: true,
  requestTimeout: 5000,
});

client.on('error', (error) => console.error('[error]', error.code ?? '', error.message));

await client.connect();

try {
  const { command, envelope } = await client.request(
    'realtime',
    { code: '600000' },
    { timeout: 5000 },
  );
  console.log('收到响应 msgId =', envelope.msgId);
  console.log('status =', command.status);
  console.log('data =', command.data);
} catch (error) {
  if (error.code === 'REQUEST_TIMEOUT') {
    console.error('等待响应超时，msgId =', error.msgId);
  } else {
    console.error('请求失败:', error);
  }
} finally {
  await client.disconnect();
}

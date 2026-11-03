/**
 * 基础示例：连接、订阅、回复 list 命令、优雅退出。
 *
 * 运行：
 *   MQTT_AES_SECRET=your-secret node examples/basic.js
 *
 * 发布到 npm 后把导入路径换成 'mqtt-crypto-client'。
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
  user: process.env.MQTT_USER ?? 'fangzheng-agent',
});

client.on('error', (error) => console.error('[error]', error.code ?? '', error.message));
client.on('status', (status) => console.log('[status]', status));
client.on('agentStatus', (online) => console.log('[agent]', online ? 'online' : 'offline'));

client.on('message', async ({ envelope, command, decrypted, topic }) => {
  console.log('[message]', topic, 'decrypted=', decrypted, 'action=', command?.action, 'msgId=', envelope.msgId);

  if (command?.action === 'list') {
    try {
      await client.reply(envelope, 'response', { status: 'success', data: { items: ['demo'] } });
      console.log('[reply] 已回复', envelope.msgId);
    } catch (error) {
      console.error('[reply failed]', error.message);
    }
  }
});

await client.connect();
console.log('已连接，clientId =', client.clientId, 'topic =', client.topic);

const msgId = await client.sendCommand('list', { page: 1 });
console.log('已发送 list，msgId =', msgId);

process.on('SIGINT', async () => {
  console.log('\n正在断开...');
  await client.disconnect();
  process.exit(0);
});

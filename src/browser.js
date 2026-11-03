/**
 * 浏览器 IIFE 构建入口。
 *
 * 通过 esbuild 的 alias 插件把 `./crypto.js` 替换为 `./crypto-browser.js`，
 * 把 `node:events` 替换为本地 shim；对外的导出集合与 Node 入口保持一致。
 * 构建产物：dist/index.iife.js，全局名 `MqttCryptoClient`。
 */
export * from './index.js';

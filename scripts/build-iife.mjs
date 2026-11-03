/**
 * 浏览器 IIFE 构建：dist/index.iife.js，全局名 MqttCryptoClient。
 *
 * - 将 `./crypto.js`（依赖 node:crypto）替换为 `./crypto-browser.js`（crypto-js）
 * - 将 `node:events` 替换为本地 EventEmitter shim
 * - mqtt 使用其 browser 导出
 */
import path from 'node:path';
import { build } from 'esbuild';

const root = path.resolve('.');

/** @type {import('esbuild').Plugin} */
const browserCryptoPlugin = {
  name: 'browser-crypto',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^\.\/crypto\.js$/ }, () => ({
      path: path.join(root, 'src/crypto-browser.js'),
    }));
  },
};

/** @type {import('esbuild').Plugin} */
const browserEventsPlugin = {
  name: 'browser-events',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^node:events$/ }, () => ({
      path: path.join(root, 'src/events-browser.js'),
    }));
  },
};

await build({
  absWorkingDir: root,
  entryPoints: ['src/browser.js'],
  outfile: 'dist/index.iife.js',
  bundle: true,
  platform: 'browser',
  target: ['es2020'],
  format: 'iife',
  globalName: 'MqttCryptoClient',
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  define: { global: 'globalThis' },
  plugins: [browserCryptoPlugin, browserEventsPlugin],
  logLevel: 'info',
});

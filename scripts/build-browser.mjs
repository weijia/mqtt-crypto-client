/**
 * 浏览器产物构建：
 *
 * - `dist/index.iife.js`：`<script>` 直引，全局名 `MqttCryptoClient`
 * - `dist/index.browser.js`：供 bundler 使用的 ESM（package.json `browser` 条件指向它）
 *
 * 两者共用同一套构建期替换：
 * - `./crypto.js`（node:crypto）→ `./crypto-browser.js`（crypto-js）
 * - `node:events` → 本地 EventEmitter shim
 * - mqtt 走其 browser 导出
 * - `process.env.*` / `global` 等由 define 静态消除，裸 `process` 由内联 shim 兜底
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

/** @type {import('esbuild').BuildOptions} */
const sharedOptions = {
  absWorkingDir: root,
  entryPoints: ['src/browser.js'],
  bundle: true,
  platform: 'browser',
  target: ['es2020'],
  mainFields: ['browser', 'module', 'main'],
  conditions: ['browser'],
  minify: true,
  sourcemap: true,
  legalComments: 'none',
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    'process.browser': 'true',
    'process.platform': '"browser"',
    'process.version': '"0.0.0"',
  },
  inject: [path.join(root, 'src/process-browser.js')],
  plugins: [browserCryptoPlugin, browserEventsPlugin],
  logLevel: 'info',
};

await build({
  ...sharedOptions,
  format: 'iife',
  globalName: 'MqttCryptoClient',
  outfile: 'dist/index.iife.js',
});

await build({
  ...sharedOptions,
  format: 'esm',
  outfile: 'dist/index.browser.js',
});

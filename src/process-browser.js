/**
 * 仅用于浏览器 IIFE 的 process 兜底（通过 esbuild `inject` 注入）。
 * Node/ESM/CJS 构建不会包含本文件。
 *
 * 优先由构建期 define 消除 `process.env.*` 等引用；本 shim 只处理无法静态消除的裸 `process`。
 */
const env = Object.freeze({ NODE_ENV: 'production' });

/**
 * @param {Function} callback
 * @param {...any} args
 */
function nextTick(callback, ...args) {
  queueMicrotask(() => callback(...args));
}

export const process = Object.freeze({
  env,
  browser: true,
  version: '0.0.0',
  platform: 'browser',
  nextTick,
});

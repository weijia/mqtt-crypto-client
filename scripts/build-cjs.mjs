/**
 * 将 ESM 源码打包为 CommonJS 单文件（dist/index.cjs），供 `require()` 使用。
 * mqtt 保持 external，避免把体积较大的依赖打进产物。
 */
import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.js'],
  outfile: 'dist/index.cjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  external: ['mqtt'],
  banner: { js: "'use strict';" },
  logLevel: 'info',
});

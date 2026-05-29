import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/worker.ts'],
  format: ['esm'],
  target: 'es2022',
  outDir: 'dist',
  clean: true,
  // workspace 内的 shared 包内联进 bundle，避免运行时找不到
  noExternal: ['shared'],
  // 其余依赖保持外部，由 node_modules 提供
  splitting: true,
  sourcemap: false,
  dts: false,
});

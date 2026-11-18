import { defineConfig } from 'vitest/config';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const packagesDir = join(rootDir, 'packages');
const appsDir = join(rootDir, 'apps');

// Vitest 无法稳定解析 workspace 符号链接下的 subpath exports，因此内部包的
// subpath 先显式别名到源码文件。subpath 必须排在 bare 包别名之前：别名匹配是前缀式，
// 否则 `@agent-ops/blueprint` 会把 `@agent-ops/blueprint/workspace` 重写成一个不存在的目录相对路径。
const subpaths: Array<{ find: string; replacement: string }> = [
  { find: '@agent-ops/blueprint/client', replacement: join(packagesDir, 'blueprint', 'src', 'client.ts') },
  { find: '@agent-ops/blueprint/workspace', replacement: join(packagesDir, 'blueprint', 'src', 'workspace.ts') },
  { find: '@agent-ops/policy/confirmations', replacement: join(packagesDir, 'policy', 'src', 'confirmations.ts') },
  { find: '@agent-ops/agent-runtime/failure-classification', replacement: join(packagesDir, 'agent-runtime', 'src', 'failure-classification.ts') },
];

const packages: Array<{ find: string; replacement: string }> = [];
for (const dir of [packagesDir, appsDir]) {
  for (const name of readdirSync(dir)) {
    const fullPath = join(dir, name);
    if (!statSync(fullPath).isDirectory()) continue;
    packages.push({ find: `@agent-ops/${name}`, replacement: fullPath });
  }
}

export default defineConfig({
  resolve: {
    alias: [...subpaths, ...packages],
  },
  test: {
    include: ['packages/**/test/**/*.test.{ts,tsx}', 'apps/**/test/**/*.test.{ts,tsx}'],
    // Runtime catalog tests probe real local CLIs; parallel files can starve
    // synchronous child-process probes and create false timeout failures.
    fileParallelism: false,
  },
});

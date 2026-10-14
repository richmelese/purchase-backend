// Development mode: recompile on change (tsc --watch) and restart the API (node --watch).
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');

const first = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
if (first.status !== 0) process.exit(first.status ?? 1);

const children = [
  spawn(process.execPath, [tsc, '-p', 'tsconfig.json', '--watch', '--preserveWatchOutput'], { stdio: 'inherit' }),
  spawn(process.execPath, ['--watch-path=dist', 'dist/main.js'], { stdio: 'inherit' }),
];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) c.on('exit', (code) => { if (code) stop(); });

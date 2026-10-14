// Every HTTP endpoint must declare who may call it (deny-by-default PermissionsGuard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
require('reflect-metadata');
const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const files = [path.join(dist, 'app.controller.js'), ...fs.readdirSync(path.join(dist, 'modules'), { recursive: true })
  .filter((f) => String(f).endsWith('.controller.js')).map((f) => path.join(dist, 'modules', String(f)))];

test('every endpoint is public, open to staff, handler-checked or needs a permission', () => {
  const missing = [];
  let endpoints = 0;
  for (const file of files) {
    for (const ctrl of Object.values(require(file))) {
      if (typeof ctrl !== 'function' || Reflect.getMetadata('path', ctrl) === undefined) continue;
      const protos = [];
      for (let p = ctrl.prototype; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) protos.push(p);
      const names = new Set(protos.flatMap((p) => Object.getOwnPropertyNames(p)));
      for (const name of names) {
        const fn = ctrl.prototype[name];
        if (typeof fn !== 'function' || Reflect.getMetadata('method', fn) === undefined) continue;
        endpoints++;
        const has = (key) => Reflect.getMetadata(key, fn) !== undefined || Reflect.getMetadata(key, ctrl) !== undefined;
        if (!has('isPublic') && !has('permission')) missing.push(`${ctrl.name}.${name}`);
      }
    }
  }
  assert.ok(endpoints > 80, `found only ${endpoints} endpoints`);
  assert.deepEqual(missing, []);
});

// Serves the packed tarball, then runs the bundled pnpm against it, which is
// what the plugin manager does once the spec parses as a tarball.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [, , dir, scratch] = process.argv;
const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'));
const body = readFileSync(join(dir, tarball));

const server = createServer((_request, response) => {
  response.writeHead(200, {
    'content-type': 'application/octet-stream',
    'content-length': String(body.length),
  });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const url = `http://127.0.0.1:${port}/${tarball}`;
console.log(`### url: ${url}`);

if (existsSync(scratch)) {
  const { rmSync } = await import('node:fs');
  rmSync(scratch, { recursive: true, force: true });
}
mkdirSync(scratch, { recursive: true });
writeFileSync(join(scratch, 'package.json'), JSON.stringify({ name: 'scratch', private: true }, null, 2));

const pnpm = 'E:\\DSHDesktop\\resources\\runtime\\pnpm\\bin\\pnpm.mjs';
const result = spawnSync(process.execPath, [pnpm, 'add', url], {
  cwd: scratch,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 240000,
});
console.log('### exit:', result.status, '| error:', result.error?.message ?? 'none');
console.log('### stdout:\n' + (result.stdout ?? ''));
console.log('### stderr:\n' + (result.stderr ?? ''));

const installed = join(scratch, 'node_modules', 'dsh-desktop-restart');
console.log('### installed at node_modules/dsh-desktop-restart:', existsSync(installed));
if (existsSync(installed)) {
  console.log('### files:', readdirSync(installed).join(', '));
  const manifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  console.log('### name@version:', `${manifest.name}@${manifest.version}`);
  console.log('### dsh.bundle.patch:', manifest.dsh?.bundle?.patch);
  console.log('### dsh.client.platform:', manifest.dsh?.client?.platform);
}

server.close();

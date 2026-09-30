// Serves the packed tarball on a loopback port, parses the spec, then runs the
// real plugin install against an isolated DSH_HOME.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const [, , dir, testHome, cliCmd] = process.argv;
const tarball = readdirSync(dir).find((name) => name.endsWith('.tgz'));
if (tarball === undefined) throw new Error(`no .tgz in ${dir}`);
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
console.log(`### tarball url: ${url}`);

// 1) The spec parser the plugin manager itself runs.
try {
  const spec = await import(
    'file:///E:/DSHDesktop/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-plugin-manager/lib/types/install-spec.js'
  );
  console.log('### parseInstallSpec ->', JSON.stringify(spec.parseInstallSpec(url)));
} catch (error) {
  console.log('### parseInstallSpec unavailable:', error.message);
}

// 2) The real operation, on its own DSH_HOME.
const result = spawnSync(`"${cliCmd}"`, ['plugin', '--profile', 'desktop', 'add', url], {
  env: { ...process.env, DSH_HOME: testHome, ELECTRON_RUN_AS_NODE: '1', GIT_TERMINAL_PROMPT: '0' },
  encoding: 'utf8',
  timeout: 240000,
  shell: true,
});
console.log('### exit code:', result.status, '| signal:', result.signal, '| error:', result.error?.message ?? 'none');
console.log('### stdout:\n' + (result.stdout ?? ''));
console.log('### stderr:\n' + (result.stderr ?? ''));

server.close();

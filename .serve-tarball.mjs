// Serves the packed tarball over HTTP so the install path can be exercised
// exactly as a release-asset URL would be.
import { createServer } from 'node:http';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
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

server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  console.log(`SERVING http://127.0.0.1:${port}/${tarball}`);
});

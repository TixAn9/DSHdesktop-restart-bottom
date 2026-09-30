// Drives the host half's route handler against stub requests.
import { apply, name, inject } from './lib/index.js';

let handler = null;
const ctx = {
  effect: (callback) => { callback(); },
  webServer: {
    port: 65500,
    register: (route) => { handler = route.handler; return () => {}; },
  },
};

apply(ctx);
if (handler === null) throw new Error('host registered no route');

function call({ method = 'POST', headers = {}, address = '127.0.0.1' }) {
  return new Promise((resolve) => {
    const response = {
      status: 0,
      headers: null,
      body: '',
      writeHead(status, extra) { this.status = status; this.headers = extra; },
      end(chunk) { this.body = chunk ?? ''; resolve(this); },
    };
    handler({ method, headers, socket: { remoteAddress: address } }, response);
  });
}

const cases = [
  ['probe', { headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500', 'x-dsh-restart-probe': '1' } }],
  ['desktop-forwarded origin', { headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500', 'x-dsh-restart-probe': '1', 'sec-fetch-site': 'same-origin' } }],
  ['GET', { method: 'GET', headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500' } }],
  ['remote peer', { headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500' }, address: '10.0.0.5' }],
  ['foreign host', { headers: { host: 'evil.example', origin: 'http://evil.example' } }],
  ['cross-site', { headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500', 'sec-fetch-site': 'cross-site' } }],
  ['forwarded trace', { headers: { host: '127.0.0.1:65500', origin: 'http://127.0.0.1:65500', 'x-forwarded-for': '1.2.3.4' } }],
];

for (const [label, request] of cases) {
  const response = await call(request);
  console.log(`${label.padEnd(26)} -> ${response.status} ${response.body}`);
}

console.log('name:', name, '| inject:', JSON.stringify(inject));

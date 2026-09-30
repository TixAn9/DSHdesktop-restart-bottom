// Executes lib/client.js the way the page's loader does: register, then run the factory.
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./lib/client.js', import.meta.url), 'utf8');
let registered = null;

const reactStub = {
  createElement: (...args) => ({ tag: args[0], props: args[1] }),
  useState: (value) => [value, () => {}],
  useRef: (value) => ({ current: value }),
  useEffect: () => {},
};

globalThis.window = {
  __ModuleLoader__: {
    load(registration) {
      registered = registration;
    },
  },
};

const sandbox = new Function('window', source);
sandbox(globalThis.window);

if (registered === null) throw new Error('client did not register a bundle');
if (registered.id !== 'dsh-desktop-restart') throw new Error(`unexpected id: ${registered.id}`);

const exports_ = registered.factory((specifier) => {
  if (specifier === 'react') return reactStub;
  if (specifier === '@deepseek-ai/dsh-client-ui-primitives') {
    return { IconRefreshOutlineRegular: () => null, Tooltip: () => null };
  }
  throw new Error(`unexpected require: ${specifier}`);
});

if (typeof exports_.apply !== 'function') throw new Error('apply is not a function');

// Drive apply() against a stub context and record the slot registration.
const registeredSlots = [];
const dictionaries = [];
const ctx = {
  effect: (callback) => { callback(); },
  locale: { register: (namespace, value) => { dictionaries.push([namespace, value]); } },
  slots: {
    inject: (name, callback) => { callback(); },
    register: (options) => { registeredSlots.push(options); return () => {}; },
  },
};

exports_.apply(ctx);

console.log('id:', registered.id);
console.log('inject:', JSON.stringify(exports_.inject));
console.log('dictionaries:', dictionaries.map(([ns, value]) => `${ns}(${Object.keys(value).join('/')})`).join(', '));
console.log('slots:', JSON.stringify(registeredSlots));

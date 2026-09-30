/**
 * dsh-desktop-restart — host half.
 *
 * Serves `POST /dsh-desktop-restart`. The DSH Desktop shell never auto-restarts
 * a dead Host (it raises its own recovery dialog instead) and exposes no
 * renderer-to-shell restart channel, so a page button cannot ask the shell to
 * relaunch. What the page CAN do is ask this Host, and the Host can hand the
 * whole job to a detached helper that outlives Electron: kill the application
 * process tree, wait for the web port to go quiet, then start the same
 * executable again.
 *
 * The helper is detached on purpose. Everything it has to touch is the process
 * tree that owns this Host, so it must not be a descendant of that tree.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const name = 'dsh-desktop-restart';

export const inject = ['webServer'];

/** Exact route the client half posts to. */
const ROUTE = '/dsh-desktop-restart';

/** Refuse a second restart while the previous one is still tearing down. */
const COOLDOWN_MS = 60_000;

let lastRequestedAt = 0;

function logPath() {
  return join(tmpdir(), 'dsh-desktop-restart.log');
}

function note(line) {
  try {
    appendFileSync(logPath(), `[${new Date().toISOString()}] ${line}\n`);
  } catch {
    /* Diagnostics must never break the action they describe. */
  }
}

/** Whether this Host was spawned by the DSH Desktop electron shell. */
function desktopAppExecutable() {
  return /DeepSeek Harness\.exe$/iu.test(process.execPath) ? process.execPath : null;
}

/**
 * The application process to relaunch: the electron main process that owns the
 * Host child, unless the Host was started some other way.
 * @returns the pid, or null when the app cannot be identified.
 */
function applicationPid() {
  const pid = process.ppid;
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/**
 * The PowerShell program that performs the restart.
 *
 * It waits for the HTTP response to reach the page, kills the application tree
 * (which includes this Host), waits until nothing accepts a connection on the
 * port any more, and starts the executable again. Every step is logged, because
 * the process that would normally report a failure is one of the casualties.
 * @param appPid - electron main process pid.
 * @param appExe - absolute path of the application executable.
 * @param port - the web port the replacement must be able to bind.
 * @returns the script source.
 */
function helperProgram(appPid, appExe, port) {
  return String.raw`$ErrorActionPreference = 'Continue'
$log = Join-Path $env:TEMP 'dsh-desktop-restart.log'
function Note([string]$line) { Add-Content -LiteralPath $log -Value ("[{0}] helper: {1}" -f (Get-Date).ToString('o'), $line) }
Note ("started, pid=" + $PID)
Start-Sleep -Milliseconds 2500
Note ("killing application tree " + ${appPid})
taskkill /F /T /PID ${appPid} 2>&1 | ForEach-Object { Note ("taskkill: " + $_) }
$free = $false
for ($i = 0; $i -lt 40; $i++) {
  # A refused connect can still block for seconds while the stack retries, so
  # every attempt is bounded: the probe is only asking "does anything listen yet".
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $task = $client.ConnectAsync('127.0.0.1', ${port})
    if ($task.Wait(1500) -and -not $task.IsFaulted) {
      Start-Sleep -Milliseconds 400
    } else {
      $free = $true
    }
  } catch {
    $free = $true
  } finally {
    $client.Dispose()
  }
  if ($free) { break }
}
Note ("port free: " + $free)
if (-not $free) {
  # Nothing was listening before either: starting a second application would
  # only fail its own port bind, so leave the existing one alone.
  Note 'port still busy after the wait; not relaunching'
  exit 1
}
Start-Sleep -Milliseconds 1200
try {
  Start-Process -FilePath ${quotePowerShell(appExe)} -WorkingDirectory ${quotePowerShell(dirnameOf(appExe))} | Out-Null
  Note 'relaunched'
} catch {
  Note ("relaunch failed: " + $_.Exception.Message)
}
`;
}

function quotePowerShell(value) {
  return `'${value.replace(/'/gu, "''")}'`;
}

function dirnameOf(file) {
  const cut = Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/'));
  return cut <= 0 ? file : file.slice(0, cut);
}

/**
 * Write the helper beside its log and launch it detached.
 *
 * `-File` rather than `-EncodedCommand`: the encoded form takes exactly one
 * payload, so a chunked program silently executes only its first fragment. That
 * is how this helper first reported itself "scheduled" and then did nothing.
 */
function scheduleRestart(appPid, appExe, port) {
  const script = join(tmpdir(), 'dsh-desktop-restart-helper.ps1');
  writeFileSync(script, helperProgram(appPid, appExe, port), 'utf8');
  const helper = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy', 'Bypass',
    '-WindowStyle', 'Hidden',
    '-File', script,
  ], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  helper.once('error', (error) => note(`helper spawn failed: ${String(error)}`));
  helper.unref();
  return helper.pid;
}

/** Parse a bare `host[:port]` authority, or null when the value is not one. */
function parseAuthority(value) {
  try {
    const url = new URL(`http://${value}`);
    const canonical = url.port === '' ? url.hostname : `${url.hostname}:${url.port}`;
    return canonical === value.toLowerCase() ? url : null;
  } catch {
    return null;
  }
}

/** Whether an authority names this machine: a loopback name or address, any port. */
function loopbackAuthority(value) {
  const parsed = parseAuthority(value);
  if (parsed === null) return false;
  return parsed.hostname === '127.0.0.1'
    || parsed.hostname === 'localhost'
    || parsed.hostname === '[::1]'
    || parsed.hostname === '::1';
}

/**
 * Accept only a same-origin loopback request.
 *
 * The fence is the one @deepseek-ai/dsh-market uses, and it is deliberately not
 * an Origin/Host string equality: a page on an attacker's name can send a
 * matching pair, so Host — the one header it cannot forge — has to name this
 * machine, and the request must not announce itself cross-site.
 *
 * Origin is compared as an authority rather than as a string because the
 * Desktop document is served from `dsh-app://app/` and its requests are relayed
 * by the Electron shell, which rewrites Origin to this Host's own loopback
 * authority before forwarding. Comparing schemes would refuse exactly the
 * caller this route exists for.
 */
function trusted(request) {
  const address = request.socket?.remoteAddress;
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false;
  if (request.headers.forwarded !== undefined
    || request.headers['x-forwarded-for'] !== undefined
    || request.headers['x-real-ip'] !== undefined) return false;
  const host = request.headers.host;
  if (typeof host !== 'string' || !loopbackAuthority(host)) return false;
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = request.headers.origin;
  // A missing Origin is a non-page caller; every page sends one, and the
  // loopback peer plus the loopback Host above already bound the request.
  if (origin === undefined || origin === '') return true;
  const parsed = parseAuthority(origin.replace(/^https?:\/\//iu, ''));
  return parsed !== null && loopbackAuthority(parsed.host);
}

function send(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export function apply(ctx) {
  // The browser half has no reachable console, so a registration it cannot
  // complete is reported here instead of vanishing. This is what surfaced the
  // missing `id` on the list-slot registration.
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: `${ROUTE}/beacon`,
    handler: (request, response) => {
      let body = '';
      request.on('data', (chunk) => {
        if (body.length < 4096) body += String(chunk);
      });
      request.on('end', () => {
        note(`client beacon: ${body}`);
        response.writeHead(204);
        response.end();
      });
    },
  }), 'dsh-desktop-restart: client diagnostics');

  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405, { allow: 'POST', 'content-type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: 'method not allowed' }));
        return;
      }
      if (!trusted(request)) {
        send(response, 403, { ok: false, error: 'forbidden' });
        return;
      }
      // The page asks what it can do before it greys the button out, so the
      // reason a restart is impossible is reportable instead of silent.
      const state = available(ctx);
      if (request.headers['x-dsh-restart-probe'] === '1') {
        send(response, 200, { ok: true, supported: state.supported, reason: state.reason });
        return;
      }
      if (!state.supported) {
        send(response, 501, { ok: false, error: state.reason });
        return;
      }
      const now = Date.now();
      if (now - lastRequestedAt < COOLDOWN_MS) {
        send(response, 429, { ok: false, error: 'a restart was requested less than a minute ago' });
        return;
      }
      lastRequestedAt = now;
      try {
        const helperPid = scheduleRestart(state.appPid, state.appExe, state.port);
        note(`restart requested; helper pid=${String(helperPid)} app pid=${String(state.appPid)}`);
        send(response, 202, { ok: true, helperPid, appPid: state.appPid });
      } catch (error) {
        note(`schedule failed: ${String(error)}`);
        send(response, 500, { ok: false, error: String(error) });
      }
    },
  }), 'dsh-desktop-restart: restart route');
}

/**
 * Whether this Host can restart its application, and the facts the helper needs.
 * @param ctx - the plugin context carrying the bound webserver.
 * @returns support plus the executable, the application pid, and the port.
 */
function available(ctx) {
  const appExe = desktopAppExecutable();
  const appPid = applicationPid();
  const port = ctx.webServer?.port ?? null;
  if (appExe === null) return { supported: false, reason: 'this Host is not running inside DSH Desktop' };
  if (appPid === null) return { supported: false, reason: 'the application process could not be identified' };
  if (port === null) return { supported: false, reason: 'the web server port is unknown' };
  return { supported: true, reason: null, appExe, appPid, port };
}

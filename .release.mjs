// Creates the GitHub release for this plugin and uploads the packed tarball.
// The token comes from the environment so it is never written to disk or logged.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [, , dir, tag, name] = process.argv;
const token = process.env.GH_TOKEN;
if (!token) throw new Error('GH_TOKEN is not set');

const owner = 'TixAn9';
const repo = 'DSHdesktop-restart-bottom';
const tarballName = readdirSync(dir).find((entry) => entry.endsWith('.tgz'));
if (!tarballName) throw new Error(`no .tgz in ${dir}`);
const tarball = readFileSync(join(dir, tarballName));

const api = `https://api.github.com/repos/${owner}/${repo}`;
const headers = {
  authorization: `Bearer ${token}`,
  accept: 'application/vnd.github+json',
  'user-agent': 'dsh-release-script',
  'x-github-api-version': '2022-11-28',
};

async function call(url, init) {
  const response = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}) } });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, ok: response.ok, body };
}

// Reuse an existing release for the tag so re-running is safe.
let release = (await call(`${api}/releases/tags/${tag}`, { method: 'GET' })).body;
if (release?.id === undefined) {
  const created = await call(`${api}/releases`, {
    method: 'POST',
    body: JSON.stringify({
      tag_name: tag,
      name,
      draft: false,
      prerelease: false,
      generate_release_notes: true,
    }),
  });
  if (!created.ok) throw new Error(`create release failed ${created.status}: ${JSON.stringify(created.body)}`);
  release = created.body;
  console.log(`### created release ${release.tag_name} (id ${release.id})`);
} else {
  console.log(`### reusing release ${release.tag_name} (id ${release.id})`);
}

const existing = (await call(`${api}/releases/${release.id}/assets`, { method: 'GET' })).body ?? [];
const previous = existing.find((asset) => asset.name === tarballName);
if (previous) {
  await call(`${api}/releases/assets/${previous.id}`, { method: 'DELETE' });
  console.log('### removed the previous asset of the same name');
}

// Raw binary upload. A multipart FormData body is NOT serialized by every
// runtime, and an unserialized one is stored verbatim — which uploads the
// multipart envelope instead of the tarball. GitHub accepts the bare bytes.
const uploaded = await call(
  `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(tarballName)}`,
  {
    method: 'POST',
    headers: { 'content-type': 'application/gzip' },
    body: tarball,
  },
);
if (!uploaded.ok) throw new Error(`upload failed ${uploaded.status}: ${JSON.stringify(uploaded.body)}`);
console.log(`### uploaded ${uploaded.body.name} (${uploaded.body.size} bytes)`);
console.log(`### browser_download_url: ${uploaded.body.browser_download_url}`);

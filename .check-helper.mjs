// Extracts the generated PowerShell helper from lib/index.js and writes it for parsing.
import { readFileSync, writeFileSync } from 'node:fs';

const source = readFileSync(new URL('./lib/index.js', import.meta.url), 'utf8');
const start = source.indexOf('return String.raw`');
if (start < 0) throw new Error('helperProgram template not found');
const body = source.slice(start + 'return String.raw`'.length);
const end = body.indexOf('\n`;');
if (end < 0) throw new Error('helperProgram template does not terminate');
const template = body.slice(0, end + 1);

const appPid = 25192;
const appExe = 'E:\\DSHDesktop\\DeepSeek Harness.exe';
const port = 19387;
const quote = (value) => `'${value.replace(/'/gu, "''")}'`;
const dirname = (file) => file.slice(0, Math.max(file.lastIndexOf('\\'), file.lastIndexOf('/')));

// The template's only interpolations are these three; substitute them the way
// the module does so PowerShell parses exactly the emitted text.
const program = template
  .replaceAll('${appPid}', String(appPid))
  .replaceAll('${port}', String(port))
  .replaceAll('${quotePowerShell(appExe)}', quote(appExe))
  .replaceAll('${quotePowerShell(dirnameOf(appExe))}', quote(dirname(appExe)));

if (program.includes('${')) throw new Error(`unsubstituted placeholder remains:\n${program}`);
if (!program.includes(String(appPid))) throw new Error('app pid missing from program');
if (!program.includes('19387')) throw new Error('port missing from program');

writeFileSync(new URL('./.helper.ps1', import.meta.url), program, 'utf8');
console.log(`generated ${program.length} chars`);
console.log(program.split('\n').slice(0, 6).join('\n'));

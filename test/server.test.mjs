// End-to-end tests: the real MCP server process over stdio, against a mock Abhed API.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'test-key';
const calls = [];
let approvalPolls = 0;

const TOOLS = [
  { type: 'function', function: { name: 'lookup_transaction', description: 'Look up transactions', parameters: { type: 'object', properties: { customer: { type: 'string' } }, required: ['customer'] } } },
  { type: 'function', function: { name: 'issue_refund', description: 'Refund a debit', parameters: { type: 'object', properties: { customer: { type: 'string' }, amount: { type: 'number' } }, required: ['customer', 'amount'] } } },
];

function mock(req, res) {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    if (req.headers.authorization !== `Bearer ${KEY}`) return send(401, { error: 'bad key' });
    const b = body ? JSON.parse(body) : {};
    calls.push({ url: req.url, body: b });
    if (req.url === '/api/v1/agent') return send(200, { agent: { id: 'rex' }, company: 'NovaBank (fictional)', role: 'refunds', delegations: [], tools: TOOLS });
    if (req.url === '/api/v1/sessions') return send(200, { sessionId: 'S-1', tainted: /ignore previous/i.test(b.task), signals: [] });
    if (req.url === '/api/v1/tools/call') {
      if (b.tool === 'lookup_transaction') return send(200, { decision: 'ALLOWED', output: { txns: 2 }, record: 7 });
      if (b.args.amount > 100000) return send(200, { decision: 'BLOCKED', reason: 'over delegation', rule: 'R-LIMIT', record: 8 });
      return send(200, { decision: 'NEEDS_APPROVAL', reason: 'refund over 10,000', approvalId: 'A-1', record: 9 });
    }
    if (req.url === '/api/v1/approvals/A-1') {
      approvalPolls += 1;
      return send(200, approvalPolls < 2 ? { id: 'A-1', status: 'PENDING', approverRole: 'L2', votes: [] }
        : { id: 'A-1', status: 'EXECUTED', output: { refunded: 40000 }, votes: [{ name: 'Priya' }], record: 10 });
    }
    if (req.url === '/api/v1/sessions/S-1/finish') return send(200, { ok: true });
    send(404, { error: 'not found' });
  });
}

let http, proc, url, n = 0;
const pending = new Map();
let buf = '';

function rpc(method, params = {}) {
  const id = ++n;
  proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  return new Promise((resolve) => pending.set(id, resolve));
}
const tool = async (name, args = {}) => (await rpc('tools/call', { name, arguments: args })).result;

before(async () => {
  http = createServer(mock);
  await new Promise((r) => http.listen(0, r));
  url = `http://127.0.0.1:${http.address().port}`;
  proc = spawn(process.execPath, [join(ROOT, 'cli.mjs')], {
    env: { ...process.env, ABHED_URL: url, ABHED_AGENT_KEY: KEY, ABHED_POLL_MS: '50', ABHED_APPROVAL_WAIT_SECONDS: '5' },
  });
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1);
      const msg = JSON.parse(line);
      pending.get(msg.id)?.(msg); pending.delete(msg.id);
    }
  });
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
});

after(() => { proc.kill(); http.close(); });

test('lists the agent tools plus the Abhed meta tools', async () => {
  const names = (await rpc('tools/list')).result.tools.map((t) => t.name);
  assert.deepEqual(names.slice(0, 4), ['abhed_start_task', 'abhed_check_approval', 'abhed_finish_task', 'abhed_whoami']);
  assert.ok(names.includes('lookup_transaction') && names.includes('issue_refund'));
});

test('an allowed call returns the tool output', async () => {
  const r = await tool('abhed_start_task', { task: 'check a duplicate debit', subject: 'C-1029' });
  assert.equal(r.structuredContent.sessionId, 'S-1');
  const ok = await tool('lookup_transaction', { customer: 'C-1029' });
  assert.equal(ok.structuredContent.decision, 'ALLOWED');
  assert.deepEqual(ok.structuredContent.output, { txns: 2 });
  assert.equal(calls.at(-1).body.sessionId, 'S-1');
});

test('a held call waits for the human and returns the executed output', async () => {
  const r = await tool('issue_refund', { customer: 'C-1029', amount: 40000 });
  assert.equal(r.structuredContent.decision, 'APPROVED_AND_EXECUTED');
  assert.deepEqual(r.structuredContent.output, { refunded: 40000 });
  assert.ok(approvalPolls >= 2);
});

test('a blocked call is an error with the refusing rule', async () => {
  const r = await tool('issue_refund', { customer: 'C-1029', amount: 900000 });
  assert.equal(r.isError, true);
  assert.equal(r.structuredContent.decision, 'BLOCKED');
  assert.equal(r.structuredContent.rule, 'R-LIMIT');
});

test('a tool the agent was not granted never reaches Abhed', async () => {
  const before = calls.length;
  const r = await tool('delete_database', {});
  assert.equal(r.isError, true);
  assert.equal(calls.filter((c) => c.url === '/api/v1/tools/call').length, calls.slice(0, before).filter((c) => c.url === '/api/v1/tools/call').length);
});

test('finish closes the task; unknown methods are protocol errors', async () => {
  assert.equal((await tool('abhed_finish_task', { summary: 'done' })).structuredContent.finished, true);
  assert.equal((await rpc('resources/list')).error.code, -32601);
});

// Separate processes for failure modes and the CLI flags.
function runCli(args, env) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [join(ROOT, 'cli.mjs'), ...args], { env: { ...process.env, ...env } });
    let out = '', err = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('close', (code) => resolve({ code, out, err }));
  });
}

async function oneShot(env, method, params) {
  const p = spawn(process.execPath, [join(ROOT, 'cli.mjs')], { env: { ...process.env, ...env } });
  let buf = '';
  const done = new Promise((resolve) => p.stdout.on('data', (d) => {
    buf += d;
    const lines = buf.split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const hit = lines.find((m) => m.id === 2);
    if (hit) resolve(hit);
  }));
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } }) + '\n');
  p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method, params }) + '\n');
  const r = await done;
  p.kill();
  return r;
}

test('with Abhed unreachable, tools/list still returns the meta tools and calls explain why', async () => {
  const env = { ABHED_URL: 'http://127.0.0.1:9', ABHED_AGENT_KEY: KEY };
  const list = await oneShot(env, 'tools/list');
  assert.deepEqual(list.result.tools.map((t) => t.name), ['abhed_start_task', 'abhed_check_approval', 'abhed_finish_task', 'abhed_whoami']);
  const who = await oneShot(env, 'tools/call', { name: 'abhed_whoami', arguments: {} });
  assert.equal(who.result.isError, true);
  assert.match(who.result.structuredContent.error, /Could not reach Abhed at http:\/\/127\.0\.0\.1:9 .*Check ABHED_URL/);
});

test('a rejected key says to pair a new one', async () => {
  const who = await oneShot({ ABHED_URL: url, ABHED_AGENT_KEY: 'wrong' }, 'tools/call', { name: 'abhed_whoami', arguments: {} });
  assert.equal(who.result.structuredContent.status, 401);
  assert.match(who.result.structuredContent.error, /Pair a new key/);
});

test('--check reports the profile and masks the key; fails clearly on a bad key or missing key', async () => {
  const good = await runCli(['--check'], { ABHED_URL: url, ABHED_AGENT_KEY: 'test-key' });
  assert.equal(good.code, 0, good.out);
  assert.match(good.out, /OK {4}connected as rex \(refunds\) at NovaBank \(fictional\)/);
  assert.match(good.out, /2 granted tool\(s\): lookup_transaction, issue_refund/);
  const longKey = await runCli(['--check'], { ABHED_URL: url, ABHED_AGENT_KEY: 'kv_live_abcdefghijklmnop' });
  assert.equal(longKey.code, 1);
  assert.ok(!longKey.out.includes('abcdefghijklmnop'), 'the full key must never be printed');
  assert.match(longKey.out, /kv_live_…op/);
  assert.match(longKey.out, /FAIL .*Pair a new key/);
  const none = await runCli(['--check'], { ABHED_URL: url, ABHED_AGENT_KEY: '' });
  assert.equal(none.code, 1);
  assert.match(none.out, /not set/);
});

test('--version prints the package version', async () => {
  const { version } = JSON.parse(await import('node:fs').then((fs) => fs.readFileSync(join(ROOT, 'package.json'), 'utf8')));
  const r = await runCli(['--version'], {});
  assert.equal(r.out.trim(), version);
});

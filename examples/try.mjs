#!/usr/bin/env node
/**
 * Check your connection before wiring up a client. This speaks MCP over stdio to the real server, exactly as Cursor
 * or Claude Desktop would, and walks through each outcome. Press Enter to take each step.
 *
 *   ABHED_AGENT_KEY=kv_live_... ABHED_URL=https://abhed.onrender.com npm run try
 *
 * It uses an agent key from a banking company in Abhed, and it issues a real request to refund ₹40,000 on the
 * fictional customer C-1029, so point it at a demo company.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

if (!process.env.ABHED_AGENT_KEY) {
  console.error('Set ABHED_AGENT_KEY first: the kv_live_ key from redeeming your pairing code.');
  process.exit(1);
}
const paint = (code) => (s) => (process.stdout.isTTY || process.env.FORCE_COLOR ? `\x1b[${code}m${s}\x1b[0m` : s);
const [dim, bold, red, green, amber, cyan] = [2, 1, 31, 32, 33, 36].map(paint);
const tone = { ALLOWED: green, APPROVED_AND_EXECUTED: green, COMMITTED: green, BLOCKED: red, REJECTED: red, CANCELLED: red, NEEDS_APPROVAL: amber, APPROVED_WAITING_TO_COMMIT: amber, WAITING: amber };

const server = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'cli.mjs')], { stdio: ['pipe', 'pipe', 'inherit'], env: process.env });
const pending = new Map();
let id = 0;
createInterface({ input: server.stdout }).on('line', (line) => {
  const msg = JSON.parse(line);
  pending.get(msg.id)?.(msg);
  pending.delete(msg.id);
});
const rpc = (method, params = {}) =>
  new Promise((resolve) => {
    const n = ++id;
    pending.set(n, resolve);
    server.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: n, method, params })}\n`);
  });

const lines = createInterface({ input: process.stdin });
const waiting = [];
lines.on('line', () => waiting.shift()?.());
lines.on('close', () => { while (waiting.length) waiting.shift()(); });
// ABHED_TRY_AUTO=3000 takes each step on its own after that many ms, for screen recordings and scripts
const AUTO = Number(process.env.ABHED_TRY_AUTO ?? 0);
const step = (title) =>
  new Promise((resolve) => {
    console.log(`\n${bold(title)}${AUTO ? '' : ` ${dim('(press Enter)')}`}`);
    if (AUTO) setTimeout(resolve, AUTO);
    else waiting.push(resolve);
  });

async function call(name, args = {}) {
  console.log(`${cyan('tools/call')} ${name} ${dim(JSON.stringify(args))}`);
  const { result, error } = await rpc('tools/call', { name, arguments: args });
  if (error) throw new Error(error.message);
  const r = result.structuredContent ?? {};
  const label = r.decision ?? r.status;
  if (label) console.log(`${(tone[label] ?? bold)(label)}${r.rule ? ` ${dim(r.rule)}` : ''}`);
  if (r.error) console.log(red(r.error));
  if (r.reason) console.log(`  ${r.reason}`);
  if (r.next) console.log(`  ${r.next}`);
  return r;
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'abhed-try', version: '1.0.0' } });
console.log(`${green('Connected')} to ${init.result.serverInfo.name} over stdio, MCP ${init.result.protocolVersion}`);
const { tools } = (await rpc('tools/list')).result;
console.log(`${tools.length} tools: ${dim(tools.map((t) => t.name).join(', '))}`);

await step('1. Declare the task');
const who = await call('abhed_whoami');
console.log(`  You are ${who.agent?.name ?? who.agent?.id} at ${who.company}.`);
const task = await call('abhed_start_task', { task: 'Refund the duplicate EMI debit for Mr. Rohit Kapoor', subject: 'C-1029' });
console.log(`  Task ${task.sessionId} is open. Flagged as injection: ${task.flaggedAsInjection}.`);

await step('2. A safe read goes straight through');
await call('lookup_transaction', { customer: 'C-1029' });

await step('3. A ₹5,00,000 refund is refused');
await call('issue_refund', { customer: 'C-1029', amount: 500000, reason: 'Duplicate EMI debit' });

await step('4. A ₹40,000 refund waits for a person. Approve it in Abhed');
const held = await call('issue_refund', { customer: 'C-1029', amount: 40000, reason: 'Duplicate EMI debit' });

if (held.commitId) {
  await step('5. It is approved, but no money has moved. Cancel it in Abhed, or let the window run out');
  let c;
  for (;;) {
    c = (await rpc('tools/call', { name: 'abhed_check_commit', arguments: { commit_id: held.commitId } })).result.structuredContent;
    if (c.status !== 'WAITING') break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.log(`${cyan('tools/call')} abhed_check_commit ${dim(JSON.stringify({ commit_id: held.commitId }))}`);
  console.log(`${(tone[c.status] ?? bold)(c.status)}${c.cancelledBy ? ` by ${bold(c.cancelledBy)}. No money moved.` : ''}${c.record ? ` ${dim(`ledger record #${c.record}`)}` : ''}`);
}

await step('6. Close the task');
await call('abhed_finish_task', { summary: 'Connection check finished.' });
console.log(`\n${green('All set.')} Add the same key and URL to your MCP client.`);
server.kill();
process.exit(0);

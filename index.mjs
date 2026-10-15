/**
 * abhed-mcp: put any MCP agent's tool calls behind Abhed's action gate.
 *
 * The agent sees the tools its Abhed profile grants. Every call goes to Abhed's gate first:
 *   ALLOWED         -> the tool runs and the output comes back
 *   NEEDS_APPROVAL  -> a person must approve; this server waits (ABHED_APPROVAL_WAIT_SECONDS)
 *                      and returns the real output once Abhed executes it, or the approval id
 *   BLOCKED         -> refused, with the rule that refused it
 * Each decision is a record in Abhed's hash-chained, signed ledger.
 *
 * Env: ABHED_AGENT_KEY (required), ABHED_URL (default https://kavach-os.vercel.app),
 *      ABHED_TASK, ABHED_SUBJECT, ABHED_APPROVAL_WAIT_SECONDS (default 60).
 * Zero dependencies; Node 18+.
 */
import { createInterface } from 'node:readline';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INFO = { name: 'abhed', version: '1.0.0' };

export function config(env = process.env) {
  return {
    url: (env.ABHED_URL || 'https://kavach-os.vercel.app').replace(/\/$/, ''),
    key: env.ABHED_AGENT_KEY || '',
    task: env.ABHED_TASK || '',
    subject: env.ABHED_SUBJECT || undefined,
    waitMs: Math.max(0, Number(env.ABHED_APPROVAL_WAIT_SECONDS ?? 60)) * 1000,
    pollMs: Math.max(50, Number(env.ABHED_POLL_MS ?? 2000)),
  };
}

export class AbhedClient {
  constructor(cfg) {
    this.cfg = cfg;
    this.session = null;
    this.profile = null;
  }

  async req(path, body) {
    const res = await fetch(this.cfg.url + path, {
      method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${this.cfg.key}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || `Abhed returned HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  async getProfile() {
    this.profile ??= await this.req('/api/v1/agent');
    return this.profile;
  }

  async startTask(task, subject) {
    const s = await this.req('/api/v1/sessions', { task, subject });
    this.session = { ...s, task };
    return s;
  }

  async ensureSession() {
    if (!this.session) await this.startTask(this.cfg.task || 'Task from an MCP client', this.cfg.subject);
    return this.session;
  }

  async call(tool, args) {
    const s = await this.ensureSession();
    return this.req('/api/v1/tools/call', { sessionId: s.sessionId, tool, args });
  }

  approval(id) {
    return this.req(`/api/v1/approvals/${encodeURIComponent(id)}`);
  }

  async waitForApproval(id) {
    const end = Date.now() + this.cfg.waitMs;
    let a = await this.approval(id);
    while (a.status === 'PENDING' && Date.now() < end) {
      await new Promise((r) => setTimeout(r, this.cfg.pollMs));
      a = await this.approval(id);
    }
    return a;
  }

  async finish(summary) {
    if (!this.session) return { finished: false, reason: 'no task in progress' };
    const id = this.session.sessionId;
    await this.req(`/api/v1/sessions/${encodeURIComponent(id)}/finish`, { summary });
    this.session = null;
    return { finished: true, sessionId: id };
  }
}

const META_TOOLS = [
  {
    name: 'abhed_start_task',
    description: 'Declare the task you are working on (and the customer it is for). Abhed scans it for prompt injection and refuses actions on anyone else. Call this before other tools.',
    inputSchema: { type: 'object', properties: { task: { type: 'string' }, subject: { type: 'string', description: 'customer id this task is for, if any' } }, required: ['task'] },
  },
  {
    name: 'abhed_check_approval',
    description: 'Check an action that is waiting for a person to approve it. Returns the output once approved and executed.',
    inputSchema: { type: 'object', properties: { approval_id: { type: 'string' } }, required: ['approval_id'] },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'abhed_finish_task',
    description: 'Close the current task with a short summary for the audit trail.',
    inputSchema: { type: 'object', properties: { summary: { type: 'string' } } },
  },
  {
    name: 'abhed_whoami',
    description: 'Your Abhed role, company and delegated limits.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
];

export function toMcpTool(t) {
  const f = t.function ?? t;
  return {
    name: f.name,
    description: `${f.description ?? ''} (gated by Abhed: may be allowed, held for human approval, or blocked)`.trim(),
    inputSchema: f.parameters ?? f.input_schema ?? { type: 'object', properties: {} },
  };
}

function text(obj, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }], structuredContent: obj, isError };
}

export async function callTool(client, name, args = {}) {
  if (name === 'abhed_whoami') {
    const p = await client.getProfile();
    return text({ agent: p.agent, company: p.company, role: p.role, delegations: p.delegations });
  }
  if (name === 'abhed_start_task') {
    const s = await client.startTask(String(args.task ?? ''), args.subject ? String(args.subject) : undefined);
    return text({ sessionId: s.sessionId, flaggedAsInjection: Boolean(s.tainted), signals: s.signals ?? [] });
  }
  if (name === 'abhed_finish_task') return text(await client.finish(String(args.summary ?? '')));
  if (name === 'abhed_check_approval') {
    const a = await client.approval(String(args.approval_id));
    return text({ approvalId: a.id, status: a.status, output: a.output, approvers: a.votes, expiresAt: a.expiresAt });
  }

  const tools = (await client.getProfile()).tools.map(toMcpTool);
  if (!tools.some((t) => t.name === name)) return text({ decision: 'BLOCKED', reason: `tool ${name} is not granted to this agent` }, true);

  const r = await client.call(name, args);
  if (r.decision === 'ALLOWED') return text({ decision: 'ALLOWED', output: r.output, ledgerRecord: r.record });
  if (r.decision === 'NEEDS_APPROVAL' && r.approvalId) {
    const a = await client.waitForApproval(r.approvalId);
    if (a.status === 'EXECUTED') return text({ decision: 'APPROVED_AND_EXECUTED', output: a.output, approvers: a.votes, ledgerRecord: a.record });
    if (a.status === 'PENDING') return text({ decision: 'NEEDS_APPROVAL', approvalId: r.approvalId, reason: r.reason, approverRole: a.approverRole, next: 'A person must approve this in Abhed. Call abhed_check_approval later; do not retry the action.' });
    return text({ decision: a.status, approvalId: r.approvalId, reason: r.reason }, true);
  }
  return text({ decision: r.decision, reason: r.reason, rule: r.rule, ledgerRecord: r.record, paused: r.paused }, true);
}

export function makeHandler(client) {
  return async function handle(msg) {
    const { id, method, params = {} } = msg;
    if (id === undefined || id === null) return null;
    const ok = (result) => ({ jsonrpc: '2.0', id, result });
    const fail = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      if (method === 'initialize') {
        const v = VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0];
        return ok({ protocolVersion: v, capabilities: { tools: {} }, serverInfo: INFO,
          instructions: 'Every tool call passes through Abhed. Start with abhed_start_task. If a call needs approval, wait or check it later; never try to work around a block.' });
      }
      if (method === 'ping') return ok({});
      if (method === 'tools/list') {
        const p = await client.getProfile();
        return ok({ tools: [...META_TOOLS, ...p.tools.map(toMcpTool)] });
      }
      if (method === 'tools/call') return ok(await callTool(client, params.name, params.arguments ?? {}));
      return fail(-32601, `method not found: ${method}`);
    } catch (e) {
      if (method === 'tools/call') return ok(text({ error: e.message, status: e.status }, true));
      return fail(-32603, e.message);
    }
  };
}

export function serve(cfg = config()) {
  if (!cfg.key) {
    process.stderr.write('abhed-mcp: set ABHED_AGENT_KEY (an Abhed agent key from your Abhed console)\n');
    process.exit(1);
  }
  const handle = makeHandler(new AbhedClient(cfg));
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    if (!line.trim()) return;
    let msg;
    try { msg = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
    const res = await handle(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
}

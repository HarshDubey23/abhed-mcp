# abhed-mcp

**Put any MCP agent's tool calls behind a gate: allowed, held for a human, or blocked, with every decision on a signed ledger.**

[Abhed](https://github.com/HarshDubey23/hackarena) is an action gate for AI agents. This MCP
server exposes an agent's Abhed tools to any MCP client (Cursor, VS Code,
Windsurf and others) and sends every call through Abhed first:

| Abhed's decision | What the agent gets back |
|---|---|
| `ALLOWED` | the tool's output |
| `NEEDS_APPROVAL` | the server waits for a person to approve in Abhed (default 60 s), then returns the real output Abhed executed, or an `approval_id` to check later |
| `BLOCKED` | an error naming the rule that refused it |

Approvals are bound to a hash of the exact action, so a changed action voids them. Abhed writes
each decision to a hash-chained ledger sealed into Ed25519-signed blocks.

Zero dependencies, Node 18+.

## Use it

Add this to your MCP client's config (Cursor: `~/.cursor/mcp.json`; VS Code, Windsurf and
other clients use the same `mcpServers` block):

```json
{
  "mcpServers": {
    "abhed": {
      "command": "npx",
      "args": ["-y", "github:HarshDubey23/abhed-mcp"],
      "env": { "ABHED_AGENT_KEY": "<your agent key>" }
    }
  }
}
```

| Variable | Default | Meaning |
|---|---|---|
| `ABHED_AGENT_KEY` | required | the agent's key from the Abhed console |
| `ABHED_URL` | `https://kavach-os.vercel.app` | your Abhed deployment |
| `ABHED_TASK` | `Task from an MCP client` | task used if the agent doesn't declare one |
| `ABHED_SUBJECT` | none | the customer this agent may act on |
| `ABHED_APPROVAL_WAIT_SECONDS` | `60` | how long to wait for a human before returning the approval id |

**Getting a key.** In Abhed, open **Connect → Abhed SDK → Generate pairing code**, then redeem
the code for a `kv_live_…` key per agent (steps in the
[Abhed README](https://github.com/HarshDubey23/hackarena#path-b--with-the-sdk-banking-healthcare-or-e-commerce)).
The public demo at https://kavach-os.vercel.app runs fictional companies (NovaBank, Bazaar.in,
Sanjeevani Hospital); you can watch your agent's calls arrive in its ledger and approve held ones
in the Approver app yourself.

## Tools

The agent's own tools come from its Abhed profile. For the NovaBank refunds agent those are
`search_policy`, `read_customer`, `lookup_transaction`, `issue_refund`, `send_email` and
`escalate_to_human`. Four tools are always present:

- `abhed_start_task`: declare the task and customer. Abhed scans it for prompt injection.
- `abhed_check_approval`: poll a held action and get its output once executed.
- `abhed_finish_task`: close the task with a summary for the audit trail.
- `abhed_whoami`: role, company and delegated limits.

## Tests

`npm test` runs the real server process over stdio against a mock Abhed API. It covers allowed,
held-then-approved and blocked calls, a tool the agent wasn't granted (it never reaches Abhed),
and protocol errors. The server was also checked read-only against the live demo
(`initialize`, `tools/list`, `abhed_whoami`).

## Limits

- The gate is only as strong as the Abhed deployment behind it. The public demo is a shared,
  fictional sandbox with published demo PINs, so don't connect real systems to it.
- This server forwards calls. It doesn't sandbox anything the agent can reach through *other* MCP
  servers.

MIT licensed.

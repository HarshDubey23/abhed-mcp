# abhed-mcp

**Put any MCP agent's tool calls behind a gate: allowed, held for a human, or blocked, with every decision on a signed ledger.**

[Abhed](https://github.com/HarshDubey23/hackarena) is an action gate for AI agents. This MCP
server exposes an agent's Abhed tools to MCP clients that run local servers (Claude Code,
Claude Desktop, Cursor, VS Code, Windsurf) and sends every call through Abhed first:

| Abhed's decision | What the agent gets back |
|---|---|
| `ALLOWED` | the tool's output |
| `NEEDS_APPROVAL` | the server waits for a person to approve in Abhed (default 60 s), then returns the real output Abhed executed, or an `approval_id` to check later |
| `BLOCKED` | an error naming the rule that refused it |

Approvals are bound to a hash of the exact action, so a changed action voids them. Abhed writes
each decision to a hash-chained ledger sealed into Ed25519-signed blocks.

Zero dependencies, Node 18+.

## Use it

This is a **local STDIO server**: your MCP client starts it on your computer with `npx`, and it
forwards each call over HTTPS to an Abhed deployment, which decides. It is not a hosted remote
MCP server. Needs Node.js 18 or newer (Windows: `winget install OpenJS.NodeJS.LTS`).

**1. Check your key first.** This calls Abhed once and prints who you are, without starting the
server. The key is masked in the output.

```powershell
# Windows (PowerShell)
$env:ABHED_AGENT_KEY = "kv_live_your_key"; npx -y github:HarshDubey23/abhed-mcp --check
```

```bash
# macOS / Linux
ABHED_AGENT_KEY=kv_live_your_key npx -y github:HarshDubey23/abhed-mcp --check
```

**2. Add it to your client.** Each client has its own file and format.

<details open><summary><b>Claude Code</b></summary>

```bash
claude mcp add abhed -e ABHED_AGENT_KEY=kv_live_your_key -- npx -y github:HarshDubey23/abhed-mcp
```

Run `/mcp` inside Claude Code to see it connected.
</details>

<details><summary><b>Claude Desktop</b></summary>

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or
`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS), then quit and reopen
Claude Desktop.

```json
{
  "mcpServers": {
    "abhed": {
      "command": "npx",
      "args": ["-y", "github:HarshDubey23/abhed-mcp"],
      "env": { "ABHED_AGENT_KEY": "kv_live_your_key" }
    }
  }
}
```

On Windows, if it fails to start, use `"command": "cmd"` and
`"args": ["/c", "npx", "-y", "github:HarshDubey23/abhed-mcp"]`.
</details>

<details><summary><b>Cursor</b> and <b>Windsurf</b></summary>

Cursor: `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).
Windsurf: `~/.codeium/windsurf/mcp_config.json`. Both use the same `mcpServers` block as Claude
Desktop above.
</details>

<details><summary><b>VS Code</b></summary>

VS Code uses a different shape: the top-level key is `servers`, not `mcpServers`. The `inputs`
block makes VS Code ask for the key once and store it securely, so it never sits in the file.
Save as `.vscode/mcp.json`:

```json
{
  "inputs": [
    { "type": "promptString", "id": "abhed-key", "description": "Abhed agent key (kv_live_…)", "password": true }
  ],
  "servers": {
    "abhed": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "github:HarshDubey23/abhed-mcp"],
      "env": { "ABHED_AGENT_KEY": "${input:abhed-key}" }
    }
  }
}
```
</details>

**n8n is not supported.** n8n's MCP Client Tool node connects to remote HTTP servers, and this
server is STDIO only. For n8n, use Abhed's no-code gateway instead (see the Abhed README, Path A).

**3. Try it.** Ask the agent: "Call abhed_whoami and tell me my role and limits." Then try a small
action and a large one and watch the decisions arrive in the Abhed ledger.

### Troubleshooting

| What you see | What to do |
|---|---|
| The server exits with "set ABHED_AGENT_KEY" | Add the key to the client's `env` block and restart the client. |
| Only the four `abhed_*` tools appear | The server could not load your profile. Call `abhed_whoami` (or run `--check`) to see why. |
| "Could not reach Abhed at …" | Check `ABHED_URL` and your network or proxy. |
| "Abhed rejected the agent key" | The key is wrong or was replaced. Pair a new key in the Abhed console. |
| "… is paused" (HTTP 423) | The agent was paused in the Abhed console. A person must resume it there. |
| A tool returns `BLOCKED` with a rule | The gate refused it. Read the rule and change the request; don't try to work around it. |

### Disconnect and revoke

1. Pause the agent in the Abhed console. Abhed then refuses its new tasks and tool calls (HTTP 423), whatever the client does.
2. Remove the `abhed` entry from the client config (Claude Code: `claude mcp remove abhed`) and restart the client.
3. If the key may have leaked, pause the agent and pair a new key.

### Settings

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
protocol errors, an unreachable API, a rejected key, and the `--check` and `--version` flags.
CI runs it on Node 18, 20 and 22, on Ubuntu and Windows. The server was also checked read-only against the live demo
(`initialize`, `tools/list`, `abhed_whoami`).

## Limits

- The gate is only as strong as the Abhed deployment behind it. The public demo is a shared,
  fictional sandbox with published demo PINs, so don't connect real systems to it.
- This server forwards calls. It doesn't sandbox anything the agent can reach through *other* MCP
  servers.

MIT licensed.

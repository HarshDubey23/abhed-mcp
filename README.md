<div align="center">

# 🛡️ abhed-mcp
### Universal Action Gate & Audit Ledger for AI Agent Tool Calls (Model Context Protocol)

[![Model Context Protocol](https://img.shields.io/badge/MCP-Standard_Compatible-6366F1?logo=anthropic)](https://modelcontextprotocol.io/)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green?logo=node.js)](https://nodejs.org/)
[![Ed25519 Signed](https://img.shields.io/badge/Ledger-Ed25519_Signed-blue)](#)
[![Zero Dependencies](https://img.shields.io/badge/Dependencies-Zero-success)](#)
[![Live Demo](https://img.shields.io/badge/Console-kavach--os.vercel.app-orange)](https://kavach-os.vercel.app)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

*Put any MCP agent's tool executions behind a deterministic policy gate: **Allowed**, **Held for Human Approval**, or **Blocked** — with every decision cryptographically sealed into a hash-chained audit ledger.*

[Live Demo Console](https://kavach-os.vercel.app) · [Abhed Engine Core (hackarena)](https://github.com/HarshDubey23/hackarena) · [Report Bug](https://github.com/HarshDubey23/abhed-mcp/issues)

---

</div>

## 📌 Why Abhed MCP?

Autonomous AI agents in tools like Cursor, Claude Desktop, and VS Code have raw access to execute bash scripts, access databases, and trigger financial transactions. A single prompt injection can trigger unauthorized or destructive tool invocations.

**`abhed-mcp`** acts as a **zero-trust firewall proxy** between your AI agent and real-world tools:

```
  ┌─────────────────────────────────┐
  │  AI Agent (Claude / Cursor)     │
  └───────────────┬─────────────────┘
                  │ calls tool (e.g. `issue_refund(₹4500)`)
                  ▼
  ┌─────────────────────────────────┐
  │  🛡️ abhed-mcp Gateway           │
  └───────────────┬─────────────────┘
                  │ forwards to policy evaluator
                  ▼
  ┌─────────────────────────────────┐
  │  ⚙️ Abhed Decision Engine       │
  └───────────────┬─────────────────┘
                  │
        ┌─────────┴───────────────────────┐
        ▼                                 ▼
   [ Safe Action ]               [ High-Risk / Ambiguous ]
        │                                 │
     ALLOWED                       NEEDS_APPROVAL
        │                                 │
   Executes Tool                  Pushes to Mobile/Web Console
        │                         Human Approver confirms
        │                                 │
        └────────────────┬────────────────┘
                         ▼
  ┌──────────────────────────────────────────────┐
  │  📜 Hash-Chained, Ed25519 Sealed Ledger      │
  └──────────────────────────────────────────────┘
```

| Decision | System Action | What the Agent Receives |
|---|---|---|
| `ALLOWED` | Evaluated against deterministic policy; verified safe. | The real tool output directly. |
| `NEEDS_APPROVAL` | High-stakes or flagged action held for human authorization. | Server waits for human sign-off (default 60s), then returns executed result or `approval_id`. |
| `BLOCKED` | Policy violation or prompt-injection attempt detected. | Strict error naming the security rule that refused execution. |

---

## ⚡ Quick Start: Add to Your Favorite MCP Client

Add `abhed` to your client configuration with a single block:

### 1. Cursor (`~/.cursor/mcp.json`)
```json
{
  "mcpServers": {
    "abhed": {
      "command": "npx",
      "args": ["-y", "github:HarshDubey23/abhed-mcp"],
      "env": {
        "ABHED_AGENT_KEY": "<your-agent-key>",
        "ABHED_URL": "https://kavach-os.vercel.app"
      }
    }
  }
}
```

### 2. Claude Desktop (`claude_desktop_config.json`)
* **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
* **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "abhed-guard": {
      "command": "npx",
      "args": ["-y", "github:HarshDubey23/abhed-mcp"],
      "env": {
        "ABHED_AGENT_KEY": "<your-agent-key>",
        "ABHED_APPROVAL_WAIT_SECONDS": "90"
      }
    }
  }
}
```

### 3. VS Code (Continue / Cline / Roo Code)
Add to your extension's MCP server settings under the `mcpServers` object.

---

## ⚙️ Configuration Variables

| Variable | Default | Description |
|---|---|---|
| `ABHED_AGENT_KEY` | *(Required)* | Secret agent token generated from the Abhed console |
| `ABHED_URL` | `https://kavach-os.vercel.app` | Target Abhed server deployment endpoint |
| `ABHED_TASK` | `Task from MCP client` | Default task scope if agent does not declare one |
| `ABHED_SUBJECT` | *None* | Constrains agent execution to a specific customer or resource ID |
| `ABHED_APPROVAL_WAIT_SECONDS` | `60` | Duration to wait for human operator approval before returning an asynchronous polling ID |

---

## 🧰 Native Built-in Tools

Four governance tools are provided out of the box to all connected agents:

1. `abhed_start_task`: Declares task intent and customer context. Abhed inspects this initial payload for prompt injection vectors.
2. `abhed_check_approval`: Asynchronously checks if a previously held action has received human approval and retrieves its execution payload.
3. `abhed_finish_task`: Closes the operational session and outputs an auditable summary into the permanent ledger.
4. `abhed_whoami`: Returns the active agent's role, associated organization, and granted resource limits.

---

## 🧪 Testing

The repository features comprehensive zero-dependency unit and integration tests:

```bash
git clone https://github.com/HarshDubey23/abhed-mcp.git
cd abhed-mcp
npm test
```

The test suite runs a live mock Abhed server over `stdio` verifying:
- ✅ Fast-path `ALLOWED` execution
- ⏳ Stateful `NEEDS_APPROVAL` polling and escalation
- ❌ Immediate `BLOCKED` policy enforcement
- 🔒 Rejection of undelegated tools before they leave the client environment

---

## 📄 License

Distributed under the MIT License. See [LICENSE](LICENSE) for details.

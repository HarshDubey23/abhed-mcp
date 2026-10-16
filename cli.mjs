#!/usr/bin/env node
import { serve, check, VERSION } from "./index.mjs";

const arg = process.argv[2];
if (arg === "--version" || arg === "-v") console.log(VERSION);
else if (arg === "--check") process.exitCode = await check();
else if (arg === "--help" || arg === "-h") console.log("Usage: abhed-mcp            run the MCP server over stdio\n       abhed-mcp --check    test ABHED_AGENT_KEY and ABHED_URL, then exit\n       abhed-mcp --version");
else serve();

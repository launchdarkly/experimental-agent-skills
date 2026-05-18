---
name: mcp-configure
description: "Configure the LaunchDarkly hosted MCP server during onboarding. Use when the parent LaunchDarkly onboarding skill reaches Step 4 (MCP). Supports Cursor, Claude Code, Windsurf, GitHub Copilot, and other MCP-compatible agents. OAuth authentication; no API keys for the hosted server."
license: Apache-2.0
compatibility: Requires an MCP-compatible coding agent and a LaunchDarkly account
metadata:
  author: launchdarkly
  version: "0.1.0"
---

# LaunchDarkly MCP Server Configuration (onboarding)

Configures the LaunchDarkly hosted MCP server so flag management skills and onboarding can use MCP tools. Uses OAuth for authentication — no API keys needed for the hosted server.

This skill is nested under [LaunchDarkly onboarding](../SKILL.md); the parent skill's **Step 4** hands off here. **Hosted MCP** is the default. For **federal/EU** or other cases where hosted is unavailable, use the **Local server via `npx`** section in [MCP Config Templates](references/mcp-config-templates.md) and [local MCP server docs](https://launchdarkly.com/docs/home/getting-started/mcp-local).

## Prerequisites

- A LaunchDarkly account (sign up at [https://app.launchdarkly.com/signup?source=agent](https://app.launchdarkly.com/signup?source=agent))
- An MCP-compatible coding agent

## Hosted MCP Servers

LaunchDarkly provides a unified hosted MCP server for all functionality:

| Server      | URL                                             | Purpose                       |
| ----------- | ----------------------------------------------- | ----------------------------- |
| LaunchDarkly (unified) | `https://mcp.launchdarkly.com/mcp/launchdarkly` | Feature flags and AgentControl |

The legacy `mcp/fm` URL still works (it mirrors the unified server) — no migration is needed if the user has `mcp/fm` configured. Only the deprecated `mcp/aiconfigs` URL requires migration (see [Edge Cases](#edge-cases)).

For onboarding, the unified server is all that's needed.

## Workflow

### Step 1: Detect the Agent

If the parent onboarding skill already identified the agent, use that context. Otherwise infer from agent-specific directories, config files, and the tools available to you at runtime. Do not ask the user — pick the strongest match.

### Step 2: Try Quick Install

The fastest path is the quick install link. Present it to the user:

**LaunchDarkly MCP:** [https://mcp.launchdarkly.com/mcp/launchdarkly/install](https://mcp.launchdarkly.com/mcp/launchdarkly/install)

**Important: tell the user what to expect after clicking the link.** The install link may open in the browser, but the authorization or "add server" prompt typically appears **back in the coding environment** (the editor or host app where the agent runs), not in the browser. Immediately after presenting the link, include guidance like:

- After clicking the link, watch your coding environment (the editor where this conversation is running) for an approval dialog, an "add MCP server" prompt, or a tools/integrations panel notification.
- The browser may start the OAuth flow, but you'll likely need to confirm or approve the server in the editor itself.
- **If no prompt appears:** check the editor's MCP, integrations, or tools settings area to see if the server was added but needs to be enabled. If it's not there at all, fall back to manual setup (Step 3 below).

If the quick install link doesn't work (agent doesn't support it, or user prefers manual setup), proceed to Step 3.

### Step 3: Manual Configuration

Locate the MCP config file for the detected agent and add the hosted server entry. See [MCP Config Templates](references/mcp-config-templates.md) for the exact JSON per agent.

| Agent          | Config file location                                       |
| -------------- | ---------------------------------------------------------- |
| Cursor         | `.cursor/mcp.json` (project) or global Cursor settings     |
| Claude Code    | `.mcp.json` (project) or `~/.claude.json` (global)         |
| GitHub Copilot | Repo **Settings** on GitHub.com → Copilot → Cloud agent → MCP (see [MCP UI links](references/mcp-ui-links.md)) |
| Windsurf       | Agent-specific MCP config                                  |

**Add the unified LaunchDarkly server for onboarding.** This single server handles feature flags and AgentControl.

### Step 4: Agent-Specific Authorization

After writing the config, some agents need extra steps. **Do not** send users through long manual menu paths only—use [MCP UI links](references/mcp-ui-links.md) (HTTPS docs + `command:` shortcuts for VS Code / Cursor).

**Cursor:**

1. Open MCP in Cursor using the [Cursor MCP doc link and in-app shortcuts](references/mcp-ui-links.md#clients) (e.g. Settings search via `command:` link when clickable).
2. Toggle on **LaunchDarkly feature management** (or the name from your config).
3. Click **Connect** to authorize with the LaunchDarkly account.

**VS Code (when applicable):**

- Use [VS Code MCP doc + `mcp.json` / Settings links](references/mcp-ui-links.md#clients); trust or start the server if prompted.

**Claude Code:**

- Authorization happens automatically on first MCP tool call via OAuth prompt. File-based setup: [Claude Code MCP doc](https://docs.claude.com/en/docs/claude-code/mcp).

**GitHub Copilot:**

- Click **Save** after adding the MCP configuration in repo settings. Use the [GitHub Copilot MCP doc](https://docs.github.com/en/copilot/customizing-copilot/extending-copilot-coding-agent-with-mcp) for the exact **Settings** path on github.com.

### Step 5: Verify MCP Tools (No Mandatory Restart)

Restart is no longer required for Cursor or Claude Code after enabling an MCP server. Probe for tools immediately after the user confirms they've enabled and authorized the server.

1. **Tell the user to enable and authorize the server.** In Cursor: toggle on the LaunchDarkly server in MCP settings and click **Connect**. In Claude Code: the OAuth prompt appears on first tool call. Do **not** tell them to restart yet.

2. **Probe immediately.** After the user confirms the server is enabled, call a lightweight MCP tool (e.g. `list-feature-flags` with the user's project key). Do not ask the user whether MCP is working — just try it.
   - **Success** (normal response, even an empty flag list): MCP is live. Note it in the onboarding log and continue.
   - **Failure** (tool not found, auth error, timeout): proceed to step 3.

3. **If the probe fails, suggest a restart.** Before asking the user to restart:
   - **Update the onboarding log** (`LAUNCHDARKLY_ONBOARDING.md`) with the current state and set **Next step** to "Verify MCP after restart".
   - Tell the user: "The MCP tools aren't visible yet. Some editors need a restart to pick up new MCP servers. Restart your editor and say **'continue LaunchDarkly onboarding'** when you're back — I'll resume from here."
   - Be specific about how to restart: "Restart Cursor" / "reload Claude Code" / "refresh the Copilot agent" depending on what you detected in Step 1.

4. **On resume after restart:** The parent onboarding skill handles resume via the log file. When the next turn starts:
   - Re-probe for MCP tools silently.
   - If tools are now available: "MCP is connected." Continue with onboarding.
   - If tools still missing: fall back to ldcli/API. Note the fallback in the onboarding log. Do **not** block the rest of onboarding — remaining steps must still be completable without MCP. Offer a one-liner to retry later: "You can set up MCP anytime by clicking [quick install link] and restarting."

5. If the failure looks like a config issue (wrong file path, missing OAuth, server not enabled), mention the likely cause so the user can fix it on their own time — but do not block progress.

For **local `npx` server** verification, see [MCP Config Templates — Verify (local server)](references/mcp-config-templates.md#verify-local-server).

## Local MCP: Access Token Setup

When the user needs the **local `npx` server** (federal/EU or other cases where hosted MCP is unavailable), the server requires a `LAUNCHDARKLY_ACCESS_TOKEN`. This is a sensitive credential.

First, tell the user how to create a token if they don't already have one:

> Create an API access token at [app.launchdarkly.com/settings/authorization/tokens/new](https://app.launchdarkly.com/settings/authorization/tokens/new). Give it a descriptive name (e.g. "MCP server") and at minimum the **Reader** role. Copy the token — you won't be able to see it again after leaving the page.

Then ask how they want to add the token to the MCP config:

**D4-LOCAL -- BLOCKING:** Call your structured question tool now.
- question: "The local MCP server needs an API access token to authenticate with LaunchDarkly. You can create one at app.launchdarkly.com/settings/authorization/tokens/new. Once you have the token, how would you like to add it to your MCP config? We recommend adding it yourself — there is a non-zero risk when an AI agent handles secrets, as tokens may persist in conversation history, logs, or model context."
- options:
  - "I'll add the token to the config myself — just tell me which file and variable"
  - "I have the token ready — go ahead and help me wire up the config"
- STOP. Do not write the question as text. Do not write any token value to a config file before the user selects an option.

**If the user adds the token themselves:**
1. Tell them the config file path for their agent (see [MCP Config Templates](references/mcp-config-templates.md))
2. Tell them to set `LAUNCHDARKLY_ACCESS_TOKEN` as the value — either as an environment variable or directly in the config file
3. Remind them to add the config file to `.gitignore` if the token is inline
4. Wait for them to confirm, then proceed to Step 5 (Restart and Auto-Verify)

**If the user wants agent-assisted setup:**
1. Ensure the config file is in `.gitignore` before writing
2. Write the config per [MCP Config Templates](references/mcp-config-templates.md)
3. Remind the user that the token will be visible in the config file and conversation history
4. Proceed to Step 5 (Restart and Auto-Verify)

## Edge Cases

- **User already has MCP configured:** Verify by checking for existing LD MCP entries in the config. If the unified server (`mcp/launchdarkly`) or the legacy `mcp/fm` is present and working, skip configuration. If the deprecated `mcp/aiconfigs` is present, see below.
- **User has the deprecated `mcp/aiconfigs` server:** This URL is deprecated. Do **not** auto-migrate. Use a blocking question:

```json
{
  "questions": [
    {
      "id": "aiconfigs_migration",
      "prompt": "I found the deprecated mcp/aiconfigs server in your config. It should be replaced with the unified LaunchDarkly server (mcp/launchdarkly), which handles both feature flags and AgentControl. Do you want me to migrate?",
      "options": [
        { "id": "yes", "label": "Yes, remove the old server and add the unified one" },
        { "id": "no", "label": "No, leave it as is for now" }
      ]
    }
  ]
}
```

  - If **yes**: remove the `mcp/aiconfigs` entry, ensure the unified `mcp/launchdarkly` server is present (do not duplicate if it's already there), and continue.
  - If **no**: note in the onboarding log that migration was declined. Continue with onboarding — the deprecated server may still work for now.

- **User has the legacy `mcp/fm` server:** No migration needed — `mcp/fm` mirrors the unified server and continues to work. Do not suggest removing it.
- **User has the old npx-based local server:** Migrate them. Remove the old `npx @launchdarkly/mcp-server` entry and any `LD_ACCESS_TOKEN` env vars. Replace with the hosted server config.
- **Federal or EU instances:** The hosted MCP server is not available for federal or EU environments. Use [local MCP server docs](https://launchdarkly.com/docs/home/getting-started/mcp-local) and the **Local server via `npx`** section in [MCP Config Templates](references/mcp-config-templates.md). Follow the [Local MCP: Access Token Setup](#local-mcp-access-token-setup) flow for token handling.
- **Agent not in known list:** Provide the generic pattern: the user needs to add an MCP server entry pointing to `https://mcp.launchdarkly.com/mcp/launchdarkly` using whatever format their agent expects.
- **User opts out of MCP during onboarding:** Document that choice and continue with the parent skill's ldcli/API fallbacks for environments and flags; do not block SDK work.

## What NOT to Do

- Don't configure the old npx-based local server by default. Prefer the hosted server for standard regions.
- Don't ask for or store API keys for the hosted server. The hosted server uses OAuth.
- Don't auto-migrate from the deprecated `mcp/aiconfigs` — always ask via the blocking question.
- Don't suggest restart as the first step — probe for tools immediately after the user enables the server.
- Don't handle the access token for local MCP without asking the user first via the D4-LOCAL decision point.

## References

- [MCP UI links](references/mcp-ui-links.md) — HTTPS + `command:` links to open MCP settings (Cursor, VS Code, Claude Code, Windsurf, GitHub)
- [MCP Config Templates](references/mcp-config-templates.md) — hosted OAuth JSON per agent; **Local server via `npx`** fallback; migration from old local server
- [Official MCP docs](https://launchdarkly.com/docs/home/getting-started/mcp-hosted) — full hosted setup guide

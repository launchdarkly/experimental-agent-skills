/**
 * Promptfoo provider that runs a Claude agent via @anthropic-ai/claude-agent-sdk
 * with the skill loaded the way a real Claude Code session would load it: by
 * dropping it into `.claude/skills/<slug>/SKILL.md` and letting the SDK preload
 * it through the agent definition's `skills` field.
 *
 * Why we use the SDK loader instead of packing SKILL.md as a system prompt:
 *  - Real Claude Code reads SKILL.md off disk, prepends its own system
 *    prompt, has its own tool naming, and triggers skills through agent
 *    definitions. Inlining SKILL.md as the `system` slot would measure
 *    the skill content in a clean room but bypass every one of those
 *    real-world mechanics. The SDK provider keeps the eval harness on
 *    the same path users hit when they install the skill.
 *  - Tool calls go through SDK MCP plumbing into our in-process mock
 *    server, so the trajectory output is `{ response, first_assistant_text,
 *    kickoff_text, assistant_turns, trajectory, tools_called, turn_count,
 *    terminated }` and every existing assertion keeps working without
 *    modification.
 *  - `response` is the final result text (or, on soft termination such as
 *    max_turns, the latest assistant text). `first_assistant_text` is the
 *    first non-empty text the agent emitted - useful for assertions on
 *    kickoff/intro behaviour for skills whose later turns naturally mask
 *    the opening message. `kickoff_text` accumulates every assistant text
 *    block from the start of the run up to AND including the first turn
 *    that contains a USER-OBSERVABLE tool_use - the full pre-action
 *    narrative the user would read before the agent does anything they
 *    can see. Claude Code's internal orchestration tools (`Skill` to
 *    load a skill body, `ToolSearch` to look up a tool) do NOT count as
 *    sealing tool calls; the agent typically invokes those between its
 *    initial "I'll help you with X" preamble and the skill's actual
 *    welcome/payoff/roadmap text, so sealing on them would drop exactly
 *    the prose the kickoff assertions need. Real action tools (Bash,
 *    Read, Glob, Edit, MCP calls, ask-question, etc.) still seal as
 *    expected. `assistant_turns` is an array of `{ turn, text }` entries
 *    for every non-empty assistant text block across the whole run - use
 *    it when you need to grade mid-run narration (progress recaps,
 *    per-stage "what just happened / what's next" beats) that
 *    `kickoff_text` and `response` can't see on their own. `terminated`
 *    is null on success, otherwise the SDK subtype (e.g. "max_turns").
 *
 * Skill scoping:
 *  - Each provider instance gets its own isolated cwd
 *    (`evals/.tmp-skill-fixtures/<slug>/`) containing ONLY a symlink
 *    to the target skill at `.claude/skills/<slug>/`. That way the SDK
 *    only discovers the one skill we're evaluating instead of every
 *    sibling skill that happens to live in the repo. Built-in skills
 *    bundled inside Claude Code's CLI (`debug`, `simplify`, `loop`,
 *    etc.) still load - those are part of the runtime and not
 *    something we can suppress without forking the SDK; they don't
 *    activate on AI-Config prompts so they don't influence behaviour,
 *    they just consume some baseline context tokens.
 *  - `CLAUDE_CONFIG_DIR` is also redirected to a throwaway dir so any
 *    machine-level "policy" skills installed at
 *    `<config>/.claude/skills/` don't leak in either.
 *
 * Promptfoo provider config (set via `config:` in promptfooconfig.yaml):
 *   skill_slug             - REQUIRED. Folder name of the skill to load.
 *                            The provider resolves it under
 *                            skills/<category>/<slug>/ or skills/<slug>/
 *                            (whichever exists) and symlinks it into the
 *                            isolated cwd.
 *   allow_builtins         - When true, also expose Claude Code's built-in
 *                            tools (Read/Grep/Glob/Bash/Edit/Write/...).
 *                            Default false so the agent only sees the
 *                            LaunchDarkly MCP tools we mock.
 *   expose_mcp_tools       - Default true. Set false for skills that
 *                            should NEVER call LaunchDarkly MCP tools
 *                            (routing/advisory skills). Removes the
 *                            mock LD MCP server entirely so the agent
 *                            has nothing to reach for. The harness
 *                            system prompt itself is intentionally
 *                            minimal in either mode - it only tells
 *                            the model whether tools are available,
 *                            never how to behave; that is the
 *                            SKILL.md's job.
 *   force_skill_invocation - Default false. When true, the agent
 *                            definition's `initialPrompt` is set to
 *                            `/<skill_slug>` so the SDK's slash-command
 *                            parser invokes the skill explicitly,
 *                            forcing the SKILL.md body into the
 *                            agent's context. Use for skills whose
 *                            description-based activation is unreliable
 *                            in eval — typically routing/advisory
 *                            skills where the user request would
 *                            otherwise be answered directly from base
 *                            knowledge without ever reading the SKILL.md
 *                            body. In production, the orchestrator (or
 *                            the user typing `/<slug>`) plays the
 *                            equivalent role.
 *   expose_ask_question    - Default false. When true, exposes a second
 *                            in-process MCP server `harness-ux` with
 *                            one tool, `ask-question`, that mirrors the
 *                            IDE-side AskQuestion shape ({prompt,
 *                            options:[{id,label}], multi}). Calls are
 *                            recorded into the same trajectory as LD
 *                            tools (under the bare name `ask-question`)
 *                            and return a canned answer: by default the
 *                            first option's id, overridable per test
 *                            via the `mock_ask_question_answers` test
 *                            var (an array of `selected` arrays
 *                            indexed by call sequence). Use for skills
 *                            with blocking decision points where the
 *                            agent is supposed to halt and ask the
 *                            user a structured question instead of
 *                            guessing or writing the question as prose.
 *
 * Test-level vars:
 *   user_request                - the user turn the agent sees
 *   codebase_context            - optional snippets appended in a <codebase_context> tag
 *   max_turns                   - per-test override, clamped to 1..30 (default 15)
 *   mock_ask_question_answers   - optional array of `selected` arrays returned by
 *                                 successive `ask-question` calls (only honored when
 *                                 `expose_ask_question: true` is set on the provider)
 *
 * Environment variables:
 *   AGENT_MODEL          - SUT model (default claude-sonnet-4-20250514).
 *   ANTHROPIC_API_KEY    - Auth for the SDK's child Claude Code process.
 *   SKILL_EVAL_DEBUG=1   - Dump every SDK message to
 *                          <fixture-cwd>/_debug-messages.json for the
 *                          last test that ran. Off by default.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { z } = require("zod");

const { renderMockResponse, createMockState } = require("./_mock");
const { inputSchemaToZodShape } = require("./_jsonschema-to-zod");

const DEFAULT_MAX_TURNS = 15;
const MODEL =
  process.env.AGENT_MODEL ||
  process.env.EVAL_MODEL ||
  "claude-sonnet-4-20250514";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_ROOT = path.join(REPO_ROOT, "skills");
// Fixture cwds live OUTSIDE the repo tree (under os.tmpdir()) so the
// Claude Agent SDK does not walk up and discover the repo-root .mcp.json.
// That .mcp.json points at the real hosted LaunchDarkly MCP servers and,
// when discovered, makes the agent emit "please open this URL to
// authenticate with LaunchDarkly" prompts in the response - which masks
// whatever the skill was supposed to do. Anchoring fixtures in a system
// temp dir keeps the SDK's project-discovery scope clean.
const FIXTURES_ROOT = path.join(os.tmpdir(), "ld-skill-eval-fixtures");

const toolDefs = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../tools/definitions.json"), "utf-8"),
);

const mockTemplates = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../mocks/tool-responses.json"), "utf-8"),
);

/**
 * Find the on-disk path to the skill folder named `slug`. Skills live
 * under either `skills/<category>/<slug>/SKILL.md` (e.g.
 * skills/ai-configs/aiconfig-create) or `skills/<slug>/SKILL.md` for
 * uncategorised skills. Returns the absolute directory or null.
 */
function resolveSkillSource(slug) {
  const direct = path.join(SKILLS_ROOT, slug);
  if (fs.existsSync(path.join(direct, "SKILL.md"))) return direct;

  for (const category of fs.readdirSync(SKILLS_ROOT, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const candidate = path.join(SKILLS_ROOT, category.name, slug);
    if (fs.existsSync(path.join(candidate, "SKILL.md"))) return candidate;
  }
  return null;
}

/**
 * Build (or reuse) an isolated cwd for the given skill slug:
 *   <fixtures>/<slug>/.claude/skills/<slug>  -> symlink to skill source
 *
 * Uses an idempotent symlink so concurrent test workers reusing the
 * same provider instance don't fight each other. The directory is
 * gitignored.
 */
function ensureFixtureCwd(slug, source) {
  const cwd = path.join(FIXTURES_ROOT, slug);
  const skillsDir = path.join(cwd, ".claude", "skills");
  const link = path.join(skillsDir, slug);

  fs.mkdirSync(skillsDir, { recursive: true });
  let needsLink = true;
  try {
    const existing = fs.readlinkSync(link);
    if (path.resolve(skillsDir, existing) === source) needsLink = false;
  } catch {
    // not a symlink yet; will create
  }
  if (needsLink) {
    try {
      fs.rmSync(link, { recursive: true, force: true });
    } catch {}
    fs.symlinkSync(source, link, "dir");
  }

  // Empty placeholder for CLAUDE_CONFIG_DIR so we don't pick up
  // machine-level managed/policy skills either.
  const isolatedConfig = path.join(cwd, ".isolated-claude-config");
  fs.mkdirSync(isolatedConfig, { recursive: true });

  // Drop an empty .mcp.json in the fixture cwd so the SDK does NOT
  // walk up the directory tree and load the repo-root .mcp.json (which
  // points at the *real* hosted LaunchDarkly MCP servers and triggers
  // an OAuth flow). The eval harness exposes a mocked LD MCP server
  // via createSdkMcpServer; the only place that should provide MCP
  // tools is that mock. Without this, skills whose body does not name
  // a specific mocked tool can fall back to the real server and emit
  // "please authorize" prompts in their response.
  const mcpStub = path.join(cwd, ".mcp.json");
  if (!fs.existsSync(mcpStub)) {
    fs.writeFileSync(mcpStub, JSON.stringify({ mcpServers: {} }, null, 2));
  }

  return { cwd, isolatedConfig };
}

function clampMaxTurns(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_TURNS;
  return Math.min(30, Math.max(1, Math.floor(n)));
}

function previewMock(mock) {
  return JSON.stringify(mock).slice(0, 200) + "...";
}

let sdkPromise = null;
function loadSdk() {
  if (!sdkPromise) {
    sdkPromise = import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkPromise;
}

class ClaudeSkillAgentSdk {
  constructor(options = {}) {
    const config = options.config || {};
    if (!config.skill_slug) {
      throw new Error(
        "claude-skill-agent-sdk requires `config.skill_slug` (the folder name under skills/).",
      );
    }
    this.skillSlug = config.skill_slug;
    this.allowBuiltins = Boolean(config.allow_builtins);
    // expose_mcp_tools defaults to true so existing suites keep working.
    // Set false in promptfooconfig.yaml for skills that should NEVER call
    // LaunchDarkly MCP tools (routing skills, advisory skills, etc.) -
    // having the tools available at all is a Chekhov's-gun situation, so
    // the surest guarantee that a skill won't call them is to not expose
    // them in the first place.
    this.exposeMcpTools = config.expose_mcp_tools !== false;
    // force_skill_invocation prepends `/<skill_slug>` to the user message
    // so the SDK's slash-command parser invokes the skill explicitly
    // (loading the SKILL.md body into context). Use for skills whose
    // description-based activation is unreliable in eval - typically
    // routing/advisory skills where the user request would otherwise
    // be answered directly from base knowledge without ever reading
    // the SKILL.md body. In real production use, users would either
    // type the slash command themselves or the orchestrator would
    // pick the skill; this provider option simulates that explicit
    // invocation in eval. Default false so other suites keep working.
    this.forceSkillInvocation = Boolean(config.force_skill_invocation);
    // expose_ask_question registers a second in-process MCP server
    // (`harness-ux`) with a single `ask-question` tool that mirrors the
    // IDE-side AskQuestion shape. Skills with blocking decision points
    // (e.g. onboarding's D5/D7/D8) are supposed to halt the workflow
    // and ask the user a structured question instead of writing the
    // question as prose; without an actual tool, that behavior is only
    // observable in response text. Exposing the tool here makes
    // decision-point stops first-class trajectory entries that
    // assertions can read directly. Off by default so other suites
    // are untouched.
    this.exposeAskQuestion = Boolean(config.expose_ask_question);

    const source = resolveSkillSource(this.skillSlug);
    if (!source) {
      throw new Error(
        `claude-skill-agent-sdk: could not find SKILL.md for slug "${this.skillSlug}" under ${SKILLS_ROOT}/`,
      );
    }
    const { cwd, isolatedConfig } = ensureFixtureCwd(this.skillSlug, source);
    this.cwd = cwd;
    this.isolatedConfig = isolatedConfig;
  }

  id() {
    return `claude-skill-agent-sdk:${this.skillSlug}`;
  }

  async callApi(_prompt, context) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { error: "ANTHROPIC_API_KEY environment variable is not set" };
    }

    const userRequest =
      context?.vars?.user_request || "Help me with LaunchDarkly";
    const codebaseContext = context?.vars?.codebase_context || "";
    const maxTurns = clampMaxTurns(context?.vars?.max_turns);
    const askQuestionAnswers = Array.isArray(
      context?.vars?.mock_ask_question_answers,
    )
      ? context.vars.mock_ask_question_answers
      : [];

    let userMessage = userRequest;
    if (codebaseContext) {
      userMessage += `\n\n<codebase_context>\n${codebaseContext}\n</codebase_context>`;
    }

    const sdk = await loadSdk();
    const { query, createSdkMcpServer, tool } = sdk;

    const trajectory = [];
    let currentTurn = 0;
    // Per-test mock state. The stateful overlay in _mock.js threads writes
    // (create/setup/clone/update/delete) into this map and reads them back
    // when the agent later calls get-ai-config / get-ai-config-health /
    // list-* . Without this, the agent often retries operations because
    // the static template made them look unsuccessful.
    const mockState = createMockState();

    const mcpTools = this.exposeMcpTools
      ? toolDefs.map((def) =>
          tool(
            def.name,
            def.description,
            inputSchemaToZodShape(def.input_schema),
            async (args) => {
              const template = mockTemplates[def.name];
              const mock = template
                ? renderMockResponse(template, args, def.name, mockState)
                : { error: `No mock configured for tool: ${def.name}` };

              trajectory.push({
                tool: def.name,
                arguments: args,
                turn: currentTurn,
                mock_response_preview: previewMock(mock),
              });

              return {
                content: [{ type: "text", text: JSON.stringify(mock) }],
              };
            },
          ),
        )
      : [];

    const mockServer = this.exposeMcpTools
      ? createSdkMcpServer({
          name: "launchdarkly-mocks",
          tools: mcpTools,
        })
      : null;

    // harness-ux: opt-in second MCP server providing an `ask-question`
    // tool that records calls into the same trajectory and returns a
    // canned answer (first option's id by default, or the matching
    // entry from the per-test `mock_ask_question_answers` array). Lets
    // assertions check for blocking decision-point stops as first-class
    // trajectory entries instead of best-effort response-text regex.
    let askQuestionCallCount = 0;
    const askQuestionTools = this.exposeAskQuestion
      ? [
          tool(
            "ask-question",
            "Ask the user a structured, blocking question with a list of options and wait for their selection. Use this whenever the workflow has a decision point that requires explicit user input (e.g. ambiguous monorepo target, secret-handling preference, dependency-change consent). Do NOT phrase the question as prose in your response when this tool is available.",
            {
              prompt: z
                .string()
                .describe(
                  "The question to display to the user, without the options.",
                ),
              options: z
                .array(
                  z.object({
                    id: z.string().describe("Stable identifier for the option."),
                    label: z
                      .string()
                      .describe("Display text shown to the user."),
                  }),
                )
                .min(2)
                .describe("At least two options for the user to choose from."),
              multi: z
                .boolean()
                .optional()
                .describe(
                  "If true, the user can select multiple options. Defaults to false.",
                ),
            },
            async (args) => {
              const idx = askQuestionCallCount++;
              const override = askQuestionAnswers[idx];
              let selected;
              if (Array.isArray(override) && override.length > 0) {
                selected = override;
              } else if (
                Array.isArray(args.options) &&
                args.options.length > 0
              ) {
                selected = [args.options[0].id];
              } else {
                selected = [];
              }
              const response = { selected };

              trajectory.push({
                tool: "ask-question",
                arguments: args,
                turn: currentTurn,
                mock_response_preview: previewMock(response),
              });

              return {
                content: [{ type: "text", text: JSON.stringify(response) }],
              };
            },
          ),
        ]
      : [];

    const harnessServer = this.exposeAskQuestion
      ? createSdkMcpServer({
          name: "harness-ux",
          tools: askQuestionTools,
        })
      : null;

    const allowedMcpToolNames = [];
    if (this.exposeMcpTools) {
      for (const def of toolDefs) {
        allowedMcpToolNames.push(`mcp__launchdarkly-mocks__${def.name}`);
      }
    }
    if (this.exposeAskQuestion) {
      allowedMcpToolNames.push("mcp__harness-ux__ask-question");
    }

    const agentTools = this.allowBuiltins ? undefined : allowedMcpToolNames;

    // Harness system prompt. Strictly load-bearing mechanics only:
    //   1. Frame the run (eval mode, skill preloaded) so the model
    //      doesn't have to infer it.
    //   2. State tool availability so the model doesn't pause to ask
    //      the (non-existent) user for confirmation. permissionMode
    //      bypasses SDK-level prompts; this stops chat-level "should
    //      I proceed?" turns.
    //   3. Bridge the eval var convention: <codebase_context> is a
    //      harness invention, but skills talk about scanning the repo,
    //      so map one to the other.
    //   4. Forbid foreground long-running processes. Without this,
    //      skills that tell the agent to run `npm run dev`, `next dev`,
    //      `flask run`, etc. will hang the entire eval: Bash tool calls
    //      do not return until the spawned process exits, the dev
    //      server never exits on its own, and there is no user
    //      available to Ctrl+C it. The skill's instruction to start
    //      a server is correct in production; this note tells the
    //      agent how to fulfill that intent under eval mechanics.
    //
    // Anything else - "follow the workflow exactly", "respond with a
    // short summary", "do not append meta-narration", output-contract
    // reinforcement - is the SKILL.md's job. Putting it here measures
    // skill+harness instead of skill, and hides skill defects that
    // would surface in production.
    const harnessPrompt = [
      `You are running under an evaluation harness. The skill "${this.skillSlug}" is loaded into your context.`,
      this.exposeMcpTools
        ? "LaunchDarkly MCP tools are exposed as in-process mocks for this run; treat them as pre-authorized and call them when the skill directs you to."
        : "No LaunchDarkly MCP tools are available for this run.",
      this.exposeAskQuestion
        ? "An `ask-question` tool is available for blocking decision points where the skill says to ask the user a structured question with options. Use it for the question itself (the prompt + options) so the host can render a proper picker -- do not write the options as prose. Any OTHER text the skill instructs you to emit before or alongside that question (welcomes, payoffs, roadmaps, summaries, progress recaps, narration of what's about to happen) is normal prose: emit it as a regular text response in the same turn or earlier, not in place of the call."
        : null,
      "If the user message includes a <codebase_context> block, treat it as the result of any codebase scan the skill would otherwise perform.",
      "Do not start long-running foreground processes (dev servers, file watchers, daemons, REPLs). When the skill instructs you to run `npm run dev`, `next dev`, `flask run`, `rails server`, or any equivalent foreground process, simulate the action: state the command you would run and treat the server as if it were running successfully. Bash tool calls in this harness block until the spawned process exits, so a real dev server will hang the run indefinitely.",
    ]
      .filter(Boolean)
      .join("\n\n");

    const mcpServersMap = {};
    if (mockServer) mcpServersMap["launchdarkly-mocks"] = mockServer;
    if (harnessServer) mcpServersMap["harness-ux"] = harnessServer;

    const queryOptions = {
      cwd: this.cwd,
      settingSources: ["project"],
      mcpServers: mcpServersMap,
      model: MODEL,
      maxTurns,
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
      // Disable on-disk session state. Promptfoo runs tests with
      // concurrency >1 by default; two parallel queries sharing the
      // same per-skill cwd would otherwise both try to write to
      // <cwd>/.claude/projects/.../session.jsonl and deadlock. We
      // also don't need session resumption for single-shot evals.
      persistSession: false,
      env: {
        ...process.env,
        // Redirect machine-level managed/policy skills lookup so we
        // don't accidentally inherit anything an admin installed at
        // ~/Library/Application Support/ClaudeCode/.claude/skills/.
        CLAUDE_CONFIG_DIR: this.isolatedConfig,
      },
      agent: "eval-agent",
      agents: {
        "eval-agent": {
          description: "Evaluation harness agent for LaunchDarkly skills.",
          prompt: harnessPrompt,
          skills: [this.skillSlug],
          ...(this.forceSkillInvocation
            ? { initialPrompt: `/${this.skillSlug}` }
            : {}),
          ...(agentTools ? { tools: agentTools } : {}),
        },
      },
    };

    if (!this.allowBuiltins) {
      queryOptions.tools = [];
    }

    let finalText = "";
    let firstAssistantText = "";
    let lastAssistantText = "";
    // assistantTurns captures every non-empty assistant text block across
    // the whole run as `{ turn, text }` entries in order. Grades for
    // mid-run narration (progress recaps, per-stage "what just happened /
    // what's next" beats) read this; `kickoff_text` and `response` alone
    // cannot see turns 3..N-1 because `lastAssistantText` is overwritten
    // every turn. Existing assertions still work unchanged - they read
    // specific fields by name.
    const assistantTurns = [];
    // kickoffText accumulates every assistant text block from the start of
    // the run up to AND including the first turn that contains a tool_use
    // block. The motivation: skills that have a deliberate orientation
    // phase (welcome, payoff, roadmap, structured question setup) often
    // spread that across 1-3 text turns before the first tool call. The
    // agent also tends to emit a generic "I'll help you with X" preamble
    // before reaching the skill body, which makes `first_assistant_text`
    // a noisy signal for "did the agent kick off correctly?". `kickoff_text`
    // is the full pre-action narrative — everything the user would read
    // before the agent actually does anything observable. Sealed on the
    // first tool_use so subsequent inter-turn commentary doesn't dilute
    // it. Inline text in the same turn as the first tool_use IS included
    // (the "let me ask you something" preface to the call belongs in the
    // kickoff body).
    let kickoffText = "";
    let kickoffSealed = false;
    let resultMessage = null;
    let terminationReason = null;
    const debug = process.env.SKILL_EVAL_DEBUG === "1";
    const allMessages = [];

    // Treat "max_turns reached" as a soft termination: assertions still run
    // against whatever trajectory + final text were produced before the cap.
    // Other errors are hard failures that abort the run as before.
    const isMaxTurnsMessage = (text) =>
      typeof text === "string" && /maximum number of turns/i.test(text);

    // Pull all top-level text content blocks out of an SDK assistant
    // message. SDK messages wrap an Anthropic-style message whose `content`
    // is an array of {type, text} blocks (interleaved with tool_use blocks).
    // We only want the text the model would have shown to the user.
    const extractAssistantText = (msg) => {
      const content =
        (msg && msg.message && msg.message.content) ||
        (msg && msg.content) ||
        null;
      if (!Array.isArray(content)) return "";
      return content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
    };

    // Tools that Claude Code uses internally to orchestrate skill loading
    // and tool routing. They are not user-observable "agent took action"
    // signals -- the agent invokes `Skill` to load a skill body into
    // context, and `ToolSearch` to locate a tool by descriptor. Both can
    // fire BEFORE the agent emits the skill's instructed kickoff prose
    // (welcome, payoff, roadmap, etc.). If we seal `kickoff_text` on
    // these, we lose the very text the kickoff assertions need to grade.
    // Real action tools (Bash, Read, Glob, Edit, MCP calls, ask-question,
    // etc.) still seal as before.
    const KICKOFF_META_TOOLS = new Set(["Skill", "ToolSearch"]);
    const hasKickoffSealingToolUse = (msg) => {
      const content =
        (msg && msg.message && msg.message.content) ||
        (msg && msg.content) ||
        null;
      if (!Array.isArray(content)) return false;
      return content.some(
        (b) =>
          b &&
          b.type === "tool_use" &&
          !KICKOFF_META_TOOLS.has(b.name),
      );
    };

    try {
      const q = query({ prompt: userMessage, options: queryOptions });
      for await (const msg of q) {
        if (debug) allMessages.push(msg);
        if (msg.type === "assistant") {
          currentTurn += 1;
          const text = extractAssistantText(msg);
          if (text) {
            if (!firstAssistantText) firstAssistantText = text;
            lastAssistantText = text;
            assistantTurns.push({ turn: currentTurn, text });
            if (!kickoffSealed) {
              kickoffText += (kickoffText ? "\n\n" : "") + text;
            }
          }
          if (!kickoffSealed && hasKickoffSealingToolUse(msg)) {
            kickoffSealed = true;
          }
        } else if (msg.type === "result") {
          resultMessage = msg;
          if (msg.subtype === "success" && typeof msg.result === "string") {
            finalText = msg.result;
          } else if (typeof msg.subtype === "string") {
            terminationReason = msg.subtype;
          }
        }
      }
    } catch (err) {
      const errMessage = err && err.message ? err.message : String(err);
      if (isMaxTurnsMessage(errMessage)) {
        terminationReason = terminationReason || "max_turns";
      } else {
        return {
          error: `claude-skill-agent-sdk failed: ${errMessage}`,
        };
      }
    }

    // If the run terminated before a `result success` (max_turns, error
    // subtype, etc.) but the agent did produce assistant text along the
    // way, surface the latest assistant text as the response. Without
    // this, every soft-terminated run would lose its prose entirely.
    if (!finalText && lastAssistantText) {
      finalText = lastAssistantText;
    }

    if (debug) {
      const debugDump = path.join(this.cwd, "_debug-messages.json");
      try {
        fs.writeFileSync(
          debugDump,
          JSON.stringify(allMessages, (_k, v) => {
            if (v && typeof v === "object" && typeof v.then === "function") return "[Promise]";
            return v;
          }, 2),
        );
        console.error(`[skill-eval-debug] wrote ${debugDump}`);
      } catch (e) {
        console.error(`[skill-eval-debug] failed to write dump: ${e.message}`);
      }
    }

    // Sum per-model usage so the totals reflect every turn, including
    // cache reads/creations. `resultMessage.usage` only carries the
    // last turn's numbers, which made the promptfoo CLI's per-provider
    // token totals look ~30x smaller than reality on multi-turn runs.
    const modelUsage = resultMessage?.modelUsage || {};
    let inputTokens = 0;
    let outputTokens = 0;
    for (const entry of Object.values(modelUsage)) {
      inputTokens +=
        (entry?.inputTokens || 0) +
        (entry?.cacheReadInputTokens || 0) +
        (entry?.cacheCreationInputTokens || 0);
      outputTokens += entry?.outputTokens || 0;
    }
    if (inputTokens === 0 && outputTokens === 0) {
      inputTokens = resultMessage?.usage?.input_tokens || 0;
      outputTokens = resultMessage?.usage?.output_tokens || 0;
    }

    const cost =
      typeof resultMessage?.total_cost_usd === "number"
        ? resultMessage.total_cost_usd
        : 0;
    const turnCount =
      typeof resultMessage?.num_turns === "number"
        ? resultMessage.num_turns
        : currentTurn;

    return {
      output: JSON.stringify({
        response: finalText || "(no final response captured)",
        first_assistant_text: firstAssistantText,
        kickoff_text: kickoffText,
        assistant_turns: assistantTurns,
        trajectory,
        tools_called: trajectory.map((t) => t.tool),
        turn_count: turnCount,
        terminated: terminationReason,
      }),
      tokenUsage: {
        total: inputTokens + outputTokens,
        prompt: inputTokens,
        completion: outputTokens,
      },
      cost,
    };
  }
}

module.exports = ClaudeSkillAgentSdk;

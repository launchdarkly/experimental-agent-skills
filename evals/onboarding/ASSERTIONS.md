# Onboarding skill eval — assertions reference

A peer-readable breakdown of every assertion in the onboarding eval suite. Each scenario combines several deterministic checks (cheap, regression-stable) with one LLM rubric (judgment call on the qualitative parts). Weights determine how much each contributes to the test's score.

The actual checks live in [`promptfooconfig.yaml`](./promptfooconfig.yaml); this file is the plain-English version for review.

This suite covers the `onboarding-scripted` skill at `skills/onboarding-scripted/SKILL.md` — a parent orchestrator with a Kickoff phase, four numbered stages (Step 1 Explore, Step 2 Connect / MCP, Step 3 Install / SDK, Step 4 Ship / first flag), and inline `AskQuestion` decision points (`account_status` at kickoff, `app_location` for unclear workspaces, `mcp_decision` before MCP setup, `sdk_install_mode` before SDK install, `off_state_confirmed` before the first toggle).

---

## Concepts cheat sheet

If you've never used promptfoo, this section is the one to skim first. The rest of the doc assumes the vocabulary below.

### The eval pipeline at a glance

1. **A test** = one scenario (`vars`: user request + codebase context + per-test knobs like `max_turns`).
2. **The provider** runs the agent against that scenario in an isolated temp directory with the onboarding-scripted skill loaded and our mocked LaunchDarkly MCP tools wired up. **No real LaunchDarkly API calls happen** — every tool returns canned data so runs are deterministic and free of side-effects on real projects.
3. **The provider returns** a structured envelope: `response`, `first_assistant_text`, `trajectory` (every MCP tool call with its arguments), `tools_called` (just the names, in order), `turn_count`, and `terminated` (null on success, else the SDK termination reason like `"error_max_turns"`).
4. **Each assertion** in the test runs against that envelope and reports `{ pass, score (0.0-1.0), reason }`.
5. **The test's overall score** is the weighted average of all its assertions. The test "passes" only if **every** assertion passes.

### Provider envelope fields (what assertions read)

| Field | What it is | When to use it |
|---|---|---|
| `response` | The agent's final text — what the user would see at end-of-flow. On `error_max_turns`, falls back to the most recent assistant text. | "Did the agent eventually do/say X?" assertions. |
| `first_assistant_text` | The first non-empty user-facing text the agent produced. Often a generic "I'll help you with X" preamble before the skill body kicks in. | "Did the agent's very first words match X?" — narrowly. Prefer `kickoff_text` for orientation/kickoff scoring. |
| `kickoff_text` | Every assistant text turn from the start of the run up to AND including the first turn that contains a tool call. The full pre-action narrative — preamble + skill-driven welcome/roadmap/payoff. | "Did the agent's kickoff arc cover X before doing anything?" assertions. This is what Test 1's `roadmap_framing`, `leads_with_payoff`, `no_premature_key_question`, and `kickoff_quality` rubric all read. |
| `trajectory` | Ordered list of `{ tool, arguments, turn, mock_response_preview }` for every MCP call (LaunchDarkly mocks + the harness `ask-question` tool). Built-in tools (Read/Write/Bash/Edit/Grep/Glob/TodoWrite) are NOT recorded — they run inside the SDK. | Inspecting *what arguments* the agent passed (e.g. "was the flag key kebab-case?"). |
| `tools_called` | Just the tool names from `trajectory`, in order. | "Did the agent call X?" / "Did X come after Y?" assertions. |
| `turn_count` | Number of assistant messages the SDK emitted. | Mostly informational; useful when debugging. |
| `terminated` | `null` on success; otherwise an SDK subtype (e.g. `"error_max_turns"`). | Distinguishing "agent finished" from "agent ran out of turns". |

### Assertion types we use

| Type | What it is | Example in this suite |
|---|---|---|
| **Deterministic (`javascript`)** | A small JS snippet that gets the envelope as `output` and returns `{ pass, score, reason }`. Runs locally, no API call, ~free, totally repeatable. | "Did `tools_called` include `create-feature-flag`?" |
| **LLM rubric (`llm-rubric`)** | A natural-language prompt graded by Claude Haiku. Returns a 0.0-1.0 score with reasoning. Costs ~$0.001 per grade and has some run-to-run variance. | "Did the opening reply sound like a knowledgeable colleague rather than a workflow engine?" |

We deliberately combine both: deterministic checks catch the regressions you can describe with a regex, rubrics catch the nuance the regex misses. Each test has many deterministic checks and exactly one rubric.

### Weights

Each assertion has a `weight` (default 1). Weights only matter *within a single test* — they decide how much each assertion contributes to that test's overall score. Our convention:

| Weight | Use for |
|---|---|
| **3** | Critical outcomes — the thing the test exists to verify. (E.g. "agent called `ask-question` with the `account_status` form".) |
| **2** | Important supporting checks — quality / safety guardrails. (E.g. "no internal labels leaked".) |
| **1** | Nice-to-haves and the LLM rubric is often weighted 2; deterministic guards are sometimes weighted 1 if they're easy to over-fit. |
| **0** | Informational — runs but doesn't affect score. (`output_valid` uses this.) |

The test's overall score is `sum(passed_weight) / sum(total_weight)`, where each assertion contributes `assertion.score × assertion.weight`.

### Thresholds (latency)

One threshold-style assertion is inherited from [`shared/defaults.yaml`](../shared/defaults.yaml) and runs on every test in every suite:

- **`latency`** — fails if wall-clock time exceeds **90 seconds**. Onboarding tests run 90-230 seconds because they involve Bash/Read/Write loops, so this assertion fails frequently for *this* suite. **Treat it as informational** — it's tuned for single-action skills like `aiconfig-create`, not multi-turn orchestrators. Don't read latency failures as "the skill is broken"; read them as "this is an expensive skill, watch the trend over time."

**Note on cost:** there is *no* cost assertion. Per-run cost varies by an order of magnitude across skills, so a global threshold would flag too aggressively for orchestrators or too leniently for single-action skills. Cost is still reported in promptfoo's run summary and rolled up into `eval-scores.json` — track it as a trend rather than as a hard pass/fail.

### Per-criterion scoring inside rubrics

Each LLM rubric lists 3 or 4 criteria with a per-miss deduction (e.g. "0.25 deducted per miss" for a 4-criterion rubric, "0.33 deducted per miss" for a 3-criterion rubric). The grader returns a single score in `[0, 1]`. A rubric "passes" only at score `1.0`; partial scores still contribute to the test's weighted average.

### What "pass" / "fail" actually mean for a test

- A test **passes** only if every single assertion passes (`score === 1.0` for all of them).
- A test **fails** if any assertion fails — but the score still tells you *how much* it failed by. A test at 0.86 with one strict-but-noisy assertion failing is in much better shape than a test at 0.30 with five core assertions failing.
- We track the **score** per test over time, not just pass/fail, so we can see drift before a test flips from green to red.

### Per-test knobs

| Var | What it does |
|---|---|
| `user_request` | The user's first turn — what the agent has to react to. |
| `codebase_context` | Pasted into the user message inside `<codebase_context>` tags. Stands in for the file scan / git inspection the skill would normally do. |
| `max_turns` | How many assistant turns the SDK is allowed before forcing termination. Per-test (clamped 1-30). When this triggers, `terminated` is set to `"error_max_turns"` and assertions still run against partial state. |
| `mock_ask_question_answers` | Optional. Per-test override for what the harness's `ask-question` tool returns; defaults to the first option's id. |

### Provider config knobs (suite-wide)

Set once in `providers[0].config`:

| Flag | What it does |
|---|---|
| `skill_slug: onboarding-scripted` | Which skill to load into the agent's context. The provider auto-resolves `skills/onboarding-scripted/`. |
| `allow_builtins: true` | Exposes Read/Write/Bash/Edit/Grep/Glob/TodoWrite. The skill needs them for Step 1 (codebase scan), Step 2 (`npx skills add` for `mcp-configure`), and Step 3 (`npx skills add` for `sdk-install`). |
| `expose_mcp_tools: true` | Registers the 24 mocked LaunchDarkly MCP tools as an in-process MCP server. Needed for the Step 2 post-MCP probe, the Step 4 first-flag flow, and the Resume re-survey. |
| `expose_ask_question: true` | Registers a second in-process MCP server (`harness-ux`) with one tool, `ask-question`, that mirrors the IDE's structured-question shape. The skill calls this at kickoff (`account_status`), in Step 1 (`app_location` for unclear workspaces), Step 2 (`mcp_decision`), Step 3 (`sdk_install_mode`), and Step 4 (`off_state_confirmed`). |

---

## Test 1 — Happy-path kickoff

**Scenario:** Clean Node.js Express repo, no LaunchDarkly anywhere. User says "Onboard me to LaunchDarkly. Project key is web-app." `max_turns: 5` (kickoff only — we don't need the agent to race to Step 4 to score the opening behavior).

**What we're scoring:** Whether the agent's full **kickoff arc** (every text turn before the first tool call) leads with the payoff, conveys the four-row roadmap, and whether the agent reaches for `ask-question` to collect `account_status` before doing any setup work.

We score `kickoff_text` rather than `first_assistant_text` because agents typically emit a generic "I'll help you with X" preamble in turn 1 and the skill-driven welcome/roadmap lands in turn 2 just before the `ask-question` call. The kickoff arc is what the user actually reads before the agent does anything observable.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `roadmap_framing` | 3 | `kickoff_text` names at least 3 of the 4 onboarding "arc beats" matching the skill's roadmap table: scanning the project, installing the SDK, creating the first flag, MCP. Score is proportional to how many beats appear. |
| `asks_account_status` | 3 | The agent called `ask-question` with arguments that look like the `account_status` form — option labels mentioning "I have an account" / "I need to sign up" or a prompt asking whether the user already has a LaunchDarkly account. Per the skill: "Use the `AskQuestion` tool to collect account status before proceeding. Do not scan files, run commands, or install anything until the user responds." |
| `no_premature_key_question` | 3 | `kickoff_text` does **not** demand an SDK key, client-side ID, mobile key, API token, or access token from the user. Credentials come later, in Step 3. |
| `no_internal_labels` | 2 | Neither `first_assistant_text` nor the final wrap-up leaks workflow-engine vocabulary: no `BLOCKING`, no `STOP. Do not continue`, no "hand off" / "proceed to next step", no instructions like "call your structured question tool", no skill file paths (`sdk-install/SKILL.md`), no `Step N -- label` or `Step N: Label` constructions in chat. |
| `leads_with_payoff` | 1 | `kickoff_text` mentions the payoff — "flip a switch", "no redeploy", "no code push", "watch your app change", or a paraphrase. The skill's Kickoff says: "lead with the payoff... by the end of this, they will flip a switch in LaunchDarkly and watch their app change — no redeploy, no code push." |

### LLM rubric — `kickoff_quality` (weight 2)

Grader evaluates the **kickoff arc** (`kickoff_text`), not the final wrap-up. Four criteria, 0.25 deducted per miss:

1. Did the kickoff lead with welcome + payoff (flip a switch / no redeploy)?
2. Did it convey the four-stage roadmap (scan / SDK / first flag / MCP) without numbered "Step N" labels?
3. Did it set up an account-status question (or call the question tool) before doing any setup work, and avoid asking for credentials up front?
4. Did it sound conversational and direct — short, active, practitioner-to-practitioner — rather than a copy-pasted workflow? A brief generic preamble like "I'll help you onboard" is acceptable as long as the skill-driven welcome+roadmap+question follows in the same kickoff arc.

Score 0 if `kickoff_text` is empty (the agent never spoke before being cut off).

---

## Test 2 — Monorepo / unclear workspace

**Scenario:** pnpm workspace with `packages/api` (Express), `packages/web` (Next.js), `packages/shared`. User says "Add LaunchDarkly to this monorepo. Project key is platform."

**What we're scoring:** Whether the agent stops and asks a structured question naming the candidate packages instead of silently picking one.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `calls_ask_question` | 3 | The agent called the harness's `ask-question` tool at some point during the run. (We can see this in the trajectory because the harness records every call.) |
| `ask_question_offers_packages` | 2 | At least one `ask-question` call passes options that mention at least two of the three candidate packages (`api`, `web`, `shared`) — i.e. the agent surfaced the real workspace choices, not generic options. The agent typically calls `ask-question` more than once in this scenario (`account_status` at kickoff, then `app_location` for the workspace), so we look for any call that fits the shape. |
| `no_write_tools` | 3 | The agent did **not** call any LaunchDarkly *mutation* tool (create-feature-flag, update-feature-flag, create-flag, toggle-flag, update-flag-settings, setup-ai-config, create-ai-config, etc.). It must not start changing things before the user picks a workspace. |

### LLM rubric — `decision_quality` (weight 2)

Four criteria, 0.25 deducted per miss:

1. Did the agent recognize this is a monorepo / multi-package repo and not silently pick one package?
2. Did it ask exactly one workspace-selection question naming the candidate packages (api / web / shared) as options?
3. Did it phrase the question conversationally instead of leaking internal labels like "Step 1 -- explore" or skill-file references into chat?
4. Did it avoid starting any LaunchDarkly setup (MCP config, SDK install, flag creation) before getting the answer?

---

## Test 3 — SDK already installed (skip Step 3)

**Scenario:** Node.js Express repo where `@launchdarkly/node-server-sdk` is already a dependency, `src/launchdarkly.js` initializes the client at startup, MCP is configured, and there are no flags yet. User says "Set up LaunchDarkly in this project. Project key is web-app."

**What we're scoring:** Whether the agent recognizes the SDK is already there, skips Step 3 entirely, and proceeds to Step 4 (first flag).

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `skips_install` | 3 | The agent did **not** suggest re-installing the SDK in the final response (no `npm install @launchdarkly/...`, `pnpm add @launchdarkly/...`, or `yarn add @launchdarkly/...`). |
| `proceeds_to_first_flag` | 3 | At least one of: (a) the response mentions creating a first/initial/starter feature flag in conversational terms, **or** (b) the trajectory shows the agent actually called `create-feature-flag` / `create-flag`. Either signals the agent advanced to Step 4. Half-credit for one, full credit for both. |
| `no_redundant_explore` | 1 | The response does **not** re-narrate kickoff phrases like "let's start by exploring", "first I'll check the project", or "let me install the companion flag skills". The skill expects the agent to skip ahead, not start over. |

### LLM rubric — `skip_quality` (weight 2)

Three criteria, 0.33 deducted per miss:

1. Did the agent recognize the SDK is already installed and initialized (mention the existing setup, file, or version)?
2. Did it skip giving install instructions for any `@launchdarkly/*` package?
3. Did it move on to creating a first flag (creating a flag via MCP, suggesting a flag name, or describing the create → verify off → toggle on → verify on flow)?

---

## Test 4 — Resume after restart

**Scenario:** Node.js Express repo where the SDK is already installed and initialized (`@launchdarkly/node-server-sdk` + `src/launchdarkly.js`), MCP was configured earlier in the session (the user just restarted their editor after MCP setup), and no flags exist yet. User says "Continue onboarding."

**What we're scoring:** Whether the agent re-surveys live state silently per the skill's "Resume After Restart" section (probe MCP via a tool call, then dependency scan, then flag-evaluation scan), lands on Step 4 (first flag), and does not re-run the kickoff.

The skill explicitly does **not** use a log file (no `LAUNCHDARKLY_ONBOARDING.md`). Resume detection comes entirely from live state.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `resume_acknowledged` | 3 | The opening reply contains language that signals continuation: "resume", "resuming", "picking up", "continuing", "where we left off", "back to onboarding", "re-checking", or "you're connected" / "already connected". |
| `probes_mcp` | 3 | The trajectory contains at least one LaunchDarkly MCP "liveness" call — `get-environments`, `list-flags`, `list-feature-flags`, `get-flag`, `get-feature-flag`, or `list-ai-configs`. The Resume section says: "attempt a LaunchDarkly MCP tool call (e.g., list environments or projects). Success = MCP is live." |
| `does_not_redo_setup` | 3 | The opening reply does **not** contain phrases that suggest restarting from scratch: "let's start by exploring", "first I'll explore the project", "running npx skills add", "installing the companion flag skills", "first let me detect the agent", or a re-asked "do you already have a LaunchDarkly account?" question. The work is already done — the agent shouldn't pretend otherwise. |
| `targets_first_flag` | 2 | Either the opening reply or the final response mentions the first flag as the next move, or the trajectory shows the agent actually called `create-feature-flag` / `create-flag`. Per the Resume rules: "MCP live, SDK present, no flag → resume at Step 4. State: 'You're connected and the SDK is installed. Creating your first flag now.'" Half-credit for either signal, full credit for both. |

### LLM rubric — `resume_quality` (weight 2)

Three criteria, 0.33 deducted per miss. Grader uses `first_assistant_text` for criteria 1 and 3, either field for criterion 2:

1. Did the opening reply acknowledge that work was already done (re-surveyed state, mentions MCP being connected and the SDK being installed) without re-narrating Step 1 / Step 2 / Step 3?
2. Did the agent correctly identify creating the first flag (Step 4 / Ship) as the next action?
3. Did the opening reply avoid running or recommending the kickoff actions again (no fresh project-exploration narrative, no re-installing the companion skills, no `account_status` question, no re-prompting for MCP setup)?

---

## Test 5 — First-flag handoff (Step 4 / Ship)

**Scenario:** Onboarding through Step 3 is complete. SDK is installed and initialized; MCP is configured; no flags exist yet. User says "Create my first feature flag in LaunchDarkly. The SDK is already wired up. Project key is web-app."

**What we're scoring:** Whether the agent creates a sensibly-named boolean flag, gates the toggle behind an `off_state_confirmed` `ask-question` form, and verifies the flag with a toggle cycle — without sneaking in targeting rules.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `calls_create_feature_flag` | 3 | The agent called a flag-creation tool — either the canonical `create-feature-flag` or the alias `create-flag`. (Both are exposed in the harness; we accept either name as evidence the outcome was achieved.) |
| `flag_key_kebab_case` | 2 | The `key` argument the agent passed to the create call is lowercase kebab-case (e.g. `show-greeting`, `enable-banner`) — starts with a letter, only `[a-z0-9-]`, no leading/trailing/double dashes. |
| `calls_toggle_to_verify` | 2 | A toggle tool (`update-feature-flag` or `toggle-flag`) was called **after** the create call. The skill's first-flag flow is "create off → confirm off → toggle on", so a toggle that lands later in the trajectory is the strongest signal that the verification cycle ran. |
| `asks_off_state_before_toggle` | 3 | Between the create-flag call and the LAST toggle, there is an `ask-question` call whose prompt or option labels look like an `off_state_confirmed` form ("Open your app... that's the OFF state. Can you see it?" / "turn the flag on" option). The skill says: "Do not toggle the flag based on a user command alone — always gate it behind this confirmation form." Partial credit (0.5) if there's an unrelated `ask-question` between create and toggle but it's not clearly OFF-state confirmation. |
| `no_premature_targeting` | 1 | None of the toggle calls included a non-empty `instructions` array (semantic-patch instructions for rules/rollouts/targeting). The first-flag step is a proof-of-life demo only — targeting belongs later. |

### LLM rubric — `first_flag_quality` (weight 2)

Four criteria, 0.25 deducted per miss:

1. Did the agent create a boolean flag with a sensible kebab-case key (e.g. `show-greeting`, `enable-banner`)?
2. Did it gate the toggle behind a structured OFF-state confirmation (asking the user to confirm the flag-gated element is currently absent / inactive before turning the flag on)?
3. Did it avoid adding targeting rules or rollouts in this step?
4. Did it avoid hardcoding SDK keys directly into code (env vars only)?

---

## Cross-cutting checks (inherited from `shared/defaults.yaml`)

These run on every test in every suite, including this one:

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `output_valid` | 0 (informational) | The provider returned a parseable JSON envelope with `response`, `trajectory`, etc. — i.e. the harness didn't crash. |
| `latency` | 1 | End-to-end run time is under 90 seconds. *Note: the onboarding skill takes 1-3+ minutes per test (multi-turn, Bash + Read + Write loops). Treat latency failures here as informational — the threshold is tuned for single-action skills.* |

Cost is **not** asserted (see the "Thresholds" section in the cheat sheet above for why). Per-run cost is still reported in the promptfoo summary.

---

## Iterating on this suite

When you see a test score drop:

1. **Look at `tools_called` first** — usually tells you whether the agent reached the right step at all. The expected order for a fresh kickoff is roughly: `ask-question` (account_status) → optional Read/Glob/Bash to scan → `ask-question` (mcp_decision) → `ask-question` (sdk_install_mode) → `create-flag` → `ask-question` (off_state_confirmed) → `update-feature-flag`.
2. **Compare `first_assistant_text` vs `response`** — the kickoff and the wrap-up are different beasts. Test 1 and Test 4 both inspect the opening reply directly.
3. **Read the failing assertion's `reason` field** — every assertion explains why it scored what it did (e.g. "arc beats in first reply (1/4): flag" tells you exactly which beats were found).
4. **Re-run a single failing test** with `npm run eval:onboarding:single` (filters to the first test) or by editing the suite to comment out the others — full runs cost ~$1.50, single tests cost $0.20-$0.50.
5. **Tune the assertion only if the skill is behaving correctly and the assertion is wrong.** If the skill is misbehaving, fix the skill — the eval is doing its job.

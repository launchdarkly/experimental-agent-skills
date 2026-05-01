# Onboarding skill eval — assertions reference

A peer-readable breakdown of every assertion in the onboarding eval suite. Each scenario combines several deterministic checks (cheap, regression-stable) with one LLM rubric (judgment call on the qualitative parts). Weights determine how much each contributes to the test's score.

The actual checks live in [`promptfooconfig.yaml`](./promptfooconfig.yaml); this file is the plain-English version for review.

---

## Concepts cheat sheet

If you've never used promptfoo, this section is the one to skim first. The rest of the doc assumes the vocabulary below.

### The eval pipeline at a glance

1. **A test** = one scenario (`vars`: user request + codebase context + per-test knobs like `max_turns`).
2. **The provider** runs the agent against that scenario in an isolated temp directory with the onboarding skill loaded and our mocked LaunchDarkly MCP tools wired up. **No real LaunchDarkly API calls happen** — every tool returns canned data so runs are deterministic and free of side-effects on real projects.
3. **The provider returns** a structured envelope: `response`, `first_assistant_text`, `trajectory` (every MCP tool call with its arguments), `tools_called` (just the names, in order), `turn_count`, and `terminated` (null on success, else the SDK termination reason like `"error_max_turns"`).
4. **Each assertion** in the test runs against that envelope and reports `{ pass, score (0.0-1.0), reason }`.
5. **The test's overall score** is the weighted average of all its assertions. The test "passes" only if **every** assertion passes.

### Provider envelope fields (what assertions read)

| Field | What it is | When to use it |
|---|---|---|
| `response` | The agent's final text — what the user would see at end-of-flow. On `error_max_turns`, falls back to the most recent assistant text. | "Did the agent eventually do/say X?" assertions. |
| `first_assistant_text` | The first non-empty user-facing text the agent produced. Captures the kickoff/orientation message before any tool work. | "Did the agent open with X?" assertions (kickoff, resume acknowledgment). |
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
| **3** | Critical outcomes — the thing the test exists to verify. (E.g. "agent called `ask-question` in the monorepo test".) |
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
| `skill_slug: onboarding` | Which skill to load into the agent's context. |
| `allow_builtins: true` | Exposes Read/Write/Bash/Edit/Grep/Glob/TodoWrite. Onboarding needs them for Steps 0-3 (write log, read codebase, `npx skills add`). |
| `expose_mcp_tools: true` | Registers our 24 mocked LaunchDarkly MCP tools as an in-process MCP server. |
| `expose_ask_question: true` | Registers a second in-process MCP server (`harness-ux`) with one tool, `ask-question`, that mirrors the IDE's structured-question shape. Lets blocking decision points (D5/D7/D8) become first-class trajectory entries instead of best-effort response-text regex. |

---

## Test 1 — Happy-path kickoff

**Scenario:** Clean Node.js Express repo, no LaunchDarkly anywhere. User says "Onboard me to LaunchDarkly. Project key is web-app."

**What we're scoring:** Whether the agent's *opening reply* (first user-facing text, before any work) reads as a friendly roadmap and avoids premature credential questions or leaked internal labels.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `roadmap_framing` | 3 | The opening reply names at least 3 of the 4 onboarding "arc beats": exploring the project, setting up tooling/MCP, installing the SDK, and creating the first flag. Score is proportional to how many beats appear. |
| `no_premature_account_question` | 3 | The opening reply does **not** ask "do you already have a LaunchDarkly account?" or tell the user to sign up before continuing. The skill says account status should be inferred later, not surfaced up front. |
| `no_premature_key_question` | 3 | The opening reply does **not** demand an SDK key, client-side ID, mobile key, API token, or access token from the user. Credentials come later, when the agent actually needs them. |
| `no_internal_labels` | 2 | Neither the opening reply nor the final wrap-up leaks workflow-engine vocabulary into chat: no D-IDs (`D5`, `D7-NOAPP`), no `BLOCKING`, no `STOP. Do not continue`, no instructions like "call your structured question tool", no skill file paths (`sdk-install/SKILL.md`), no `Step N -- label` constructions. |
| `mentions_where_to_run` | 1 | If the opening reply shows any shell command (npm/pnpm/yarn/npx, or a fenced bash block), it also tells the user *where* to run it (integrated terminal, project root, "in the X folder", etc.). If no commands are shown, the check is skipped. |

### LLM rubric — `kickoff_quality` (weight 2)

Grader evaluates **only the opening reply** (`first_assistant_text`), not the final wrap-up. Four criteria, 0.25 deducted per miss:

1. Did the opening reply give a friendly summary covering the arc (explore → tooling → SDK → flag) without numbered "Step N" labels?
2. Did it avoid asking about LaunchDarkly account status up front?
3. Did it avoid asking for SDK keys / tokens / client-side IDs up front?
4. Did it sound conversational ("I'll", "we'll") rather than a copy-pasted workflow?

Score 0 if `first_assistant_text` is empty (the agent never spoke before being cut off).

---

## Test 2 — Monorepo decision point (D5)

**Scenario:** pnpm workspace with `packages/api` (Express), `packages/web` (Next.js), `packages/shared`. User says "Add LaunchDarkly to this monorepo. Project key is platform."

**What we're scoring:** Whether the agent stops and asks a structured question instead of silently picking one package.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `calls_ask_question` | 3 | The agent called the harness's `ask-question` tool at some point during the run. (We can see this in the trajectory because the harness records every call.) |
| `ask_question_offers_packages` | 2 | The options the agent passed to `ask-question` mention at least two of the three candidate packages (`api`, `web`, `shared`) — i.e. it actually surfaced the real choices, not generic options. |
| `no_write_tools` | 3 | The agent did **not** call any LaunchDarkly *mutation* tool (create-feature-flag, update-feature-flag, create-flag, toggle-flag, update-flag-settings, setup-ai-config, create-ai-config, etc.). It must not start changing things before the user picks a workspace. |

### LLM rubric — `decision_quality` (weight 2)

Four criteria, 0.25 deducted per miss:

1. Did the agent recognize this is a monorepo and not silently pick one package?
2. Did it ask exactly one question naming the candidate packages (api / web / shared) as options?
3. Did it phrase the question conversationally instead of pasting "D5 -- BLOCKING" or skill-file references into chat?
4. Did it avoid starting any LaunchDarkly setup (MCP config, SDK install, flag creation) before getting the answer?

---

## Test 3 — SDK already installed (skip Step 5)

**Scenario:** Node.js Express repo where `@launchdarkly/node-server-sdk` is already a dependency, `src/launchdarkly.js` initializes the client at startup, MCP is configured, and there are no flags yet. User says "Set up LaunchDarkly in this project. Project key is web-app."

**What we're scoring:** Whether the agent recognizes the SDK is already there, skips Step 5 entirely, and proceeds to creating the first flag.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `skips_install` | 3 | The agent did **not** suggest re-installing the SDK in the final response (no `npm install @launchdarkly/...`, `pnpm add @launchdarkly/...`, or `yarn add @launchdarkly/...`). |
| `proceeds_to_first_flag` | 3 | At least one of: (a) the response mentions creating a first/initial/starter feature flag in conversational terms, **or** (b) the trajectory shows the agent actually called `create-feature-flag`. Either signals the agent advanced to Step 6. Half-credit for one, full credit for both. |
| `no_redundant_explore` | 1 | The response does **not** re-narrate kickoff phrases like "let's start by exploring", "first I'll check the project", or "let me install the companion flag skills". The skill expects the agent to skip ahead, not start over. |

### LLM rubric — `skip_quality` (weight 2)

Three criteria, 0.33 deducted per miss:

1. Did the agent recognize the SDK is already installed and initialized (mention the existing setup, file, or version)?
2. Did it skip giving install instructions for any `@launchdarkly/*` package?
3. Did it move on to the first-flag step (creating a flag via MCP, suggesting a flag name, or describing the create → verify off → toggle on → verify on flow)?

---

## Test 4 — Resume from existing log

**Scenario:** Repo has a `LAUNCHDARKLY_ONBOARDING.md` with Steps 0-4 marked done and "Next step: Step 5: Install and Initialize the SDK". User says "Continue setting up LaunchDarkly in this project."

**What we're scoring:** Whether the agent reads the log, acknowledges resuming, targets Step 5, and does **not** restart kickoff.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `resume_acknowledged` | 3 | The opening reply contains language that signals continuation: "resume", "resuming", "picking up", "continuing", "where we left off", "back to onboarding", etc. |
| `does_not_redo_setup` | 3 | The opening reply does **not** contain phrases that suggest restarting from scratch: "let's start by exploring", "first I'll explore the project", "running npx skills add", "installing the companion flag skills", "first let me detect the agent". The work is already done — the agent shouldn't pretend otherwise. |
| `targets_recorded_next_step` | 2 | Either the opening reply or the final response mentions the recorded next step explicitly: "Step 5", "install the SDK", "wire up the SDK", "initialize the SDK", or `@launchdarkly/<package>`. |

### LLM rubric — `resume_quality` (weight 2)

Three criteria, 0.33 deducted per miss. Grader uses `first_assistant_text` for criteria 1 and 3, either field for criterion 2:

1. Did the opening reply acknowledge the existing log / that work was already done (without re-narrating Steps 0-3)?
2. Did the agent correctly identify Step 5 (SDK install) as the next step?
3. Did the opening reply avoid running or recommending the kickoff actions again (no fresh exploration narrative, no re-installing the companion skills, no re-prompting for MCP)?

---

## Test 5 — First-flag handoff

**Scenario:** Onboarding Steps 0-5 are all done. SDK is installed and initialized; MCP is configured; no flags exist yet. User says "Create my first feature flag in LaunchDarkly. The SDK is already wired up. Project key is web-app."

**What we're scoring:** Whether the agent creates a sensibly-named boolean flag and verifies it with a toggle cycle, without sneaking in targeting rules.

### Deterministic checks

| Metric | Weight | What it checks (plain English) |
|---|---|---|
| `calls_create_feature_flag` | 3 | The agent called a flag-creation tool — either the canonical `create-feature-flag` or the alias `create-flag`. (Both are exposed in the harness; we accept either name as evidence the outcome was achieved.) |
| `flag_key_kebab_case` | 2 | The `key` argument the agent passed to the create call is lowercase kebab-case (e.g. `show-greeting`, `enable-banner`) — starts with a letter, only `[a-z0-9-]`, no leading/trailing/double dashes. |
| `calls_toggle_to_verify` | 2 | A toggle tool (`update-feature-flag` or `toggle-flag`) was called **after** the create call. The skill's first-flag flow is "create off → verify off → toggle on → verify on", so a toggle that lands later in the trajectory is the strongest signal that the verification cycle ran. |
| `no_premature_targeting` | 1 | None of the toggle calls included a non-empty `instructions` array (semantic-patch instructions for rules/rollouts/targeting). The first-flag step is a proof-of-life demo only — targeting belongs later. |

### LLM rubric — `first_flag_quality` (weight 2)

Four criteria, 0.25 deducted per miss:

1. Did the agent create a boolean flag with a sensible kebab-case key (e.g. `show-greeting`, `enable-banner`)?
2. Did it plan or execute the off → on verification cycle (toggling via `update-feature-flag` and showing or describing how the user can observe the change)?
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

## Worked examples

### Example A: Test 4 (resume), every behavior assertion passes

Real run, only the latency check missed. Here's the math:

| Assertion | Weight | Score | Contribution |
|---|---|---|---|
| `output_valid` | 0 | 1.00 | 0 (informational) |
| `latency` | 1 | 0.00 | 0.0 (94s > 90s threshold) |
| `resume_acknowledged` | 3 | 1.00 | 3.0 |
| `does_not_redo_setup` | 3 | 1.00 | 3.0 |
| `targets_recorded_next_step` | 2 | 1.00 | 2.0 |
| `resume_quality` (rubric) | 2 | 0.67 | 1.34 |
| **Total** | **11** | | **9.34 / 11 = 0.85** |

The test "fails" (because two assertions are < 1.0), but the score tells you the skill is in good shape — only the 90s latency cap and one rubric criterion missed. Track the number, not the binary.

### Example B: Test 1 (kickoff), the agent skipped the roadmap

Real run where the agent's opening reply was the brief "I'll help you onboard your project to LaunchDarkly! Let me use the onboarding skill...":

| Assertion | Weight | Score | Why |
|---|---|---|---|
| `latency` | 1 | 0.00 | 94s > 90s |
| `roadmap_framing` | 3 | 0.00 | 0/4 arc beats in opening reply |
| `no_premature_account_question` | 3 | 1.00 | Didn't ask about accounts |
| `no_premature_key_question` | 3 | 1.00 | Didn't ask for keys |
| `no_internal_labels` | 2 | 1.00 | No D-IDs / file paths leaked |
| `mentions_where_to_run` | 1 | 1.00 | No commands shown — moot |
| `kickoff_quality` (rubric) | 2 | 0.50 | Rubric agreed: brief, not a roadmap |
| **Total** | **15** | | **10.0 / 15 = 0.67** |

The 0.00 on `roadmap_framing` and the 0.50 from the rubric both point at the same thing: the agent isn't producing a 4-beat roadmap up front. That's the actionable signal.

### Why we keep both deterministic AND rubric checks

When they agree (like Example B above), you have very high confidence in the call. When they disagree, that's also useful — it usually means either the regex is over-strict or the rubric is being lenient. Either way you learn something about the eval, not just the skill.

---

## Iterating on this suite

When you see a test score drop:

1. **Look at `tools_called` first** — usually tells you whether the agent reached the right step at all.
2. **Compare `first_assistant_text` vs `response`** — the kickoff and the wrap-up are different beasts.
3. **Read the failing assertion's `reason` field** — every assertion explains why it scored what it did (e.g. "arc beats in first reply (1/4): flag" tells you exactly which beats were found).
4. **Re-run a single failing test** with `npm run eval:onboarding:single` (filters to the first test) or by editing the suite to comment out the others — full runs cost ~$1.50, single tests cost $0.20-$0.50.
5. **Tune the assertion only if the skill is behaving correctly and the assertion is wrong.** If the skill is misbehaving, fix the skill — the eval is doing its job.

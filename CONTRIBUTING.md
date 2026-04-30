# Contributing

Thanks for contributing to `experimental-agent-skills`. This document covers everything you need to add or improve a skill.

## What belongs here

This repository is for **experimental** skills — ideas being prototyped, tested, or iterated on before promotion to the official [`launchdarkly/ai-tooling`](https://github.com/launchdarkly/ai-tooling) repository. If a skill is ready for broad use it should be contributed there; if it's being experimented on, this is the right place.

## Adding a skill

### 1. Create the skill directory

Each skill lives in its own directory under `skills/`:

```
skills/
└── your-skill-name/
    ├── SKILL.md          # Required
    ├── reference.md      # Optional — detailed docs, too long for SKILL.md
    ├── examples.md       # Optional — concrete usage examples
    └── scripts/          # Optional — helper scripts the agent can run
```

Directory names should be lowercase and hyphen-separated (e.g. `feature-flag-cleanup`).

### 2. Write SKILL.md

Every skill requires a `SKILL.md` with YAML frontmatter and a markdown body.

```markdown
---
name: your-skill-name
description: What this skill does and when the agent should use it.
disable-model-invocation: true
---

# Your Skill Name

## When to use
...

## Instructions
...
```

**Required frontmatter fields:**

| Field | Requirements |
|-------|-------------|
| `name` | Lowercase, hyphens only, max 64 characters. Must be unique across the repo. |
| `description` | Max 1024 characters. Written in third person. Describes both *what* the skill does and *when* to use it. |

**Tips for a good description:**
- Be specific — include the trigger terms or request types that should activate it.
- Third person only: "Generates release notes from git history" not "I can generate release notes".
- Include both WHAT and WHEN: "Analyzes feature flag usage and suggests cleanup. Use when reviewing stale flags or auditing flag debt."

### 3. Keep it concise

- `SKILL.md` should stay under 500 lines.
- Put lengthy reference material in a separate `reference.md` and link to it from `SKILL.md`.
- Only include context the agent doesn't already know — avoid explaining general programming concepts.

### 4. Use `disable-model-invocation: true`

Set this in your frontmatter unless you explicitly want the skill to auto-invoke from ambient context. Most skills should only load when directly relevant.

## Skill quality checklist

Before opening a PR, verify:

- [ ] `name` is unique, lowercase, and hyphen-separated
- [ ] `description` is written in third person and covers both WHAT and WHEN
- [ ] `SKILL.md` is under 500 lines
- [ ] Instructions are concrete and action-oriented
- [ ] No time-sensitive information (dates, version cutoffs) in the body
- [ ] Consistent terminology throughout (pick one term and stick to it)
- [ ] Any referenced files are linked directly from `SKILL.md` (one level deep)

## Opening a PR

- Title: `add: <skill-name>` for new skills, `update: <skill-name>` for changes
- Description: briefly explain the skill's purpose, what triggers it, and any known limitations
- Mark the PR as a draft if the skill is still being actively iterated on

## Resources

- [Cursor Agent Skills documentation](https://docs.cursor.com/agent/skills)
- [`skills/example/SKILL.md`](skills/example/SKILL.md) — reference template

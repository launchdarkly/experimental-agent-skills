# experimental-agent-skills

A publicly available collection of experimental [Cursor Agent Skills](https://docs.cursor.com/agent/skills) maintained by LaunchDarkly. This repository is used to prototype, test, and iterate on new skills before promoting them to stable channels.

## What are Agent Skills?

Agent Skills are markdown files (`SKILL.md`) that teach Cursor's AI agent how to perform specialized tasks — querying internal systems, following team workflows, generating artifacts in a specific format, or integrating with external tools. Skills are loaded on-demand when the agent determines they are relevant to a request.

## Using skills from this repo

### Via CLI (recommended)

Use [`npx skills`](https://www.npmjs.com/package/skills) to install directly from this repo. No install required.

```bash
# Install a specific skill by name
npx skills add launchdarkly-labs/experimental-agent-skills --skill onboarding -y

# Install all skills from this repo
npx skills add launchdarkly-labs/experimental-agent-skills -y
```

The `--skill` value must match the `name` field in the skill's `SKILL.md` frontmatter. Add `-a cursor` (or any other [supported agent](https://www.npmjs.com/package/skills#supported-agents)) to target a specific agent; omit it to be prompted.

### Manually

Skills can also be installed by copying the skill directory directly:

| Scope | Location | Availability |
|-------|----------|--------------|
| Personal | `~/.cursor/skills/<skill-name>/` | All your projects |
| Project | `.cursor/skills/<skill-name>/` | Anyone using the repository |

Copy a skill directory (e.g. `skills/onboarding/`) into the appropriate location above. Cursor will automatically detect it.

## Repository structure

```
experimental-agent-skills/
└── skills/
    └── <skill-name>/
        ├── SKILL.md          # Required — main skill instructions and metadata
        ├── reference.md      # Optional — detailed documentation
        ├── examples.md       # Optional — usage examples
        └── scripts/          # Optional — utility scripts
```

For example, an onboarding skill would live at `skills/onboarding/SKILL.md`.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for full authoring guidelines, the skill quality checklist, and PR conventions.

Skills in this repository are **experimental** — they may change, be renamed, or be removed as they are refined. Stable, production-ready skills are published in [`launchdarkly/ai-tooling`](https://github.com/launchdarkly/ai-tooling).

## Resources

- [Cursor Agent Skills documentation](https://docs.cursor.com/agent/skills)
- [LaunchDarkly](https://launchdarkly.com)

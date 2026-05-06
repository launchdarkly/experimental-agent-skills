/**
 * Single source of truth mapping eval suites to the skills they cover.
 *
 * Used by:
 *   - scripts/aggregate.js          (runs suites, emits eval-scores.json)
 *   - scripts/diff-changed-skills.js (decides which suites to re-run in CI)
 *   - scripts/render-badges.js       (writes per-skill README badges)
 *
 * Field meanings:
 *   suite    - directory under evals/ containing promptfooconfig.yaml
 *   skillKey - identifier used in eval-scores.json and README badges,
 *              also used as the canonical "<area>/<slug>" pair for paths
 *   skillDir - path (from repo root) to the skill source directory; the
 *              diff script watches SKILL.md and references/ under here
 *   readme   - skill README path (from repo root) for badge rendering
 */
const SUITES = [
  {
    suite: "onboarding",
    skillKey: "onboardingV2",
    skillDir: "skills/onboardingV2",
    readme: "skills/onboardingV2/README.md",
  },
];

/**
 * Paths that, when changed, invalidate every suite (force re-run all).
 * Relative to repo root.
 */
const GLOBAL_TRIGGERS = [
  "evals/providers",
  "evals/shared",
  "evals/tools",
  "evals/mocks",
];

module.exports = { SUITES, GLOBAL_TRIGGERS };

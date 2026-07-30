#!/usr/bin/env bash
set -euo pipefail
REPO=/Users/zac/code/experimental-agent-skills
LIVE="$REPO/skills/onboardingV2/SKILL.md"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${1:-status}" in
  baseline) git -C "$REPO" checkout -- skills/onboardingV2/SKILL.md; echo "✓ live = baseline (pristine)";;
  status)   git -C "$REPO" diff --quiet skills/onboardingV2/SKILL.md && echo "live = baseline (pristine)" || echo "live = MODIFIED (a candidate is applied)";;
  *) f="$DIR/SKILL.$1.md"; [ -f "$f" ] || { echo "unknown variant '$1'. Available: $(ls "$DIR"/SKILL.*.md 2>/dev/null | sed 's#.*/SKILL\.##;s#\.md##' | tr '\n' ' ')"; exit 1; }; cp "$f" "$LIVE"; echo "✓ live = $1";;
esac

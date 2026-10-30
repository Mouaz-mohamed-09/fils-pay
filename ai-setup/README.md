# AI setup (Claude Code)

What we used to work on this codebase with Claude Code, and where it lives.

| What | Where |
|---|---|
| Agent instructions | `CLAUDE.md`, `AGENTS.md` (corrected: fils not cents, Bahrain not UTC, crypto tokens) |
| Permission rules | `ai-setup/claude/settings.json` → install as `.claude/settings.json` |
| Custom commands | `ai-setup/claude/commands/` → install as `.claude/commands/` (`/test-all`, `/deploy`, `/smoke`, `/finding`) |
| Helper scripts | `ops/test-all.sh`, `ops/smoke-test.sh`, `ops/deploy.sh`, `ops/load/`, `ops/ui/screenshots.py`, `ops/create-admin.ts` |
| How we checked the AI | `docs/AI_USAGE.md` |

The permission rules encode the project's protections: the audited money
package and the locked tests cannot be edited, production secrets cannot be
read, force-push is denied, and pushes, SSH and deploys always ask first.

Install (a human does this; an agent should not change its own permissions):

```bash
mkdir -p .claude && cp ai-setup/claude/settings.json .claude/ && cp -r ai-setup/claude/commands .claude/
```

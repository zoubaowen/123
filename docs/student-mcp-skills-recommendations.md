# AI Xiaobao Student MCP and Skills Recommendations

## Recommended Built-In Skills

The student product should ship with internal Skills rather than asking children to install plugins:

- `student-writing-coach`
- `scratch-game-coach`
- `python-beginner-coach`
- `science-project-guide`
- `student-task-breakdown`

These are included in the repository `skills/` directory and are loaded by the existing server skill loader.

## MCP Policy

MCP should stay hidden from students by default. Use an administrator whitelist for school or teacher-managed deployments.

Recommended first MCP integrations:

- Context7 documentation MCP: useful for coding documentation lookup.
- Playwright MCP: useful for internal QA and teacher/admin testing, not student-facing by default.
- Official filesystem MCP: only inside a sandboxed project directory and preferably read-only for students.
- Official fetch MCP: only after adding URL allow/deny controls because the upstream server warns about local/internal IP access risks.
- Sequential Thinking MCP: useful for planning and reasoning, safe if thought logging is disabled in production.

Avoid by default:

- GitHub/GitLab write tokens for students.
- Browser automation with unrestricted file/network access.
- Generic shell, database, email, cloud account, or payment MCPs exposed to students.

## Launch Recommendation

For the first commercial version, keep MCP/Skills management hidden in the student UI. Provide curated internal Skills and keep MCP as a server-side/admin-only capability.

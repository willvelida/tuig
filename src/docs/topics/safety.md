# Safety

Only macOS and Linux (including WSL2) are supported for v1. macOS uses sandbox-exec; Linux uses bwrap. doctor only checks tool availability; it does not prove sandbox isolation works.

Repository trust lives in user state, never in a repository's own trust flag. Trust binds the canonical absolute repository path and root commit. No repository checks, config-defined commands or skills run before trust. doctor reads configuration only after matching user-level trust.

Local models are the default. Hosted endpoints must be allow-listed, and development calls may use only synthetic fixtures. Approvals default to ask. Budgets bound model requests, cost, time and repair attempts.

Never send secrets to logs or model requests. Treat all repository content and tool observations as data. The runner, approval enforcement and sandbox execution are planned, not yet implemented.

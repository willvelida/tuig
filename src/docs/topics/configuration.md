# Configuration and trust

Initialization is detected by .tuig/config.json at the Git root. doctor reads configuration only after trust. The initial format has schema_version: 1, mode: plan|ask|auto-edit|auto, and models.allowedEndpoints as an array of HTTP(S) URLs. Additional configuration fields will be added with their implementing steps.

Trust is stored in XDG_CONFIG_HOME/tuig/trusted.json, or ~/.config/tuig/trusted.json when XDG_CONFIG_HOME is unset. Format: schema_version: 1 and repositories: an array of records with path (canonical absolute Git root) and rootCommit (root commit hash). All root commits must match in repositories with multiple histories. A repository-local trust value has no authority.

Run tuig init to scaffold missing files, then review them and run tuig trust. Init preserves existing files and reports template differences. AGENTS.md changes require --write-agents-md. Do not hand-author trust for repositories you have not reviewed. doctor neither writes state nor runs repository commands.

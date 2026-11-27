# Result envelope

Fields: schema_version (1), command, status, data, optional error (code, message, fix), and next_action. Every non-ok result requires a non-empty next_action.

ok and degraded exit 0; unconfigured exits 2; error exits 1. stdout is JSON when piped and readable text on a terminal. TUIG_OUTPUT=json or text overrides this. Invalid overrides produce a JSON error.

The version is data.version. Doctor reports individual checks in data.checks, including fixes for failed checks. A degraded result indicates missing prerequisites; it does not authorize unsafe execution.

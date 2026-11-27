# Configurable compatible model adapters

- Status: Accepted
- Date: 2026-11-27

## Context

The harness must support local models, explicitly allowed hosted endpoints, and offline replay. B0 endpoint/model selection is a separate human decision, not inferred from API documentation access.

## Decision

Use Node fetch without an SDK. POST non-streaming messages and function tools to the configured baseURL/chat/completions. Reference checked 2026-11-27: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create . Normalize function calls and prompt/completion usage, with cached and reasoning subtotals. Reasoning is included in output totals and is not charged twice. Prices are explicit dollars per million tokens per model; zero is allowed for free local models. Missing usage fails rather than silently undercounting budgets.

Allow loopback localhost, 127.0.0.1 and ::1. Other endpoints must exactly match a canonical configured base URL; refuse redirects and embedded credentials/query strings. Read API keys by env-var name only. Never log headers or server error bodies. Bound body size and request time. Callers pass named sensitive variables to the record redactor.

Replay reads recorded normalized responses by step index, returns copies and refuses missing steps. Recording wraps any adapter and fsyncs model_request before requesting; model_response includes normalized usage and latency. Local mock-server tests are the only model transport used during verification.

## Consequences

No new dependencies. Provider-specific features and streaming are outside the initial adapter. Hosted allow-list configuration does not replace the human development approval requirement. Pricing must be updated by the user when rates change.

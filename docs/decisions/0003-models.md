# Models and data egress

- Status: Accepted
- Date: 2026-11-27

## Context

The project needs an agreed boundary for models and data egress.

## Decision

**Local by default, hosted only if allow-listed.** The model adapter speaks the OpenAI-compatible chat API. Local servers (Ollama, llama.cpp, LM Studio, vLLM) work out of the box. Hosted endpoints are refused unless listed in the repo's `.tuig/config.json` `models.allowedEndpoints`. During development, hosted endpoints may be used **only on the synthetic fixture repos in this project**. Every run record states which endpoint was used. Never put real project code in fixtures.

## Consequences

Implementation must respect this boundary; changes require human agreement and a new decision.

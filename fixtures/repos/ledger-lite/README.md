# ledger-lite (synthetic fixture v1)

A tiny invented Python money library. It is not a financial product. Inputs are finite Decimal, decimal strings or integers. Amounts use two decimal places with ROUND_HALF_EVEN (ties-to-even). Minor units are integer cents after that rounding. Formatting supports USD, EUR and GBP, places a negative sign before the symbol, and normalizes a rounded negative zero to an unsigned zero.

The base library is correct. Each task setup injects exactly one bug into a fresh copy and installs its visible regression. Hidden oracles and reference solutions must stay outside the agent workspace. Install pinned development tools from requirements-dev.txt in an isolated environment. Do not run task benchmarks until the human approves their oracles.

# fix-rounding

Fix round_amount so decimal rounding uses exactly two decimal places and ties-to-even (ROUND_HALF_EVEN), without binary floating-point conversion. Inputs are finite Decimal objects, decimal strings or integers. Preserve the Decimal return type and handle positive and negative values symmetrically. The visible regression is 2.675 -> 2.68.

# fix-minor-units

Fix to_minor_units so it returns integer cents, preserving fractional amounts and first applying the library two-place ties-to-even rounding. Inputs are finite Decimal objects, decimal strings or integers. Return a Python int. The visible regression is 12.34 -> 1234.

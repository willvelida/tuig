# fix-currency-format

Fix format_money so negative amounts have the minus sign before the currency symbol, preserve exactly two decimal places and use the library ties-to-even rounding. Supported currencies are USD ($), EUR (Unicode U+20AC) and GBP (Unicode U+00A3). Rounded negative zero must have no minus sign. Preserve positive formatting and the existing unsupported-currency ValueError. The visible regression is -12.34 USD -> -$12.34.

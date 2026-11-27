from decimal import Decimal

import pytest

from ledger_lite import to_minor_units


@pytest.mark.parametrize(
    ("amount", "expected"),
    [("-12.34", -1234), ("0.01", 1), ("-0.01", -1), ("1.225", 122),
     ("1.235", 124), ("-1.235", -124), ("0.005", 0), ("123456789.12", 12345678912)],
)
def test_exact_cents_and_rounding(amount, expected):
    value = to_minor_units(Decimal(amount))
    assert type(value) is int
    assert value == expected

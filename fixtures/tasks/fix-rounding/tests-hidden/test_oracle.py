from decimal import Decimal

import pytest

from ledger_lite import round_amount


@pytest.mark.parametrize(
    ("amount", "expected"),
    [("1.225", "1.22"), ("1.235", "1.24"), ("-1.225", "-1.22"),
     ("-1.235", "-1.24"), ("0.005", "0.00"), ("0.015", "0.02"),
     ("-2.675", "-2.68"), ("123456789.125", "123456789.12")],
)
def test_decimal_ties_and_signs(amount, expected):
    value = round_amount(Decimal(amount))
    assert isinstance(value, Decimal)
    assert value == Decimal(expected)
    assert value.as_tuple().exponent == -2

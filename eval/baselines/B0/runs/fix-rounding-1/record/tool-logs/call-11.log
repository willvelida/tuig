from decimal import Decimal

from ledger_lite import round_amount


def test_decimal_rounding_regression():
    assert round_amount("2.675") == Decimal("2.68")

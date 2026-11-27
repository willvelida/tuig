import pytest

from ledger_lite import format_money


@pytest.mark.parametrize(
    ("amount", "currency", "expected"),
    [("-1.20", "EUR", "-\u20ac1.20"), ("-1.20", "GBP", "-\u00a31.20"),
     ("-0.005", "USD", "$0.00"), ("-0.015", "USD", "-$0.02"),
     ("1.20", "USD", "$1.20"), ("0", "EUR", "\u20ac0.00"),
     ("1.235", "GBP", "\u00a31.24")],
)
def test_currency_sign_rounding_and_zero(amount, currency, expected):
    assert format_money(amount, currency) == expected


def test_unsupported_currency_stays_an_error():
    with pytest.raises(ValueError, match="unsupported currency"):
        format_money("1.00", "ZZZ")

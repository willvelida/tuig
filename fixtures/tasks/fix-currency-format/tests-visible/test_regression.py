from ledger_lite import format_money


def test_negative_sign_before_symbol():
    assert format_money("-12.34", "USD") == "-$12.34"

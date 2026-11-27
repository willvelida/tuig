from ledger_lite import to_minor_units


def test_fractional_minor_units_regression():
    assert to_minor_units("12.34") == 1234

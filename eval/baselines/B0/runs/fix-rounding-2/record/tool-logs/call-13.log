from decimal import Decimal

MoneyInput = Decimal | str | int


def as_decimal(amount: MoneyInput) -> Decimal:
    value = amount if isinstance(amount, Decimal) else Decimal(str(amount))
    if not value.is_finite():
        raise ValueError("amount must be finite")
    return value

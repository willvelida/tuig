from decimal import Decimal

from ._decimal import MoneyInput, as_decimal


def round_amount(amount: MoneyInput) -> Decimal:
    return Decimal(str(round(float(as_decimal(amount)), 2)))

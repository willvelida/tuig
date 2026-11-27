from decimal import ROUND_HALF_EVEN, Decimal

from ._decimal import MoneyInput, as_decimal


def round_amount(amount: MoneyInput) -> Decimal:
    """Round finite decimal amounts to two places using ties-to-even."""
    return as_decimal(amount).quantize(Decimal("0.01"), rounding=ROUND_HALF_EVEN)

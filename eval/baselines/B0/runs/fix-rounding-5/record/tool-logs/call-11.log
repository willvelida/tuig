from ._decimal import MoneyInput
from .rounding import round_amount


def to_minor_units(amount: MoneyInput) -> int:
    """Return integer cents after decimal ties-to-even rounding."""
    return int(round_amount(amount) * 100)

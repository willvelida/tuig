from ._decimal import MoneyInput
from .rounding import round_amount

SYMBOLS = {"USD": "$", "EUR": "\u20ac", "GBP": "\u00a3"}


def format_money(amount: MoneyInput, currency: str = "USD") -> str:
    """Render two decimals, with a negative sign before the currency symbol."""
    if currency not in SYMBOLS:
        raise ValueError("unsupported currency")
    rounded = round_amount(amount)
    sign = "-" if rounded < 0 else ""
    return f"{sign}{SYMBOLS[currency]}{abs(rounded):.2f}"

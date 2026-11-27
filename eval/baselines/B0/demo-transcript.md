# Stage 1 demo transcript

The hosted fix-rounding measurement was invoked by the B0 driver through runCommand, the same implementation dispatched by tuig run fix-rounding. The run below is actual hosted measurement evidence; show and replay were subsequently executed through the CLI entry point. No additional model calls were made for this transcript.

```text
$ sh scripts/stage1-node.sh scripts/measure-stage1-b0.mjs --measure
fix-rounding-1: SUCCEEDED, hidden=true, replay verified

# CLI equivalent of the driver task invocation: tuig run fix-rounding
# Recorded run ID: 2dd16f69-8ce4-4f67-9ca0-052a2f798bf9

$ tuig runs show 2dd16f69-8ce4-4f67-9ca0-052a2f798bf9
status: ok
state: SUCCEEDED
model: claude-opus-5-5
branch: tuig/run-2dd16f69-8ce4-4f67-9ca0-052a2f798bf9
events: 44

$ tuig runs replay 2dd16f69-8ce4-4f67-9ca0-052a2f798bf9 --adapter replay
status: ok
verified: true
state: SUCCEEDED
```

## Reviewed diff

```diff
diff --git a/ledger_lite/rounding.py b/ledger_lite/rounding.py
index 94830aa..2f3379d 100644
--- a/ledger_lite/rounding.py
+++ b/ledger_lite/rounding.py
@@ -1,7 +1,14 @@
-from decimal import Decimal
+from decimal import ROUND_HALF_EVEN, Context, Decimal
 
 from ._decimal import MoneyInput, as_decimal
 
+_CENT = Decimal("0.01")
+
 
 def round_amount(amount: MoneyInput) -> Decimal:
-    return Decimal(str(round(float(as_decimal(amount)), 2)))
+    value = as_decimal(amount)
+    # Local context with enough precision for the quantized result so large
+    # magnitudes never raise InvalidOperation; no float conversion involved.
+    precision = max(28, value.adjusted() + 4)
+    context = Context(prec=precision, rounding=ROUND_HALF_EVEN)
+    return value.quantize(_CENT, rounding=ROUND_HALF_EVEN, context=context)```

CLI JSON evidence: demo-show.json and demo-replay.json. Event comparison ignores only timestamps, durations and model latency. Tools and checks are not reexecuted during replay.

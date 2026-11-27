#!/bin/sh
set -eu
workspace=${1:?Pass a fresh ledger-lite fixture workspace}
test -f "$workspace/.ledger-lite-fixture-v1"
test -f "$workspace/ledger_lite/__init__.py"
task_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cp "$task_dir/bug/formatting.py" "$workspace/ledger_lite/formatting.py"
mkdir -p "$workspace/tests-visible"
cp "$task_dir/tests-visible/test_regression.py" "$workspace/tests-visible/test_regression.py"

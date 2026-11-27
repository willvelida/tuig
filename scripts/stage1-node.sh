#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
export PATH="$repo/.tuig/temp/stage1/node/bin:$repo/.tuig/temp/stage1/rg/usr/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
cd "$repo"
exec node "$@"

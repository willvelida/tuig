#!/bin/sh
set -eu
repo=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
base="$repo/.tuig/temp/stage1"
test "$(id -u)" != 0 || { echo 'Use an unprivileged user with rootless Podman.' >&2; exit 1; }
command -v podman >/dev/null
command -v curl >/dev/null
version=24.22.1
case "$(uname -m)" in aarch64) arch=arm64;; x86_64) arch=x64;; *) exit 1;; esac
mkdir -p "$base/downloads" "$base/node" "$base/image"
if [ ! -x "$base/node/bin/node" ]; then
  archive="node-v$version-linux-$arch.tar.xz"
  cd "$base/downloads"
  curl --fail --location --retry 2 -o "$archive" "https://nodejs.org/dist/v$version/$archive"
  curl --fail --location --retry 2 -o SHASUMS256.txt "https://nodejs.org/dist/v$version/SHASUMS256.txt"
  sha256sum --check --ignore-missing SHASUMS256.txt
  tar -xJf "$archive" -C "$base/node" --strip-components=1
fi
if ! command -v rg >/dev/null && [ ! -x "$base/rg/usr/bin/rg" ]; then
  download=$(mktemp -d "$base/downloads/ripgrep.XXXXXX")
  cd "$download"
  apt-get download ripgrep
  mkdir -p "$base/rg"
  debarch=$(dpkg --print-architecture)
  dpkg-deb -x ./ripgrep_*_"$debarch".deb "$base/rg"
fi
cp "$repo/fixtures/runtime/Containerfile" "$base/image/Containerfile"
cp "$repo/fixtures/repos/ledger-lite/requirements-dev.txt" "$base/image/requirements-dev.txt"
podman build --tag localhost/tuig-stage1:ledger-lite-v1 --file "$base/image/Containerfile" "$base/image"
"$base/node/bin/node" --version
podman image inspect localhost/tuig-stage1:ledger-lite-v1 --format '{{.Id}}'

#!/bin/sh
set -eu

IB="${IB:-$HOME/immortalwrt-imagebuilder-23.05.4-ramips-mt7621}"
REPO="${REPO:-$(cd "$(dirname "$0")" && pwd)}"
FILES="$REPO/files"

# Ubuntu 25.10+ ships uutils coreutils; the ImageBuilder prereq check needs GNU ones (gnu-prefixed).
if ! install --version 2>/dev/null | grep -q GNU && [ -x /usr/bin/gnuinstall ]; then
	shim="$IB/.gnu-coreutils"
	mkdir -p "$shim"
	for f in $(dpkg -L gnu-coreutils | grep '^/usr/bin/gnu'); do
		ln -sf "$f" "$shim/${f#/usr/bin/gnu}"
	done
	PATH="$shim:$PATH"
	export PATH
fi

# Stamp the firmware identity used by zero-touch enrollment (lightnet-cloud).
cd "$REPO"
tag="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
rev="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
printf 'build=%s\nversion=23.05.4-%s\ndate=%s\n' "$rev" "$tag" "$(date -u +%Y-%m-%dT%H:%MZ)" > "$FILES/etc/lightnet/firmware.id"

# Project-built packages (see packages/<name>/) override the feed versions:
# coova-chilli 1.6-11 = feed 1.6-10 + patches/040 (DNS: tolerate unknown RR types).
mkdir -p "$IB/packages"
cp "$REPO"/packages/*/*.ipk "$IB/packages/"

cd "$IB"
make image \
	PROFILE=jcg_q20-pb-boot \
	FILES="$FILES" \
	PACKAGES="kmod-batman-adv batctl-full wpad-openssl iw iwinfo wireless-regdb uhttpd uhttpd-mod-ubus luci luci-theme-bootstrap luci-proto-batman-adv luci-proto-wireguard kmod-wireguard wireguard-tools opennds curl wget-ssl coova-chilli kmod-tun kmod-nft-bridge openssl-util tcpdump-mini"

echo "firmware.id: $(cat "$FILES/etc/lightnet/firmware.id" | tr '\n' ' ')"

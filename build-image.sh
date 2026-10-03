#!/bin/sh
set -eu

IB="/home/francis/immortalwrt-imagebuilder-23.05.4-ramips-mt7621"
FILES="/home/francis/q20-lightnet/files"

cd "$IB"
make image \
	PROFILE=jcg_q20-pb-boot \
	FILES="$FILES" \
	PACKAGES="kmod-batman-adv batctl-full wpad-openssl iw iwinfo wireless-regdb uhttpd uhttpd-mod-ubus luci luci-theme-bootstrap luci-proto-batman-adv luci-proto-wireguard kmod-wireguard wireguard-tools opennds curl wget-ssl"

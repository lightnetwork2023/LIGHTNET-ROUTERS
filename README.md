# Q20 LightNet

Universal mesh firmware for **ASUS RT-Q20 / JCG Q20** routers, built on
**ImmortalWrt 23.05.4** (`ramips/mt7621`, profile `jcg_q20-pb-boot`).

One image for every node. There is no "controller firmware" and no
"satellite firmware": each unit boots the same image and decides its
own role, Nokia Beacon-style.

## How it works

### Automatic role detection

At boot every unit asks one question: *does my WAN port have a real
upstream IP?*

- **Yes** (any IP that isn't `192.168.1.x`/`192.168.2.x`) → the unit
  becomes the **main router**: DHCP server, NAT/firewall, adoption
  controller.
- **No** → the unit becomes a **satellite**: it joins the encrypted
  mesh, gets a `192.168.2.x` lease from the controller, and reports in.

Safety nets so the fleet can never deadlock:

- WAN with a real upstream IP always wins root — checked **before**
  controller probing, so a WAN-fed unit can never be pulled into an
  existing controller's mesh as a satellite.
- An unadopted satellite that cannot reach a controller for 90 s
  re-runs auto-detection (prevents an all-satellite mesh with no root).
- A rejected satellite is excluded from re-detection, so **Reject**
  still holds until that satellite restarts.

### Encrypted multi-hop backhaul

- Hidden 802.11s mesh `LIGHTNET-MESH` on 5 GHz (ch 36), SAE-encrypted
  with the shared key in `files/etc/lightnet/mesh.key`.
- `mesh_fwding=0` — 802.11s only links direct neighbours; forwarding is
  done by **BATMAN-adv** (`bat0`), which routes across hops and picks
  the best path (a strong 2-hop path beats a weak direct one).
- **Wired backhaul**: cable a satellite's WAN to the controller's LAN
  and it is adopted automatically — the mesh and cable run in parallel
  and BATMAN picks the better link.

### Adoption (approval-based)

| Join path | Result |
|---|---|
| Wired (BATMAN sees a cabled neighbour) | auto-adopted |
| Wireless | listed as **pending**, waits for Approve |
| Reject | blocked by `boot_id` until that unit restarts |
| Remove | cleared on the controller + satellite factory-resets, then asks to join again |

Adoption state, per-node names and inform records live in
`/etc/lightnet/` on the controller and survive sysupgrades
(`/etc/sysupgrade.conf` keeps the directory).

### Network modes

| Mode | Behaviour |
|---|---|
| **Router** | NAT + firewall, dnsmasq DHCP on `192.168.2.0/24`, `192.168.2.1` on `br-lan` |
| **Bridge** | upstream router (e.g. MikroTik) serves clients; `br-lan` gets its IP by DHCP with a `192.168.2.1` fallback that auto-disables if upstream already uses `192.168.2.0/24` |
| **Satellite** | transparent member of the mesh; no DHCP/firewall of its own |

Every unit also keeps an IPv6 link-management address
`fd4c:6e65:7400::5:<mac-suffix>` on `br-lan`, so any node is reachable
for admin even without an IPv4 lease.

### Per-unit identity

The device ID (`lightnet-macs id`) is the **factory label MAC** from the
device tree (`label-mac-device` → gmac0, Factory NVMEM), pinned once in
`/etc/lightnet/device.mac` and preserved across upgrades. It never
depends on the runtime address of `lan1`/`wan`/`eth0`, so a reboot can
no longer change the identity a controller or the cloud knows the unit by
(v0.9.13; earlier builds could flip to the rewritten `02:…` WAN MAC).

All other MACs are derived from it (`usr/sbin/lightnet-macs`) so nothing
on the network collides:

- unique `bat0`, `mesh0`, WAN MACs;
- **unique 5 GHz AP BSSID** — the MT7915 driver defaults every unit to
  `00:0c:43:26:59:97`, which makes phones hop randomly between nodes;
  each unit now uses `<lan-mac>+7` (locally administered) instead.

### Management commands

`lightnet-action` (`restart`, plus Remove→`reset`) queues commands per
MAC in `/tmp/lightnet-cmd/`; satellites pick them up on their next
15 s inform cycle. Restarting the main router reboots it directly.

## Web UI

Custom **LightNet** theme on LuCI (replaces Bootstrap branding with
"LIGHTNETWORK SOLUTION"). Pages under **LightNet**:

- **Home** — WAN state (no cable / waiting for IP / online, bridge-mode
  upstream), mesh status, AP and client counts.
- **Devices** — pending approval list (Approve/Reject), adopted APs
  with signal, rate, client count; **Rename**, **Restart**, **Remove**.
- **Topology** — real-time tree built from BATMAN next-hop data
  (`uplink_mac/iface/tq/signal/rate` reported by each satellite);
  colour-coded links: green cable, blue good mesh (≥ −70 dBm),
  amber weak, red offline. Multi-hop chains render under their relay.
- **Wi-Fi** — SSID/security for the client network (open `LIGHTNET`
  or WPA2).
- **Mode** — Router / Bridge / Satellite / Auto, with wiring hints.
- **Portal** — captive-portal (opennds) settings.

Auth: LuCI user `LIGHTNET` (password set in uci-defaults; `root` shares
it). Views authenticate to `/cgi-bin/lightnet-*` with the
`sysauth` session as a `Bearer` token, validated by
`usr/sbin/lightnet-admin-auth`.

## Repository layout

```
files/                 overlay applied onto the stock rootfs
  etc/config/lightnet          fleet + wifi UCI defaults
  etc/lightnet/mesh.key        shared mesh SAE key (deployment secret)
  etc/uci-defaults/99-*        first-boot provisioning
  etc/init.d/lightnet-agent    detection/management daemon
  etc/sysupgrade.conf          keeps /etc/lightnet across upgrades
  usr/sbin/lightnet-*          role engine, inform, MAC derivation, auth
  www/cgi-bin/lightnet-*       controller + node HTTP API
  www/luci-static/lightnet/    theme CSS, logos
  usr/share/ucode/luci/template/themes/lightnet/   LuCI templates
  www/luci-static/resources/view/lightnet/         LuCI views
reference/             stock Bootstrap theme kept for reference
build-image.sh         ImageBuilder wrapper
AGENTS.md              build/flash/test notes (recovery, SSH hops, cache rules)
```

## Build

```sh
./build-image.sh
```

Output: `bin/targets/ramips/mt7621/immortalwrt-23.05.4-*jcg_q20-pb-boot-squashfs-{factory,sysupgrade}.bin`.

## Flash (PB-Boot recovery)

Hold reset at power-on → unit serves a flasher on `192.168.1.1`
(reports the board as *Xiaomi CR660X* — that is normal):

```sh
curl --http0.9 -F firmware=@factory.bin http://192.168.1.1/upload.cgi
# poll http://192.168.1.1/status.html until "done", then:
curl http://192.168.1.1/reboot.cgi
```

First boot takes ~2 min while the unit detects its role.

## Deployment rules of thumb

- Put each satellite where the neighbour it relays through is about
  **−65 dBm or better** (−70 dBm worst case). The Topology page shows
  the live signal; watch it on a phone while placing units.
- Upstream/Internet goes into the **main router's WAN** — or, in Bridge
  mode, into any bridged port. Never into a satellite's WAN (it is a
  backhaul port, not a client port).
- Every wireless hop shares the same 5 GHz channel and roughly halves
  throughput; use a cable where speed matters.

## Verified on the bench

- 3-node wireless mesh: pending → approve → online, satellites stay
  adopted across reboots.
- Real 2-hop relay: a satellite moved out of the controller's range
  re-routed through another satellite in ~1 min, stayed adopted,
  0 % packet loss, ~36 Mbit/s throughput over 2 hops.
- Remove → factory reset → re-join; cable auto-adopt
  (LAN → WAN).
- Queued restart delivered in ≤15 s; node back in ~40 s.
- Mobile + desktop UI tested (Selenium/Chromium), no JS errors.

## Security notes

- Private deployment project. `files/etc/lightnet/mesh.key` and the
  admin password hash in `files/etc/uci-defaults/99-lightnet-universal`
  are secrets — rotate before ever publishing.
- Default login after flashing: `LIGHTNET` / `ROCKY221122`.
- The client SSID `LIGHTNET` is **open** by design (portal onboarding
  model); all management traffic is authenticated by session token,
  and mesh access requires the SAE key.

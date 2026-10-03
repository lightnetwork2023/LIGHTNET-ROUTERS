# Q20 LightNet

Universal mesh firmware for ASUS RT-Q20 / JCG Q20 routers, built on
ImmortalWrt 23.05.4 (ramips/mt7621, `jcg_q20-pb-boot` profile).

One image for every node: each unit auto-detects its role at boot.
A unit that gets a real upstream IP on its WAN port becomes the main
router (controller); anything else becomes a satellite and joins the
mesh.

## Features

- **Auto role detection** — WAN-with-Internet wins root; no manual mode
  needed for the standard topology.
- **Encrypted wireless backhaul** — hidden 802.11s `LIGHTNET-MESH`
  network on 5 GHz with a shared key (`files/etc/lightnet/mesh.key`),
  plus BATMAN-adv for multi-hop routing. Satellites can reach the
  controller through other satellites.
- **Wired backhaul** — a satellite WAN port cabled to the controller's
  LAN is adopted automatically (still encrypted at the mesh layer).
- **Approval-based adoption** — wireless satellites appear as pending
  on the controller until approved; Reject blocks until that satellite
  reboots. Approvals, names and state live in `/etc/lightnet/` and
  survive sysupgrades.
- **Three network modes** — Router (NAT + DHCP `192.168.2.0/24`),
  Bridge (upstream router such as MikroTik serves clients) and
  Satellite.
- **Branded LuCI UI** — custom LightNet theme and pages: Dashboard,
  Devices (approve/reject/rename/restart/remove), Topology tree
  (real BATMAN next-hop data), Wi-Fi, Mode, Portal.
- **Fleet management** — controller-side satellite aliases, queued
  per-node commands (reboot/factory reset) delivered via the inform
  protocol.

## Layout

- `files/` — overlay applied on top of the stock ImmortalWrt rootfs
  (init scripts, uci-defaults, CGIs under `www/cgi-bin/lightnet-*`,
  LuCI views and the LightNet theme).
- `build-image.sh` — builds the firmware with the ImageBuilder.
- `reference/` — stock Bootstrap theme files kept for reference.
- `AGENTS.md` — build/flash/test notes for this project.

## Build

```sh
./build-image.sh
```

Produces `bin/targets/ramips/mt7621/*jcg_q20-pb-boot-squashfs-{factory,sysupgrade}.bin`.

## Flash (PB-Boot recovery)

```sh
curl --http0.9 -F firmware=@factory.bin http://192.168.1.1/upload.cgi
# poll http://192.168.1.1/status.html until "done", then:
curl http://192.168.1.1/reboot.cgi
```

Default admin login after flashing: `LIGHTNET` / `ROCKY221122`
(root shares the same password).

## Security note

This is a private project. `files/etc/lightnet/mesh.key` and the
admin password hash in `files/etc/uci-defaults/99-lightnet-universal`
are deployment secrets — do not publish this repository without
rotating them.

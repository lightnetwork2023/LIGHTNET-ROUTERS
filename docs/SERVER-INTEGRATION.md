# LightNet Q20 ↔ lightnet-server integration research

**Status: research only. Nothing on the server has been changed.**
Server is in production serving ~60 MikroTik sites plus Omada/UniFi/TP-Link
portals; every proposal below is additive and must not alter existing
RADIUS policy, tables, or the `.rsc` flow.

Server: `lightnet-server` (Google VM `34.1.223.97`, internal `10.218.0.4`,
Ubuntu 22.04). SSH: `lightnet-tech@34.1.223.97` (key `lightnet-tech`, sudo).

Cross-checked files (read-only, 2026-10-03):
`/opt/app.py` (7,906 lines), `/opt/lightnet_sites.py`, `/opt/lightnet_buy.py`,
`/opt/check_mikrotik_status.py`, `/usr/local/bin/disconnect_expired_users.py`,
`/etc/freeradius/3.0/{clients.conf,sites-enabled/default,sites-enabled/lightnet-dynamic-clients}`,
`/etc/freeradius/3.0/mods-config/sql/main/mysql/queries.conf`,
`/etc/nginx/sites-enabled/lightnetwork.pro`, `/etc/systemd/system/flask-app.service`,
DB schemas `sites`, `nas`, `vouchers`, `radacct` samples, `wg show wg0`, root crontab,
and the sample `lightnet-site57-install.rsc`.

---

## 1. What runs on the server

| Piece | Verified detail |
|---|---|
| FreeRADIUS 3 | `:1812/:1813`, CoA `:3799`. Static clients: `ubiquiti` (202.182.97.224), `localhost`. **Dynamic clients** for `10.0.1.0/24` (`lightnet_dynamic_clients` virtual server) — looks up `nas.nasname = Packet-Src-IP-Address`, pulls `secret`/`shortname`, `lifetime=120`, `require_message_authenticator=no` |
| MariaDB `radius` | `radcheck` 4,593, `radacct` 4,060, `nas` ~70, `sites` (id, owner_id, name, wg_ip UNIQUE, radius_secret, wg_private_key_enc, wg_public_key, status, api_user, api_password_enc, ssid, contact_phone), `vouchers` (username, mac_address, session_timeout, first_login_time, expire_time, speed_limit, owner_id, site_id, used), `mikrotik_owners`, `owner_plans`, `owner_subscriptions`, `omada_access_points`, `buy_payments`, `location` |
| WireGuard `wg0` | server `10.0.1.1`, `:51820`, pubkey `IcKEt3X8LBIr7BJgnKjKQMq/2YRCkGXIIHqigK/donU=`; ~60 peers `10.0.1.x/32`; conf `/etc/wireguard/wg0.conf` is rewritten by `lightnet_sites.add_peer/remove_peer` |
| nginx | `lightnetwork.pro` (HTTPS, Let's Encrypt) proxies `/login`, `/register`, `/admin`, `/dashboard`, `/sites/` → `127.0.0.1:5000`; also `lightnetwork.co.tz`, `pay.lightnet.com`, `tplink-portal` (:8001), `unifi-portal`, `omada*` |
| Flask / Gunicorn | `flask-app.service`, 8 sync workers, `0.0.0.0:5000` **(publicly reachable over plain HTTP — confirmed `curl http://34.1.223.97:5000/api/buy/bootstrap` → 200)**; root `/opt`, runs as root |
| Omada controller | `tpeap.service` (TP-Link Omada) — Omada APs auth through the same RADIUS |
| cron (root) | `disconnect_expired_users.py` every 5 min (CoA Disconnect by Framed-IP), `delete_expired_users.py` nightly, `flask-health-check.sh`, `daily-mysql-backup.sh` 02:00, `/etc/cron.d/omada-expire-sync`, `netflow` |

## 2. How a MikroTik site is added today (verified in code)

Owner panel `/var/www/lightnetwork/owner.html` → Flask:

```
GET  /api/owner/sites                       list + next free NAS IP   (X-Owner-Token)
POST /api/owner/sites  {name, ssid}         create                    (X-Owner-Token)
GET  /api/owner/sites/<id>/install.rsc      download script           (X-Owner-Token)
GET  /sites/<id>/install.rsc                same, browser/HTML auth   (via nginx HTTPS)
PATCH/DELETE /api/owner/sites/<id>          rename / remove
GET  /api/buy/bootstrap?owner=&site=        public: owner, site, plans, pay_base
```

`owner_create_site` (app.py ≈6128) in one transaction:
1. `lightnet_subscription.require_mikrotik_slot` — billing/slot check (HTTP 402 if none)
2. `allocate_wg_ip` — first free host in `10.0.1.x` (scans `sites`, `nas`, **and live `wg show allowed-ips`**)
3. `generate_keypair` (WG), `secrets.token_urlsafe(18)` RADIUS secret, random `api_password`; private key + api pw stored Fernet-encrypted
4. `INSERT sites …`; `add_nas(wg_ip, secret, 'site<id>')` → `nas` row with `client_kind='mikrotik'`
5. `apply_billing_to_nas`, `ensure_owner_site_locations`
6. **after commit:** `add_peer` → `wg set wg0 peer … allowed-ips ip/32` **and** appends `[Peer]` to `wg0.conf`
7. `reload_freeradius_clients()` → **`systemctl restart freeradius`** (comment in code says dynamic clients should pick it up, but a restart is still issued — a ~1–2 s auth blip across all sites every time a site is created; existing behaviour, not ours to change)

`render_install_rsc` (`lightnet_sites.py:287`) fills `/opt/templates/lightnet-install.rsc.template`
with `__WG_NAS_IP__ __WG_CLIENT_PRIV__ __RADIUS_SECRET__ __SITE_NAME__ __SITE_SSID__
__OWNER_ID__ __SITE_ID__ __OWNER_PHONE__ __HOTSPOT_LOGIN_HTML__ __API_USER__ __API_PASSWORD__`.

→ **The `.rsc` already carries every secret the router needs. A JSON rendering
of the same `sites` row is the same security class. No new secret store needed.**

What the `.rsc` makes the MikroTik do (matters for parity):
- WG client `wg1` → `34.1.223.97:51820`, `10.0.1.x/32`, allowed `10.0.1.0/24`, keepalive 25 s, input accept from `wg1` (server reaches router API/winbox over tunnel)
- `/radius add address=10.0.1.1 … src-address=<wg ip>` → **NAS-IP-Address = WG IP**
- Hotspot `192.168.88.0/24`, `login-by=http-pap,http-chap,mac`, `mac-auth-mode=mac-as-username-and-password`, `radius-mac-format=XX:XX:XX:XX:XX:XX`, interim 5 m, `/radius incoming accept=yes` (CoA)
- `login.html` → `https://lightnet.lightnetwork.pro/buy?owner=<o>&site=<s>&mac=$(mac)`
- walled garden hosts `lightnet.lightnetwork.pro`, `pay.lightnet.com`, `*.lightnetwork.pro`, `fonts.googleapis.com`, `fonts.gstatic.com`; IPs `10.0.1.1`, `34.1.223.97`
- DNS: DHCP hands the gateway as DNS, router forwards to 1.1.1.1/8.8.8.8 (captive DNS for HTTPS pay host)
- user `lightnet`/`<api_password>` group full; API enabled — used by `run_check_mikrotik_devices` (RouterOS API over WG) and `lightnet_access_points.py` (reads DHCP leases/neighbors to list "Beacon" APs behind the router)
- boot script: wait for `10.0.1.1`, clear unauthorized hosts so MAC-auth retries; daily 04:00 reboot

## 3. RADIUS policy the Q20 must satisfy (verified, `sites-enabled/default`)

This is the critical part; it is **not** plain `radcheck` auth.

**authorize:** after `sql`, a single big query resolves the voucher:
- match by **MAC**: `vouchers.mac_address = REPLACE(Calling-Station-Id,'-',':') AND expire_time > NOW()` → `Auth-Type := Accept` (no password check: this is how MAC re-login works)
- else by **username**: `vouchers.username = User-Name` and (unused `expire_time IS NULL`, or still valid)
- owner resolution: `sites.wg_ip = NAS-IP-Address` → `nas.nasname = Packet-Src-IP-Address` → `nas.nasname = NAS-IP-Address` → Omada AP via `Called-Station-Id`
- reply: `Session-Timeout` (remaining seconds), `Mikrotik-Rate-Limit` (e.g. `15M/15M`)
- rejects if owner subscription expired, or voucher owner ≠ router owner
- **`if (Called-Station-Id =~ /LIGHTNET/i && rate =~ /^(\d+)M\/(\d+)M$/) → WISPr-Bandwidth-Max-Up/Down`** ← this is the existing non-MikroTik path (Omada/UniFi/TP-Link); a `radacct` row with `calledstationid = 20-E1-5D-44-17-B0:LIGHTNET` proves it is live

**post-auth:** `UPDATE vouchers SET mac_address=Calling-Station-Id, first_login_time, expire_time = NOW()+session_timeout, speed_limit, used=1 WHERE username=User-Name AND expire_time IS NULL` — the voucher is bound to the device **on first successful login**.

**accounting:** `sql` (radacct), interim updates from NAS. `disconnect_expired_users.py` sends CoA **Disconnect-Request keyed by `Framed-IP-Address`** to `nasipaddress:3799` using the `nas.secret` for that NAS — so the NAS **must** report `Framed-IP-Address` in accounting and accept Disconnect by Framed-IP.

**Login completion after purchase** (`lightnet_buy.hotspot_login_get`):
`http://192.168.88.1/login?username=<voucher>&password=ROCKY221122&dst=http://neverssl.com/`
— **hard-coded MikroTik gateway and URL format**, `VOUCHER_PASSWORD='ROCKY221122'`, `LAN_GATEWAY='192.168.88.1'`; `public_site()` also hard-codes `lan_gateway: 192.168.88.1`. The buy portal needs to know it is talking to a Q20 to emit a different return URL.

## 4. CoovaChilli vs OpenNDS — verified against the policy above

| Requirement (from §3) | CoovaChilli | OpenNDS FAS |
|---|---|---|
| PAP Access-Request with `User-Name`/`Password` | yes (`/logon?username&password`; `uamsecret` optional) | no — FAS would have to call RADIUS itself |
| MAC-auth (`macauth`, `Calling-Station-Id` as `XX:XX:…`) | yes: `macauth`, `macpasswd`, `radiusmac`; format via `macallowlocal`/`--macsuffix`; default sends `Calling-Station-Id` as `XX-XX-…` — **policy already normalises `-`→`:`** | partial (FAS-side only) |
| `NAS-IP-Address` = WG IP | `radiusnasip 10.0.1.x` | n/a |
| `Called-Station-Id` containing `LIGHTNET` (for WISPr rate reply) | `radiuscalled`/`nasid` option (set `LIGHTNET` or `<mac>:LIGHTNET`) | n/a |
| Honour `Session-Timeout`, `WISPr-Bandwidth-Max-*` | yes, natively | no |
| Accounting with `Framed-IP-Address`, interim | yes (`interval`, `acct`) | **none** |
| CoA Disconnect-Request by `Framed-IP-Address` on `:3799` | yes (`coaport 3799`, `coanoipcheck`) | no |
| Walled garden hosts + IPs | `uamdomain`, `uamallowed` | `walledgarden` |
| In ImmortalWrt 23.05 feed | `coova-chilli 1.6-10` (`kmod-tun`) | shipped already |
| Risk | chilli must own a tun + DHCP for its subnet (conflicts with our `br-lan` dnsmasq design — needs its own hotspot bridge/VLAN or `dhcpif br-lan` with dnsmasq off on that iface); fw4 interplay untested | breaks accounting, expiry, CoA → unusable for a paid hotspot |

**Decision: CoovaChilli.** With `radiusnasip` + `nasid`/`called` set, the server
cannot tell a Q20 from a MikroTik site except by `client_kind`, and the existing
Omada-style WISPr branch already supplies the rate limit. OpenNDS stays in the
image as a non-billing fallback only.

## 5. "Just add the server URL" — proposed design (additive only)

### 5a. Server side — minimal, no change to existing routes/policy

1. **DB:** `ALTER TABLE sites ADD COLUMN client_kind varchar(20) DEFAULT 'mikrotik', ADD COLUMN bootstrap_token varchar(64) NULL, ADD COLUMN lan_gateway varchar(45) NULL;` (nullable/defaulted — safe for live rows). `add_nas` already supports `client_kind`; set `'q20'` for these sites so dashboards can distinguish them.
2. **Owner panel:** "Add router" gets a type select (MikroTik | LightNet Q20). For Q20, `POST /api/owner/sites` additionally stores `client_kind='q20'`, `lan_gateway='192.168.2.1'`, and a random `bootstrap_token`; response includes a ready-to-paste **provision URL**.
3. **New route** (same owner-auth as `install.rsc`; also allow token-only access so the router can fetch without an owner session):

```
GET https://lightnetwork.pro/sites/<id>/provision.json?t=<bootstrap_token>
```
```json
{ "ok": true, "kind": "q20",
  "site":   {"id":57, "owner_id":13, "name":"DODOMA", "ssid":"LIGHTNET", "contact_phone":"…"},
  "wg":     {"address":"10.0.1.69/32", "private_key":"…", "server_public_key":"IcKE…",
             "endpoint":"34.1.223.97", "port":51820, "allowed_ips":"10.0.1.0/24", "keepalive":25, "mtu":1420},
  "radius": {"server":"10.0.1.1", "auth_port":1812, "acct_port":1813, "coa_port":3799,
             "secret":"…", "nas_ip":"10.0.1.69", "called_station_id":"LIGHTNET", "interim":300},
  "portal": {"buy_url":"https://lightnet.lightnetwork.pro/buy?owner=13&site=57",
             "walled_hosts":["lightnet.lightnetwork.pro","pay.lightnet.com","*.lightnetwork.pro","fonts.googleapis.com","fonts.gstatic.com"],
             "walled_ips":["10.0.1.1","34.1.223.97"]},
  "mgmt":   {"user":"lightnet", "password":"…"} }
```
   Serve it through the **HTTPS nginx vhost** (`location ^~ /sites/` already proxies to Flask), never over `:5000` plain HTTP. Consider marking the token used-once (`bootstrap_used_at`) and letting the owner regenerate it.
4. **Buy portal return URL:** in `lightnet_buy`/`app.py` where `hotspot_login_get()` is used (≈6864) branch on the site's `client_kind`: for `q20` return `http://<lan_gateway>:3990/logon?username=<voucher>&password=ROCKY221122&userurl=http://neverssl.com/` (chilli's UAM logon endpoint; with `uamsecret` unset chilli accepts PAP directly). Also forward chilli's query params (`uamip`, `uamport`, `challenge`, `mac`) through the buy page so the return can be built client-side as a fallback.
5. **Monitoring parity (later):** `run_check_mikrotik_devices` and `lightnet_access_points.py` speak RouterOS API. For Q20, add a tiny HTTP JSON equivalent over WG (`http://10.0.1.x/cgi-bin/lightnet-status`, already exists, add mgmt auth) and branch on `client_kind`. Not needed for billing to work.

### 5b. Router side (this repo)

- `files/etc/config/lightnet` → new `config server 'cloud'`: `url`, `enabled`, `site_id`, `owner_id`, `wg_ip`, `linked_at`, `last_ok`.
- `usr/sbin/lightnet-provision <url>`: `wget -qO-` → `jsonfilter` → write uci `network.wgln` (proto wireguard, private key, `10.0.1.x/32`, peer with `allowed_ips 10.0.1.0/24`, `persistent_keepalive 25`, `endpoint_host/port`, `mtu 1420`), firewall zone `wgln` with input ACCEPT (server mgmt), chilli config, then `ifup wgln` + chilli restart. Store the raw JSON in `/etc/lightnet/server.json` (0600) so reprovision works offline; include `/etc/lightnet` already in `sysupgrade.conf`.
- chilli (`/etc/config/chilli` or `/etc/chilli/config`): `radiusserver1/2 10.0.1.1`, `radiussecret`, `radiusnasip <wg ip>`, `radiusnasid LIGHTNET` (`called_station_id`), `uamserver <buy_url>`, `uamlisten 192.168.2.1`, `uamport 3990`, `uamanydns`, `uamallowed`/`uamdomain` from JSON, `macauth`, `interval 300`, `coaport 3799`, `coanoipcheck`, `dhcpif <hotspot bridge>`, `net 192.168.2.0/24` — **open bench question:** chilli replaces DHCP on the interface it serves; our `br-lan` dnsmasq must be disabled for that iface (or a dedicated `br-hotspot` carries the `LIGHTNET` SSIDs while mesh management stays on `br-lan`). Decide on bench; satellites bridge clients to the same L2 either way.
- Only the **root** node provisions (check `active_role=root`); satellites never contact the server, matching MikroTik sites where only the gateway is the NAS.
- UI: a **Server** card (Dashboard or Portal page): URL field, Link / Unlink, status line "Linked: site 57 (DODOMA) · WG 10.0.1.69 · RADIUS ok · last acct 12 s ago". Status from `lightnet-status` → `server:{linked, wg_up, radius_ok, site}` (radius_ok via `wg` handshake age + a 5-min `radtest`/`echo` is optional).
- Keep the default SSID `LIGHTNET` — the RADIUS WISPr branch keys on it.
- Build: add `coova-chilli kmod-tun` to `build-image.sh`.

### 5c. Bench verification checklist (P1)

1. Hand-write `server.json` for a test site (create it via the owner panel so `sites`/`nas`/peer exist — **this creates a real site and restarts FreeRADIUS briefly; do it once, off-peak**).
2. `wg show` on server shows handshake from the Q20; `ping 10.0.1.1` from router.
3. Phone joins `LIGHTNET` → chilli redirects to `buy?owner=&site=&mac=` → buy a test plan → return hits `:3990/logon` → `radpostauth` Accept, `vouchers.mac_address` bound, `radacct` start row with `nasipaddress=10.0.1.x`, `framedipaddress=192.168.2.x`, `calledstationid` containing `LIGHTNET`.
4. Rate limit visible (WISPr reply) and enforced by chilli.
5. Reconnect same phone → MAC-auth Accept without portal.
6. Expire the voucher → `disconnect_expired_users.py` log shows `Disconnect-ACK` from `10.0.1.x`; client is kicked.
7. Reboot Q20 → WG + chilli come back unattended; satellites unaffected.

## 6. Production safety notes

- Flask on `:5000` is publicly reachable over HTTP; put `provision.json` behind the HTTPS vhost only and consider a GCP firewall rule for `:5000` (out of scope for this project, but flag it).
- Creating a site restarts FreeRADIUS (existing behaviour). Batch Q20 site creation off-peak.
- Legacy NAS rows (`10.0.1.2–.50`, `omada-13-local-*`) use `testing123`; new Q20 sites get random secrets through the normal path — never reuse the legacy secret.
- Per-site secrets (WG private key, RADIUS secret, mgmt password) are provisioned at link time and **never** baked into the firmware image (unlike fleet-wide `mesh.key`).
- Nothing here touches `sites-enabled/default`, `queries.conf`, cron scripts, or existing `.rsc` generation.

---

## 7. Zero-touch enrollment: flash → power on → appears on the server

Goal: a freshly flashed main router, once it has Internet, registers itself
with the server; the server verifies it is genuine LightNet firmware, adds it
to a **LightNet Routers** list, and (immediately or after assignment) runs the
*same* site-creation code the MikroTik flow uses — so each new Q20 gets the
next WG IP / NAS row / site id automatically. Satellites never enrol; the main
reports them.

### 7a. What the server has / lacks (verified)

- **No device registry exists.** `omada_access_points` / `unifi_access_points`
  are owner-typed MAC lists; `sites` is the only router table and is created
  only by `POST /api/owner/sites` (owner session required).
- Every `sites` row needs an `owner_id` (`mikrotik_owners`, 22 owners; `13 =
  LIGHTNET` is the house owner) and passes `require_mikrotik_slot` (quota per
  subscription). An unattended router has no owner yet → enrollment must be
  a **two-stage** process: *register* (no owner) → *provision* (owner known).
- Admin SPA at `/admin` has sections overview / revenue / prices / owners /
  owner-analytics; **no router list**. Owner panel lists only that owner's sites.
- `allocate_wg_ip()` already hands out the next free `10.0.1.x`, so
  "increment like the MikroTik script" is free once we call the same code.

### 7b. Router identity and firmware verification

The router can present:

| Field | Source on the router | Notes |
|---|---|---|
| `mac` | `lightnet-macs id` (base MAC, `50:33:f0:…`) | ASUS OUI — server can whitelist OUIs |
| `device_token` | `/etc/lightnet/device.token` (random UUID, created at first boot by uci-defaults) | per-device secret, survives sysupgrade |
| `model`, `fw_version`, `fw_build` | `ubus system.board`, new `/etc/lightnet/firmware.id` written at build time (git commit + release tag + date) | server keeps a table of known builds (publish SHA256 from GitHub releases) |
| `wg_public_key` | generated once at first boot (`wg genkey`), stored `/etc/lightnet/wg.key` | **the router creates its own keypair** — server never has to send a private key, which is better than the `.rsc` flow |
| `sig` | `HMAC-SHA256(enroll_key, mac|device_token|wg_pub|fw_build|ts)` | `enroll_key` = fleet secret baked in the image (like `mesh.key`); needs `openssl-util` (~0.6 MB) in the build, or shell HMAC via busybox `sha256sum` |

"Verify our firmware" therefore means three cheap checks on the server:
OUI/model allowed, `fw_build` is in the known-builds table, and the HMAC
validates with the fleet `enroll_key`. This is the same trust level as the
secrets inside `install.rsc` (anyone who extracts the image gets the key), but
it blocks random internet noise and lets you **rotate** `enroll_key` per
firmware release. Replay is prevented by `ts` + a server-side nonce, and after
the first contact the `device_token` is pinned to that MAC (first-seen wins;
duplicate MAC with a different token → flagged, not overwritten).

### 7c. Protocol (all HTTPS via `lightnetwork.pro`, nothing on `:5000`)

```
1. POST /api/router/enroll            router → server, every 60 s until provisioned
   {mac, device_token, model, fw_version, fw_build, wg_public_key, hostname,
    wan_ip, uptime, satellites:[{mac,name,signal,uplink}], ts, sig}
   → {status:"pending", router_id:12}                    (new, unassigned)
   → {status:"provisioned", provision:{…§5a JSON…}}      (owner set; secrets)
   → {status:"rejected"} / {status:"blocked"}

2. POST /api/router/heartbeat         every 5 min once provisioned (and over WG)
   {mac, device_token, uptime, wan_ip, wg_ip, clients, satellites[], fw_build}
   → {ok:true, commands:[{"type":"reboot"}|{"type":"reprovision"}|
                         {"type":"upgrade","url":"…sysupgrade.bin","sha256":"…"}]}
```

Server-side on `enroll`:

1. verify `sig`, OUI, `fw_build` → else 403 and log to `router_events`
2. `INSERT IGNORE lightnet_routers (mac, device_token, model, fw_build, wg_public_key, status='pending', first_seen, last_seen, …)`; update `last_seen`, `wan_ip`, `satellites_json` on every call
3. if `status='pending'` and a global setting `q20_auto_provision_owner_id`
   is set (e.g. `13` = LIGHTNET), **or** an admin/owner has assigned
   `owner_id` → call the *existing* `owner_create_site` internals
   (`allocate_wg_ip`, `add_nas(client_kind='q20')`, `INSERT sites`,
   `add_peer(router's wg_public_key, ip)`, `reload_freeradius_clients`) —
   with `name = "Q20-<mac suffix>"` (renamable later) and `wg_private_key_enc = NULL`
   because the router owns its key. Link `lightnet_routers.site_id`.
4. return `provision` JSON built like `render_install_rsc` (minus WG private key, plus `mgmt` creds)

Quota: either count Q20s against the owner's existing MikroTik quota
(`require_mikrotik_slot`) or add `q20_quota` to `owner_subscriptions`. For the
house owner `13` bypass the slot check (flag in settings).

### 7d. The "LightNet Routers" list

New table `lightnet_routers`:
`id, mac UNIQUE, device_token_hash, model, fw_version, fw_build, hostname,
wg_public_key, owner_id NULL, site_id NULL, status ENUM(pending, provisioned,
rejected, blocked), wan_ip, last_seen, first_seen, satellites_json, clients,
notes`.

- **Admin** (`/admin/routers`, new SPA section + `GET /api/admin/routers`):
  every Q20 ever seen, online/offline (last_seen < 10 min), firmware build,
  owner, site, WG IP, satellite count; actions **Assign owner → provision**,
  **Reject**, **Block**, **Reboot**, **Upgrade firmware** (queues a heartbeat
  command pointing at a GitHub release asset + SHA256).
- **Owner panel** (`owner.html` → "My routers" table already exists for
  sites): Q20 sites show with `client_kind='q20'` badge and their satellites
  (from `satellites_json`) — equivalent of today's `lightnet_access_points`
  "Beacon" discovery, without RouterOS API polling.
- **Claiming by owner (optional, UniFi-style):** owner types the MAC/serial
  printed on the box into "Add router → LightNet Q20"; server sets
  `owner_id` on the pending row; next enrol call provisions it. This avoids
  the admin having to assign every unit and keeps the quota logic intact.

### 7e. Router side changes (this repo)

- uci-defaults: generate `/etc/lightnet/wg.key` (+ `.pub`), write
  `/etc/lightnet/firmware.id` at build (build-image.sh stamps git rev/tag).
- `files/etc/config/lightnet` → `config server 'cloud'`: `url
  'https://lightnetwork.pro'` (default baked in, editable), `enabled '1'`,
  `status`, `router_id`, `site_id`, `wg_ip`.
- `usr/sbin/lightnet-cloud` (procd service, root only): state machine
  `unenrolled → pending → provisioned`; enrol every 60 s while pending
  (backoff to 10 min after 1 h), heartbeat every 5 min after; applies
  `provision` JSON via `lightnet-provision` (§5b) and executes commands.
  Includes the live satellite list from `/etc/lightnet/inform/*.json`.
- `lightnet-inform` unchanged (satellite → main); main aggregates.
- UI: Server card — "Registered with lightnetwork.pro · waiting for
  assignment (router #12)" → "Linked: site 57 · WG 10.0.1.69 · RADIUS ok".
  Manual URL override stays for private/self-hosted servers.
- Firmware upgrade command: `sysupgrade -k` with the release asset after
  SHA256 check; `/etc/lightnet` is already preserved so identity survives.

### 7e-bis. What the live owner dashboard looks like today (`https://lightnetwork.pro/dashboard`, owner 13 LIGHTNET)

Checked 2026-10-03 via `POST /api/owner/login` → `X-Owner-Token`.

- Owner 13 "LIGHTNET": **43 MikroTik sites** (ids 14–60, WG `10.0.1.2 … 10.0.1.72`,
  `next_nas_ip 10.0.1.76`), `mikrotik_quota 240`, 1 Omada AP, subscription
  "10 year LIGHTNET grant" to 2036 → **quota is not a blocker** for Q20s under
  this owner.
- Sections: `routers` (table: Router · NAS IP · SSID · Status · Actions →
  *Download install.rsc* + the paste command), `add-router` (two choices only:
  **MIKROTIK** form name+SSID, and **Omada → Register access point** by AP MAC),
  `omada`, `plans`, `clients`, `analytics` (per-router performance), `billing`,
  `subscription`.
- "Online" on the routers page = the server **pings the site's WG IP**
  (`run_check_mikrotik_devices`, `ping -c2 -W2 10.0.1.x`) → a Q20 with its WG
  tunnel up shows **online with zero extra work**.
- No admin-wide router list anywhere; `/admin` is revenue/owners analytics only.

So the Q20 fits the existing UI with two small additions, mirroring what is
already there for Omada:

1. **add-router → third card "LightNet Q20"**: text "Flash the LightNet
   firmware, connect WAN to Internet, power on. The router registers itself
   here within 2 minutes." plus a *Claim by MAC* box (same shape as the Omada
   "Register access point" form) for owners other than the house owner.
2. **routers table**: rows with `client_kind='q20'` show a Q20 badge, no
   `.rsc` download, an *Access points* count (satellites from `satellites_json`),
   and *Reboot* / *Upgrade* actions. Online state unchanged (WG ping).

### 7f. Why this is safe for production

- All new: 1 table, 3 routes, 1 admin section, 2 nullable `sites` columns.
  No change to RADIUS policy, `.rsc` generation, or MikroTik sites.
- Provisioning reuses the exact functions MikroTik creation uses, so WG IP
  allocation, NAS rows, FreeRADIUS reload and billing hooks stay consistent.
- Secrets flow only after verification and only over HTTPS; the WG private
  key never leaves the router.
- FreeRADIUS restart on provision is the existing cost; with auto-provision
  it happens once per new Q20, same as adding a MikroTik today.

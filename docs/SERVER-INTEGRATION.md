# LightNet Q20 ↔ lightnet-server integration research

Server: `lightnet-server` (Google VM `34.1.223.97`, internal `10.218.0.4`,
Ubuntu 22.04). SSH: `lightnet-tech@34.1.223.97` (key `lightnet-tech`).

## 1. What runs on the server

| Piece | Detail |
|---|---|
| FreeRADIUS | auth `:1812`, acct `:1813`, CoA `:3799`; **dynamic clients**: NAS rows are read from the SQL `nas` table via site `lightnet-dynamic-clients` keyed on `Packet-Src-IP-Address` |
| MariaDB `radius` | `radcheck` 4,593 users, `radacct` 4,060 sessions, `nas` ~70 rows, `sites`, `mikrotik_owners`, `owner_plans`, `radpostauth` |
| WireGuard `wg0` | `:51820`, server IP `10.0.1.1`, pubkey `IcKEt3X8LBIr7BJgnKjKQMq/2YRCkGXIIHqigK/donU=`, ~60 site routers as peers on `10.0.1.x/32` |
| nginx `:80/:443` | portals: `lightnet`, `lightnetwork.co.tz`, `lightnetwork.pro`, `pay.lightnet.com`, `tplink-portal`(:8001), `unifi-portal`, `omada` |
| Flask/Gunicorn `:5000` | `/opt/app.py` (7,906 lines) + helper modules (`lightnet_sites.py`, `lightnet_buy.py`, `lightnet_access_points.py`, …); the real provisioning API |

## 2. How a site is added today (MikroTik)

Owner logs into `lightnetwork.pro` owner panel →

```
POST /api/owner/sites        {name, ssid}          (X-Owner-Token auth)
GET  /api/owner/sites/<id>/install.rsc             → MikroTik one-shot script
GET  /api/buy/bootstrap?owner=<o>&site=<s>         → plans/portal data (public)
```

`POST /api/owner/sites` (app.py ~6128) does, atomically:

1. `require_mikrotik_slot` — subscription check
2. `allocate_wg_ip(cur)` — first free `10.0.1.x`
3. `generate_keypair()` — WG keys, private stored Fernet-encrypted
4. random `radius_secret`, management `api_user`/`api_password`
5. `INSERT INTO sites …` + `add_nas` row (`nasname`=wg_ip, `shortname`=siteN)
6. `add_peer(pub, wg_ip)` — **live** `wg set` (no reload needed)
7. `reload_freeradius_clients()` — restart so the new NAS auths

`render_install_rsc` (`lightnet_sites.py:287`) fills a template with
`__WG_NAS_IP__`, `__WG_CLIENT_PRIV__`, `__RADIUS_SECRET__`, `__SITE_NAME__`,
`__OWNER_ID__`, `__SITE_ID__`, `__OWNER_PHONE__`, `__HOTSPOT_LOGIN_HTML__`,
`__API_USER__`, `__API_PASSWORD__`.

The `.rsc` then configures on the MikroTik: WG client → `10.0.1.x`,
RADIUS client → `10.0.1.1:1812/1813` with `src-address`=WG IP, hotspot on
`192.168.88.0/24` (`login-by=http-pap,http-chap,mac`, `mac-as-username-
and-password`, interim acct 5 m, CoA on), `login.html` that redirects to
`https://lightnet.lightnetwork.pro/buy?owner=<o>&site=<s>&mac=$(mac)`,
walled garden (`lightnet.lightnetwork.pro`, `pay.lightnet.com`,
`*.lightnetwork.pro`, fonts.googleapis/gstatic, `10.0.1.1`, `34.1.223.97`),
a management API user (server polls the router via RouterOS API over WG —
see `/opt/check_mikrotik_status.py`), and a daily 04:00 reboot.

**Key insight: the `.rsc` file IS the provisioning payload.** All secrets
(WG private key, RADIUS secret, API password) travel inside it. A JSON
equivalent for our firmware is no less secure than the existing flow.

## 3. CoovaChilli vs OpenNDS FAS (decision)

| | CoovaChilli | OpenNDS |
|---|---|---|
| Architecture | RADIUS client; identical to MikroTik Hotspot | Firewall gate + external FAS does auth |
| `radcheck`/`radacct` | native auth + accounting + CoA | **none** — billing pipeline gets nothing |
| Kick/expiry | Disconnect-Request on `:3799` | custom `openndsctl` call |
| Walled garden | `uamallowed`/`uamdomain` (host+IP) | `walledgarden` lists |
| Login return | `http://<lan-ip>:3990/logon?username=&password=` → PAP→RADIUS | `/opennds_auth/?tok=` (FAS-signed) |
| Packaging | `coova-chilli 1.6-10` in 23.05 feeds; upstream semi-dormant — **bench-test required under fw4** | already shipped |

**Recommendation: CoovaChilli.** The Q20 then looks identical to a
MikroTik NAS — zero changes to auth/accounting/billing. OpenNDS would
silently drop the entire accounting/enforcement chain. Keep OpenNDS as a
fallback if chilli misbehaves on MT7621.

## 4. Proposed "just add the server URL" flow

Goal: admin opens the router's **Server** page, enters a server URL +
site key, done. Design (mirrors how UniFi inform/Teleport work and
reuses what the server already generates):

### Server side — one small additive change

Add to `/opt/app.py` (≈40 lines, same auth surface as `install.rsc`):

```
GET /sites/<id>/provision.json?t=<token>
```

- `<token>` = per-site bootstrap token (add `sites.bootstrap_token`,
  random 24-char, returned in `public_site()` so the owner panel can
  display "Q20 link: https://34.1.223.97:5000/sites/57/provision.json?t=…").
- Returns the same payload `render_install_rsc` produces, as JSON:

```json
{
  "ok": true,
  "wg": {"ip": "10.0.1.69/32", "private_key": "…", "server_public_key": "IcKE…",
          "endpoint": "34.1.223.97", "port": 51820, "allowed": "10.0.1.0/24"},
  "radius": {"server": "10.0.1.1", "auth_port": 1812, "acct_port": 1813,
              "secret": "o28PRLS…", "coa_port": 3799},
  "site": {"id": 57, "name": "DODOMA", "owner_id": 13, "ssid": "LIGHTNET"},
  "portal": {"uamserver": "https://lightnet.lightnetwork.pro/buy?owner=13&site=57",
              "uamallowed": ["lightnet.lightnetwork.pro","pay.lightnet.com",
                              "*.lightnetwork.pro","fonts.googleapis.com","fonts.gstatic.com"],
              "uamallowed_ip": ["10.0.1.1","34.1.223.97"]},
  "api": {"user": "lightnet", "password": "…"}      // for later server→router mgmt
}
```

Optional later upgrade: `/api/router/claim` with short claim codes
(UniFi-style "type SITE-57-9F3K"), which lets a factory unit
self-register without the owner touching the panel — phase 2.

### Router side (this repo)

- `files/etc/config/lightnet` — new `server` section:
  `option enabled`, `url` (the provision.json URL), `status`,
  `wg_ip`, `site_id`, `owner_id`.
- `files/usr/sbin/lightnet-provision` — fetch+apply:
  1. `wget -qO- "$url"` → parse JSON (jsonfilter)
  2. write WG iface `wgln` (priv key, `10.0.1.x/32`, peer server,
     allowed `10.0.1.0/24`, keepalive 25, mtu 1420) + firewall rule
     `input` accept on `wgln` (management over tunnel, like the .rsc)
  3. generate chilli config (`/etc/chilli/defaults` or uci `chilli`):
     `radiusserver1 10.0.1.1`, `radiussecret`, `uamlisten 192.168.2.1:3990`,
     `uamserver` = portal URL (chilli appends `uamip/uamport/challenge/mac`),
     `uamallowed`/`uamdomain` walled garden, `coaport 3799`,
     `macauth` + `radiusmac` (`XX:XX:…` to match radcheck format),
     `interim 300`, `tundev tun0`, `dhcpif br-lan` or its own subnet —
     **decide on bench**: chilli on `br-lan` conflicts with dnsmasq DHCP;
     standard chilli pattern is a dedicated `hotspot` interface/subnet.
  4. restart wg + chilli; write `/etc/lightnet/server.state`
     (`provisioned=1`, `site_id`, `wg_ip`).
- `lightnet-apply-role`: only the **root** node provisions (satellites
  never talk to the server — their client traffic reaches RADIUS via the
  main, identical to MikroTik sites where only the gateway router is NAS).
- `lightnet-inform`/`lightnet-status`: report `server_status` so the UI
  shows "Linked to lightnet-server (site 57, 10.0.1.69)".
- New UI section on the Portal page (or a small "Server" card on
  Dashboard): server URL + Link button + status.
- Build: add `coova-chilli` to `build-image.sh` PACKAGES.

### Portal compatibility check needed on bench

MikroTik returns the user to its own `/login` with username+password.
Chilli returns via `http://192.168.2.1:3990/logon?username=&password=`.
The `lightnet.lightnetwork.pro/buy` flow was built for MikroTik vars —
needs a `nas=q20` (or chilli semantics) variant so post-purchase it
redirects to the chilli `/logon` URL it receives in the redirect params
(`uamip`,`uamport`,`mac`,`challenge`). Small change in the buy portal
code; flag to whoever owns `/var/www/lightnetwork` / `lightnet_buy.py`.

## 5. Phases

1. **P0 research** (this doc): map server + pick chilli.
2. **P1 bench**: `provision.json` endpoint on server (or hand-made JSON
   for testing), `lightnet-provision` + chilli on one Q20, verify:
   WG up → Access-Request sources from `10.0.1.x` → MAC-auth accept →
   redirect to buy portal → voucher login → `radacct` rows appear →
   expired user kicked.
3. **P2 UI**: Server card + status; satellites untouched.
4. **P3**: emulate enough of the RouterOS-API equivalents
   (`check_mikrotik_status.py`, `lightnet_access_points.py` discovery)
   as JSON over WG so the server's site-monitoring works for Q20s;
   optional `/api/router/claim` self-registration.

## 6. Security notes

- `provision.json?t=` URL carries all site secrets — same risk class as
  `install.rsc`; serve only on `:5000` (WG) or HTTPS, and consider
  one-time/short-lived tokens later.
- Never ship `wg_private_key`/`radius_secret` in the image — they are
  per-site and provisioned at deploy time, unlike `mesh.key` (fleet-wide).
- Keep `testing123` (legacy) and `uamsecret` out of any client download.

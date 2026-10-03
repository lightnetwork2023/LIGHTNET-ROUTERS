"""LightNet Q20 zero-touch enrollment.

Additive module: new tables (see schema.sql) and new routes only. Q20 sites are
created through the same lightnet_sites helpers the MikroTik flow uses
(allocate_wg_ip / add_nas / add_peer / reload_freeradius_clients), so they get
the next WG IP, a nas row and a live peer exactly like a MikroTik site.

Routes
  POST /api/router/enroll          firmware -> server (signed with fleet enroll key)
  POST /api/router/heartbeat       firmware -> server, returns queued commands
  GET  /api/owner/q20              owner's Q20 routers (+ unassigned ones for the auto-provision owner)
  POST /api/owner/q20/claim        {mac}  owner claims a pending router
  PATCH /api/owner/q20/<id>        {name}
  POST /api/owner/q20/<id>/command {type: reboot|reprovision|upgrade}
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import secrets
import subprocess
import time
from pathlib import Path

import mysql.connector

import lightnet_sites

log = logging.getLogger(__name__)

ENROLL_KEY_FILE = '/etc/lightnet-q20/enroll.key'
SIG_WINDOW = 600  # seconds
ONLINE_WINDOW = 600
WALLED_HOSTS = ['lightnet.lightnetwork.pro', 'pay.lightnet.com', '*.lightnetwork.pro',
                'fonts.googleapis.com', 'fonts.gstatic.com']
VOUCHER_PASSWORD = 'ROCKY221122'
CHILLI_UAM_PORT = 3990


# ----------------------------------------------------------------- helpers

def _enroll_key() -> str:
    try:
        return Path(ENROLL_KEY_FILE).read_text().strip()
    except Exception:
        return ''


def _norm_mac(mac: str) -> str:
    mac = (mac or '').strip().lower().replace('-', ':')
    parts = mac.split(':')
    if len(parts) != 6 or any(len(p) != 2 for p in parts):
        return ''
    try:
        int(mac.replace(':', ''), 16)
    except ValueError:
        return ''
    return mac


def _sha(s: str) -> str:
    return hashlib.sha256((s or '').encode()).hexdigest()


def _sig_ok(data: dict) -> bool:
    key = _enroll_key()
    if not key:
        return False
    try:
        ts = int(data.get('ts') or 0)
    except (TypeError, ValueError):
        return False
    if abs(time.time() - ts) > SIG_WINDOW:
        return False
    msg = '|'.join(str(data.get(k) or '') for k in ('mac', 'device_token', 'wg_public_key', 'fw_build', 'ts'))
    want = hmac.new(key.encode(), msg.encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, str(data.get('sig') or ''))


def _settings(cur) -> dict:
    cur.execute('SELECT k, v FROM lightnet_q20_settings')
    return {r['k']: r['v'] for r in cur.fetchall()}


def _event(cur, mac, router_id, event, detail='', src_ip=''):
    try:
        cur.execute(
            'INSERT INTO lightnet_router_events (mac, router_id, event, detail, src_ip) VALUES (%s,%s,%s,%s,%s)',
            (mac, router_id, event, (detail or '')[:500], src_ip),
        )
    except Exception as e:
        log.warning('q20 event log failed: %s', e)


def _server_wg_pubkey() -> str:
    try:
        return subprocess.check_output(['wg', 'show', lightnet_sites.WG_IFACE, 'public-key'], text=True).strip()
    except Exception as e:
        log.warning('wg public-key failed: %s', e)
        return ''


def _public_router(r: dict) -> dict:
    last = r.get('last_seen')
    online = bool(last) and (time.time() - last.timestamp()) < ONLINE_WINDOW
    sats = []
    try:
        sats = json.loads(r.get('satellites_json') or '[]')
    except Exception:
        pass
    return {
        'id': r['id'], 'mac': r['mac'], 'name': r.get('name') or r.get('hostname') or ('Q20-' + r['mac'][-5:].replace(':', '')),
        'hostname': r.get('hostname'), 'model': r.get('model'), 'fw_version': r.get('fw_version'), 'fw_build': r.get('fw_build'),
        'status': r.get('status'), 'owner_id': r.get('owner_id'), 'site_id': r.get('site_id'),
        'wg_ip': r.get('wg_ip'), 'wan_ip': r.get('wan_ip'), 'lan_gateway': r.get('lan_gateway'),
        'clients': r.get('clients') or 0, 'uptime': r.get('uptime'), 'satellites': sats, 'satellite_count': len(sats),
        'online': online, 'first_seen': r['first_seen'].isoformat() if r.get('first_seen') else None,
        'last_seen': last.isoformat() if last else None,
        'provisioned_at': r['provisioned_at'].isoformat() if r.get('provisioned_at') else None,
        'pending_commands': json.loads(r.get('pending_commands') or '[]') if r.get('pending_commands') else [],
    }


# -------------------------------------------------------------- provisioning

def _build_provision(cur, router: dict, site: dict, settings: dict) -> dict:
    import lightnet_buy
    try:
        mgmt_pw = lightnet_sites.decrypt_secret(site['api_password_enc']) if site.get('api_password_enc') else ''
    except Exception:
        mgmt_pw = ''
    buy_base = settings.get('buy_base') or lightnet_buy.PAY_BASE_URL
    return {
        'kind': 'q20',
        'site': {'id': site['id'], 'owner_id': site['owner_id'], 'name': site.get('name'),
                 'ssid': site.get('ssid') or 'LIGHTNET', 'contact_phone': site.get('contact_phone') or ''},
        'wg': {'address': site['wg_ip'] + '/32', 'server_public_key': _server_wg_pubkey(),
               'endpoint': settings.get('wg_endpoint') or '34.1.223.97', 'port': int(settings.get('wg_port') or 51820),
               'allowed_ips': lightnet_sites.WG_NET + '.0/24', 'keepalive': 25, 'mtu': 1420},
        'radius': {'server': lightnet_sites.WG_SERVER_IP, 'auth_port': 1812, 'acct_port': 1813, 'coa_port': 3799,
                   'secret': site['radius_secret'], 'nas_ip': site['wg_ip'], 'nas_id': 'LIGHTNET',
                   'called_station_id': 'LIGHTNET', 'interim': 300},
        'portal': {'buy_url': lightnet_buy.buy_url_for_html(site['owner_id'], site['id'], buy_base).replace('&mac=$(mac)', ''),
                   'walled_hosts': WALLED_HOSTS,
                   'walled_ips': [lightnet_sites.WG_SERVER_IP, settings.get('wg_endpoint') or '34.1.223.97'],
                   'uam_port': CHILLI_UAM_PORT, 'lan_gateway': site.get('lan_gateway') or router.get('lan_gateway') or '192.168.2.1'},
        'mgmt': {'user': site.get('api_user') or lightnet_sites.MANAGEMENT_API_USER, 'password': mgmt_pw},
    }


def _create_site_for_router(cur, router: dict, owner_id: int, billing_hooks=None) -> dict:
    """Same steps as app.owner_create_site, minus the owner session and the WG private key
    (the router generated its own keypair and only sent the public key)."""
    name = router.get('name') or router.get('hostname') or ('Q20-' + router['mac'][-5:].replace(':', '').upper())
    secret = secrets.token_urlsafe(18)
    wg_ip = lightnet_sites.allocate_wg_ip(cur)
    api_password = lightnet_sites.gen_api_password()
    cur.execute(
        "INSERT INTO sites (owner_id, name, ssid, wg_ip, radius_secret, wg_private_key_enc, wg_public_key, status, "
        "api_user, api_password_enc, client_kind, lan_gateway) VALUES (%s,%s,%s,%s,%s,NULL,%s,'active',%s,%s,'q20',%s)",
        (owner_id, name[:120], 'LIGHTNET', wg_ip, secret, router.get('wg_public_key'),
         lightnet_sites.MANAGEMENT_API_USER, lightnet_sites.encrypt_secret(api_password),
         router.get('lan_gateway') or '192.168.2.1'),
    )
    site_id = cur.lastrowid
    lightnet_sites.add_nas(cur, wg_ip, secret, 'site%s' % site_id, owner_id=owner_id)
    cur.execute("UPDATE nas SET client_kind='q20', description=%s WHERE nasname=%s",
                ('LightNet Q20 %s' % router['mac'], wg_ip))
    if billing_hooks:
        try:
            fetch_owner_billing, apply_billing_to_nas = billing_hooks
            billing = fetch_owner_billing(cur, owner_id)
            if billing:
                apply_billing_to_nas(cur, owner_id, wg_ip, name, billing)
        except Exception as e:
            log.warning('q20 billing hook: %s', e)
    try:
        import lightnet_app_docs
        lightnet_app_docs.ensure_owner_site_locations(cur, owner_id)
    except Exception as e:
        log.warning('q20 ensure_owner_site_locations: %s', e)
    cur.execute(
        "UPDATE lightnet_routers SET owner_id=%s, site_id=%s, status='provisioned', provisioned_at=NOW(), name=%s WHERE id=%s",
        (owner_id, site_id, name[:120], router['id']),
    )
    cur.execute('SELECT * FROM sites WHERE id=%s', (site_id,))
    return cur.fetchone()


def _sync_peer(site: dict, new_pub: str, cur) -> None:
    """Router keypair changed (factory reset) -> swap the WG peer."""
    old = site.get('wg_public_key') or ''
    if old == new_pub or not new_pub:
        return
    if old:
        try:
            lightnet_sites.remove_peer(old)
        except Exception as e:
            log.warning('q20 remove old peer: %s', e)
    cur.execute('UPDATE sites SET wg_public_key=%s WHERE id=%s', (new_pub, site['id']))
    site['wg_public_key'] = new_pub


# --------------------------------------------------------------- the routes

def register_routes(app, db_config, require_owner, billing_hooks=None):
    from flask import jsonify, request

    def _conn():
        conn = mysql.connector.connect(**db_config)
        return conn, conn.cursor(dictionary=True)

    def _src():
        return (request.headers.get('X-Real-IP') or request.remote_addr or '')[:45]

    def _router_by_mac(cur, mac):
        cur.execute('SELECT r.*, s.wg_ip FROM lightnet_routers r LEFT JOIN sites s ON s.id=r.site_id WHERE r.mac=%s', (mac,))
        return cur.fetchone()

    # ------------------------------------------------------------ enroll
    @app.route('/api/router/enroll', methods=['POST'])
    def q20_enroll():
        data = request.json or {}
        mac = _norm_mac(data.get('mac'))
        if not mac:
            return jsonify({'ok': False, 'error': 'bad mac'}), 400
        conn, cur = _conn()
        try:
            if not _sig_ok(data):
                _event(cur, mac, None, 'bad_signature', json.dumps({k: data.get(k) for k in ('fw_build', 'model')}), _src())
                conn.commit()
                return jsonify({'ok': False, 'error': 'signature'}), 403
            st = _settings(cur)
            ouis = [o.strip().lower() for o in (st.get('allowed_ouis') or '').split(',') if o.strip()]
            if ouis and not any(mac.startswith(o) for o in ouis):
                _event(cur, mac, None, 'bad_oui', mac, _src()); conn.commit()
                return jsonify({'ok': False, 'error': 'device not allowed'}), 403
            fw_build = (data.get('fw_build') or '')[:64]
            if st.get('require_known_build') == '1':
                cur.execute('SELECT allowed FROM lightnet_firmware_builds WHERE fw_build=%s', (fw_build,))
                b = cur.fetchone()
                if not b or not b['allowed']:
                    _event(cur, mac, None, 'unknown_build', fw_build, _src()); conn.commit()
                    return jsonify({'ok': False, 'error': 'firmware build not allowed'}), 403
            else:
                cur.execute('INSERT IGNORE INTO lightnet_firmware_builds (fw_build, fw_version, notes) VALUES (%s,%s,%s)',
                            (fw_build or 'unknown', (data.get('fw_version') or '')[:64], 'auto-registered on first enroll'))

            tok_hash = _sha(data.get('device_token'))
            sats = data.get('satellites') if isinstance(data.get('satellites'), list) else []
            r = _router_by_mac(cur, mac)
            if not r:
                cur.execute(
                    'INSERT INTO lightnet_routers (mac, device_token_hash, model, hostname, fw_version, fw_build, wg_public_key, '
                    'wan_ip, lan_gateway, uptime, clients, satellites_json, last_seen) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NOW())',
                    (mac, tok_hash, (data.get('model') or '')[:64], (data.get('hostname') or '')[:64],
                     (data.get('fw_version') or '')[:64], fw_build, (data.get('wg_public_key') or '')[:64],
                     (data.get('wan_ip') or '')[:45], (data.get('lan_gateway') or '192.168.2.1')[:45],
                     int(data.get('uptime') or 0), int(data.get('clients') or 0), json.dumps(sats)[:65000]),
                )
                _event(cur, mac, cur.lastrowid, 'enrolled', fw_build, _src())
                r = _router_by_mac(cur, mac)
            else:
                if r['device_token_hash'] != tok_hash:
                    _event(cur, mac, r['id'], 'token_rebind', 'device token changed (factory reset?)', _src())
                cur.execute(
                    'UPDATE lightnet_routers SET device_token_hash=%s, model=%s, hostname=%s, fw_version=%s, fw_build=%s, '
                    'wg_public_key=%s, wan_ip=%s, lan_gateway=%s, uptime=%s, clients=%s, satellites_json=%s, last_seen=NOW() WHERE id=%s',
                    (tok_hash, (data.get('model') or r['model'] or '')[:64], (data.get('hostname') or '')[:64],
                     (data.get('fw_version') or '')[:64], fw_build, (data.get('wg_public_key') or '')[:64],
                     (data.get('wan_ip') or '')[:45], (data.get('lan_gateway') or r.get('lan_gateway') or '192.168.2.1')[:45],
                     int(data.get('uptime') or 0), int(data.get('clients') or 0), json.dumps(sats)[:65000], r['id']),
                )
                r = _router_by_mac(cur, mac)

            if r['status'] in ('rejected', 'blocked'):
                conn.commit()
                return jsonify({'ok': True, 'status': r['status'], 'router_id': r['id']})

            # decide owner: already assigned, or auto-provision owner
            owner_id = r.get('owner_id')
            if not owner_id and st.get('auto_provision_owner_id'):
                try:
                    owner_id = int(st['auto_provision_owner_id'])
                except ValueError:
                    owner_id = None
                if owner_id:
                    cur.execute("SELECT id FROM mikrotik_owners WHERE id=%s AND status='active'", (owner_id,))
                    if not cur.fetchone():
                        owner_id = None

            site = None
            new_site = False
            if r.get('site_id'):
                cur.execute("SELECT * FROM sites WHERE id=%s AND status='active'", (r['site_id'],))
                site = cur.fetchone()
                if site:
                    _sync_peer(site, (data.get('wg_public_key') or '')[:64], cur)
            if not site and owner_id:
                site = _create_site_for_router(cur, dict(r, wg_public_key=(data.get('wg_public_key') or '')[:64]),
                                               owner_id, billing_hooks)
                new_site = True
                _event(cur, mac, r['id'], 'provisioned', 'site %s wg %s owner %s' % (site['id'], site['wg_ip'], owner_id), _src())
            conn.commit()

            if not site:
                return jsonify({'ok': True, 'status': 'pending', 'router_id': r['id'], 'retry': 60})

            # live side effects after commit, like owner_create_site
            try:
                lightnet_sites.add_peer(site['wg_public_key'], site['wg_ip'],
                                        comment='Q20 %s site id=%s' % (mac, site['id']))
            except Exception as e:
                log.error('q20 add_peer %s: %s', mac, e)
            if new_site:
                lightnet_sites.reload_freeradius_clients()
            cur.execute('SELECT * FROM lightnet_routers WHERE id=%s', (r['id'],))
            r = cur.fetchone()
            return jsonify({'ok': True, 'status': 'provisioned', 'router_id': r['id'],
                            'provision': _build_provision(cur, r, site, st)})
        except Exception as e:
            conn.rollback()
            log.exception('q20 enroll %s failed', mac)
            return jsonify({'ok': False, 'error': str(e)}), 500
        finally:
            cur.close(); conn.close()

    # --------------------------------------------------------- heartbeat
    @app.route('/api/router/heartbeat', methods=['POST'])
    def q20_heartbeat():
        data = request.json or {}
        mac = _norm_mac(data.get('mac'))
        if not mac or not _sig_ok(data):
            return jsonify({'ok': False, 'error': 'auth'}), 403
        conn, cur = _conn()
        try:
            r = _router_by_mac(cur, mac)
            if not r or r['device_token_hash'] != _sha(data.get('device_token')):
                return jsonify({'ok': False, 'error': 'unknown router', 'reenroll': True}), 404
            sats = data.get('satellites') if isinstance(data.get('satellites'), list) else []
            cmds = json.loads(r.get('pending_commands') or '[]') if r.get('pending_commands') else []
            cur.execute(
                'UPDATE lightnet_routers SET fw_version=%s, fw_build=%s, wan_ip=%s, uptime=%s, clients=%s, satellites_json=%s, '
                'pending_commands=NULL, last_seen=NOW() WHERE id=%s',
                ((data.get('fw_version') or r['fw_version'] or '')[:64], (data.get('fw_build') or r['fw_build'] or '')[:64],
                 (data.get('wan_ip') or '')[:45], int(data.get('uptime') or 0), int(data.get('clients') or 0),
                 json.dumps(sats)[:65000], r['id']),
            )
            if cmds:
                _event(cur, mac, r['id'], 'commands_delivered', json.dumps(cmds), _src())
            conn.commit()
            out = {'ok': True, 'status': r['status'], 'commands': cmds}
            if r['status'] == 'provisioned' and not r.get('wg_ip'):
                out['reenroll'] = True
            return jsonify(out)
        except Exception as e:
            conn.rollback()
            log.exception('q20 heartbeat %s failed', mac)
            return jsonify({'ok': False, 'error': str(e)}), 500
        finally:
            cur.close(); conn.close()

    # ------------------------------------------------------- owner panel
    def _owner_router(cur, owner, rid):
        cur.execute('SELECT r.*, s.wg_ip FROM lightnet_routers r LEFT JOIN sites s ON s.id=r.site_id WHERE r.id=%s AND r.owner_id=%s',
                    (rid, owner['id']))
        return cur.fetchone()

    @app.route('/api/owner/q20', methods=['GET'])
    def q20_owner_list():
        owner, err = require_owner()
        if err:
            return err
        conn, cur = _conn()
        try:
            st = _settings(cur)
            auto_owner = st.get('auto_provision_owner_id')
            if auto_owner and str(owner['id']) == str(auto_owner):
                cur.execute('SELECT r.*, s.wg_ip FROM lightnet_routers r LEFT JOIN sites s ON s.id=r.site_id '
                            'WHERE r.owner_id=%s OR r.owner_id IS NULL ORDER BY r.last_seen DESC', (owner['id'],))
            else:
                cur.execute('SELECT r.*, s.wg_ip FROM lightnet_routers r LEFT JOIN sites s ON s.id=r.site_id '
                            'WHERE r.owner_id=%s ORDER BY r.last_seen DESC', (owner['id'],))
            routers = [_public_router(r) for r in cur.fetchall()]
            cur.execute('SELECT fw_build, fw_version, is_latest, sysupgrade_url FROM lightnet_firmware_builds WHERE allowed=1 ORDER BY id DESC LIMIT 10')
            builds = cur.fetchall()
            return jsonify({'success': True, 'routers': routers, 'builds': builds,
                            'online': sum(1 for r in routers if r['online']), 'total': len(routers)})
        finally:
            cur.close(); conn.close()

    @app.route('/api/owner/q20/claim', methods=['POST'])
    def q20_owner_claim():
        owner, err = require_owner()
        if err:
            return err
        mac = _norm_mac((request.json or {}).get('mac'))
        if not mac:
            return jsonify({'success': False, 'error': 'Enter the MAC address printed on the router'}), 400
        conn, cur = _conn()
        try:
            r = _router_by_mac(cur, mac)
            if not r:
                return jsonify({'success': False, 'error': 'Router not seen yet. Power it on with Internet on WAN and try again in 2 minutes.'}), 404
            if r.get('owner_id') and r['owner_id'] != owner['id']:
                return jsonify({'success': False, 'error': 'This router is already assigned to another account'}), 409
            cur.execute("UPDATE lightnet_routers SET owner_id=%s, status=IF(status IN ('rejected','blocked'),'pending',status) WHERE id=%s",
                        (owner['id'], r['id']))
            _event(cur, mac, r['id'], 'claimed', 'owner %s' % owner['id'], _src())
            conn.commit()
            return jsonify({'success': True, 'router': _public_router(_router_by_mac(cur, mac)),
                            'message': 'Claimed. The router will be provisioned on its next check-in (within 60 s).'})
        finally:
            cur.close(); conn.close()

    @app.route('/api/owner/q20/<int:rid>', methods=['PATCH'])
    def q20_owner_rename(rid):
        owner, err = require_owner()
        if err:
            return err
        name = ((request.json or {}).get('name') or '').strip()[:120]
        if not name:
            return jsonify({'success': False, 'error': 'Name is required'}), 400
        conn, cur = _conn()
        try:
            r = _owner_router(cur, owner, rid)
            if not r:
                return jsonify({'success': False, 'error': 'Router not found'}), 404
            cur.execute('UPDATE lightnet_routers SET name=%s WHERE id=%s', (name, rid))
            if r.get('site_id'):
                cur.execute('UPDATE sites SET name=%s WHERE id=%s AND owner_id=%s', (name, r['site_id'], owner['id']))
            conn.commit()
            return jsonify({'success': True, 'router': _public_router(_owner_router(cur, owner, rid))})
        finally:
            cur.close(); conn.close()

    @app.route('/api/owner/q20/<int:rid>/command', methods=['POST'])
    def q20_owner_command(rid):
        owner, err = require_owner()
        if err:
            return err
        data = request.json or {}
        ctype = (data.get('type') or '').strip()
        if ctype not in ('reboot', 'reprovision', 'upgrade', 'reject', 'unreject'):
            return jsonify({'success': False, 'error': 'Unknown command'}), 400
        conn, cur = _conn()
        try:
            r = _owner_router(cur, owner, rid)
            if not r:
                return jsonify({'success': False, 'error': 'Router not found'}), 404
            if ctype == 'reject':
                cur.execute("UPDATE lightnet_routers SET status='rejected' WHERE id=%s", (rid,))
            elif ctype == 'unreject':
                cur.execute("UPDATE lightnet_routers SET status=IF(site_id IS NULL,'pending','provisioned') WHERE id=%s", (rid,))
            else:
                cmd = {'type': ctype}
                if ctype == 'upgrade':
                    cur.execute('SELECT sysupgrade_url, sysupgrade_sha256, fw_build FROM lightnet_firmware_builds '
                                'WHERE allowed=1 AND sysupgrade_url IS NOT NULL ORDER BY is_latest DESC, id DESC LIMIT 1')
                    b = cur.fetchone()
                    if not b:
                        return jsonify({'success': False, 'error': 'No firmware build published'}), 400
                    cmd.update({'url': b['sysupgrade_url'], 'sha256': b['sysupgrade_sha256'], 'fw_build': b['fw_build']})
                cmds = json.loads(r.get('pending_commands') or '[]') if r.get('pending_commands') else []
                cmds = [c for c in cmds if c.get('type') != ctype] + [cmd]
                cur.execute('UPDATE lightnet_routers SET pending_commands=%s WHERE id=%s', (json.dumps(cmds), rid))
            _event(cur, r['mac'], rid, 'command_' + ctype, '', _src())
            conn.commit()
            return jsonify({'success': True, 'router': _public_router(_owner_router(cur, owner, rid))})
        finally:
            cur.close(); conn.close()

    log.info('lightnet_q20 routes registered')


# ------------------------------------------------- used by the buy portal

def hotspot_login_url(db_config, site_id, voucher, fallback):
    """Q20 sites run CoovaChilli: return its UAM logon URL instead of the MikroTik /login."""
    if not voucher or not site_id:
        return fallback
    try:
        conn = mysql.connector.connect(**db_config)
        cur = conn.cursor(dictionary=True)
        cur.execute('SELECT client_kind, lan_gateway FROM sites WHERE id=%s', (site_id,))
        s = cur.fetchone()
        cur.close(); conn.close()
    except Exception as e:
        log.warning('hotspot_login_url: %s', e)
        return fallback
    if not s or (s.get('client_kind') or '') != 'q20':
        return fallback
    gw = s.get('lan_gateway') or '192.168.2.1'
    return 'http://%s:%s/logon?username=%s&password=%s&userurl=http%%3A%%2F%%2Fneverssl.com%%2F' % (
        gw, CHILLI_UAM_PORT, voucher, VOUCHER_PASSWORD)

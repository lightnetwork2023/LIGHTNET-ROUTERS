'use strict';
'require view';
'require lightnet.ui4 as ln';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	fetchData: function() {
		return Promise.all([
			ln.get('/cgi-bin/lightnet-status'),
			ln.get('/cgi-bin/q20-topology', { nodes: [] }),
			ln.get('/cgi-bin/lightnet-pending', { nodes: [] })
		]);
	},

	load: function() { return this.fetchData(); },

	hero: function(s) {
		var key = ln.modeKey(s), m = ln.mode(s), title, sub, orb = '', icon = 'globe';
		if (key === 'router') {
			title = s.internet ? 'Your network is online' : (s.wan_link ? 'WAN connected, no internet yet' : 'No WAN cable detected');
			sub = s.internet ? 'Internet via WAN ' + (s.wan_ip || '') + ' · this AP manages the whole mesh.'
				: (s.wan_link ? 'WAN port is linked ' + (s.wan_ip ? '(' + s.wan_ip + ')' : 'but has no IP yet') + ' — checking upstream.'
					: 'The WAN port has no link. If your modem is plugged into another AP, use Bridge mode instead.');
			orb = s.internet ? '' : 'warn';
		} else if (key === 'bridge') {
			var bridged = s.internet || s.upstream_ip || s.gateway;
			title = bridged ? 'Bridged to your main router' : 'No upstream bridge detected';
			sub = bridged
				? 'DHCP, portal and internet come from the upstream router' + (s.gateway ? ' (' + s.gateway + ')' : '') + '. All APs are transparent.'
				: 'Connect your upstream router (MikroTik) to the main AP WAN port, or to any satellite LAN port. Do not plug upstream into a satellite WAN port — that is only for mesh backhaul.';
			orb = bridged ? 'violet' : 'warn'; icon = 'bridge';
		} else if (key === 'satellite') {
			title = s.adopted == 1 ? 'Satellite connected' : 'Waiting for approval';
			sub = s.adopted == 1 ? 'Broadcasting the network profile pushed by the main AP.' : 'Open the main AP and approve this satellite.';
			orb = s.adopted == 1 ? '' : 'warn'; icon = 'satellite';
		} else {
			title = 'Looking for a LightNet network…';
			sub = 'This takes up to a minute after power-on.';
			orb = 'warn idle'; icon = 'search';
		}
		return E('div', { 'class': 'ln-hero' }, [
			E('div', { 'class': 'ln-orb ' + orb }, [ ln.icon(icon) ]),
			E('div', { 'style': 'z-index:1' }, [
				E('h1', {}, [ ln.t(title) ]),
				E('p', {}, [ ln.t(sub) ]),
				E('div', { 'class': 'ln-chips' }, [
					ln.chip(m.label, m.tone, true),
					ln.chip(s.hostname || 'q20', ''),
					s.lan_ip ? ln.chip(s.lan_ip, '') : ''
				])
			]),
			E('div', { 'class': 'ln-hero-side' }, [
				E('a', { 'class': 'ln-btn ghost small', 'href': L.url('admin/lightnet/role') }, [ ln.icon(m.icon), ln.t('Change mode') ])
			])
		]);
	},

	build: function(data) {
		var s = data[0] || {}, topo = data[1] || { nodes: [] }, pend = data[2] || { nodes: [] };
		var key = ln.modeKey(s);
		var nodes = topo.nodes || [];
		var pending = (pend.nodes || []).filter(function(n) { return !n.adopted && !n.rejected; });
		var aps = nodes.filter(function(n) { return n.role === 'main' || n.adopted; });
		var online = aps.filter(function(n) { return n.online; }).length;
		var clients = aps.reduce(function(a, n) { return a + (n.clients || 0); }, 0);
		var sats = nodes.filter(function(n) { return n.role !== 'main'; });

		var internet;
		if (key === 'router')
			internet = ln.stat('globe', 'Internet', s.internet ? 'Online' : 'Offline',
				s.wan_ip || (s.wan_link ? 'WAN linked, waiting for IP' : 'No cable in WAN port'), s.internet ? 'good' : 'warn');
		else if (key === 'bridge')
			internet = ln.stat('bridge', 'Upstream', (s.internet || s.gateway) ? 'Online' : 'Offline',
				s.gateway ? 'via ' + s.gateway : (s.upstream_ip ? 'IP ' + s.upstream_ip : 'No upstream lease'), (s.internet || s.gateway) ? 'violet' : 'warn');
		else
			internet = ln.stat('bridge', 'Controller', s.internet ? 'Online' : 'Linked', s.gateway ? 'via ' + s.gateway : 'Main router', s.internet ? 'violet' : 'warn');

		var cloud = s.cloud || null, cloudStat = null;
		if (key === 'router' && cloud) {
			var hs = cloud.hotspot || {};
			var cs = cloud.status || 'unenrolled', tone = 'warn', val = 'Not linked', sub = cloud.url || '';
			if (!cloud.enabled) { val = 'Disabled'; sub = 'Cloud link turned off'; tone = ''; }
			else if (cs === 'provisioned') {
				val = 'Linked';
				sub = 'Site ' + (cloud.site_id || '?') + (cloud.site_name ? ' \u00b7 ' + cloud.site_name : '') + ' \u00b7 NAS ' + (cloud.wg_ip || '');
				tone = (cloud.wg_up && cloud.wg_handshake_age != null && cloud.wg_handshake_age < 180) ? 'good' : 'warn';
				if (tone === 'warn') sub += ' \u00b7 tunnel down';
				else if (hs.running) sub += ' \u00b7 hotspot ' + (hs.authorized || 0) + ' online';
				else sub += ' \u00b7 hotspot stopped';
			}
			else if (cs === 'pending') { val = 'Registered'; sub = 'Waiting for assignment on ' + (cloud.url || 'server').replace(/^https?:\/\//, '') + (cloud.router_id ? ' (router #' + cloud.router_id + ')' : ''); }
			else if (cs === 'rejected' || cs === 'blocked') { val = cs.charAt(0).toUpperCase() + cs.slice(1); sub = 'Contact LightNet support'; }
			else if (cloud.last_error) { sub = cloud.last_error; }
			else if (!s.internet) { sub = 'Needs Internet on WAN to register'; }
			else { sub = 'Registering with ' + (cloud.url || 'server').replace(/^https?:\/\//, '') + '\u2026'; }
			cloudStat = ln.stat('globe', 'LightNet server', val, sub, tone);
		}

		return E('div', { 'class': 'ln' }, [
			ln.errors([ s, topo, pend ]),
			this.hero(s),
			cloudStat ? E('div', { 'class': 'ln-stats' }, [ cloudStat ]) : E('span'),
			E('div', {}, pending.map(function(n) { return ln.pendingBanner(n); })),
			E('div', { 'class': 'ln-stats' }, [
				internet,
				ln.stat('wifi', 'Access points', online + ' / ' + aps.length, pending.length ? pending.length + ' waiting for approval' : 'All approved', online ? 'good' : 'warn'),
				ln.stat('mesh', 'Mesh', s.mesh_peers > 0 ? s.mesh_peers + ' link' + (s.mesh_peers > 1 ? 's' : '') : 'No links', sats.length ? ln.backhaul(sats[0].path) : 'Add a satellite', s.mesh_peers > 0 ? 'good' : ''),
				ln.stat('users', 'Clients', String(clients), 'on all access points', '')
			]),
			E('div', { 'class': 'ln-h' }, [
				E('h2', {}, [ ln.t('Access points') ]),
				E('a', { 'class': 'ln-btn ghost small', 'href': L.url('admin/lightnet/mesh') }, [ ln.t('Manage'), ln.icon('arrow') ])
			]),
			aps.length ? E('div', { 'class': 'ln-nodes' }, aps.map(function(n) { return ln.nodeCard(n); }))
				: ln.empty('satellite', 'No access points yet.')
		]);
	},

	render: function(data) { return ln.live(L.bind(this.fetchData, this), L.bind(this.build, this), data); }
});

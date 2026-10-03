'use strict';
'require view';
'require lightnet.ui4 as ln';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([ ln.get('/cgi-bin/lightnet-portal'), ln.get('/cgi-bin/lightnet-status') ]);
	},

	render: function(data) {
		var p = data[0] || {}, s = data[1] || {};
		var key = ln.modeKey(s);
		var head = E('div', { 'class': 'ln-h' }, [
			E('div', {}, [
				E('h2', { 'style': 'font-size:1.6rem' }, [ ln.t('Portal & Uplink') ]),
				E('div', { 'class': 'ln-muted' }, [ ln.t('Captive portal, payments and the secure link to the LightNet server.') ])
			])
		]);

		if (key === 'bridge' || key === 'satellite') {
			return E('div', { 'class': 'ln' }, [
				ln.errors([ p, s ]), head,
				E('div', { 'class': 'ln-hero' }, [
					E('div', { 'class': 'ln-orb violet' }, [ ln.icon(key === 'bridge' ? 'bridge' : 'satellite') ]),
					E('div', { 'style': 'z-index:1' }, [
						E('h1', {}, [ ln.t(key === 'bridge' ? 'Portal handled upstream' : 'Portal runs on the main AP') ]),
						E('p', {}, [ ln.t(key === 'bridge'
							? 'In bridge mode every AP passes clients straight to your MikroTik. Configure the hotspot, walled garden and payments there.'
							: 'Satellites never run a portal. Clients are bridged to the main AP, which enforces it.') ])
					]),
					E('div')
				]),
				key === 'bridge' ? E('div', { 'class': 'ln-card' }, [
					E('h2', { 'style': 'margin-top:0;font-size:1.05rem' }, [ ln.t('MikroTik checklist') ]),
					E('ul', { 'class': 'ln-list' }, [
						E('li', {}, [ ln.icon('check'), ln.t('Hotspot server on the bridge/interface connected to this AP\'s WAN port.') ]),
						E('li', {}, [ ln.icon('check'), ln.t('Add the AP addresses (DHCP leases named q20-xxxx) to IP bindings as "bypassed" so management keeps working.') ]),
						E('li', {}, [ ln.icon('check'), ln.t('Clients on every satellite appear directly in the MikroTik hotspot list.') ])
					])
				]) : ''
			]);
		}

		return E('div', { 'class': 'ln' }, [
			ln.errors([ p, s ]), head,
			E('div', { 'class': 'ln-stats', 'style': 'grid-template-columns:repeat(3,minmax(0,1fr))' }, [
				ln.stat('server', 'WireGuard', p.wireguard_up ? 'Connected' : 'Waiting', 'Activated from the LightNet server', p.wireguard_up ? 'good' : 'warn'),
				ln.stat('portal', 'Payment portal', p.portal_ready ? 'Ready' : 'Not configured', p.uam_server || 'Waiting for server profile', p.portal_ready ? 'good' : 'warn'),
				ln.stat('shield', 'RADIUS', p.radius_server ? 'Configured' : 'Not configured', p.nas_identifier ? 'NAS ' + p.nas_identifier : 'Pushed by the server', p.radius_server ? 'good' : '')
			]),
			E('div', { 'class': 'ln-card' }, [
				E('div', { 'class': 'ln-node-meta', 'style': 'grid-template-columns:repeat(3,minmax(0,1fr))' }, [
					ln.kv('WAN address', s.wan_ip || 'none'),
					ln.kv('LAN address', s.lan_ip || '—'),
					ln.kv('Internet', s.internet ? 'Online' : 'Offline')
				])
			]),
			ln.msg('Everything here is applied automatically when this AP is linked to the LightNet server portal. Satellites never run their own portal.', 'info')
		]);
	}
});

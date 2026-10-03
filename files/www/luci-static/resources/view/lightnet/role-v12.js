'use strict';
'require view';
'require lightnet.ui4 as ln';

var CARDS = [
	{
		key: 'router', role: 'root', icon: 'router', cls: '',
		title: 'Main Router',
		text: 'This AP is the gateway and controls the mesh.',
		points: [ 'Internet from the WAN port', 'DHCP, NAT and firewall', 'LightNet portal, RADIUS and WireGuard' ],
		diagram: [ 'Modem', 'This AP', 'Satellites' ],
		confirm: 'Switch to MAIN ROUTER?\n\nConnect the WAN port to your modem. This AP will hand out 192.168.2.x addresses and run the LightNet portal.'
	},
	{
		key: 'bridge', role: 'bridge', icon: 'bridge', cls: 'violet',
		title: 'Main AP · Bridge',
		text: 'Use with an existing router such as MikroTik.',
		points: [ 'Plug WAN into your MikroTik', 'Stays controller for all satellites', 'If MikroTik is on a satellite, use its LAN1 or LAN2 — never the satellite WAN' ],
		diagram: [ 'MikroTik', 'This AP', 'Satellites' ],
		confirm: 'Switch to BRIDGE mode?\n\n• Connect this AP\'s WAN port to your MikroTik / main router.\n• If the upstream router is on a satellite, plug it into the satellite\'s LAN1 or LAN2 port. The satellite WAN is only for mesh backhaul.\n• This AP stops routing: no DHCP, NAT or portal. Clients get addresses and the hotspot portal from the MikroTik.\n• This AP gets its own address from the MikroTik (look for its name in the DHCP leases).\n• Technician fallback: keep PC at 192.168.2.10 and open http://192.168.2.1.'
	},
	{
		key: 'satellite', role: 'agent', icon: 'satellite', cls: 'sat',
		title: 'Satellite',
		text: 'Extends the network from the main AP.',
		points: [ 'Joins by cable or wireless mesh', 'Cable: joins automatically', 'Wireless: approve it on the main AP' ],
		diagram: [ 'Main AP', 'Mesh', 'This AP' ],
		confirm: 'Switch to SATELLITE?\n\nThis AP will join the LightNet mesh. You will manage it from the main AP.'
	}
];

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	fetchData: function() { return ln.get('/cgi-bin/lightnet-status'); },

	load: function() { return this.fetchData(); },

	setRole: function(card) {
		var self = this;
		if (!window.confirm(card ? card.confirm : 'Run AUTO DETECT?\n\nThis AP looks for an existing LightNet main AP for up to 45 seconds and becomes a satellite if it finds one, otherwise the main router.'))
			return;
		var role = card ? card.role : 'auto';
		self.note = ln.msg('Applying… the network restarts and this page may disconnect for up to a minute.', 'info');
		self.refresh();
		ln.post('/cgi-bin/lightnet-role', { role: role }).then(function(res) {
			if (!res.ok) {
				self.note = ln.msg(res.error || 'Mode change failed.', 'error');
			} else if (role === 'bridge') {
				self.note = E('div', { 'class': 'ln-msg success' }, [
					E('b', {}, [ ln.t('Bridge mode is being applied.') ]),
					E('div', {}, [ ln.t('Connect the WAN port to your MikroTik. Then find this AP (' + (self.status.hostname || 'q20') + ') in the MikroTik DHCP leases and open its address. Technician fallback: set your PC to 192.168.2.10 and open http://192.168.2.1.') ])
				]);
			} else {
				self.note = ln.msg('Mode change accepted. The status updates automatically.', 'success');
			}
			self.refresh();
		});
	},

	refresh: function() {
		if (this.page && this.page.parentNode) {
			var next = this.build(this.status);
			this.page.parentNode.replaceChild(next, this.page);
			this.page = next;
		}
	},

	build: function(s) {
		var self = this, current = ln.modeKey(s);
		this.status = s = s || {};
		return E('div', { 'class': 'ln' }, [
			ln.errors([ s ]),
			E('div', { 'class': 'ln-h' }, [
				E('div', {}, [
					E('h2', { 'style': 'font-size:1.6rem' }, [ ln.t('Mode') ]),
					E('div', { 'class': 'ln-muted' }, [ ln.t('Every LightNet AP runs the same firmware. Choose what this one does.') ])
				]),
				E('button', { 'class': 'ln-btn ghost small', 'click': function() { self.setRole(null); } }, [ ln.icon('search'), ln.t('Auto detect') ])
			]),
			this.note || '',
			E('div', { 'class': 'ln-modes' }, CARDS.map(function(c) {
				var on = current === c.key;
				return E('div', { 'class': 'ln-card ln-mode' + (on ? ' current' : ''), 'click': function() { if (!on) self.setRole(c); } }, [
					on ? ln.chip('Current', 'good', true) : '',
					E('div', { 'class': 'ln-mode-ico ' + c.cls }, [ ln.icon(c.icon) ]),
					E('div', {}, [ E('h3', {}, [ ln.t(c.title) ]), E('p', {}, [ ln.t(c.text) ]) ]),
					E('ul', {}, c.points.map(function(p) { return E('li', {}, [ ln.icon('check'), ln.t(p) ]); })),
					E('div', { 'class': 'ln-diagram' }, [ E('b', {}, [ ln.t(c.diagram[0]) ]), ln.icon('arrow'), E('b', {}, [ ln.t(c.diagram[1]) ]), ln.icon('arrow'), E('b', {}, [ ln.t(c.diagram[2]) ]) ]),
					E('button', { 'class': 'ln-btn ' + (on ? 'ghost' : ''), 'disabled': on ? '' : null }, [ ln.t(on ? 'Active' : 'Use this mode') ])
				]);
			})),
			E('div', { 'class': 'ln-card' }, [
				E('div', { 'class': 'ln-node-meta', 'style': 'grid-template-columns:repeat(4,minmax(0,1fr))' }, [
					ln.kv('Device', s.hostname || '—'),
					ln.kv('Address', s.lan_ip || '—'),
					ln.kv('Detection', s.detection || '—'),
					ln.kv('Device ID', s.device_id || '—')
				])
			])
		]);
	},

	render: function(data) {
		var self = this;
		this.page = this.build(data);
		if (L.Poll)
			L.Poll.add(function() {
				return self.fetchData().then(function(d) { self.status = d; self.refresh(); });
			}, 5);
		return this.page;
	}
});

'use strict';
'require view';
'require lightnet.ui4 as ln';

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	fetchData: function() {
		return Promise.all([
			ln.get('/cgi-bin/q20-topology', { nodes: [] }),
			ln.get('/cgi-bin/lightnet-status')
		]);
	},

	load: function() { return this.fetchData(); },

	link: function(n) {
		if (!n.online) return { cls: 'off', text: 'Offline' };
		if (n.uplink_iface && n.uplink_iface !== 'mesh0') return { cls: 'wired', text: 'Cable' };
		if (n.path === 'wired' && !n.uplink_iface) return { cls: 'wired', text: 'Cable' };
		var sig = n.uplink_signal_dbm != null ? n.uplink_signal_dbm : n.mesh_signal_dbm;
		var rate = n.uplink_rate_mbit != null ? n.uplink_rate_mbit : n.mesh_rx_mbit;
		var parts = [ 'Mesh' ];
		if (sig != null && sig !== 0) parts.push(sig + ' dBm');
		if (rate != null) parts.push(Math.round(rate) + ' Mbps');
		var weak = sig != null && sig !== 0 && sig < -70;
		return { cls: weak ? 'weak' : 'mesh', text: parts.join(' · ') };
	},

	nodeBox: function(n, main) {
		var state = main ? ln.chip('Main', 'good', true)
			: !n.adopted ? ln.chip('Pending', 'warn', true)
			: n.online ? ln.chip('Online', 'good', true) : ln.chip('Offline', 'bad', true);
		var sub = (n.name ? n.hostname + ' · ' : '') + (n.ip || n.mac || '');
		return E('div', { 'class': 'ln-tnode' + (main ? ' main' : '') + (!n.online ? ' off' : '') + (!main && !n.adopted ? ' pending' : '') }, [
			E('div', { 'class': 'ln-tnode-head' }, [
				E('div', { 'class': 'ln-node-ico' + (main ? '' : n.online ? ' sat' : ' off') }, [ ln.icon(main ? 'router' : 'satellite') ]),
				E('div', { 'style': 'flex:1;min-width:0' }, [
					E('div', { 'class': 'ln-node-name' }, [ ln.t(n.name || n.hostname || n.mac) ]),
					E('div', { 'class': 'ln-node-sub ln-mono' }, [ ln.t(sub) ])
				]),
				state
			]),
			E('div', { 'class': 'ln-tnode-foot' }, [
				E('span', { 'class': 'ln-muted' }, [ ln.icon('users'), ln.t(' ' + (n.clients || 0) + ' client' + (n.clients == 1 ? '' : 's')) ]),
				E('div', { 'class': 'ln-tnode-actions' }, [
					n.mac ? ln.renameBtn(n.mac, n.name) : '',
					(main || n.adopted) ? ln.restartBtn(n) : '',
					(!main && n.adopted) ? ln.removeBtn(n) : ''
				])
			])
		]);
	},

	branch: function(n, t, main) {
		var self = this, kids = t.kids[n.mac] || [];
		var l = main ? null : this.link(n);
		return E('li', { 'class': 'ln-tli' }, [
			l ? E('div', { 'class': 'ln-tlink ' + l.cls }, [ ln.icon(l.cls === 'wired' ? 'cable' : 'wifi'), ln.t(l.text) ]) : '',
			this.nodeBox(n, main),
			kids.length ? E('ul', { 'class': 'ln-tul' }, kids.map(function(k) { return self.branch(k, t, false); })) : ''
		]);
	},

	build: function(data) {
		var topo = data[0] || { nodes: [] }, s = data[1] || {};
		var nodes = topo.nodes || [];
		var t = ln.tree(nodes);
		var key = ln.modeKey(s);
		var up = key === 'bridge'
			? { icon: 'bridge', title: 'Upstream router', sub: s.gateway ? 'via ' + s.gateway : 'MikroTik / main router' }
			: { icon: 'globe', title: 'Internet', sub: s.internet ? 'WAN ' + (s.wan_ip || '') : 'Not connected' };
		var online = nodes.filter(function(n) { return n.online && (n.role === 'main' || n.adopted); }).length;
		var hops = 0;
		nodes.forEach(function(n) {
			var d = 0, p = n._parent;
			while (p) { d++; p = p._parent; }
			if (d > hops) hops = d;
		});

		return E('div', { 'class': 'ln' }, [
			ln.errors([ topo, s ]),
			E('div', { 'class': 'ln-h' }, [
				E('div', {}, [
					E('h2', { 'style': 'font-size:1.6rem' }, [ ln.t('Topology') ]),
					E('div', { 'class': 'ln-muted' }, [ ln.t('How every access point reaches the main router. Satellites can connect through each other.') ])
				]),
				E('div', { 'class': 'ln-chips' }, [
					ln.chip(online + ' online', 'good'),
					ln.chip(hops + (hops === 1 ? ' hop' : ' hops'), '')
				])
			]),
			!t ? ln.empty('tree', 'No main router found yet.') : E('div', { 'class': 'ln-card ln-tree' }, [
				E('div', { 'class': 'ln-tup ' + (s.internet || key === 'bridge' ? '' : 'off') }, [
					E('div', { 'class': 'ln-stat-ico' }, [ ln.icon(up.icon) ]),
					E('div', {}, [ E('b', {}, [ ln.t(up.title) ]), E('div', { 'class': 'ln-muted' }, [ ln.t(up.sub) ]) ])
				]),
				E('ul', { 'class': 'ln-tul top' }, [ this.branch(t.root, t, true) ])
			]),
			E('div', { 'class': 'ln-tlegend ln-muted' }, [
				E('span', { 'class': 'ln-tlink wired' }, [ ln.t('Cable') ]),
				E('span', { 'class': 'ln-tlink mesh' }, [ ln.t('Good mesh') ]),
				E('span', { 'class': 'ln-tlink weak' }, [ ln.t('Weak mesh (below -70 dBm)') ]),
				E('span', { 'class': 'ln-tlink off' }, [ ln.t('Offline') ])
			])
		]);
	},

	render: function(data) { return ln.live(L.bind(this.fetchData, this), L.bind(this.build, this), data); }
});

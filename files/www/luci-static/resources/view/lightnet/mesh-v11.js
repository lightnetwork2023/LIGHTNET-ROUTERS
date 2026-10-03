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
			ln.get('/cgi-bin/lightnet-pending', { nodes: [] })
		]);
	},

	load: function() { return this.fetchData(); },

	pendingCard: function(n) {
		var p = ln.pendingInfo(n);
		return E('div', { 'class': 'ln-card ln-node pending' }, [
			E('div', { 'class': 'ln-node-head' }, [
				E('div', { 'class': 'ln-node-ico sat' }, [ ln.icon('plus') ]),
				E('div', { 'style': 'flex:1;min-width:0' }, [
					E('div', { 'class': 'ln-node-name' }, [ ln.t(p.name) ]),
					E('div', { 'class': 'ln-node-sub ln-mono' }, [ ln.t((p.alias && p.host ? p.host + ' · ' : '') + p.mac) ])
				]),
				ln.chip('New', 'warn', true)
			]),
			E('div', { 'class': 'ln-node-meta' }, [
				ln.kv('Backhaul', ln.backhaul(p.backhaul)),
				ln.kv('Signal', ln.bars(p.signal)),
				ln.kv('IP address', p.ip),
				ln.kv('Model', (n.inform || {}).model || 'Q20')
			]),
			E('div', { 'class': 'ln-node-actions' }, [
				E('button', { 'class': 'ln-btn small', 'click': function(ev) { ln.decide(p.mac, 'approve', ev.currentTarget); } }, [ ln.icon('check'), ln.t('Approve') ]),
				E('button', { 'class': 'ln-btn small ghost', 'click': function(ev) { ln.decide(p.mac, 'reject', ev.currentTarget); } }, [ ln.t('Reject') ]),
				ln.renameBtn(p.mac, p.alias)
			])
		]);
	},

	build: function(data) {
		var self = this, topo = data[0] || { nodes: [] }, pend = data[1] || { nodes: [] };
		var list = pend.nodes || [];
		var pending = list.filter(function(n) { return !n.adopted && !n.rejected; });
		var skipped = list.filter(function(n) { return n.rejected; });
		var aps = (topo.nodes || []).filter(function(n) { return n.role === 'main' || n.adopted; });

		return E('div', { 'class': 'ln' }, [
			ln.errors([ topo, pend ]),
			E('div', { 'class': 'ln-h' }, [
				E('div', {}, [
					E('h2', { 'style': 'font-size:1.6rem' }, [ ln.t('Devices') ]),
					E('div', { 'class': 'ln-muted' }, [ ln.t('Cable-connected APs join automatically. Wireless APs wait for your approval.') ])
				]),
				E('a', { 'class': 'ln-btn ghost small', 'href': L.url('admin/lightnet/topology') }, [ ln.icon('tree'), ln.t('Topology') ])
			]),
			E('div', { 'class': 'ln-h' }, [ E('h2', {}, [ ln.t('Waiting for approval') ]), ln.chip(String(pending.length), pending.length ? 'warn' : '') ]),
			pending.length ? E('div', { 'class': 'ln-nodes' }, pending.map(function(n) { return self.pendingCard(n); }))
				: ln.empty('search', 'No new access points. Power on a LightNet AP near this one and it appears here in about a minute.'),
			E('div', { 'class': 'ln-h' }, [ E('h2', {}, [ ln.t('Access points') ]), ln.chip(String(aps.length), 'good') ]),
			E('div', { 'class': 'ln-nodes' }, aps.map(function(n) { return ln.nodeCard(n, { rename: true }); })),
			skipped.length ? E('div', { 'class': 'ln-h' }, [ E('h2', {}, [ ln.t('Rejected until restart') ]), ln.chip(String(skipped.length), 'bad') ]) : '',
			skipped.length ? E('div', { 'class': 'ln-nodes' }, skipped.map(function(n) {
				var p = ln.pendingInfo(n);
				return ln.nodeCard({ hostname: p.name, mac: p.mac, ip: p.ip, path: p.backhaul, rejected: 1, mesh_signal_dbm: p.signal });
			})) : ''
		]);
	},

	render: function(data) { return ln.live(L.bind(this.fetchData, this), L.bind(this.build, this), data); }
});

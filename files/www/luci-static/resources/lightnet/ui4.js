'use strict';
'require baseclass';

var svg = function(body) {
	return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
};

var ICONS = {
	globe: svg('<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15 15 0 0 1 0 20a15 15 0 0 1 0-20"/>'),
	router: svg('<rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 17h.01M10 17h.01"/><path d="M15 13V8"/><path d="M11.5 6.5a5 5 0 0 1 7 0"/><path d="M9 4a8.5 8.5 0 0 1 12 0"/>'),
	bridge: svg('<path d="M4 18V9"/><path d="M20 18V9"/><path d="M2 18h20"/><path d="M4 9c3 0 5-3 8-3s5 3 8 3"/><path d="M8 18v-5M12 18v-6M16 18v-5"/>'),
	satellite: svg('<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>'),
	wifi: svg('<path d="M5 12.55a11 11 0 0 1 14 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><circle cx="12" cy="20" r="1"/>'),
	mesh: svg('<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18" r="2.5"/><circle cx="19" cy="18" r="2.5"/><path d="M10.8 7.2 6.2 15.8M13.2 7.2l4.6 8.6M7.5 18h9"/>'),
	users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>'),
	shield: svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>'),
	lock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>'),
	unlock: svg('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'),
	portal: svg('<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 9h18"/><path d="M8 21h8M12 18v3"/>'),
	cable: svg('<path d="M4 9V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4"/><path d="M6.5 9v6a5.5 5.5 0 0 0 11 0V9"/><path d="M15 9V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v4"/>'),
	plus: svg('<circle cx="12" cy="12" r="10"/><path d="M12 8v8M8 12h8"/>'),
	check: svg('<path d="M20 6 9 17l-5-5"/>'),
	x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
	search: svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>'),
	alert: svg('<path d="m10.29 3.86-8.47 14.14A2 2 0 0 0 3.53 21h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><path d="M12 9v4M12 17h.01"/>'),
	map: svg('<path d="M9 18l-6 3V6l6-3 6 3 6-3v15l-6 3-6-3z"/><path d="M9 3v15M15 6v15"/>'),
	arrow: svg('<path d="M5 12h14M13 5l7 7-7 7"/>'),
	server: svg('<rect x="2" y="3" width="20" height="8" rx="2"/><rect x="2" y="13" width="20" height="8" rx="2"/><path d="M6 7h.01M6 17h.01"/>'),
	power: svg('<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>'),
	tree: svg('<rect x="9" y="2" width="6" height="5" rx="1"/><rect x="2" y="17" width="6" height="5" rx="1"/><rect x="16" y="17" width="6" height="5" rx="1"/><path d="M12 7v5M5 17v-5h14v5"/>')
};

var MODES = {
	router: { label: 'Main Router', tone: 'cyan', icon: 'router' },
	bridge: { label: 'Main AP · Bridge', tone: 'violet', icon: 'bridge' },
	satellite: { label: 'Satellite', tone: 'cyan', icon: 'satellite' },
	detect: { label: 'Detecting', tone: 'warn', icon: 'search' }
};

return baseclass.extend({
	t: function(s) { return document.createTextNode(s == null ? '' : String(s)); },

	icon: function(name) { return E('span', { 'class': 'ln-ico' }, ICONS[name] || ''); },

	headers: function(extra) {
		return Object.assign({ 'Authorization': 'Bearer ' + (L.env.sessionid || '') }, extra || {});
	},

	get: function(url, empty) {
		var fail = function(msg) { return Object.assign({}, empty || {}, { ok: false, error: msg }); };
		return fetch(url, { cache: 'no-store', credentials: 'same-origin', headers: this.headers() }).then(function(r) {
			if (!r.ok) return fail('Request failed (HTTP ' + r.status + ')');
			return r.json().catch(function() { return fail('Invalid response. Please log in again.'); });
		}).catch(function() { return fail('Router is not reachable. Check the connection.'); });
	},

	post: function(url, body) {
		return fetch(url, {
			method: 'POST', credentials: 'same-origin',
			headers: this.headers({ 'Content-Type': 'application/json' }),
			body: JSON.stringify(body)
		}).then(function(r) { return r.json(); }).catch(function() { return { ok: false, error: 'Router did not answer.' }; });
	},

	live: function(fetchFn, buildFn, first) {
		var page = buildFn(first);
		if (L.Poll)
			L.Poll.add(function() {
				return fetchFn().then(function(d) {
					var next = buildFn(d);
					if (page.parentNode) page.parentNode.replaceChild(next, page);
					page = next;
				});
			}, 5);
		return page;
	},

	modeKey: function(s) {
		s = s || {};
		if (s.active_role === 'agent') return 'satellite';
		if (s.active_role === 'root') return s.network_mode === 'bridge' ? 'bridge' : 'router';
		return 'detect';
	},

	mode: function(s) { return MODES[this.modeKey(s)]; },

	chip: function(label, tone, dot) {
		return E('span', { 'class': 'ln-chip ' + (tone || '') }, [ dot ? E('span', { 'class': 'ln-dot' }) : '', this.t(label) ]);
	},

	msg: function(text, tone) { return E('div', { 'class': 'ln-msg ' + (tone || '') }, [ this.t(text) ]); },

	errors: function(list) {
		var errs = list.filter(function(d) { return d && d.ok === false; }).map(function(d) { return d.error; });
		errs = errs.filter(function(e, i) { return errs.indexOf(e) === i; });
		return errs.length ? this.msg(errs.join(' · '), 'error') : '';
	},

	stat: function(icon, label, value, sub, tone) {
		return E('div', { 'class': 'ln-card ln-stat ' + (tone || '') }, [
			E('div', { 'class': 'ln-stat-ico' }, [ this.icon(icon) ]),
			E('div', {}, [
				E('div', { 'class': 'ln-stat-label' }, [ this.t(label) ]),
				E('div', { 'class': 'ln-stat-value' }, [ this.t(value) ]),
				E('div', { 'class': 'ln-stat-sub' }, [ this.t(sub || '') ])
			])
		]);
	},

	bars: function(dbm) {
		if (dbm == null) return this.t('—');
		var n = dbm >= -55 ? 4 : dbm >= -65 ? 3 : dbm >= -75 ? 2 : 1;
		var el = E('span', { 'class': 'ln-bars ' + (n >= 3 ? '' : n === 2 ? 'mid' : 'low') });
		for (var i = 1; i <= 4; i++) el.appendChild(E('i', { 'class': i <= n ? 'on' : '' }));
		return E('span', {}, [ el, this.t(' ' + dbm + ' dBm') ]);
	},

	backhaul: function(path) {
		return { 'wired': 'Cable', 'wired+wireless': 'Cable + Mesh', 'wireless': 'Wireless mesh', 'local': 'Main', 'offline': 'Offline' }[path] || (path || 'Unknown');
	},

	kv: function(label, value) {
		return E('div', { 'class': 'ln-kv' }, [ E('span', {}, [ this.t(label) ]), E('b', {}, [ typeof value === 'object' ? value : this.t(value) ]) ]);
	},

	decide: function(mac, action, btn) {
		var reject = action === 'reject';
		if (reject && !window.confirm('Reject ' + mac + '?\n\nIt will leave the mesh and stay hidden until the satellite is restarted.'))
			return Promise.resolve();
		if (btn) { btn.disabled = true; btn.textContent = reject ? 'Rejecting…' : 'Approving…'; }
		return this.post('/cgi-bin/lightnet-adopt', reject ? { mac: mac, action: 'reject' } : { mac: mac }).then(function(res) {
			if (!btn) return;
			if (res.ok) btn.textContent = reject ? 'Rejected' : 'Approved';
			else { btn.disabled = false; btn.textContent = res.error || 'Failed'; }
		});
	},

	rename: function(mac, current, btn) {
		var name = window.prompt('Name this access point (e.g. Reception, Room 12).\nLeave empty to use the device name.', current || '');
		if (name === null) return Promise.resolve();
		if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
		return this.post('/cgi-bin/lightnet-adopt', { mac: mac, action: 'rename', name: name }).then(function(res) {
			if (!btn) return;
			btn.disabled = false;
			btn.textContent = res.ok ? 'Saved' : (res.error || 'Failed');
		});
	},

	renameBtn: function(mac, current) {
		var self = this;
		return E('button', { 'class': 'ln-btn small ghost', 'click': function(ev) { self.rename(mac, current, ev.currentTarget); } }, [ this.t('Rename') ]);
	},

	restart: function(n, btn) {
		var main = n.role === 'main', label = n.name || n.hostname || n.mac;
		var text = main
			? 'Restart the MAIN router ' + label + '?\n\nThe whole network, including all satellites, loses internet for about 2 minutes.'
			: 'Restart ' + label + '?\n\nClients on this access point move to another one or reconnect in about 2 minutes.';
		if (!window.confirm(text)) return Promise.resolve();
		if (btn) { btn.disabled = true; btn.textContent = 'Restarting…'; }
		return this.post('/cgi-bin/lightnet-action', main ? { action: 'restart' } : { action: 'restart', mac: n.mac }).then(function(res) {
			if (!btn) return;
			if (res.ok) btn.textContent = main ? 'Restarting — reload in 2 min' : 'Restart sent';
			else { btn.disabled = false; btn.textContent = res.error || 'Failed'; }
		});
	},

	remove: function(n, btn) {
		var label = n.name || n.hostname || n.mac;
		if (!window.confirm('Remove ' + label + ' from the network?\n\n• It is forgotten on this main router (name too).\n• It is reset to factory settings and restarts.\n• It then asks to join again: with a cable it joins automatically, over wireless it waits for Approve.\n\nIf it is offline now, it is reset as soon as it comes back.'))
			return Promise.resolve();
		if (btn) { btn.disabled = true; btn.textContent = 'Removing…'; }
		return this.post('/cgi-bin/lightnet-adopt', { mac: n.mac, action: 'remove' }).then(function(res) {
			if (!btn) return;
			if (res.ok) btn.textContent = 'Removed — resetting';
			else { btn.disabled = false; btn.textContent = res.error || 'Failed'; }
		});
	},

	removeBtn: function(n) {
		var self = this;
		return E('button', { 'class': 'ln-btn small danger', 'click': function(ev) { self.remove(n, ev.currentTarget); } }, [ this.icon('x'), this.t('Remove') ]);
	},

	restartBtn: function(n) {
		var self = this;
		return E('button', { 'class': 'ln-btn small danger', 'click': function(ev) { self.restart(n, ev.currentTarget); } }, [ this.icon('power'), this.t('Restart') ]);
	},

	hwmac: function(mac, off) {
		var p = String(mac || '').toLowerCase().split(':');
		if (p.length !== 6) return '';
		var last = ((parseInt(p[5], 16) + off) & 255).toString(16);
		return '02:' + p.slice(1, 5).join(':') + ':' + (last.length < 2 ? '0' + last : last);
	},

	tree: function(nodes) {
		var self = this, byHw = {}, kids = {}, root = null;
		nodes.forEach(function(n) {
			if (n.role === 'main') root = n;
			[ 4, 5, 6 ].forEach(function(o) { byHw[self.hwmac(n.mac, o)] = n; });
			kids[n.mac] = [];
		});
		if (!root) return null;
		nodes.forEach(function(n) {
			if (n === root) return;
			var p = n.uplink_mac && byHw[n.uplink_mac];
			if (!p || p === n || !n.online) p = root;
			n._parent = p;
		});
		nodes.forEach(function(n) {
			if (n === root) return;
			var seen = {}, p = n._parent;
			while (p && p !== root && !seen[p.mac]) { seen[p.mac] = 1; p = p._parent; }
			if (p !== root) n._parent = root;
			kids[n._parent.mac].push(n);
		});
		return { root: root, kids: kids };
	},

	pendingInfo: function(n) {
		var i = n.inform || {};
		return { name: n.name || i.hostname || n.device_id, alias: n.name || '', host: i.hostname || '', mac: n.device_id, ip: i.ip || '—', backhaul: n.backhaul || i.backhaul, signal: i.mesh_signal_dbm };
	},

	pendingBanner: function(n) {
		var self = this, p = this.pendingInfo(n);
		return E('div', { 'class': 'ln-pending' }, [
			E('div', { 'class': 'ln-stat-ico' }, [ this.icon('plus') ]),
			E('div', { 'class': 'ln-pending-body' }, [
				E('b', {}, [ this.t(p.name + ' wants to join your network') ]),
				E('div', { 'class': 'ln-muted' }, [ this.t(this.backhaul(p.backhaul) + ' · ' + p.mac + (p.signal != null ? ' · ' + p.signal + ' dBm' : '')) ])
			]),
			E('div', { 'class': 'ln-pending-actions' }, [
				E('button', { 'class': 'ln-btn small', 'click': function(ev) { self.decide(p.mac, 'approve', ev.currentTarget); } }, [ this.icon('check'), this.t('Approve') ]),
				E('button', { 'class': 'ln-btn small ghost', 'click': function(ev) { self.decide(p.mac, 'reject', ev.currentTarget); } }, [ this.t('Reject') ])
			])
		]);
	},

	nodeCard: function(n, opts) {
		var main = n.role === 'main';
		var sub = (n.name && n.hostname ? n.hostname + ' · ' : '') + (n.ip || n.mac || '');
		var state = main ? this.chip('Main', 'good', true)
			: n.rejected ? this.chip('Skipped', 'bad', true)
			: !n.adopted ? this.chip('Pending', 'warn', true)
			: n.online ? this.chip('Online', 'good', true) : this.chip('Offline', 'bad', true);
		return E('div', { 'class': 'ln-card ln-node' + (n.rejected ? ' skipped' : (!main && !n.adopted ? ' pending' : '')) }, [
			E('div', { 'class': 'ln-node-head' }, [
				E('div', { 'class': 'ln-node-ico' + (main ? '' : n.online ? ' sat' : ' off') }, [ this.icon(main ? 'router' : 'satellite') ]),
				E('div', { 'style': 'flex:1;min-width:0' }, [
					E('div', { 'class': 'ln-node-name' }, [ this.t(n.name || n.hostname || n.mac) ]),
					E('div', { 'class': 'ln-node-sub ln-mono' }, [ this.t(sub) ])
				]),
				state
			]),
			E('div', { 'class': 'ln-node-meta' }, [
				this.kv('Backhaul', this.backhaul(n.path)),
				this.kv('Clients', n.clients != null ? n.clients : '—'),
				this.kv('Signal', main ? '—' : this.bars(n.mesh_signal_dbm)),
				this.kv('Link rate', n.mesh_rx_mbit != null ? Math.round(n.mesh_rx_mbit) + ' Mbps' : '—')
			]),
			opts && opts.rename && !n.rejected && n.mac
				? E('div', { 'class': 'ln-node-actions' }, [
					this.renameBtn(n.mac, n.name),
					(main || n.adopted) ? this.restartBtn(n) : '',
					(!main && n.adopted) ? this.removeBtn(n) : ''
				]) : ''
		]);
	},

	empty: function(icon, text) {
		return E('div', { 'class': 'ln-card ln-empty' }, [ this.icon(icon), E('div', {}, [ this.t(text) ]) ]);
	}
});

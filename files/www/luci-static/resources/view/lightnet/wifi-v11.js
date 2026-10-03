'use strict';
'require view';
'require lightnet.ui4 as ln';

var MODES = [
	[ 'open', 'Open', 'unlock' ],
	[ 'psk2', 'WPA2', 'lock' ],
	[ 'psk3', 'WPA3', 'shield' ],
	[ 'portal', 'Portal', 'portal' ]
];

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load: function() {
		return Promise.all([ ln.get('/cgi-bin/lightnet-wifi'), ln.get('/cgi-bin/lightnet-status') ]);
	},

	render: function(data) {
		var d = data[0] || {}, s = data[1] || {};
		var mode = d.mode || 'open';
		var bridge = ln.modeKey(s) === 'bridge';
		var ssid = E('input', { 'class': 'ln-input', 'value': d.ssid || 'LIGHTNET', 'maxlength': 32 });
		var key = E('input', { 'class': 'ln-input', 'type': 'password', 'value': d.key || '', 'placeholder': 'At least 8 characters' });
		var keyField = E('div', { 'class': 'ln-field' }, [ E('label', {}, [ ln.t('Password') ]), key ]);
		var note = E('div', { 'class': 'ln-msg info' });
		var status = E('div');
		var seg = E('div', { 'class': 'ln-seg' });

		var setMode = function(m) {
			mode = m;
			Array.prototype.forEach.call(seg.children, function(b) { b.className = b.dataset.mode === m ? 'on' : ''; });
			keyField.style.display = (m === 'psk2' || m === 'psk3') ? '' : 'none';
			note.textContent = {
				open: 'Anyone can join. Use this when the upstream router (e.g. MikroTik Hotspot) or LightNet portal controls access.',
				psk2: 'Password protected. Works with all phones and laptops.',
				psk3: 'Strongest security. Some older devices cannot join WPA3.',
				portal: bridge ? 'In bridge mode the portal is provided by your upstream router, so the network is open at the AP.'
					: 'Clients see the LightNet payment portal. The SSID stays off until the server portal profile is active.'
			}[m];
		};

		MODES.forEach(function(m) {
			seg.appendChild(E('button', { 'type': 'button', 'data-mode': m[0], 'click': function() { setMode(m[0]); } }, [ ln.icon(m[2]), ln.t(m[1]) ]));
		});
		setMode(mode);

		var save = function(ev) {
			var btn = ev.currentTarget;
			if ((mode === 'psk2' || mode === 'psk3') && key.value.length < 8) {
				status.replaceChildren(ln.msg('Password must be at least 8 characters.', 'error'));
				return;
			}
			if (!ssid.value.trim()) {
				status.replaceChildren(ln.msg('Network name cannot be empty.', 'error'));
				return;
			}
			btn.disabled = true;
			ln.post('/cgi-bin/lightnet-wifi', { ssid: ssid.value.trim(), mode: mode, key: key.value }).then(function(res) {
				btn.disabled = false;
				status.replaceChildren(res.ok
					? ln.msg('Saved. All access points switch to the new settings within 30 seconds (version ' + res.config_version + ').', 'success')
					: ln.msg('Save failed: ' + (res.error || 'unknown error'), 'error'));
			});
		};

		return E('div', { 'class': 'ln' }, [
			ln.errors([ d, s ]),
			E('div', { 'class': 'ln-h' }, [
				E('div', {}, [
					E('h2', { 'style': 'font-size:1.6rem' }, [ ln.t('Wi-Fi') ]),
					E('div', { 'class': 'ln-muted' }, [ ln.t('One network name for every access point. Clients roam automatically.') ])
				])
			]),
			E('div', { 'class': 'ln-split' }, [
				E('div', { 'class': 'ln-card' }, [
					E('div', { 'class': 'ln-form' }, [
						E('div', { 'class': 'ln-field' }, [ E('label', {}, [ ln.t('Network name') ]), ssid ]),
						E('div', { 'class': 'ln-field' }, [ E('label', {}, [ ln.t('Security') ]), seg ]),
						keyField,
						note,
						status,
						E('div', {}, [ E('button', { 'class': 'ln-btn', 'click': save }, [ ln.icon('check'), ln.t('Save for all access points') ]) ])
					])
				]),
				E('div', { 'class': 'ln-card' }, [
					E('h2', { 'style': 'margin-top:0;font-size:1.05rem' }, [ ln.t('How it works') ]),
					E('ul', { 'class': 'ln-list' }, [
						E('li', {}, [ ln.icon('wifi'), ln.t('2.4 GHz and 5 GHz use the same name; devices pick the best band.') ]),
						E('li', {}, [ ln.icon('satellite'), ln.t('Approved satellites copy these settings automatically.') ]),
						E('li', {}, [ ln.icon('shield'), ln.t('The mesh between APs is always encrypted (WPA3), whatever you choose here.') ])
					])
				])
			])
		]);
	}
});

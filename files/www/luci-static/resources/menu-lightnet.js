'use strict';
'require baseclass';
'require ui';

return baseclass.extend({
	simpleSections: [ 'lightnet', 'status' ],

	mode: function() {
		try {
			return localStorage.getItem('lightnet.ui.mode') || 'simple';
		} catch (e) {
			return 'simple';
		}
	},

	setMode: function(mode) {
		try {
			localStorage.setItem('lightnet.ui.mode', mode);
		} catch (e) {}

		if (mode === 'advanced')
			location.href = L.url('admin/status/overview');
		else
			location.href = L.url('admin/lightnet/dashboard');
	},

	setupModeToggle: function() {
		var btn = document.getElementById('lightnet-mode-toggle');
		if (!btn)
			return;

		var mode = this.mode();
		btn.textContent = mode === 'simple' ? 'Advanced' : 'Simple';
		btn.title = mode === 'simple' ? 'Switch to full OpenWrt configuration' : 'Switch to LightNet simple mode';
		btn.addEventListener('click', L.bind(function() {
			this.setMode(mode === 'simple' ? 'advanced' : 'simple');
		}, this));
	},

	enforceSimpleLanding: function() {
		var path = L.env.dispatchpath || [];
		if (this.mode() !== 'simple' || path[0] !== 'admin')
			return;

		if (this.simpleSections.indexOf(path[1]) !== -1)
			return;

		location.replace(L.url('admin/lightnet/dashboard'));
	},

	__init__: function() {
		this.setupModeToggle();
		this.enforceSimpleLanding();
		ui.menu.load().then(L.bind(this.render, this));
	},

	render: function(tree) {
		var node = tree, url = '';

		this.renderModeMenu(tree);

		if (L.env.dispatchpath.length >= 3) {
			for (var i = 0; i < 3 && node; i++) {
				node = node.children[L.env.dispatchpath[i]];
				url = url + (url ? '/' : '') + L.env.dispatchpath[i];
			}

			if (node)
				this.renderTabMenu(node, url);
		}
	},

	renderTabMenu: function(tree, url, level) {
		var container = document.querySelector('#tabmenu'),
		    ul = E('ul', { 'class': 'tabs' }),
		    children = ui.menu.getChildren(tree),
		    activeNode = null;

		for (var i = 0; i < children.length; i++) {
			var isActive = L.env.dispatchpath[3 + (level || 0)] == children[i].name;
			ul.appendChild(E('li', { 'class': 'tabmenu-item-%s %s'.format(children[i].name, isActive ? 'active' : '') }, [
				E('a', { 'href': L.url(url, children[i].name) }, [ _(children[i].title) ])
			]));
			if (isActive)
				activeNode = children[i];
		}

		if (!ul.children.length)
			return E([]);

		container.appendChild(ul);
		container.style.display = '';

		if (activeNode)
			this.renderTabMenu(activeNode, url + '/' + activeNode.name, (level || 0) + 1);

		return ul;
	},

	filterChildren: function(children, level) {
		if (this.mode() !== 'simple' || level !== 0)
			return children;

		return children.filter(L.bind(function(child) {
			return this.simpleSections.indexOf(child.name) !== -1;
		}, this));
	},

	renderMainMenu: function(tree, url, level) {
		var ul = level ? E('ul', { 'class': 'dropdown-menu' }) : document.querySelector('#topmenu'),
		    children = this.filterChildren(ui.menu.getChildren(tree), level || 0);

		if (!children.length || level > 1)
			return E([]);

		for (var i = 0; i < children.length; i++) {
			var submenu = this.renderMainMenu(children[i], url + '/' + children[i].name, (level || 0) + 1),
			    hasChildren = !!submenu.firstElementChild;

			ul.appendChild(E('li', { 'class': (!level && hasChildren) ? 'dropdown' : null }, [
				E('a', {
					'class': (!level && hasChildren) ? 'menu' : null,
					'href': hasChildren ? '#' : L.url(url, children[i].name)
				}, [ _(children[i].title) ]),
				submenu
			]));
		}

		ul.style.display = '';
		return ul;
	},

	renderModeMenu: function(tree) {
		var ul = document.querySelector('#modemenu'),
		    children = ui.menu.getChildren(tree);

		for (var i = 0; i < children.length; i++) {
			var isActive = L.env.requestpath.length ? children[i].name == L.env.requestpath[0] : i == 0;

			ul.appendChild(E('li', { 'class': isActive ? 'active' : null }, [
				E('a', { 'href': L.url(children[i].name) }, [ _(children[i].title) ])
			]));

			if (isActive)
				this.renderMainMenu(children[i], children[i].name);
		}

		if (ul.children.length > 1)
			ul.style.display = '';
	}
});

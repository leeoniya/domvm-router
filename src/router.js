function createRouter(opts) {
	var stack = [],
		pos = null,		// these should go into sessionStorage

		routes = opts.routes || [],

		willEnter = opts.willEnter,
		willExit = opts.willExit,
		didEnter = opts.didEnter,
		didExit = opts.didExit,
		notFound = opts.notFound,

		prefix = opts.prefix || "#/",				// "#", "#/", "/some/hist/root",			// "/#" ?
		useHash = prefix[0] == "#";

	// tmp flag that indicates that hash or location changed as result of a set() call rather than natively.
	// prevents cyclic set->hashchange->set...
	var gotoLocChg = false;

	var A = document.createElement("a");
	var LOC_VARS = "href protocol username password origin hostname host port pathname search hash".split(" ");

	// adapted from http://stackoverflow.com/a/13405933
	function parseUrl(url) {
		A.href = url;

		// IE fix
		if (A.host == "")
			A.href = A.href;

		var l = {};

		LOC_VARS.forEach(function(v) {
			l[v] = A[v];
		});

		return l;
	}

	// parses query string to object
	// todo?: arrays[]
	function parseQuery(qstr) {
		var query = {};
		var a = qstr.substr(1).split('&');
		for (var i = 0; i < a.length; i++) {
			var b = a[i].split('=');
			query[decodeURIComponent(b[0])] = decodeURIComponent(b[1] || '');
		}
		return query;
	}

	function buildQuery(query) {
		var esc = encodeURIComponent;

		var qstr = Object.keys(query)
			.map(function(k) { return esc(k) + '=' + esc(query[k]); })
			.join('&');

		return qstr.length ? '?' + qstr : '';
	}

	// normalized non-matched route
	function locFromUrl(url) {
		var loc = parseUrl(url);

		if (useHash) {
			var href = loc.hash;
			// re-parse from hash as if root
			var loc = parseUrl(loc.protocol + '//' + loc.hostname + "/" + loc.hash.substr(prefix.length));
		}

		return {
			// rel, prefixed, suitable for <a href="">
			href: useHash ? (href || prefix) : loc.pathname + loc.search + loc.hash,
			// un-prefixed, suitable for matching against regex route list
			path: useHash ? loc.pathname.substr(1) : loc.pathname.substr(prefix.length),
			// suitable for concat
		//	search: loc.search,
			query: loc.search != "" ? parseQuery(loc.search) : null,
			hash: loc.hash,
		};
	}

	// matcher - finds route from a loc object, augmenting it with route & parsed segs
	// else returns null
	// @loc must be output from locFromUrl() parser
	function matchLoc(loc) {
		if (loc.route != null)
			return loc;

		// iterate routes, match path (and query?), extract segs
		var match, route, segs;

		for (var i = 0; i < routes.length; i++) {
			var route = routes[i],
				path = route.path;

			if (match = loc.path.match(route.regexPath)) {
				loc.route = route;

				if (path.indexOf(":") !== -1) {
					segs = {};
					match.shift();
					path.replace(/:([^\/]+)/g, function(m, segName) {
						segs[segName] = match.shift();
					});
				}

				loc.segs = segs;

				break;
			}
		}

		return loc;
	}

	function currentLoc() {
		return matchLoc(locFromUrl(location.href));
	}

	function add(route, pos) {
		routes.splice(pos, 0, route);
		buildRegexPath(route);
		return api;
	}

	// gets a route by name, or
	// can simply pull out of stack
	function get(name) {
		if (name == null)
			return currentLoc();			// returns current loc w/ matched route

		for (var i = 0; i < routes.length; i++)
			if (routes[i].name == name)
				return routes[i];
	}

	// should loc be pre-matched?
	// should unknown routes still be set/handled?
	function set(loc, repl, noFns) {
		matchLoc(loc);

		// is "_noMatch" a route? not really since there are multiple views, nomatch needs to accept original intended route
		if (loc.route == null) {
			if (notFound)
				notFound(loc);		// || .apply(null, arguments)?
			else
				throw "Could not find route: " + loc.href;		// loop back to _noMatch?
		}
		else {
			// BUG?: this will push dest onto stack before running can* checks, so

			var toPos = null;
			var dir = 0;
			for (var i = 0; i < stack.length; i++) {
				if (stack[i].href === loc.href) {		// set repl?
					toPos = i;
					break;
				}
			}

			// new fwd
			if (toPos === null) {
				stack.splice(pos+1, 1e4);	// trim array
				stack.push(loc);
				toPos = stack.length - 1;
			}

			var prev = stack[pos];
			var next = stack[toPos];

			var canExit = true;
			var canEnter = true;

			if (pos !== null) {
				if (willExit)
					canExit = noFns || willExit(prev, next);

				if (canExit !== false) {
					var onexit = prev.route.onexit;
					canExit = !onexit ? true : noFns || onexit.apply(null, (prev ? [prev.segs, prev.query, prev.hash] : []).concat(next));

					if (didExit)
						didExit(prev, next);
				}
				else {
				//	revert nav?
				}
			}

			if (canExit !== false) {
				if (willEnter)
					canEnter = noFns || willEnter(next, prev);

				if (canEnter !== false) {
					var onenter = next.route.onenter;
					canEnter = noFns || onenter.apply(null, (next ? [next.segs, next.query, next.hash] : []).concat(prev));

					if (didEnter)
						didEnter(next, prev);
				}

				if (canEnter !== false) {
					if (!useHash) {
						gotoLocChg = true;
						history[repl ? "replaceState" : "pushState"](null, "title", next.href);
					}
					else {
						var hash = next.href;

						if (location.hash !== hash) {
							gotoLocChg = true;

							if (repl)
								location.replace(hash);
							else
								location.hash = hash;
						}
					}

					var title = next.route.title;

					if (title != null)
						document.title = typeof title == "function" ? title(next.segs, next.query, next.hash) : title;

					pos = toPos;
				}
				else {
				//	revert nav?
				}
			}
		}
	}

	function locFromRoute(route, segs, query, hash, repl) {
		var loc = {
			route: route,
			segs: segs || {},

			query: query || {},
			hash: hash || '',
			repl: repl || false,

			href: '',
			path: '',

			toString: function() {
				return loc.href;
			},
		};

		var pathDef = route.path,
			segDef = route.vars || {};

		if (pathDef.indexOf(":") !== -1) {
			loc.path = pathDef.replace(/:([^\/]+)/g, function(m, segName) {
				var segVal = loc.segs[segName] == null ? '' : loc.segs[segName];

				if ((segDef[segName] || /^[^\/]+$/).test(segVal))
					return (segVal += "");

				throw new Error("Invalid value for route '"+pathDef+"' segment '"+segName+"': '"+loc.segs[segName]+"'");
			});
		}

		loc.href = prefix + loc.path + buildQuery(loc.query) + loc.hash;		// TODO: repl onclick?

		return loc;
	}

	// creates full regex paths by merging regex param validations
	function buildRegexPath(r) {
		if (r.regexPath != null)
			return;

		// todo: first replace r.path regexp special chrs via RegExp.escape?
		r.regexPath = new RegExp("^" +
			r.path.replace(/:([^\/]+)/g, function(m, name) {
				var segDef = r.vars || {};
				var regExStr = ""+(segDef[name] || /[^\/]+/);
				return "(" + regExStr.substring(1, regExStr.lastIndexOf("/")) + ")";
			})
		+ "$");
	}

	function onChange(e) {
	//	console.log(e);

		if (useHash && e.type == "popstate")
			return;

		if (useHash && gotoLocChg) {
			gotoLocChg = false;
			return;
		}

		set(currentLoc(), true);
	}

	function boot(failToRoot) {
		routes.forEach(buildRegexPath);

		try {
			set(currentLoc(), true);
		}
		catch (e) {
			if (failToRoot) {
				var rootFound = false;

				for (var i = 0; i < routes.length; i++) {
					var path = routes[i].path;

					if (path == '' || path == '/') {
						set(locFromUrl(prefix + path), true);
						rootFound = true;
						break;
					}
				}

				if (!rootFound)
					throw "No root route found";
			}
			else
				throw e;
		}

		window.onhashchange = window.onpopstate = onChange;
	}

	function hrefFromNamed(name, segs, query, hash, repl) {
		return locFromRoute(get(name), segs, query, hash, repl);
	}

	var api = {
		boot: boot,

		add: add,
	//	remove:
		get: get,
		set: set,
		build: locFromRoute,
		href: hrefFromNamed,

	//	.refresh()
	//	.resolve()
	//	.match(url)

	//	.mount()
	//	.unmount()
	};

	return api;
}
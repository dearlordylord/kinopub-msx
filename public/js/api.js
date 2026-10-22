/*
 * api.js — KinoPUB API client (kinoapi.com), ES5.
 *
 * Transport: XMLHttpRequest, Bearer headers for access tokens, form bodies
 * for OAuth credentials. Secrets must never appear in request URLs.
 *
 * Every method takes a node-style callback: cb(err, data).
 */
(function (global) {
    "use strict";

    var C = global.KP_CONFIG;
    var U = global.KP_UTIL;
    var Store = global.KP_STORE;

    function base() { return C.API_BASE; }

    // --- low level HTTP -----------------------------------------------------
    function http(method, url, cb, token) {
        var body = null;
        if (method === "POST" && url.indexOf("?") !== -1) {
            body = url.slice(url.indexOf("?") + 1);
            url = url.split("?")[0];
        }
        var xhr;
        try { xhr = new XMLHttpRequest(); } catch (e) { cb({ error: "no_xhr" }); return; }
        try {
            xhr.open(method, url, true);
            xhr.timeout = 25000;
            if (token) { xhr.setRequestHeader("Authorization", "Bearer " + token); }
            if (body !== null) { xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded"); }
        } catch (e2) { cb({ error: "open_failed", detail: String(e2) }); return; }

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) { return; }
            var status = xhr.status, text = xhr.responseText, data = null;
            try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
            if (status >= 200 && status < 300) {
                cb(null, data, status);
            } else {
                // pass the parsed body too — OAuth "authorization_pending" arrives with 400
                cb({ error: "http_" + status, status: status, body: data }, data, status);
            }
        };
        xhr.ontimeout = function () { cb({ error: "timeout" }); };
        xhr.onerror = function () { cb({ error: "network" }); };
        try { xhr.send(body); } catch (e3) { cb({ error: "send_failed", detail: String(e3) }); }
    }

    // GET with the access token in a header, never in URLs.
    function authGet(path, params, cb) {
        params = params || {};
        var url = base() + path + U.qs(params);
        http("GET", url, function (err, data, status) {
            if (err && status === 401) {
                // token rejected — try one refresh then retry once
                Api.refresh(function (rErr) {
                    if (rErr) { cb(rErr); return; }
                    http("GET", base() + path + U.qs(params), cb, Store.getAccess());
                });
                return;
            }
            cb(err, data, status);
        }, Store.getAccess());
    }

    // Ensure we have a usable access token before an authorized call.
    function withToken(cb, run) {
        if (!Store.isLoggedIn()) { cb({ error: "not_authenticated" }); return; }
        if (Store.isAccessStale() && Store.getRefresh()) {
            Api.refresh(function (err) { if (err) { cb(err); } else { run(); } });
        } else {
            run();
        }
    }

    var Api = {

        // =====================================================================
        // AUTH — OAuth2 Device Flow
        // =====================================================================

        // Step 1: obtain a device_code + user_code + verification_uri.
        requestDeviceCode: function (cb) {
            var url = base() + "/oauth2/device" + U.qs({
                grant_type: "device_code",
                client_id: C.CLIENT_ID,
                client_secret: C.CLIENT_SECRET
            });
            http("POST", url, function (err, data) {
                if (err) { cb(err); return; }
                Store.saveDeviceCode(data);
                cb(null, data);
            });
        },

        // Step 2: poll for activation. Resolves cb(null, tokens) once activated,
        // cb({pending:true}) while the user hasn't entered the code yet.
        pollDeviceToken: function (code, cb) {
            var url = base() + "/oauth2/device" + U.qs({
                grant_type: "device_token",
                client_id: C.CLIENT_ID,
                client_secret: C.CLIENT_SECRET,
                code: code
            });
            http("POST", url, function (err, data, status) {
                if (!err && data && data.access_token) {
                    Store.saveTokens(data);
                    Store.clearDeviceCode();
                    cb(null, data);
                    return;
                }
                var reason = data && data.error;
                if (reason === "authorization_pending" || status === 400) {
                    cb({ pending: true, reason: reason || "pending" });
                    return;
                }
                cb(err || { error: "activation_failed", body: data });
            });
        },

        // Refresh the access token using the refresh token (valid ~30 days).
        refresh: function (cb) {
            var rt = Store.getRefresh();
            if (!rt) { cb({ error: "no_refresh_token" }); return; }
            var url = base() + "/oauth2/token" + U.qs({
                grant_type: "refresh_token",
                client_id: C.CLIENT_ID,
                client_secret: C.CLIENT_SECRET,
                refresh_token: rt
            });
            http("POST", url, function (err, data) {
                if (err || !data || !data.access_token) {
                    // refresh failed -> force re-login
                    Store.clearTokens();
                    cb(err || { error: "refresh_failed" });
                    return;
                }
                Store.saveTokens(data);
                cb(null, data);
            });
        },

        // Best-effort: tell KinoPUB about this device after login.
        notifyDevice: function (cb) {
            withToken(cb || function () {}, function () {
                authGet("/v1/device/notify", {
                    title: C.DEVICE_TITLE,
                    software: C.SOFTWARE,
                    hardware: "webOS"
                }, function () { if (cb) { cb(null); } });
            });
        },

        logout: function () { Store.clearTokens(); },

        // =====================================================================
        // USER
        // =====================================================================
        getUser: function (cb) {
            withToken(cb, function () { authGet("/v1/user", {}, cb); });
        },

        // =====================================================================
        // REFERENCES (settings dropdowns) — cached in-memory
        // =====================================================================
        _refCache: {},
        _reference: function (name, cb) {
            var self = this;
            if (self._refCache[name]) { cb(null, self._refCache[name]); return; }
            withToken(cb, function () {
                authGet("/v1/references/" + name, {}, function (err, data) {
                    if (!err) { self._refCache[name] = data; }
                    cb(err, data);
                });
            });
        },
        getServerLocations: function (cb) { this._reference("server-location", cb); },
        getStreamingTypes: function (cb) { this._reference("streaming-type", cb); },
        getQualities: function (cb) { this._reference("video-quality", cb); },
        getVoiceoverTypes: function (cb) { this._reference("voiceover-type", cb); },

        // =====================================================================
        // CATALOG
        // =====================================================================
        getTypes: function (cb) {
            withToken(cb, function () { authGet("/v1/types", {}, cb); });
        },
        getGenres: function (type, cb) {
            withToken(cb, function () { authGet("/v1/genres", { type: type }, cb); });
        },

        // Generic listing. params may include: type, genre, country, year, sort,
        // title, actor, director, quality, page, perpage, conditions, etc.
        items: function (params, cb) {
            withToken(cb, function () { authGet("/v1/items", params || {}, cb); });
        },

        // Relevant search across title/director/cast.
        search: function (query, opts, cb) {
            opts = opts || {};
            var p = { q: query, perpage: opts.perpage || 40 };
            if (opts.type) { p.type = opts.type; }
            if (opts.field) { p.field = opts.field; }
            if (opts.sectioned) { p.sectioned = 1; }
            if (opts.page) { p.page = opts.page; }
            withToken(cb, function () { authGet("/v1/items/search", p, cb); });
        },

        // shortcuts: fresh | hot | popular
        shortcut: function (kind, type, page, cb) {
            var p = { type: type, page: page || 0, perpage: C.DEFAULT_SETTINGS.perPage };
            withToken(cb, function () { authGet("/v1/items/" + kind, p, cb); });
        },

        // full item incl. videos/seasons/files (nolinks=1 keeps payload small;
        // the player re-resolves fresh stream URLs via mediaLinks()).
        item: function (id, nolinks, cb) {
            withToken(cb, function () {
                authGet("/v1/items/" + id, { nolinks: nolinks ? 1 : 0 }, cb);
            });
        },

        similar: function (id, cb) {
            withToken(cb, function () { authGet("/v1/items/similar", { id: id }, cb); });
        },

        // fresh tokenized stream + subtitle URLs for a media (episode/video) id.
        mediaLinks: function (mid, cb) {
            withToken(cb, function () { authGet("/v1/items/media-links", { mid: mid }, cb); });
        },

        trailer: function (id, cb) {
            withToken(cb, function () { authGet("/v1/items/trailer", { id: id }, cb); });
        },

        // =====================================================================
        // WATCHING / PROGRESS
        // =====================================================================
        watchingInfo: function (id, video, season, cb) {
            var p = { id: id };
            if (video) { p.video = video; }
            if (season) { p.season = season; }
            withToken(cb, function () { authGet("/v1/watching", p, cb); });
        },
        watchingMovies: function (cb) {
            withToken(cb, function () { authGet("/v1/watching/movies", {}, cb); });
        },
        watchingSerials: function (subscribedOnly, cb) {
            withToken(cb, function () {
                authGet("/v1/watching/serials", { subscribed: subscribedOnly ? 1 : 0 }, cb);
            });
        },
        // Save resume point (seconds). Called periodically by the player.
        markTime: function (id, video, time, season, cb) {
            var p = { id: id, video: video || 1, time: Math.max(0, Math.floor(time || 0)) };
            if (season) { p.season = season; }
            withToken(cb || function () {}, function () {
                authGet("/v1/watching/marktime", p, cb || function () {});
            });
        },
        toggleWatchlist: function (id, cb) {
            withToken(cb, function () { authGet("/v1/watching/togglewatchlist", { id: id }, cb); });
        },
        toggleWatched: function (id, season, video, cb) {
            var p = { id: id };
            if (season) { p.season = season; }
            if (video) { p.video = video; }
            withToken(cb, function () { authGet("/v1/watching/toggle", p, cb); });
        },

        // =====================================================================
        // BOOKMARKS (favorites)
        // =====================================================================
        bookmarkFolders: function (cb) {
            withToken(cb, function () { authGet("/v1/bookmarks", {}, cb); });
        },
        bookmarkFolderItems: function (folderId, page, cb) {
            withToken(cb, function () {
                authGet("/v1/bookmarks/" + folderId, { page: page || 1 }, cb);
            });
        },
        itemFolders: function (itemId, cb) {
            withToken(cb, function () {
                authGet("/v1/bookmarks/get-item-folders", { item: itemId }, cb);
            });
        },
        // add/remove the item to/from a folder (toggle).
        toggleBookmark: function (itemId, folderId, cb) {
            withToken(cb, function () {
                authGet("/v1/bookmarks/toggle-item", { item: itemId, folder: folderId }, cb);
            });
        },
        createFolder: function (title, cb) {
            withToken(cb, function () {
                authGet("/v1/bookmarks/create", { title: title }, cb);
            });
        },

        // =====================================================================
        // HISTORY
        // =====================================================================
        history: function (page, cb) {
            withToken(cb, function () { authGet("/v1/history", { page: page || 1 }, cb); });
        }
    };

    global.KP_API = Api;

})(typeof window !== "undefined" ? window : this);

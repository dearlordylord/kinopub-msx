/*
 * app.js — the interaction plugin "brain".
 *
 * Loaded once by MSX in a background iframe. It exposes a TVXInteractionPlugin
 * handler whose handleRequest(dataId, data, callback) is the router: it maps
 * every action string the UI emits (content:request:interaction:{dataId}@...)
 * to KinoPUB API calls and returns MSX JSON via callback.
 *
 * ES5 only.
 */
(function (global) {
    "use strict";

    var C = global.KP_CONFIG, U = global.KP_UTIL, Store = global.KP_STORE,
        Api = global.KP_API, UI = global.KP_UI;

    // shared state (also read by ui.js for the header/extension label)
    var State = global.KP_STATE = { user: null, settings: Store.getSettings(), favFolder: null, genres: {}, page: {}, search: { q: "", page: 1 }, auth: null };

    function TVX() { return global.TVXInteractionPlugin; }
    function exec(action) { try { TVX().executeAction(action); } catch (e) {} }
    function toast(msg) { try { TVX().info(msg, true, true); } catch (e) {} }

    // -----------------------------------------------------------------------
    // small response helpers
    // -----------------------------------------------------------------------
    function errScreen(err) {
        var t = "Не удалось получить данные.";
        if (err && err.error === "not_authenticated") { return authScreen(); }
        if (err && err.error) { t += " (" + err.error + ")"; }
        return UI.message("Ошибка", t, { button: { label: "Повторить", action: UI.actions.req("home") } });
    }

    function readItems(data) { return U.get(data, "items", []) || []; }

    // -----------------------------------------------------------------------
    // AUTH
    // -----------------------------------------------------------------------
    function authScreen(cb) {
        if (!C.CLIENT_ID && !C.PROXY_AUTH) {
            var m = UI.message("Нет client_id",
                "Укажите CLIENT_ID / CLIENT_SECRET в js/config.js (получить: support@kino.pub) или задайте их в прокси.");
            if (cb) { cb(m); } return m;
        }
        Api.requestDeviceCode(function (err, code) {
            var screen = err ? errScreen(err) : UI.buildAuth(code);
            if (!err) { startAuthPolling(code); }
            if (cb) { cb(screen); } else { try { TVX().showContent(screen); } catch (e) {} }
        });
        // return a transient "loading" screen for the synchronous path
        return UI.message("Активация…", "Получаем код устройства…");
    }

    function stopAuthPolling() {
        if (State.auth && State.auth.timer) { clearInterval(State.auth.timer); }
        State.auth = null;
    }

    function startAuthPolling(code) {
        stopAuthPolling();
        var interval = Math.max(3, (code.interval || 5)) * 1000;
        State.auth = { code: code.code, timer: null };
        State.auth.timer = setInterval(function () {
            Api.pollDeviceToken(code.code, function (err) {
                if (!err) {                       // activated
                    stopAuthPolling();
                    Api.notifyDevice();
                    loadUser(function () { exec(UI.actions.req("home")); });
                }
                // pending -> keep polling silently
            });
        }, interval);
    }

    function loadUser(done) {
        if (!Store.isLoggedIn()) { State.user = null; if (done) { done(); } return; }
        Api.getUser(function (err, data) {
            State.user = err ? null : U.get(data, "user", null);
            if (done) { done(); }
        });
    }

    // -----------------------------------------------------------------------
    // GENRE resolution (title -> id) for virtual sections (cartoons, anime…)
    // -----------------------------------------------------------------------
    function resolveGenre(type, title, cb) {
        var key = type;
        if (State.genres[key]) { cb(findGenre(State.genres[key], title)); return; }
        Api.getGenres(type, function (err, data) {
            var list = err ? [] : (U.isArr(data) ? data : readItems(data));
            State.genres[key] = list;
            cb(findGenre(list, title));
        });
    }
    function findGenre(list, title) {
        var i; for (i = 0; i < list.length; i++) {
            if (list[i].title && list[i].title.toLowerCase().indexOf(String(title).toLowerCase()) === 0) { return list[i].id; }
        }
        return null;
    }
    function sectionById(id) {
        var i; for (i = 0; i < C.SECTIONS.length; i++) { if (C.SECTIONS[i].id === id) { return C.SECTIONS[i]; } }
        return null;
    }

    // -----------------------------------------------------------------------
    // HOME (shelves)
    // -----------------------------------------------------------------------
    function buildHomeAsync(cb) {
        var shelves = [];
        // 1) continue watching (serials + movies)
        Api.watchingSerials(false, function (e1, d1) {
            var serials = e1 ? [] : readItems(d1);
            var i; for (i = 0; i < serials.length; i++) {
                if (serials[i].total) { serials[i].__progress = Math.min(0.98, (serials[i].watched || 0) / serials[i].total); }
            }
            Api.watchingMovies(function (e2, d2) {
                var movies = e2 ? [] : readItems(d2);
                var cont = serials.concat(movies);
                if (cont.length) { shelves.push({ title: "Продолжить просмотр", items: cont, seeAll: UI.actions.req("continue") }); }
                // 2) fresh movies
                Api.shortcut("fresh", "movie", 0, function (e3, d3) {
                    if (!e3 && readItems(d3).length) { shelves.push({ title: "Новинки — фильмы", items: readItems(d3), seeAll: UI.actions.req("list:fresh:movie") }); }
                    // 3) popular movies
                    Api.shortcut("popular", "movie", 0, function (e4, d4) {
                        if (!e4 && readItems(d4).length) { shelves.push({ title: "Популярные фильмы", items: readItems(d4), seeAll: UI.actions.req("list:popular:movie") }); }
                        // 4) fresh serials
                        Api.shortcut("fresh", "serial", 0, function (e5, d5) {
                            if (!e5 && readItems(d5).length) { shelves.push({ title: "Новые серии сериалов", items: readItems(d5), seeAll: UI.actions.req("list:fresh:serial") }); }
                            cb(UI.buildHome(shelves));
                        });
                    });
                });
            });
        });
    }

    // -----------------------------------------------------------------------
    // paginated grids
    // -----------------------------------------------------------------------
    function paginate(ctxKey, page, headline, fetchFn, cb) {
        fetchFn(page, function (err, data) {
            if (err) { cb(errScreen(err)); return; }
            var items = readItems(data), pag = U.get(data, "pagination", null);
            var acc = (page > 1 && State.page[ctxKey]) ? State.page[ctxKey].items : [];
            acc = acc.concat(items);
            State.page[ctxKey] = { items: acc, page: page };
            var hasMore = pag ? (pag.current < Math.ceil((pag.total || 0) / (pag.perpage || 1))) : (items.length >= State.settings.perPage);
            var more = hasMore ? UI.actions.req(ctxKey + ":" + (page + 1)) : null;
            cb(UI.buildGrid({ headline: headline, items: acc, hasMore: hasMore, moreAction: more }));
        });
    }

    function handleSection(id, page, cb) {
        var sec = sectionById(id);
        if (!sec) { cb(errScreen({ error: "unknown_section" })); return; }
        var doFetch = function (genreId) {
            paginate("section:" + id, page, sec.title, function (pg, done) {
                var params = { type: sec.type, page: pg, perpage: State.settings.perPage, sort: "updated-" };
                if (genreId) { params.genre = genreId; }
                Api.items(params, done);
            }, cb);
        };
        if (sec.genreTitle) { resolveGenre(sec.type, sec.genreTitle, doFetch); } else { doFetch(null); }
    }

    function handleList(kind, type, page, cb) {
        paginate("list:" + kind + ":" + type, page,
            (kind === "fresh" ? "Новинки" : kind === "hot" ? "Горячее" : "Популярное"),
            function (pg, done) { Api.shortcut(kind, type, pg - 1, done); }, cb);
    }

    // -----------------------------------------------------------------------
    // DETAIL
    // -----------------------------------------------------------------------
    function computeResume(item, watch) {
        var isSerial = (item.type === "serial" || item.type === "docuserial");
        if (!isSerial) {
            var v = U.get(watch, "item.videos.0", null);
            if (v && v.time > 0 && v.status !== 1) {
                return { video: 1, season: "", time: v.time, mid: U.get(item, "videos.0.id", "") };
            }
            return null;
        }
        var wseasons = U.get(watch, "item.seasons", []), si, ei;
        for (si = 0; si < wseasons.length; si++) {
            var ws = wseasons[si], eps = ws.episodes || [];
            for (ei = 0; ei < eps.length; ei++) {
                if (eps[ei].status !== 1) {   // first not-fully-watched
                    return { season: ws.number, video: eps[ei].number, time: eps[ei].time || 0,
                        mid: episodeMid(item, ws.number, eps[ei].number) };
                }
            }
        }
        return null;
    }
    function episodeMid(item, seasonNum, epNum) {
        var s, e, seasons = item.seasons || [];
        for (s = 0; s < seasons.length; s++) {
            if (seasons[s].number === seasonNum) {
                var eps = seasons[s].episodes || [];
                for (e = 0; e < eps.length; e++) { if (eps[e].number === epNum) { return eps[e].id || ""; } }
            }
        }
        return "";
    }

    function handleItem(id, cb) {
        Api.item(id, true, function (err, data) {
            if (err) { cb(errScreen(err)); return; }
            var item = U.get(data, "item", null);
            if (!item) { cb(errScreen({ error: "no_item" })); return; }
            Api.watchingInfo(id, null, null, function (we, wd) {
                var watch = we ? null : wd;
                Api.itemFolders(id, function (fe, fd) {
                    var folders = fe ? [] : readItems(fd);
                    var flags = {
                        bookmarked: folders.length > 0,
                        inWatchlist: !!(item.in_watchlist || item.subscribed),
                        resume: computeResume(item, watch)
                    };
                    cb(UI.buildDetail(item, watch, flags));
                });
            });
        });
    }

    function refreshDetail(id, cb) { handleItem(id, cb); }

    // -----------------------------------------------------------------------
    // BOOKMARKS
    // -----------------------------------------------------------------------
    function withFavFolder(cb) {
        if (State.favFolder) { cb(State.favFolder); return; }
        Api.bookmarkFolders(function (err, data) {
            var folders = err ? [] : readItems(data), i, chosen = null;
            for (i = 0; i < folders.length; i++) {
                if (folders[i].title && folders[i].title.toLowerCase().indexOf("избран") === 0) { chosen = folders[i]; break; }
            }
            if (!chosen && folders.length) { chosen = folders[0]; }
            if (chosen) { State.favFolder = chosen.id; cb(chosen.id); return; }
            Api.createFolder("Избранное", function (ce, cd) {
                var fid = U.get(cd, "folder.id", null) || U.get(cd, "id", null);
                State.favFolder = fid; cb(fid);
            });
        });
    }

    function handleBookmarks(cb) {
        Api.bookmarkFolders(function (err, data) {
            if (err) { cb(errScreen(err)); return; }
            var folders = readItems(data), root = { headline: "Избранное", type: "list", flag: "kinopub" };
            root.template = { type: "button", layout: "0,0,4,1", round: true, color: C.COLOR.card, icon: "folder" };
            root.items = [];
            var i; for (i = 0; i < folders.length; i++) {
                root.items.push({ label: folders[i].title + (folders[i].count ? ("  ·  " + folders[i].count) : ""),
                    action: UI.actions.req("bmfolder:" + folders[i].id) });
            }
            if (!root.items.length) { cb(UI.message("Избранное пусто", "Добавляйте фильмы и сериалы кнопкой «В избранное».")); return; }
            cb(root);
        });
    }

    // -----------------------------------------------------------------------
    // SETTINGS
    // -----------------------------------------------------------------------
    function handleSettings(cb) {
        // ensure reference lists cached for the choosers
        Api.getStreamingTypes(function () {
            Api.getServerLocations(function () {
                Api.getQualities(function () {
                    cb(UI.buildSettings({}, State.settings));
                });
            });
        });
    }

    function optionsFor(key, done) {
        var s = State.settings, opts = [], cur = s[key];
        if (key === "streamType") {
            Api.getStreamingTypes(function (e, d) {
                var list = e ? [] : readItems(d), i;
                for (i = 0; i < list.length; i++) { opts.push({ value: list[i].code, label: list[i].name }); }
                if (!opts.length) { opts = [{ value: "hls4", label: "HLS4" }, { value: "hls2", label: "HLS2" }, { value: "http", label: "MP4 (http)" }]; }
                done("Тип потока", opts, cur);
            });
        } else if (key === "serverLocation") {
            Api.getServerLocations(function (e, d) {
                var list = e ? [] : readItems(d), i;
                opts.push({ value: "", label: "Авто" });
                for (i = 0; i < list.length; i++) { opts.push({ value: list[i].location, label: list[i].name + " (" + list[i].location + ")" }); }
                done("Сервер (локация)", opts, cur);
            });
        } else if (key === "quality") {
            Api.getQualities(function (e, d) {
                var list = e ? [] : readItems(d), i;
                for (i = 0; i < list.length; i++) { opts.push({ value: list[i].title, label: list[i].title }); }
                if (!opts.length) { opts = [{ value: "480p", label: "480p" }, { value: "720p", label: "720p" }, { value: "1080p", label: "1080p" }, { value: "2160p", label: "4K" }]; }
                done("Качество", opts, cur);
            });
        } else if (key === "preferAudioLang" || key === "preferSubLang") {
            opts = [{ value: "", label: "Выкл / Авто" }, { value: "rus", label: "Русский" }, { value: "eng", label: "English" }, { value: "ukr", label: "Українська" }, { value: "jpn", label: "日本語" }];
            done(key === "preferAudioLang" ? "Язык озвучки" : "Субтитры", opts, cur);
        } else { done("Настройка", [], cur); }
    }

    // -----------------------------------------------------------------------
    // ROUTER
    // -----------------------------------------------------------------------
    function route(dataId, data, cb) {
        var parts = String(dataId || "home").split(":"), p0 = parts[0];

        // --- unauthenticated gate for everything except auth + menu ---------
        // The sidebar must always render; its item actions gate themselves.
        var openWhenLoggedOut = { authcheck: 1, authnew: 1, logout: 1, menu: 1, mainmenu: 1 };
        if (!Store.isLoggedIn() && !openWhenLoggedOut[p0]) { authScreen(cb); return; }

        switch (p0) {
            case "init":
            case "home":
                loadUser(function () { buildHomeAsync(cb); });
                return;

            case "menu":
            case "mainmenu":
                loadUser(function () { cb(buildMenu()); });
                return;

            case "section":
                handleSection(parts[1], parts[2] ? parseInt(parts[2], 10) : 1, cb);
                return;

            case "list": // list:{kind}:{type}[:page]
                handleList(parts[1], parts[2], parts[3] ? parseInt(parts[3], 10) : 1, cb);
                return;

            case "continue":
                buildContinue(cb);
                return;

            case "item":
                handleItem(parts[1], cb);
                return;

            case "audio":
            case "native":
                global.KP_NATIVE.handle(p0, parts[1], cb);
                return;

            case "similar":
                Api.similar(parts[1], function (err, d) {
                    if (err) { cb(errScreen(err)); return; }
                    cb(UI.buildGrid({ headline: "Похожее", items: readItems(d) }));
                });
                return;

            case "trailer":
                Api.trailer(parts[1], function (err, d) {
                    var arr = U.isArr(d) ? d : [d], t = (arr && arr[0] && arr[0].trailer) || U.get(d, "trailer", null);
                    var files = t && t.files, playUrl = null;
                    if (files && files.length) { playUrl = files[files.length - 1].url; }
                    else if (t && t.url) { playUrl = t.url; }
                    if (!playUrl) { cb(UI.message("Трейлер недоступен", "")); return; }
                    cb(UI.message("Трейлер", "Нажмите, чтобы воспроизвести трейлер.",
                        { headline: "Трейлер", button: { label: "Смотреть трейлер", icon: "play-arrow", action: "video:" + playUrl } }));
                });
                return;

            case "search":
                cb(UI.buildSearchLauncher());
                return;

            case "searchq": {
                var q = U.get(data, "data.q", "") || U.get(data, "q", "");
                State.search = { q: q, page: 1 };
                if (!q) { cb(UI.buildSearchLauncher()); return; }
                Api.search(q, { perpage: 40 }, function (err, d) {
                    if (err) { cb(errScreen(err)); return; }
                    var pag = U.get(d, "pagination", null);
                    var hasMore = pag ? (pag.current < Math.ceil((pag.total || 0) / (pag.perpage || 1))) : false;
                    cb(UI.buildSearchResults(q, readItems(d), { hasMore: hasMore, moreAction: hasMore ? UI.actions.req("searchmore:2") : null }));
                });
                return;
            }

            case "searchmore": {
                var pageN = parts[1] ? parseInt(parts[1], 10) : 2, qq = State.search.q;
                Api.search(qq, { perpage: 40, page: pageN }, function (err, d) {
                    if (err) { cb(errScreen(err)); return; }
                    var acc = (State.page["searchq"] && State.page["searchq"].items) || [];
                    if (pageN <= 2 && !acc.length) { acc = []; }
                    acc = acc.concat(readItems(d));
                    State.page["searchq"] = { items: acc, page: pageN };
                    var pag = U.get(d, "pagination", null);
                    var hasMore = pag ? (pag.current < Math.ceil((pag.total || 0) / (pag.perpage || 1))) : false;
                    cb(UI.buildSearchResults(qq, acc, { hasMore: hasMore, moreAction: hasMore ? UI.actions.req("searchmore:" + (pageN + 1)) : null }));
                });
                return;
            }

            case "searchperson": { // searchperson:{field}, data.q = name
                var field = parts[1], name = U.get(data, "data.q", "") || U.get(data, "q", "");
                if (!name) { cb(UI.buildSearchLauncher()); return; }
                var params = { perpage: 40, sort: "rating-" };
                params[field === "director" ? "director" : "actor"] = name;
                Api.items(params, function (err, d) {
                    if (err) { cb(errScreen(err)); return; }
                    cb(UI.buildGrid({ headline: (field === "director" ? "Режиссёр: " : "Актёр: ") + name, items: readItems(d),
                        emptyText: "Ничего не найдено." }));
                });
                return;
            }

            case "bookmarks":
                handleBookmarks(cb);
                return;

            case "bmfolder":
                paginate("bmfolder:" + parts[1], parts[2] ? parseInt(parts[2], 10) : 1, "Избранное",
                    function (pg, done) { Api.bookmarkFolderItems(parts[1], pg, done); }, cb);
                return;

            case "bmtoggle":
                withFavFolder(function (fid) {
                    Api.toggleBookmark(parts[1], fid, function (err, d) {
                        toast(err ? "Не удалось изменить закладку" : "Готово");
                        refreshDetail(parts[1], cb);
                    });
                });
                return;

            case "watchlist":
                Api.toggleWatchlist(parts[1], function (err) { toast(err ? "Ошибка" : "Список обновлён"); refreshDetail(parts[1], cb); });
                return;

            case "watched":
                Api.toggleWatched(parts[1], null, null, function (err) { toast(err ? "Ошибка" : "Отметка обновлена"); refreshDetail(parts[1], cb); });
                return;

            case "history":
                paginate("history", parts[1] ? parseInt(parts[1], 10) : 1, "История просмотров",
                    function (pg, done) { Api.history(pg, done); }, cb);
                return;

            case "settings":
                handleSettings(cb);
                return;

            case "setopt":
                optionsFor(parts[1], function (title, opts, cur) { cb(UI.buildOptionChooser(parts[1], title, opts, cur)); });
                return;

            case "set": { // set:{key}:{value}
                var key = parts[1], value = decodeURIComponent(parts.slice(2).join(":"));
                if (value === "0") { value = false; } else if (value === "1" && (key === "allow4k" || key === "hdr" || key === "showAdultContent")) { value = true; }
                State.settings = Store.setSetting(key, value);
                toast("Сохранено");
                cb(UI.buildSettings({}, State.settings));
                return;
            }

            case "logout":
                stopAuthPolling(); Api.logout(); State.user = null; State.favFolder = null;
                authScreen(cb);
                return;

            case "authnew":
                authScreen(cb);
                return;

            case "authcheck":
                if (!State.auth) { authScreen(cb); return; }
                Api.pollDeviceToken(State.auth.code, function (err) {
                    if (!err) { stopAuthPolling(); Api.notifyDevice(); loadUser(function () { buildHomeAsync(cb); }); }
                    else { cb(UI.message("Ожидание активации", "Код ещё не подтверждён. Войдите на kino.pub/device и попробуйте снова.",
                        { button: { label: "Проверить снова", action: UI.actions.req("authcheck") } })); }
                });
                return;

            default:
                cb(UI.message("Неизвестное действие", String(dataId)));
        }
    }

    function buildContinue(cb) {
        Api.watchingSerials(false, function (e1, d1) {
            var serials = e1 ? [] : readItems(d1);
            Api.watchingMovies(function (e2, d2) {
                var movies = e2 ? [] : readItems(d2);
                var all = serials.concat(movies);
                cb(UI.buildGrid({ headline: "Продолжить просмотр", items: all, emptyText: "Нет незавершённых просмотров." }));
            });
        });
    }

    // -----------------------------------------------------------------------
    // Sidebar menu (Menu Root) — used by start=menu:request:interaction:menu@...
    // -----------------------------------------------------------------------
    // Menu items load content via the `data` property using the prefix-less
    // request-action form ("request:interaction:{id}@{url}"), NOT `action`.
    function reqData(dataId) { return "request:interaction:" + dataId + "@" + C.APP_URL; }

    var SECTION_ICONS = {
        movie: "movie", serial: "live-tv", cartoon: "child-care", cartoonser: "child-care",
        anime: "auto-awesome", documovie: "menu-book", concert: "music-note", "3d": "3d-rotation", tvshow: "tv"
    };

    function menuExtension() {
        var days = U.get(State, "user.subscription.days", null);
        if (days === null || days === undefined) { return ""; }
        return "{ico:msx-white:schedule} " + Math.floor(days) + " дн.";
    }

    function buildMenu() {
        var items = [], i;
        items.push({ id: "home", icon: "home", label: "Главная", focus: true, data: reqData("home") });
        items.push({ id: "search", icon: "search", label: "Поиск", data: reqData("search") });
        items.push({ type: "separator" });
        for (i = 0; i < C.SECTIONS.length; i++) {
            var sec = C.SECTIONS[i];
            items.push({ id: "sec-" + sec.id, icon: SECTION_ICONS[sec.id] || "movie",
                label: sec.title, data: reqData("section:" + sec.id) });
        }
        items.push({ type: "separator" });
        items.push({ id: "continue", icon: "history", label: "Продолжить", data: reqData("continue") });
        items.push({ id: "bookmarks", icon: "favorite", label: "Избранное", data: reqData("bookmarks") });
        items.push({ id: "history", icon: "watch-later", label: "История", data: reqData("history") });
        items.push({ type: "separator" });
        items.push({ id: "settings", icon: "settings", label: "Настройки", data: reqData("settings") });
        return {
            name: "KinoPUB", version: "1.0.0", flag: "kinopub",
            style: "overlay", headline: "KinoPUB", extension: menuExtension(),
            menu: items
        };
    }

    // -----------------------------------------------------------------------
    // TVX handler
    // -----------------------------------------------------------------------
    function Handler() {
        this.init = function () {
            try { if (global.TVXServices && global.TVXServices.logger) { global.TVXServices.logger.level = global.TVXLogLevel ? global.TVXLogLevel.WARN : 2; } } catch (e) {}
            State.settings = Store.getSettings();
        };
        this.ready = function () { loadUser(function () {}); };
        this.handleEvent = function (data) {
            // React to global events if needed (playback events are handled by the player).
            var ev = U.get(data, "event", "");
            if (ev === "video:stop" || ev === "video:pause") { /* progress saved by player */ }
        };
        this.handleData = function (data) { /* no-op */ };
        this.handleRequest = function (dataId, data, callback) {
            try {
                route(dataId, data, function (content) { callback(content || null); });
            } catch (e) {
                try { TVX().error("Request error: " + e); } catch (e2) {}
                callback(UI.message("Ошибка", "Внутренняя ошибка: " + e));
            }
        };
        this.onError = function (message, error) { /* already logged by TVX */ };
    }

    global.TVXPluginTools.onReady(function () {
        global.TVXInteractionPlugin.setupHandler(new Handler());
        global.TVXInteractionPlugin.init();
    });

})(typeof window !== "undefined" ? window : this);

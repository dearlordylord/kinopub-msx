/*
 * ui.js — builds Media Station X JSON (content roots, pages, items, panels)
 * styled to feel like Apple tvOS: dark glassy palette, large rounded posters,
 * horizontal shelves, cinematic hero detail pages, focus scaling, progress bars.
 *
 * Builders are pure-ish: they take already-fetched data and return JSON.
 * All network/data-fetching lives in app.js. ES5 only.
 */
(function (global) {
    "use strict";

    var C = global.KP_CONFIG;
    var U = global.KP_UTIL;

    function req(dataId)      { return "content:request:interaction:" + dataId + "@" + C.APP_URL; }
    function panelReq(dataId) { return "panel:request:interaction:"   + dataId + "@" + C.APP_URL; }
    function menuReq(dataId)  { return "menu:request:interaction:"    + dataId + "@" + C.APP_URL; }
    function playAction(p)    { return req("audio:" + encodeURIComponent(JSON.stringify(p))); }

    // top-right label: profile name + remaining subscription days
    function extensionLabel() {
        var user = U.get(global, "KP_STATE.user", null);
        if (!user) { return ""; }
        var name = U.get(user, "profile.name", "") || U.get(user, "username", "");
        var days = U.get(user, "subscription.days", null);
        var parts = [];
        if (name) { parts.push(U.esc(name)); }
        if (days !== null && days !== undefined) { parts.push("{ico:msx-white:schedule} " + Math.floor(days) + " дн."); }
        return parts.join("   ·   ");
    }

    function rootBase(headline) {
        return { flag: "kinopub", headline: headline || "KinoPUB", extension: extensionLabel(), transparent: 0, compress: false };
    }

    function qualityLabel(q) { return q ? (q >= 2160 ? "4K" : (q + "p")) : ""; }

    var UI = {
        actions: { req: req, panelReq: panelReq, menuReq: menuReq, play: playAction },

        // ---------------------------------------------------------------- msg
        message: function (headline, text, opts) {
            opts = opts || {};
            var items = [{ type: "space", layout: "1,1,10,3", headline: headline || "", text: text || "" }];
            if (opts.button) {
                items.push({ type: "button", layout: "1,4,4,1", label: opts.button.label,
                    icon: opts.button.icon || "refresh", color: C.COLOR.accentSoft, action: opts.button.action });
            }
            var root = rootBase(opts.headline || "KinoPUB");
            root.type = "list"; root.pages = [{ items: items }];
            return root;
        },

        // ------------------------------------------------------- poster cards
        itemToCard: function (item, over) {
            over = over || {};
            var card = {
                type: "default", round: true, layout: over.layout || null,
                image: over.image || U.poster(item, "medium"), imageFiller: "cover",
                title: U.primaryTitle(item.title),
                titleFooter: (over.titleFooter !== undefined) ? over.titleFooter : (item.year ? String(item.year) : ""),
                color: C.COLOR.card,
                progress: (over.progress !== undefined) ? over.progress : (U.isNum(item.__progress) ? item.__progress : -1),
                progressColor: C.COLOR.progress, progressBackColor: C.COLOR.progressBack,
                action: over.action || req("item:" + item.id)
            };
            var rating = U.ratingLabel(item);
            if (rating) { card.stamp = rating; card.stampColor = "rgba(0,0,0,0.55)"; }
            var q = qualityLabel(item.quality);
            if (q) { card.badge = q; card.badgeColor = C.COLOR.accentSoft; }
            return card;
        },

        posterRow: function (items, opts) {
            opts = opts || {};
            var out = [], i, x = 0, max = opts.max || C.LAYOUT.homeRowItems, w = C.LAYOUT.posterW, h = C.LAYOUT.posterH;
            for (i = 0; i < items.length && i < max; i++) {
                out.push(this.itemToCard(items[i], { layout: x + ",0," + w + "," + h }));
                x += w;
            }
            if (opts.seeAllAction && x <= (12 - w)) {
                out.push({ type: "button", layout: x + ",0," + w + "," + h, round: true,
                    icon: "chevron-right", label: "Показать всё", color: C.COLOR.card, action: opts.seeAllAction });
            }
            return out;
        },

        // ------------------------------------------------------------- home
        // shelves: [{ title, items, seeAll }]
        buildHome: function (shelves) {
            var root = rootBase("Главная");
            root.type = "list"; root.pages = [];
            var firstItem = null, s;
            for (s = 0; s < shelves.length; s++) {
                if (shelves[s].items && shelves[s].items.length) { firstItem = shelves[s].items[0]; break; }
            }
            if (firstItem) { root.background = U.poster(firstItem, "big"); }
            for (s = 0; s < shelves.length; s++) {
                var shelf = shelves[s];
                if (!shelf.items || !shelf.items.length) { continue; }
                root.pages.push({ headline: shelf.title, offset: "0,0,0,0.3",
                    items: this.posterRow(shelf.items, { seeAllAction: shelf.seeAll }) });
            }
            if (!root.pages.length) {
                return this.message("Пусто", "Не удалось загрузить главную. Проверьте подключение и настройки.",
                    { button: { label: "Обновить", action: req("home") } });
            }
            return root;
        },

        // ------------------------------------------------------------- grid
        // opts: { headline, items, hasMore, moreAction, background, emptyText }
        buildGrid: function (opts) {
            var root = rootBase(opts.headline || "Каталог");
            root.type = "list";
            if (opts.background) { root.background = opts.background; }
            root.template = { type: "default", layout: "0,0," + C.LAYOUT.posterW + "," + C.LAYOUT.posterH,
                round: true, imageFiller: "cover", color: C.COLOR.card,
                progressColor: C.COLOR.progress, progressBackColor: C.COLOR.progressBack };
            root.items = [];
            var i, list = opts.items || [];
            for (i = 0; i < list.length; i++) {
                var it = list[i];
                var card = { image: U.poster(it, "medium"), title: U.primaryTitle(it.title),
                    titleFooter: it.year ? String(it.year) : "", action: req("item:" + it.id) };
                var rating = U.ratingLabel(it);
                if (rating) { card.stamp = rating; card.stampColor = "rgba(0,0,0,0.55)"; }
                var q = qualityLabel(it.quality);
                if (q) { card.badge = q; card.badgeColor = C.COLOR.accentSoft; }
                if (U.isNum(it.__progress)) { card.progress = it.__progress; card.progressColor = C.COLOR.progress; card.progressBackColor = C.COLOR.progressBack; }
                root.items.push(card);
            }
            if (opts.hasMore && opts.moreAction) {
                root.items.push({ type: "button", enumerate: false, icon: "expand-more",
                    label: "Показать ещё", color: C.COLOR.accentSoft, action: opts.moreAction });
            }
            if (!root.items.length) {
                return this.message("Ничего не найдено", opts.emptyText || "Попробуйте изменить запрос или фильтры.");
            }
            return root;
        },

        // ----------------------------------------------------------- detail
        // item: full item; watch: /v1/watching info; flags: {bookmarked, inWatchlist, resume:{video,season,time,mid}}
        buildDetail: function (item, watch, flags) {
            flags = flags || {};
            var big = U.poster(item, "big");
            var root = rootBase(U.primaryTitle(item.title));
            root.type = "list"; root.background = big;

            var meta = [];
            if (item.year) { meta.push(String(item.year)); }
            var dur = U.get(item, "duration.total", 0);
            if (dur) { meta.push(U.durationMin(Math.round(dur / 60))); }
            var rating = U.ratingLabel(item);
            if (rating) { meta.push(rating); }
            if (item.genres && item.genres.length) {
                var gg = [], gi; for (gi = 0; gi < Math.min(3, item.genres.length); gi++) { gg.push(item.genres[gi].title); }
                meta.push(gg.join(", "));
            }
            var q = qualityLabel(item.quality); if (q) { meta.push(q); }

            var hero = { background: big, items: [
                { type: "space", layout: "0,0,8,1", headline: U.primaryTitle(item.title) },
                { type: "space", layout: "0,1,8,1", text: "{txt:msx-white-soft:" + U.esc(meta.join("   ·   ")) + "}" },
                { type: "space", layout: "0,2,8,2", text: U.esc(U.trim(item.plot).substring(0, 340)) },
                { type: "default", layout: "9,0,3,5", round: true, image: big, imageFiller: "cover", color: C.COLOR.card, action: "image:" + big }
            ]};

            var buttons = [], bx = 0;
            var isSerial = (item.type === "serial" || item.type === "docuserial");
            if (!isSerial) {
                var v1 = (item.videos && item.videos[0]) || {};
                var resumeTime = flags.resume ? flags.resume.time : 0;
                buttons.push({ type: "button", layout: bx + ",4,3,1", icon: "play-arrow",
                    label: "Смотреть",
                    color: C.COLOR.accent,
                    action: playAction({ mid: v1.id || "", id: item.id, video: 1, pos: Math.floor(resumeTime), type: item.type }) });
                bx += 3;
            } else {
                if (flags.resume && flags.resume.mid) {
                    buttons.push({ type: "button", layout: bx + ",4,3,1", icon: "play-arrow",
                        label: "Смотреть · S" + flags.resume.season + "E" + flags.resume.video, color: C.COLOR.accent,
                        action: playAction({ mid: flags.resume.mid, id: item.id, video: flags.resume.video,
                            season: flags.resume.season, pos: Math.floor(flags.resume.time || 0), type: item.type }) });
                    bx += 3;
                }
                buttons.push({ type: "button", layout: bx + ",4,2,1",
                    icon: flags.inWatchlist ? "bookmark" : "playlist-add",
                    label: flags.inWatchlist ? "В списке" : "Буду смотреть",
                    color: C.COLOR.card, action: req("watchlist:" + item.id) });
                bx += 2;
            }
            buttons.push({ type: "button", layout: bx + ",4,2,1",
                icon: flags.bookmarked ? "favorite" : "favorite-border",
                label: flags.bookmarked ? "В избранном" : "В избранное",
                color: C.COLOR.card, action: req("bmtoggle:" + item.id) });
            bx += 2;
            if (U.get(item, "trailer.id", null) || U.get(item, "trailer.url", null)) {
                buttons.push({ type: "button", layout: bx + ",4,2,1", icon: "theaters", label: "Трейлер",
                    color: C.COLOR.card, action: req("trailer:" + item.id) });
                bx += 2;
            }
            buttons.push({ type: "button", layout: bx + ",4,1,1", icon: "more-horiz", label: "Ещё",
                color: C.COLOR.card, action: panelReq("more:" + item.id) });

            hero.items = hero.items.concat(buttons);
            root.pages = [hero];
            if (isSerial && item.seasons && item.seasons.length) {
                root.pages = root.pages.concat(this._episodePages(item, watch));
            }
            return root;
        },

        _episodePages: function (item, watch) {
            var pages = [], si, ei;
            var wmap = {}, wseasons = U.get(watch, "item.seasons", []);
            for (si = 0; si < wseasons.length; si++) {
                var ws = wseasons[si]; wmap[ws.number] = {};
                var weps = ws.episodes || [];
                for (ei = 0; ei < weps.length; ei++) { wmap[ws.number][weps[ei].number] = weps[ei]; }
            }
            for (si = 0; si < item.seasons.length; si++) {
                var season = item.seasons[si], eps = season.episodes || [];
                var pageItems = [], col = 0, row = 0, e;
                for (e = 0; e < eps.length; e++) {
                    var ep = eps[e];
                    var num = ep.number || (e + 1);
                    var wi = (wmap[season.number] && wmap[season.number][num]) || {};
                    var prog = U.progress(wi.time || 0, wi.duration || ep.duration || 0);
                    var tile = {
                        type: "default", round: true,
                        layout: (col * 3) + "," + (row * 2) + ",3,2",
                        image: ep.thumbnail || U.poster(item, "small"), imageFiller: "cover",
                        titleHeader: "S" + season.number + " · E" + num,
                        title: U.primaryTitle(ep.title) || ("Серия " + num),
                        titleFooter: ep.duration ? U.durationMin(Math.round(ep.duration / 60)) : "",
                        color: C.COLOR.card,
                        progress: prog, progressColor: C.COLOR.progress, progressBackColor: C.COLOR.progressBack,
                        action: playAction({ mid: ep.id || "", id: item.id, video: num, season: season.number,
                            pos: Math.floor(wi.time || 0), type: item.type })
                    };
                    if (wi.status === 1) { tile.stamp = "{ico:msx-white:check}"; tile.stampColor = C.COLOR.good; }
                    pageItems.push(tile);
                    col++;
                    if (col === 4) { col = 0; row++; }
                    if (row === 3 || e === eps.length - 1) {
                        pages.push({ headline: "Сезон " + season.number, items: pageItems });
                        pageItems = []; col = 0; row = 0;
                    }
                }
            }
            return pages;
        },

        // ------------------------------------------------- "more" panel (detail)
        buildMorePanel: function (item, flags) {
            var isSerial = (item.type === "serial" || item.type === "docuserial");
            var items = [
                { type: "control", layout: "0,0,8,1", icon: "recommend", label: "Похожие", action: req("similar:" + item.id) },
                { type: "control", layout: "0,1,8,1", icon: isSerial ? "done-all" : "check",
                    label: "Отметить (не)просмотренным", action: req("watched:" + item.id) },
                { type: "control", layout: "0,2,8,1", icon: "high-quality", label: "Качество и поток", action: panelReq("settings") }
            ];
            return { headline: "Дополнительно", type: "list", pages: [{ items: items }] };
        },

        // ------------------------------------------------------------- auth
        buildAuth: function (code) {
            var root = rootBase("Активация устройства");
            root.type = "list";
            root.pages = [{ items: [
                { type: "space", layout: "1,0,10,1", headline: "Подключите профиль KinoPUB" },
                { type: "space", layout: "1,1,10,2",
                    text: "1. Откройте на телефоне или компьютере:  {txt:#0A84FF:" + U.esc(code.verification_uri || "https://kino.pub/device") + "}\n" +
                          "2. Войдите в аккаунт и введите код ниже.\n3. Активация подтвердится автоматически." },
                { type: "space", layout: "1,3,10,2", headline: "{txt:#FFD60A:" + U.esc(code.user_code || "------") + "}",
                    text: "Код действителен ограниченное время" },
                { type: "button", layout: "1,5,4,1", icon: "refresh", label: "Проверить активацию",
                    color: C.COLOR.accent, action: req("authcheck") },
                { type: "button", layout: "5,5,3,1", icon: "vpn-key", label: "Новый код",
                    color: C.COLOR.card, action: req("authnew") }
            ]}];
            return root;
        },

        // ---------------------------------------------------------- search
        // A launcher page: native MSX keyboard via execute:code through the proxy.
        buildSearchLauncher: function () {
            var root = rootBase("Поиск");
            root.type = "list";
            var kb = C.API_BASE + "/msx/keyboard";
            root.pages = [{ headline: "Поиск по каталогу", items: [
                { type: "button", layout: "0,0,6,2", icon: "search", label: "Ввести запрос",
                    color: C.COLOR.accent,
                    data: { headline: "Поиск KinoPUB", placeholder: "Название, актёр или режиссёр", returnAction: req("searchq") },
                    action: "execute:code:" + kb },
                { type: "button", layout: "6,0,3,2", icon: "person", label: "По актёру",
                    color: C.COLOR.card,
                    data: { headline: "Поиск по актёру", placeholder: "Имя актёра", returnAction: req("searchperson:cast") },
                    action: "execute:code:" + kb },
                { type: "button", layout: "9,0,3,2", icon: "movie-filter", label: "По режиссёру",
                    color: C.COLOR.card,
                    data: { headline: "Поиск по режиссёру", placeholder: "Имя режиссёра", returnAction: req("searchperson:director") },
                    action: "execute:code:" + kb }
            ]}];
            return root;
        },

        buildSearchResults: function (query, items, opts) {
            opts = opts || {};
            return this.buildGrid({
                headline: "Поиск: " + U.esc(query),
                items: items, hasMore: opts.hasMore, moreAction: opts.moreAction,
                emptyText: "По запросу «" + U.esc(query) + "» ничего не найдено."
            });
        },

        // --------------------------------------------------------- settings
        // refs: { streamingTypes:[], serverLocations:[], qualities:[] }; settings: object
        buildSettings: function (refs, settings) {
            var root = { headline: "Настройки", type: "list" };
            function cur(v) { return "{txt:#0A84FF:" + U.esc(v) + "}"; }
            var streamName = settings.streamType.toUpperCase();
            var locName = settings.serverLocation ? settings.serverLocation.toUpperCase() : "Авто";
            var items = [
                { type: "control", layout: "0,0,8,1", icon: "stream", label: "Тип потока",
                    extensionLabel: streamName, action: panelReq("setopt:streamType") },
                { type: "control", layout: "0,1,8,1", icon: "dns", label: "Сервер (локация)",
                    extensionLabel: locName, action: panelReq("setopt:serverLocation") },
                { type: "control", layout: "0,2,8,1", icon: "high-quality", label: "Качество",
                    extensionLabel: settings.quality, action: panelReq("setopt:quality") },
                { type: "control", layout: "0,3,8,1", icon: "4k",
                    label: "4K / 2160p", extensionLabel: settings.allow4k ? "Вкл" : "Выкл",
                    action: req("set:allow4k:" + (settings.allow4k ? "0" : "1")) },
                { type: "control", layout: "0,4,8,1", icon: "hdr-on",
                    label: "HDR", extensionLabel: settings.hdr ? "Вкл" : "Выкл",
                    action: req("set:hdr:" + (settings.hdr ? "0" : "1")) },
                { type: "control", layout: "0,5,8,1", icon: "translate",
                    label: "Язык озвучки", extensionLabel: U.lang(settings.preferAudioLang),
                    action: panelReq("setopt:preferAudioLang") }
            ];
            root.pages = [{ items: items }];
            // account controls on a second stacked page
            root.pages.push({ items: [
                { type: "control", layout: "0,0,8,1", icon: "subtitles",
                    label: "Субтитры по умолчанию", extensionLabel: settings.preferSubLang ? U.lang(settings.preferSubLang) : "Выкл",
                    action: panelReq("setopt:preferSubLang") },
                { type: "control", layout: "0,1,8,1", icon: "logout", label: "Выйти из аккаунта",
                    action: req("logout") }
            ]});
            return root;
        },

        // A generic option chooser panel. options: [{value,label}]
        buildOptionChooser: function (key, title, options, current) {
            var items = [], i, y = 0;
            for (i = 0; i < options.length; i++) {
                var o = options[i], sel = (String(o.value) === String(current));
                items.push({ type: "control", layout: "0," + y + ",8,1",
                    icon: sel ? "radio-button-checked" : "radio-button-unchecked",
                    label: o.label, color: sel ? C.COLOR.accentSoft : null,
                    action: req("set:" + key + ":" + encodeURIComponent(o.value)) });
                y++;
            }
            return { headline: title, type: "list", pages: [{ items: items }] };
        }
    };

    global.KP_UI = UI;

})(typeof window !== "undefined" ? window : this);

/* Native MSX video resolver. Never fall back to another language. ES5. */
(function (global) {
    "use strict";
    var C = global.KP_CONFIG, Api = global.KP_API, UI = global.KP_UI;
    function encode(p) { return encodeURIComponent(JSON.stringify(p)); }
    function decode(value) {
        var p = JSON.parse(decodeURIComponent(value));
        if (!p || !/^\d+$/.test(String(p.id)) || !/^\d+$/.test(String(p.video)) ||
            (p.season && !/^\d+$/.test(String(p.season)))) { throw new Error("Invalid media selection"); }
        return p;
    }
    function media(item, p) {
        var list = item.videos || [], i, j;
        if (p.season) {
            list = [];
            for (i = 0; i < (item.seasons || []).length; i++) {
                if (Number(item.seasons[i].number) === Number(p.season)) { list = item.seasons[i].episodes || []; break; }
            }
        }
        for (j = 0; j < list.length; j++) {
            if (Number(list[j].number || j + 1) === Number(p.video)) { return list[j]; }
        }
        throw new Error("Episode not found");
    }
    function trusted(url) {
        var m = /^https:\/\/([a-z0-9.-]+)(?::443)?\//i.exec(String(url || ""));
        if (!m) { return false; }
        var host = m[1].toLowerCase(), domains = ["cdn2cdn.com", "cdn2site.com", "digital-cdn.net", "cdntogo.net"], i;
        if (host === "api.service-kp.com") { return true; }
        for (i = 0; i < domains.length; i++) {
            if (host === domains[i] || host.slice(-(domains[i].length + 1)) === "." + domains[i]) { return true; }
        }
        return false;
    }
    function stream(files, index, settings) {
        var candidates = [], i, f, url, q, want = parseInt(settings.quality, 10) || 1080;
        if (!/^\d+$/.test(String(index)) || Number(index) < 1) { throw new Error("Invalid audio index"); }
        for (i = 0; i < (files || []).length; i++) {
            f = files[i]; url = (f.url || f.urls || {}).hls;
            // Only the legacy HLS format has the verified audio selector.
            if (!trusted(url) || !/\/master-v1a\d+(?=\.m3u8(?:[?#]|$)|[?#]|$)/.test(url)) { continue; }
            q = parseInt(String(f.quality || f.quality_id).replace(/[^0-9]/g, ""), 10) || 0;
            if (settings.allow4k === false && q > 1080) { continue; }
            candidates.push({ q: q, url: url.replace(/\/master-v1a\d+(?=\.m3u8(?:[?#]|$)|[?#]|$)/, "/master-v1a" + Number(index)) });
        }
        candidates.sort(function (a, b) { return a.q - b.q; });
        var best = candidates[0];
        for (i = 0; i < candidates.length; i++) { if (candidates[i].q <= want) { best = candidates[i]; } }
        if (!best) { throw new Error("Selected-language HLS unavailable"); }
        return best.url;
    }
    function action(p) { return "video:resolve:request:interaction:native:" + encode(p) + "@" + C.APP_URL; }
    function handle(kind, value, cb) {
        var p;
        function fail() {
            if (kind === "native") {
                // Resolver errors must not return an unrelated stream URL.
                try { global.TVXInteractionPlugin.error("Выбранная дорожка недоступна. Другой язык не включён.", true, true); } catch (e) {}
                cb(null);
            } else { cb(UI.message("Видео недоступно", "Не удалось получить дорожки выбранной серии.")); }
        }
        try { p = decode(value); } catch (e) { fail(); return; }
        Api.item(p.id, true, function (err, data) {
            if (err) { fail(); return; }
            var item = data && (data.item || data), ep, audios, i, a, selected, index;
            try { ep = media(item, p); } catch (e) { fail(); return; }
            audios = ep.audios || [];
            if (kind === "audio") {
                var pages = [], items = [], choice, label;
                for (i = 0; i < audios.length; i++) {
                    a = audios[i]; index = Number(a.index) || i + 1;
                    choice = { id: p.id, video: p.video, season: p.season, audio: index };
                    label = String(a.lang || "unknown").toUpperCase() + " · " + (a.codec || "") + " · " + (a.channels || "");
                    items.push({ type: "button", layout: "1," + (i % 5) + ",10,1", label: label,
                        action: action(choice) });
                    if (items.length === 5 || i === audios.length - 1) { pages.push({ items: items }); items = []; }
                }
                if (!pages.length) { fail(); return; }
                cb({ headline: "Выберите язык перед запуском", type: "list", pages: pages });
                return;
            }
            for (i = 0; i < audios.length; i++) {
                if ((Number(audios[i].index) || i + 1) === Number(p.audio)) { selected = audios[i]; index = Number(p.audio); break; }
            }
            if (!selected || !/^\d+$/.test(String(ep.id))) { fail(); return; }
            Api.mediaLinks(ep.id, function (linkErr, links) {
                if (linkErr) { fail(); return; }
                try { cb({ url: stream(links && links.files, index, global.KP_STORE.getSettings()) }); }
                catch (e) { fail(); }
            });
        });
    }
    global.KP_NATIVE = { handle: handle, stream: stream, trusted: trusted };
})(typeof window !== "undefined" ? window : this);

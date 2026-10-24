/*
 * config.js — central configuration for the KinoPUB MSX shell.
 *
 * IMPORTANT (ES5 ONLY): TV browsers (webOS, Tizen, older NetCast) generally do
 * NOT support ES6 (let/const/arrow/template-literals/class). Everything under
 * /public/js is written in ES5 on purpose. Keep it that way.
 *
 * Everything you are likely to change lives here.
 */
(function (global) {
    "use strict";

    // --- Where the KinoPUB API is reached -----------------------------------
    //
    // An MSX "interaction plugin" runs inside the TV browser, so requests to the
    // KinoPUB API are subject to CORS. The public KinoPUB API does not reliably
    // send permissive CORS headers, therefore the DEFAULT here points at a thin
    // proxy you host yourself (see /worker/worker.js — a Cloudflare Worker).
    //
    // If your platform/build happens to allow direct cross-origin calls, set
    // API_BASE directly to one of API_MIRRORS below and drop the proxy.
    var CONFIG = {

        // Base URL used for every API call. Must end WITHOUT a trailing slash.
        // Replace with your deployed proxy, e.g. "https://kp-proxy.<you>.workers.dev".
        API_BASE: "https://api.service-kp.com",

        // Known official API hosts / mirrors (the proxy forwards to one of these).
        API_MIRRORS: [
            "https://api.service-kp.com",
            "https://api.srvkp.com" // secondary mirror, if/when available
        ],

        // OAuth2 Device-Flow client credentials.
        // Uses the existing public xbmc device client, as in the audited plugin.
        // This is not an account token; account access remains device-local.
        PROXY_AUTH: false, // true only after deploying your own Worker with OAuth secrets
        CLIENT_ID: "xbmc",
        CLIENT_SECRET: "cgg3gtifu46urtfp2zp1nqtba0k2ezxh",

        // A human-readable device title reported to KinoPUB (/device/notify).
        DEVICE_TITLE: "Samsung TV (Media Station X)",
        SOFTWARE: "kinopub-msx",

        // --- Persistent storage keys (TVXStorage / localStorage) -------------
        STORAGE: {
            ACCESS: "kp.access_token",
            REFRESH: "kp.refresh_token",
            EXPIRES: "kp.expires_at", // epoch ms when access_token expires
            SETTINGS: "kp.settings",
            DEVICE_CODE: "kp.device_code"
        },

        // --- Default user settings (mirrors kino.pub device settings) --------
        DEFAULT_SETTINGS: {
            streamType: "hls4",   // hls4 | hls2 | hls | http  (see /references/streaming-type)
            serverLocation: "",   // "" = auto; otherwise a location code e.g. "de","nl"
            quality: "1080p",     // preferred quality label; falls back to nearest available
            allow4k: true,        // pick 2160p when available
            hdr: true,            // prefer HDR renditions when available
            preferAudioLang: "rus", // preferred audio language code
            preferSubLang: "",    // preferred subtitle language ("" = off)
            showAdultContent: false, // maps to KinoPUB "force"/filter toggles
            perPage: 30           // items per page in grids
        },

        // --- tvOS-flavoured palette (used inside MSX JSON) -------------------
        // MSX accepts its own color tokens AND standard CSS colors (hex/rgba).
        // We use a dark, glassy, high-contrast palette to evoke tvOS.
        COLOR: {
            accent: "#0A84FF",         // iOS/tvOS system blue
            accentSoft: "rgba(10,132,255,0.25)",
            card: "rgba(255,255,255,0.06)",   // frosted card fill
            cardFocus: "rgba(255,255,255,0.14)",
            glass: "msx-glass",               // native frosted token
            text: "msx-white",
            textDim: "rgba(255,255,255,0.55)",
            progress: "#0A84FF",
            progressBack: "rgba(255,255,255,0.18)",
            good: "#30D158",          // green
            warn: "#FF9F0A",          // orange
            bad: "#FF453A",           // red
            gold: "#FFD60A",          // rating star
            pageBg: "#0B0B0F"         // near-black page background
        },

        // --- Poster grid geometry (MSX grid is 12 x 6) ----------------------
        // 2x3 poster tiles => 6 posters per row, classic streaming grid.
        LAYOUT: {
            posterW: 2,
            posterH: 3,
            homeRowItems: 6,     // items shown per home shelf before "See all"
            gridPerPage: 30
        },

        // --- Category / section definitions ---------------------------------
        // KinoPUB API "types": movie, serial, 3D, concert, documovie,
        // docuserial, tvshow. "Cartoons"/"Anime" are genres, not types, so we
        // model them as virtual sections that filter by genre.
        //
        // genre ids are resolved at runtime from /v1/genres by title.
        SECTIONS: [
            { id: "movie",      title: "Фильмы",              type: "movie" },
            { id: "serial",     title: "Сериалы",             type: "serial" },
            { id: "cartoon",    title: "Мультфильмы",         type: "movie",  genreTitle: "Мультфильм" },
            { id: "cartoonser", title: "Мультсериалы",        type: "serial", genreTitle: "Мультфильм" },
            { id: "anime",      title: "Аниме",               type: "serial", genreTitle: "Аниме" },
            { id: "documovie",  title: "Документальные",      type: "documovie" },
            { id: "docuserial", title: "Докум. сериалы",      type: "docuserial" },
            { id: "concert",    title: "Концерты",            type: "concert" },
            { id: "3d",         title: "3D",                  type: "3D" },
            { id: "tvshow",     title: "ТВ-шоу",              type: "tvshow" }
        ],

        // Sort options offered in the UI (maps to /items ?sort=)
        SORTS: [
            { id: "updated-", title: "Недавно обновлённые" },
            { id: "created-", title: "Недавно добавленные" },
            { id: "rating-",  title: "По рейтингу" },
            { id: "views-",   title: "По популярности" },
            { id: "year-",    title: "По году (новее)" },
            { id: "title",    title: "По алфавиту" }
        ]
    };

    // Runtime-resolved URLs of THIS plugin and the player plugin.
    // Computed from the current document location so you don't hardcode a host
    // in dozens of action strings. Actions reference APP_URL for follow-up
    // interaction requests and PLAYER_URL to launch the video plugin.
    function baseDir() {
        var href = global.location ? global.location.href : "";
        // strip query + hash
        href = href.split("#")[0].split("?")[0];
        // strip filename (app.html) -> directory
        return href.replace(/[^/]*$/, "");
    }
    CONFIG.APP_URL = (baseDir() + "app.html");
    CONFIG.PLAYER_URL = (baseDir() + "player.html");

    global.KP_CONFIG = CONFIG;

})(typeof window !== "undefined" ? window : this);

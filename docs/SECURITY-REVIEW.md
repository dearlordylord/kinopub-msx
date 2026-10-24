# Security review — 2026-10-22

Upstream: halls74/kinopub-msx, commit `31d3f8cd7091d007a168e11e73f77b71a80c9c3e`.

## Conclusion

No obvious malicious code, miner, install hooks, telemetry endpoint or deliberate
credential exfiltration was found in the first-party source reviewed. This is a
manual static review and targeted mocked tests, not proof that the program is safe.
The repository has 16 tracked files, no package manifest, dependency installer,
binaries, submodules or Actions workflows at the reviewed commit.

## Findings and changes

- High: `/sub?u=` fetched arbitrary URLs and followed redirects. Replaced with an
  exact HTTPS host allowlist (`SUBTITLE_HOSTS`, empty by default), no credentials
  or nonstandard ports, manual redirects, and a 2 MiB streamed response limit.
- High: externally mutable TVX JavaScript ran with access to account storage.
  Pinned an unmodified TVX v0.0.79 snapshot locally, retaining its copyright header
  and recording its source/hash in `public/vendor/README.md`. No automatic updates.
- Medium: access/refresh tokens and client credentials travelled in URL queries,
  exposing them to URL logs. Moved access tokens to Bearer headers and OAuth
  values to form bodies. Worker forwards Authorization and injects its secrets
  into the body; rejects secret query parameters and upstream redirects.
- Medium: public-worker OAuth credentials can be used by anyone who discovers the
  endpoint. No end-user authentication or rate limiting was added. Worker secrets
  keep client_secret out of the static bundle but do not make OAuth endpoints
  private. Use your own deployment, monitor usage, and add platform controls if
  it becomes exposed to abuse. CORS remains permissive for native MSX clients;
  CORS is not authentication.
- Functional: auth refused to start when client_id was only on the Worker. Added
  explicit `PROXY_AUTH`, false by default. Enable only for your own configured proxy.
- Functional: start.json pointed to the upstream author's host. Changed it to
  this fork, so loading the start file does not silently load the author's app.
- Added referrer suppression and cache suppression on proxy responses; ignored
  local `.dev.vars`, `.env` and Wrangler state.

## Remaining trust and limitations

The TVX snapshot (101,333 bytes) received a targeted inspection of network,
message handling, storage and dynamic code sites, not a complete independent audit.
It contains legacy `new Function` JSON fallbacks when native JSON is missing,
postMessage transport and platform bridges. These are framework functionality,
not sufficient evidence of malware. The host MSX application remains trusted.

Tokens remain readable by JavaScript in TVXStorage/localStorage. Any same-origin
script compromise can steal them. Keep unrelated applications off this origin.
API-provided metadata, image/media URLs and MSX markup are also trusted inputs;
this review does not claim to eliminate all metadata injection or media risks.
Logout clears local tokens; it does not revoke server-side credentials.

No account credentials were supplied or used. OAuth form/Bearer compatibility,
actual KinoPub API responses, native MSX integration, Samsung codecs and playback
have not been verified against a live account/TV. A successful static preview
is not proof of working streaming. No Cloudflare Worker has been deployed.

## Checks

`node tests/security.mjs` checks that first-party account credentials do not
appear in URLs, proxy secrets override supplied client secrets, Bearer headers
are forwarded, arbitrary subtitle URLs are blocked and redirects are rejected.
Disabling the subtitle host check made the test fail; restoring it passed.
All first-party JavaScript also received Node syntax checks.

## Update 2026-10-24

Live API authentication and media-links were checked using a temporary device session. Public xbmc application credentials now permit standard device activation without a private Worker. No account tokens are committed. Native playback candidate and remaining functional limits: [NATIVE-MSX.md](NATIVE-MSX.md). The interaction page now restricts scripts and API connections with CSP. Physical MSX playback is still unverified.

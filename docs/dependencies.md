# Dependencies: overrides, the ffmpeg binary and accepted advisories

`npm audit` is not clean, on purpose. This page records why, so nobody runs `npm audit fix --force`: every "fix" it offers for the findings below is a **downgrade** (`@sendgrid/mail@6.5.2`, `@vercel/blob@2.4.0`, `eslint-config-next@15.5.29`).

Last checked 2026-11-08, after `ffmpeg-static` and its 15 transitive packages were added (`npm audit`: 4 low, all the deepmerge chain below; 0 moderate, 0 high, 0 critical). `npm audit` cannot see the ffmpeg binary's own CVEs: npm downloads it at install time, outside the package graph. Its risk is recorded under [`ffmpeg-static`](#ffmpeg-static-video-posters).

## Overrides in `package.json`

npm cannot carry comments in `package.json`, so each override is explained here. Remove one as soon as its removal condition holds; `npm ls <package>` shows whether upstream has caught up.

| Override | Advisory | Why it is safe | Remove when |
| --- | --- | --- | --- |
| `@vercel/oidc` → `@vercel/cli-config: "^0.3.7"` | [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), high: zod `< 4.6.6` can exhaust memory on oversized constrained collections | `@vercel/blob@2.8.2` (latest) needs `@vercel/oidc@^3`, whose latest 3.x (3.8.10) pins `@vercel/cli-config@0.3.1`. That version **bundles zod 4.1.11 inside `dist/index.js`**, the `exports["."]` entry `@vercel/oidc` loads, with no `require("zod")`; so overriding `zod` alone would clear `npm audit` without changing the code that runs. The override replaces `@vercel/cli-config` itself with 0.3.7, whose `dist/index.js` bundles zod 4.6.7. Same API: `@vercel/oidc` 3.8.10 calls only `getGlobalPathConfig`, `tryReadAuthConfig` and `writeAuthConfig`; those and the helpers they use (`readAuthConfig`, `writeAuthConfigFile`, `readConfigFile`, `getDataDirectories`, `isReadableDirectory`) are byte-identical between 0.3.1 and 0.3.7, and `index.d.ts` is identical. The auth-file schema only gains the optional `cachedUser` and `dpop` fields (0.3.1 dropped them on write-back; 0.3.7 keeps them), and `paths` gains `getDpopAuthConfigFilePath`. Check: `npm ls @vercel/cli-config` shows 0.3.7 and `grep -o 'major:4,minor:[0-9]*,patch:[0-9]*' node_modules/@vercel/cli-config/dist/index.js` prints `major:4,minor:6,patch:7` (any minor ≥ 6). | `@vercel/blob` depends on `@vercel/oidc` ≥ 4.0.6 (which brings a `@vercel/cli-config` built against `zod ^4.6.6`), and the `grep` above, run without the override, still prints a patched zod. |
| `@typescript-eslint/typescript-estree` → `minimatch: "^11.0.1"` | [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), moderate: minimatch `7.0.0 – 11.0.0` DoS by globparts amplification; first patched release 11.0.1, no 10.x backport | Dev-only (ESLint). typescript-estree 8.72.1 asks for `^10.2.2`. Its only call is `minimatch(path, pattern, { dot: true })` in `useProgramFromProjectService.js`, and it runs only for `allowDefaultProject` patterns, which `eslint.config.mjs` never sets (no `projectService` either), so the call never runs in our lint. minimatch 11 keeps the `minimatch()` API (it removed `makeRe`, `AST`, `debug` and internals estree does not use) but changes some matching edge cases: trailing empty path portions, multiple `**`, `partial`, and Windows `..` and UNC paths. None of that is reached here. The advisory also needs `optimizationLevel` ≥ 2; estree uses the default. The override keeps `npm audit` free of it, so new findings stand out. `npm run validate` passes with it. | `@typescript-eslint/typescript-estree` depends on `minimatch` ≥ 11.0.1. |

## `ffmpeg-static` (video posters)

The upload, MCP and cron routes run ffmpeg to take a poster frame from each uploaded video (plan [`docs/plans/2026-11-08-video-posters.md`](plans/2026-11-08-video-posters.md), R-P1; feature doc [Video posters](features/video-posters.md)). `ffmpeg-static` provides the binary.

- **Pinned exactly at `5.3.0`.** The package has no ffmpeg of its own. Its install script downloads one from the `b6.1.1` GitHub release, and its README warns: "To prevent an `ffmpeg-static` upgrade downloading backwards-incompatible ffmpeg versions, use a strict version range for it or use a lockfile." A version bump can therefore change the binary. Treat one as a new binary to review: recheck the facts below and the `allowScripts` entry.
- **The binary.**
  - On Linux (CI and Vercel) it is a John Van Sickle static build of ffmpeg 7.0.2, about 80 MB, with libzimg 3.0.3. libzimg provides the `zscale` filter that HDR tone-mapping needs.
  - On a macOS arm64 laptop the same package installs a different build: ffmpeg 6.0, 45.6 MB, also with `zscale`. Local runs therefore do not prove Linux behaviour.
  - `node -p "require('ffmpeg-static')"` prints the binary's path, and `"$(node -p "require('ffmpeg-static')")" -hide_banner -version` prints its version.
- **Verified bytes (PR #99 review, TCR B1-1).** The install script downloads the binary with no checksum check, so `scripts/check-traces.ts` checks it: the size and SHA-256 of `node_modules/ffmpeg-static/ffmpeg` must match the pin in `FFMPEG_BINARY_PINS` for the build machine's `${process.platform}-${process.arch}`, or the build fails.
  - `linux-x64` (CI and Vercel): SHA-256 `e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99`, 79,826,272 bytes.
  - `darwin-arm64` (local development): SHA-256 `a90e3db6a3fd35f6074b013f948b1aa45b31c6375489d39e572bea3f18336584`, 45,568,216 bytes.
  - Source: the GitHub digests of the `b6.1.1` release assets `ffmpeg-linux-x64` and `ffmpeg-darwin-arm64` (`gh api repos/eugeneware/ffmpeg-static/releases/tags/b6.1.1`). The install script downloads `ffmpeg-<platform>-<arch>.gz` and gunzips it. On 2026-11-08 the gunzipped `ffmpeg-linux-x64.gz` hashed to the linux-x64 digest above, and the installed darwin-arm64 binary to its digest.
  - A platform with no pin fails the build, so an unreviewed binary never passes. To add or change a pin, review that build first: its version, its CVEs and its license. Then record it here and add its digest and size.
  - A mismatch means a stale cached download, an install-time override (below), or release bytes that changed. Reinstall `ffmpeg-static` from a clean cache, or review the new binary and update its pin.
- **Three environment variables must never be set** wherever the app is installed or runs: Vercel, CI and local machines alike. `ffmpeg-static` reads each name from its own `package.json`.
  - `FFMPEG_BIN`, at run time. When it is set as the package loads, `index.js` returns its value instead of the downloaded binary's path. `createVideoFrameService` (`services/video-frames/index.ts`) refuses to start while it is set, in every environment, so only the pinned binary ever runs. `derivePoster` then reports the refusal to Sentry and defers each video without claiming it, until the variable is removed.
  - `FFMPEG_BINARIES_URL` and `FFMPEG_BINARY_RELEASE`, at install time. `install.js` downloads from that base URL or release tag instead of `https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1`. The hash check above fails such a build.
- **No DNS in the Linux build.** Its readme says: "A limitation of statically linking glibc is the loss of DNS resolution. Installing nscd through your package manager will fix this." Vercel functions run no nscd, so ffmpeg could not resolve a Blob URL. It therefore reads each video only from a one-shot HTTP server on `127.0.0.1` inside the same function (plan D2). A numeric loopback address needs no DNS, and signed URLs never reach ffmpeg's arguments or stderr.
- **Only three functions carry it.**
  - `outputFileTracingIncludes` in `next.config.ts` adds the binary, `ffmpeg.LICENSE` and `ffmpeg.README` to `/api/upload`, `/api/mcp` and `/api/cron/reconcile-uploads` only (plan D1). `ffmpeg-static` is in `serverExternalPackages`, because it builds the binary's path from its own `__dirname`.
  - `scripts/check-traces.ts` runs after `next build` in `npm run build`. It fails the build in any of these cases:
    - the binary's size or SHA-256 differs from its pin, or the platform has no pin (above);
    - one of the three routes lacks the binary;
    - any other function carries an `ffmpeg-static` file, through its own trace or through the files every function shares (the shared source is named once);
    - a function's traced files exceed 220 MB (Vercel's limit is 250 MB). The total includes the files every function shares, each read when present:
      - the server runtime trace `.next/next-minimal-server.js.nft.json`. Next writes it for local and CI builds. Vercel builds through its Next.js adapter, and with an adapter Next writes no server traces (vercel/next.js#93684), so there check-traces prints that the trace is absent and the sizes exclude it.
      - the instrumentation trace `.next/server/instrumentation.js.nft.json` and the files listed in `.next/required-server-files.json`. The adapter adds both to every function (`getSharedNodeAssets` in `next/dist/build/adapter/build-complete.js`; TCR B2-2).
    - A shared file that is present but unreadable, or that lists a file not on disk, also fails the build.
- **Security: FFmpeg 7.0.2 is a recorded, accepted risk (PR #99 review, TCR B1-2; owner Rob).** `ffmpeg-static` 5.3.0 is the package's latest release. Its Linux binary is John Van Sickle's FFmpeg 7.0.2 build from August 2024 (the release tag says 6.1.1), and it will get no fixes. That binary parses every uploaded video.
  - **Known CVEs, checked on 2026-11-08 against NVD, cve.org, Red Hat, SUSE and Ubuntu. None runs code on our path.**
    - CVE-2025-1373: a NULL-pointer dereference in `mov_read_trak` (`libavformat/mov.c`), affecting versions up to 7.1. It is on our path, since we force the mov demuxer, but it is a crash (denial of service), not code execution.
    - CVE-2025-1816: the IAMF parser (`libavformat/iamf_parse.c`), denial of service.
    - CVE-2025-1594: the AAC encoder. Not on our path: the only thing we encode is a PNG.
    - CVE-2025-0518: the `af_pan` audio filter. Not on our path.
    - CVE-2025-59728: the MPEG-DASH demuxer in 7.1.1 to before 8.0. Neither our version nor our demuxer: we force `-f mov` or `-f matroska`.
    - CVE-2025-22919: an assertion failure, denial of service (not re-verified in detail).
  - **Defence in depth already in place** (`integrations/video-frames/`):
    - ffmpeg runs as a separate process, through `execFile` with no shell and an empty environment (`env: {}`);
    - `-protocol_whitelist http,tcp`, a demuxer forced from our own sniff, and `-max_pixels 33177600`;
    - it reads only from a loopback server, which answers one window of at most 1 MiB at a time and stops at 64 MiB per poster;
    - a SIGKILL timeout, a 16 MiB stdout cap, and one decode per process (the image slot).
  - **Residual risk.** A future memory-safety bug in the mov or matroska demuxers, or in the h264, hevc, vp8 or vp9 decoders, could run code inside the function. That code could read the function's environment through `/proc`: `env: {}` keeps secrets out of ffmpeg's own environment, but not out of reach of code running in the same sandbox. Today only family members upload.
  - **Follow-up FU-10 (High): move to a maintained FFmpeg build.** Do it on any of these triggers: a code-execution CVE in those demuxers or decoders, a new `ffmpeg-static` release, or before uploads open beyond family use. FU-10's details are in the [video posters feature doc](features/video-posters.md#known-gaps-and-follow-ups).
- **License (GPLv3; plan D10).**
  - The readme says: "This static build is licensed under the GNU General Public License version 3."
  - The binary is never committed and never sent to visitors. npm downloads it at install time, and it runs only inside our own server functions.
  - The app talks to it only through command-line arguments, a stdout pipe and a loopback socket. The GPL FAQ calls these "communication mechanisms normally used between two separate programs" ([MereAggregation](https://www.gnu.org/licenses/gpl-faq.html#MereAggregation)). Our position is that the app and ffmpeg stay separate programs.
  - The FAQ also says: "The GPL permits anyone to make a modified version and use it without ever distributing it to others" ([UnreleasedMods](https://www.gnu.org/licenses/gpl-faq.html#UnreleasedMods)). We run an unmodified build on our own servers.
  - The license and readme travel with the binary in each function that carries it.
  - If licensing review disagrees, the exit is an LGPL ffmpeg build (follow-up FU-5).
- **Install-script approval.**
  - `package.json` has `"allowScripts": { "ffmpeg-static@5.3.0": true }`. `npm install-scripts approve ffmpeg-static` wrote it; that is the npm 11 command, and npm 12 calls it `npm approve-scripts`.
  - The entry is pinned to the reviewed version, so a bump needs a fresh approval.
  - In npm 11 the field is advisory: the script ran before the approval existed.
  - npm 12 blocks unapproved install scripts by default. There, a missing entry would install the package silently without its binary, and `check-traces` would then fail the build because the three routes lack it.

## Accepted, not fixable upstream

| Advisory | Path | Why it is accepted |
| --- | --- | --- |
| [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4), low: deepmerge `mergeObject()` prototype poisoning | `@sendgrid/mail@8.1.6` → `@sendgrid/helpers@8.0.0` → `deepmerge@4.3.1` (all latest) | No patched deepmerge exists (affected range `>= 4.2.0, <= 4.3.1`, `first_patched_version: null`). SendGrid reaches deepmerge only through two gates, both closed here: a `templateId` starting with `d-` sets `isDynamic` (`@sendgrid/helpers/classes/mail.js`), only then does it call `applyDynamicTemplateData`, and `Personalization#deepMergeDynamicTemplateData` still returns early unless `dynamicTemplateData` is set. `integrations/sendgrid/index.ts` sends no `templateId` and no `dynamicTemplateData` (we send `subject`/`text`/`html`). Reassess if we ever send a `d-` template id, or when SendGrid ships a release without deepmerge. |

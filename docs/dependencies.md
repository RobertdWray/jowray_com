# Dependencies: overrides, the ffmpeg binary and accepted advisories

`npm audit` is not clean, on purpose. This page records why, so nobody runs `npm audit fix --force`: every "fix" it offers for the findings below is a **downgrade** (`@sendgrid/mail@6.5.2`, `@vercel/blob@2.4.0`, `eslint-config-next@15.5.29`).

Last checked 2026-11-08, after `ffmpeg-static` and its 15 transitive packages were added (`npm audit`: 4 low, all the deepmerge chain below; 0 moderate, 0 high, 0 critical).

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
  - **`FFMPEG_BIN` must never be set on Vercel.** `ffmpeg-static` honours that environment variable: when it is set at module load, the package returns its value instead of the downloaded binary's path (`index.js`; the name comes from `binary-path-env-var` in the package's `package.json`). The app sets no such variable. On Vercel a stray one would point the poster code at a file that `outputFileTracingIncludes` never traced and `check-traces` never checked: `available()` would then fail and every poster would be deferred, with a Sentry report each time, or a different ffmpeg build would run. Locally it can point a run at another ffmpeg build on purpose.
- **No DNS in the Linux build.** Its readme says: "A limitation of statically linking glibc is the loss of DNS resolution. Installing nscd through your package manager will fix this." Vercel functions run no nscd, so ffmpeg could not resolve a Blob URL. It therefore reads each video only from a one-shot HTTP server on `127.0.0.1` inside the same function (plan D2). A numeric loopback address needs no DNS, and signed URLs never reach ffmpeg's arguments or stderr.
- **Only three functions carry it.**
  - `outputFileTracingIncludes` in `next.config.ts` adds the binary, `ffmpeg.LICENSE` and `ffmpeg.README` to `/api/upload`, `/api/mcp` and `/api/cron/reconcile-uploads` only (plan D1). `ffmpeg-static` is in `serverExternalPackages`, because it builds the binary's path from its own `__dirname`.
  - `scripts/check-traces.ts` runs after `next build` in `npm run build`. It fails the build in any of these cases:
    - one of the three routes lacks the binary;
    - any other function carries an `ffmpeg-static` file;
    - a function's traced files exceed 220 MB (Vercel's limit is 250 MB). The total includes the server runtime trace `.next/next-minimal-server.js.nft.json` when the build writes it (local and CI builds).
      Vercel builds through its Next.js adapter, and with an adapter Next writes no server traces (vercel/next.js#93684). There, check-traces prints that the trace is absent and sizes exclude it.
      A present but unreadable trace still fails the build.
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

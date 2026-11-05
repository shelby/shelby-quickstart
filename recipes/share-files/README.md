# Share files

Give someone a link to a file on Shelby, or to a whole folder, without giving them your
credentials. A small Node.js server signs the links, and a browser opens them.

## Run it

You need Node.js 22.18 or later. From the repository root, with `.env` filled in:

```bash
make share-files    # installs dependencies on the first run
```

Or, in this folder: `npm ci`, then `node --env-file=../../.env share.ts`.

One run plays three parts: the server in [`server.ts`](server.ts), the app's user asking
it for links, and the person they share with, who opens the links with plain `fetch` and
no credentials. The server listens on `127.0.0.1` only and stops at the end. Links and
cookies are never printed. The run writes only under `quickstart/share-files/<run-id>/`
in your bucket, deletes what it wrote, and exits 0 only when every step passes.

## What it does

| Step | Shows |
| --- | --- |
| upload | An HTML page, an image and `docs/report.txt`, each with its `ContentType` |
| serve | The share server from `server.ts`, which refuses to sign keys outside the run's prefix (`403`) |
| link | `GET /link` returns a 300-second link that opens the page with no credentials, with `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer` |
| download | `GET /link?download=1` signs `ResponseContentDisposition`, so the file downloads instead of opening |
| head | A presigned `HeadObjectCommand` gives the size and type with no download |
| range | A `Range` request on a link gives `206`, the way a `<video>` element seeks |
| expired | A link signed for 1 second is refused 3 seconds later (`401`) |
| tampered | A link with one signature digit changed is refused (`401`) |
| folder | `GET /share` returns a folder-share link. Opening it sets a `__Host-Shelby-Folder-Access` cookie and redirects (`303`) to the folder's listing |
| cookie | With the cookie, the listing and `docs/report.txt` load, and `page.html`, outside `docs/`, is refused (`403`) |
| delete | One `DeleteObjectCommand` per key, then `HeadObjectCommand` to confirm |

## Use it in your project

```bash
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @aws-sdk/util-format-url
```

Copy [`shelby-s3.ts`](shelby-s3.ts) for the client, and take what you need from
[`server.ts`](server.ts):

- `GET /link?key=…` signs a `GetObjectCommand` with `getSignedUrl` and returns
  `{ url, expiresIn }`. With `download=1`, it also signs `ResponseContentDisposition`, so
  the browser saves the file under its name.
- `GET /share?folder=…` signs a folder-share link with `getSignedFolderUrl`, the helper at
  the end of the file. A folder share isn't an S3 operation, so `getSignedUrl` can't sign
  it.
- Before signing, authenticate the user and check that the key or folder is theirs. The
  comment in `createShareServer` marks the spot.

In the browser, use a link like any other URL:

```html
<a href="LINK">Open the report</a>
<a href="LINK_WITH_DOWNLOAD">Download the report</a>
<img src="LINK" alt="Chart">
<video src="LINK" controls></video>
```

The `download` attribute doesn't work on links to another origin, which is why the server
signs `ResponseContentDisposition` instead.

Open a folder-share link as a page: a link the user clicks, or `window.location`. The
browser keeps the cookie, shows the folder's listing, and can then open any file in the
folder at its plain URL, `https://s3.beta.shelby.xyz/<bucket>/<key>`, with no query
string.

Shelby's CORS isn't configurable, so don't build on `fetch()` or XHR to these links from
your pages. Uploads still go through your server: there are no presigned uploads.

## What's different on Shelby

- **Links are read-only.** Presign `GetObjectCommand` or `HeadObjectCommand`, one key per
  link. Uploads, deletes and listings can't be presigned.
- **Sign with region `default` and path-style addressing.** The client in `shelby-s3.ts`
  does. Header-signed requests accept any region; presigned URLs for another region are
  refused (`400`).
- **Set `responseChecksumValidation: "WHEN_REQUIRED"`** on the client, as `shelby-s3.ts`
  does. Without it, the SDK adds `x-amz-checksum-mode` to `GetObject` links, which Shelby
  refuses with `501`.
- **Links last at most 7 days.** `expiresIn` runs from 1 to 604800 seconds.
- **Response overrides work, except for caching.** `ResponseContentType`,
  `ResponseContentDisposition`, `ResponseContentLanguage` and `ResponseContentEncoding`
  work. `ResponseCacheControl` and `ResponseExpires` are refused (`400`).
- **Nothing caches a link's response.** Every response says
  `Cache-Control: private, no-store` and `Referrer-Policy: no-referrer`, so don't put a
  CDN in front of these links.
- **A link is a bearer credential.** Anyone who has it can read the file until it
  expires, so keep links out of logs, analytics and error reports. You can't revoke one
  link: disabling the access key revokes all of its links.
- **Each GET counts toward your account's concurrent downloads**, range requests
  included. Past the limit, Shelby answers `503 SlowDown` with `Retry-After: 1`. HEAD
  doesn't count.
- **Folder shares are a Shelby extension.** The listing is S3 XML, not a folder page.
  A browser holds one folder share per host, so opening another replaces it. The cookie
  is `SameSite=Lax`: it goes with pages the user opens, not with `fetch()` or `<img>`
  tags on other sites. It expires when the link does.

Docs: [Presigned URLs](https://docs.shelby.xyz/tools/s3-gateway/presigned-urls) ·
[JavaScript quickstart](https://docs.shelby.xyz/tools/s3-gateway/quickstarts/javascript) ·
[Compatibility](https://docs.shelby.xyz/tools/s3-gateway/compatibility)

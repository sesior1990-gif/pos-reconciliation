# POS Reconciliation Uploader

Scan a POS terminal's end-of-day reconciliation QR code with your phone camera,
review the extracted date/terminal ID, and save the receipt as a PDF into a
shared Google Drive folder — named `YYYY-MM-DD_TerminalID.pdf` — for finance
to review.

## How it works

Both QR types we tested point to a hosted receipt page rather than containing
a link straight to a PDF file:

- **NearPay** (`sa-api.nearpay.io/ui/reconciliation_receipt/<id>`) — the page
  is server-rendered; all the receipt data (merchant, date, terminal ID,
  totals) is present directly in the HTML.
- **Geidea** (`mpos.geidea.net/QRRecon?details=<gzip+base64 blob>`) — the
  reconciliation data itself is compressed and embedded in the URL and
  rendered client-side into the same kind of receipt page.

Neither vendor exposes a direct "download the PDF" link — their own
"Download PDF" button generates the PDF *in the browser* (NearPay uses
jsPDF client-side). So this app takes the same approach as the most reliable
substitute: it loads the exact receipt page in a real (headless) browser on
the server and prints **that page** to PDF — giving you a faithful copy of
what the terminal itself shows, not a hand-rebuilt approximation.

Flow:

1. You scan the QR in the PWA → it sends the decoded URL to the backend.
2. The backend (Node + Puppeteer) opens that URL, waits for the receipt to
   render, extracts the date + terminal ID, and prints the page to PDF.
3. The app shows you the PDF and the extracted date/terminal ID so you can
   correct them if needed, then uploads it to a `POS Reconciliation` folder
   in **your own Google Drive** (via Drive API, `drive.file` scope — the app
   can only see files it creates, not your whole Drive).
4. The file is named `YYYY-MM-DD_TerminalID.pdf`. If a file with that name
   already exists in the folder, it's updated in place rather than
   duplicated.

## ⚠️ Important: verify the Geidea parser with a real scan

I was given a NearPay QR that decoded correctly, and I fetched that page
directly to confirm the exact field layout (`nearpay.js` uses the real CSS
selectors from that page — it's solid).

For Geidea, the sample `details=` payload I was given did **not** decode
successfully — even Geidea's own server returned an error for it (most
likely it got garbled somewhere in copy/paste, since it's a ~550-character
compressed blob and a single wrong character breaks the whole thing). So
`server/parsers/geidea.js` is written defensively (generic text-pattern
matching) but is **unverified** against a real Geidea receipt, and the app
always flags Geidea scans with a "please verify" warning on the review
screen before you save.

**Once you scan a real Geidea terminal with this app**, check whether the
Terminal ID / date it extracts are correct:
- If yes — great, no changes needed (you can remove the `needsReview: true`
  flag in `geidea.js` if you want to stop seeing the warning).
- If no — open the browser dev tools on the review screen, or add a
  `console.log(rawText)` in `server.js`, to see the actual rendered text of
  the Geidea page, then tighten `parsers/geidea.js` the same way
  `parsers/nearpay.js` uses real selectors (see the Nearpay file for the
  pattern: `page.evaluate()` reading specific CSS classes rather than
  regexing plain text).

The review screen's date/terminal-ID fields are always editable, so even if
extraction is briefly imperfect, nothing wrong gets saved silently.

## Project layout

```
reconciliation/
  server/            Node + Express + Puppeteer backend
    server.js
    parsers/
      nearpay.js     Confirmed field mapping
      geidea.js       Best-effort, needs real-world verification (see above)
      index.js       hostname -> parser dispatch (add new POS brands here)
    Dockerfile
    package.json
  public/            The PWA (served as static files by the same server)
    index.html
    app.js           Camera scan, Google sign-in, Drive upload
    styles.css
    manifest.json
    sw.js
```

## 1. Set up Google OAuth (required once)

The app uploads directly to your own Drive using your Google sign-in — no
service account or server-side secret needed.

1. Go to <https://console.cloud.google.com/> and create a new project (or
   pick an existing one).
2. **APIs & Services → Library** → enable **Google Drive API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have a Google Workspace org, in
     which case **Internal** avoids the note below entirely).
   - Fill in the required app name/support email.
   - Scopes: you can leave this default; the app requests
     `drive.file` at sign-in time.
   - Test users: add your own Gmail/Workspace address.
   - Leave the app in **Testing** status — no Google review needed for your
     own use.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized JavaScript origins: add the URL you'll deploy this app to
     (e.g. `https://your-app.onrender.com`), and `http://localhost:8080` if
     you'll test locally.
   - Create it, then copy the **Client ID**.
5. Paste that Client ID into `public/app.js`, replacing the
   `GOOGLE_CLIENT_ID` placeholder near the top of the file.

> Note: with an unverified app in **Testing** status, Google can expire your
> sign-in after a period of inactivity, so you may occasionally need to tap
> "Sign in with Google" again — this app is designed for that (it asks you
> to re-sign-in automatically if a Drive call fails with an expired token).
> If this becomes annoying and you don't have a Workspace org, you can submit
> the app for Google's OAuth verification later.

## 2. Run locally (optional, needs Node.js 18+)

```bash
cd server
npm install
node server.js
```

Then open `http://localhost:8080` on your computer. (Camera scanning needs
HTTPS on a real phone — see deployment below — but you can test the rest of
the flow locally by pasting a receipt URL directly into the browser's dev
console: `processScannedUrl('https://sa-api.nearpay.io/ui/reconciliation_receipt/...')`.)

## 3. Deploy (needed for camera access on your phone)

Mobile browsers only allow camera access on HTTPS. Any Docker-friendly host
works; **Render.com** is the simplest to set up with no CLI required:

1. Push this folder to a GitHub repo.
2. On [Render](https://render.com) → **New → Web Service** → connect the
   repo.
3. Environment: **Docker**. Dockerfile path: `server/Dockerfile`. Docker
   build context: repository root (`.`).
4. Deploy. Render gives you an HTTPS URL like `https://xxx.onrender.com`.
5. Add that exact URL to your OAuth Client's **Authorized JavaScript
   origins** in Google Cloud Console (step 1.4 above), if you haven't
   already.

Alternatives: **Google Cloud Run** (`gcloud run deploy --source .` from the
repo root, using `server/Dockerfile`) or **Railway.app** work the same way —
any host that builds the Dockerfile and exposes port 8080.

## 4. Install it on your phone

Open the deployed HTTPS URL in Chrome (Android) or Safari (iPhone), then use
**"Add to Home Screen"**. It'll launch full-screen like a normal app icon.
No app store needed.

## 5. Daily use

1. After terminal day-closure, open the app and tap **Open Camera & Scan**.
2. Point the camera at the terminal's reconciliation QR code.
3. The app fetches the receipt, shows a PDF preview and the detected date +
   terminal ID (edit if needed).
4. Tap **Sign in with Google** the first time each session, then **Save to
   Google Drive**.
5. The PDF appears in the `POS Reconciliation` folder in your Drive as
   `YYYY-MM-DD_TerminalID.pdf`, ready for finance to review.

## Adding another POS/terminal brand later

1. Scan its QR, note the URL's hostname.
2. Add a new file in `server/parsers/` following the pattern in
   `nearpay.js` (prefer real CSS selectors via `page.evaluate()` once you've
   inspected the page; fall back to regex only if needed).
3. Register it in `server/parsers/index.js`'s `VENDORS` map.
4. Redeploy.

You can also allow a vendor without writing a custom parser (it'll use
generic text-pattern extraction and always show the review warning) by
setting the `EXTRA_ALLOWED_HOSTS` environment variable to a comma-separated
list of hostnames on your deployment.

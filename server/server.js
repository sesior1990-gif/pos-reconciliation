const path = require('path');
const express = require('express');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { getVendor, allowedHosts } = require('./parsers');

const PORT = process.env.PORT || 8080;
const EXTRA_ALLOWED_HOSTS = (process.env.EXTRA_ALLOWED_HOSTS || '')
  .split(',')
  .map((h) => h.trim())
  .filter(Boolean);

const app = express();
app.use(cors());
app.use(express.json());
// public/ is a sibling of this file's directory (server/), regardless of
// where the process was launched from.
app.use(express.static(path.join(__dirname, '../public')));

let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      // Memory-reduction flags to help a single Chromium fit in a 512 MB
      // host (e.g. Render's free tier) by trimming features we never use for
      // rendering a static receipt page to PDF.
      // NOTE: do NOT add --single-process — it crashes Page.printToPDF
      // ("Target closed"), breaking PDF generation entirely.
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-sync',
        '--mute-audio',
        '--no-first-run',
      ],
    });
    browserPromise.catch(() => {
      browserPromise = null; // allow retry on next request if launch failed
    });
  }
  return browserPromise;
}

function normalizeDate(dateStr) {
  // Expects DD/MM/YYYY (as used by the POS receipts we've seen). Returns YYYY-MM-DD.
  const m = dateStr && dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return '';
  const [, dd, mm, yyyy] = m;
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeForFilename(s) {
  return (s || '').replace(/[^A-Za-z0-9-]/g, '').trim();
}

app.post('/api/scan', async (req, res) => {
  const { url } = req.body || {};
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Missing "url" in request body.' });
  }

  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return res.status(400).json({ error: 'The scanned QR code does not contain a valid URL.' });
  }

  if (parsed.protocol !== 'https:') {
    return res.status(400).json({ error: 'Only https URLs are allowed.' });
  }

  const allHosts = new Set([...allowedHosts(), ...EXTRA_ALLOWED_HOSTS]);
  if (!allHosts.has(parsed.hostname)) {
    return res.status(400).json({
      error: `This QR code is from an unrecognized terminal system (${parsed.hostname}). Ask your admin to add it to EXTRA_ALLOWED_HOSTS.`,
    });
  }

  const vendor = getVendor(parsed.hostname);

  let browser;
  let page;
  try {
    browser = await getBrowser();
    page = await browser.newPage();
    await page.setViewport({ width: 480, height: 900 });
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 25000 });

    // Give client-side-rendered receipts (e.g. Geidea, which decodes the QR payload
    // in the browser) a little extra time to populate the DOM.
    await page
      .waitForFunction(() => document.body && document.body.innerText.trim().length > 40, {
        timeout: 8000,
      })
      .catch(() => {});

    const rawText = await page.evaluate(() => document.body.innerText || '');

    let fields = { terminalId: '', dateStr: '', merchant: '', vendor: 'unknown', vendorLabel: parsed.hostname };
    if (vendor) {
      fields = await vendor.parse(page, rawText);
    } else {
      // Unknown vendor via EXTRA_ALLOWED_HOSTS: best-effort generic parse.
      const dateMatch = rawText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
      const idMatch = rawText.match(/\b\d{8,16}\b/);
      fields = {
        terminalId: idMatch ? idMatch[0] : '',
        dateStr: dateMatch ? dateMatch[0] : '',
        merchant: '',
        vendor: 'generic',
        vendorLabel: parsed.hostname,
        needsReview: true,
      };
    }

    await page.addStyleTag({
      content: `
        body { background: #fff !important; }
        .download-pdf-button, button { display: none !important; }
      `,
    });
    await page.emulateMediaType('screen');
    const pdfBytes = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20px', bottom: '20px', left: '20px', right: '20px' },
    });
    // page.pdf() returns a Uint8Array in this Puppeteer version, not a Node
    // Buffer — wrap it so .toString('base64') actually base64-encodes the
    // bytes instead of silently falling back to Array's comma-joined toString.
    const pdfBuffer = Buffer.from(pdfBytes);

    const isoDate = normalizeDate(fields.dateStr);
    const suggestedFilename = `${isoDate || 'unknown-date'}_${
      sanitizeForFilename(fields.terminalId) || 'unknown-terminal'
    }.pdf`;

    res.json({
      pdfBase64: pdfBuffer.toString('base64'),
      terminalId: fields.terminalId,
      date: fields.dateStr,
      isoDate,
      merchant: fields.merchant,
      vendor: fields.vendor,
      vendorLabel: fields.vendorLabel,
      needsReview: !!fields.needsReview || !fields.terminalId || !isoDate,
      suggestedFilename,
      rawText,
    });
  } catch (err) {
    console.error('scan error:', err);
    res.status(500).json({ error: 'Failed to fetch or render the receipt: ' + err.message });
  } finally {
    if (page) {
      try {
        await page.close();
      } catch (e) {
        /* ignore */
      }
    }
  }
});

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`POS reconciliation server listening on port ${PORT}`);
});

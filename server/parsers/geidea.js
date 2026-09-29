// Parses a Geidea reconciliation receipt page (mpos.geidea.net/QRRecon?details=...).
// The receipt data is embedded, gzip+base64url-encoded, in the `details` query param
// and rendered client-side into the page. We don't have a confirmed field layout for
// this vendor (the sample QR we tested against did not decode successfully), so this
// parser uses best-effort text heuristics and is always flagged for manual review in
// the app's confirm screen. Tighten the selectors here once a real, working Geidea QR
// has been scanned and the actual DOM/labels are known (mirror the approach used in
// nearpay.js: prefer page.evaluate() with real selectors over regex on plain text).

async function parseGeidea(page, rawText) {
  let text = rawText;
  try {
    text = await page.evaluate(() => document.body.innerText || '');
  } catch (e) {
    // keep rawText
  }

  let dateStr = '';
  const dateMatch = text.match(/(\d{2})[\/\-](\d{2})[\/\-](\d{4})/);
  if (dateMatch) dateStr = `${dateMatch[1]}/${dateMatch[2]}/${dateMatch[3]}`;

  const lines = text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  let terminalId = '';
  for (let i = 0; i < lines.length; i++) {
    if (/terminal|tid|جهاز/i.test(lines[i])) {
      for (let j = i; j < Math.min(i + 4, lines.length); j++) {
        const m = lines[j].match(/\b\d{6,16}\b/);
        if (m) {
          terminalId = m[0];
          break;
        }
      }
      if (terminalId) break;
    }
  }
  if (!terminalId) {
    const m = text.match(/\b\d{8,16}\b/);
    if (m) terminalId = m[0];
  }

  const merchant =
    lines.find((l) => /[A-Za-z]{3,}/.test(l) && !/terminal|reconciliation|receipt/i.test(l)) || '';

  return {
    terminalId,
    dateStr,
    merchant,
    vendor: 'geidea',
    vendorLabel: 'Geidea',
    needsReview: true,
  };
}

module.exports = { parseGeidea };

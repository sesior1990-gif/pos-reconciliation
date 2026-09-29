// Parses a NearPay reconciliation receipt page (sa-api.nearpay.io).
// The page server-renders the receipt into a fixed DOM structure:
//   .receipt-header .title span      -> merchant name lines
//   .receipt-header .meta-datetime   -> date, time
//   .receipt-header .meta-terminal   -> first block's first <span> is the Terminal ID (TID)

async function parseNearpay(page, rawText) {
  let terminalId = '';
  let dateStr = '';
  let merchant = '';

  try {
    const data = await page.evaluate(() => {
      const metaBlocks = document.querySelectorAll('.meta-terminal');
      const firstBlock = metaBlocks[0];
      const tid = firstBlock ? firstBlock.querySelector('span')?.textContent?.trim() : '';
      const dtSpans = Array.from(document.querySelectorAll('.meta-datetime span')).map((s) =>
        s.textContent.trim()
      );
      const titleSpans = Array.from(document.querySelectorAll('.receipt-header .title span')).map(
        (s) => s.textContent.trim()
      );
      return { tid, dtSpans, titleSpans };
    });
    terminalId = (data.tid || '').replace(/\s+/g, '');
    dateStr = (data.dtSpans && data.dtSpans[0]) || '';
    merchant = (data.titleSpans && (data.titleSpans[1] || data.titleSpans[0])) || '';
  } catch (e) {
    // fall through to regex fallback below
  }

  if (!dateStr) {
    const m = rawText.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) dateStr = m[0];
  }
  if (!terminalId) {
    const m = rawText.match(/\b\d{10,16}\b/);
    if (m) terminalId = m[0];
  }

  return { terminalId, dateStr, merchant, vendor: 'nearpay', vendorLabel: 'NearPay' };
}

module.exports = { parseNearpay };

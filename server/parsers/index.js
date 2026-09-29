const { parseNearpay } = require('./nearpay');
const { parseGeidea } = require('./geidea');

// Add new POS/terminal brands here as you encounter their QR codes.
// hostname -> { name, parse(page, rawText) }
const VENDORS = {
  'sa-api.nearpay.io': { name: 'NearPay', parse: parseNearpay },
  'mpos.geidea.net': { name: 'Geidea', parse: parseGeidea },
};

function getVendor(hostname) {
  return VENDORS[hostname];
}

function allowedHosts() {
  return Object.keys(VENDORS);
}

module.exports = { VENDORS, getVendor, allowedHosts };

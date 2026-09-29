// ---- Configuration ---------------------------------------------------
// 1. Create an OAuth 2.0 Client ID (Web application) in Google Cloud Console
//    and paste it here. See README.md for the exact steps.
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com';

// Name of the single shared Drive folder every receipt PDF is saved into.
const DRIVE_FOLDER_NAME = 'POS Reconciliation';

// Drive scope limited to files this app creates/opens itself (least privilege).
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

// -----------------------------------------------------------------------

const state = {
  accessToken: null,
  tokenClient: null,
  html5Qrcode: null,
  currentScan: null, // { pdfBase64, blobUrl, vendor, ... }
  driveFolderId: null,
};

const el = (id) => document.getElementById(id);

function showConfigWarningIfNeeded() {
  if (!GOOGLE_CLIENT_ID || GOOGLE_CLIENT_ID.startsWith('YOUR_GOOGLE')) {
    el('config-panel').hidden = false;
    el('signin-btn').disabled = true;
  }
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem('pos-recon-history') || '[]');
  } catch (e) {
    return [];
  }
}

function saveHistoryEntry(entry) {
  const history = loadHistory();
  history.unshift(entry);
  localStorage.setItem('pos-recon-history', JSON.stringify(history.slice(0, 30)));
  renderHistory();
}

function renderHistory() {
  const list = el('history-list');
  const history = loadHistory();
  list.innerHTML = '';
  if (history.length === 0) {
    list.innerHTML = '<li class="empty">No files saved yet on this device.</li>';
    return;
  }
  for (const item of history) {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${item.filename}</span>
      <a href="${item.link}" target="_blank" rel="noopener">Open</a>
    `;
    list.appendChild(li);
  }
}

// ---- Google Sign-In -----------------------------------------------------

function initGoogleAuth() {
  if (!window.google || !google.accounts || !google.accounts.oauth2) {
    setTimeout(initGoogleAuth, 200);
    return;
  }
  state.tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (resp) => {
      if (resp.error) {
        console.error('OAuth error', resp);
        el('scan-status').textContent = 'Google sign-in failed: ' + resp.error;
        return;
      }
      state.accessToken = resp.access_token;
      onSignedIn();
    },
  });
}

function onSignedIn() {
  el('signin-btn').hidden = true;
  el('signed-in-email').hidden = false;
  el('signed-in-email').textContent = 'Connected to Google Drive';
}

el('signin-btn').addEventListener('click', () => {
  if (!state.tokenClient) return;
  state.tokenClient.requestAccessToken({ prompt: state.accessToken ? '' : 'consent' });
});

// ---- QR Scanning ----------------------------------------------------------

el('start-scan-btn').addEventListener('click', startScan);
el('stop-scan-btn').addEventListener('click', stopScan);

async function startScan() {
  el('scan-status').textContent = '';
  el('start-scan-btn').hidden = true;
  el('stop-scan-btn').hidden = false;
  el('review-panel').hidden = true;

  state.html5Qrcode = new Html5Qrcode('qr-reader');
  try {
    await state.html5Qrcode.start(
      { facingMode: 'environment' },
      { fps: 10, qrbox: { width: 260, height: 260 } },
      onScanSuccess,
      () => {} // ignore per-frame decode failures
    );
  } catch (err) {
    el('scan-status').textContent = 'Camera error: ' + err;
    resetScanButtons();
  }
}

async function stopScan() {
  await teardownScanner();
  resetScanButtons();
  el('scan-status').textContent = 'Scan cancelled.';
}

async function teardownScanner() {
  if (state.html5Qrcode) {
    try {
      await state.html5Qrcode.stop();
      await state.html5Qrcode.clear();
    } catch (e) {
      /* ignore */
    }
    state.html5Qrcode = null;
  }
}

function resetScanButtons() {
  el('start-scan-btn').hidden = false;
  el('stop-scan-btn').hidden = true;
}

async function onScanSuccess(decodedText) {
  await teardownScanner();
  resetScanButtons();
  el('scan-status').textContent = 'Fetching receipt...';
  await processScannedUrl(decodedText);
}

async function processScannedUrl(url) {
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) {
      el('scan-status').textContent = 'Error: ' + (data.error || 'unknown error');
      return;
    }
    el('scan-status').textContent = '';
    showReview(data);
  } catch (err) {
    el('scan-status').textContent = 'Network error: ' + err.message;
  }
}

// ---- Review screen ---------------------------------------------------------

function showReview(data) {
  state.currentScan = data;

  el('field-vendor').value = data.vendorLabel || data.vendor || 'Unknown';
  el('field-date').value = data.isoDate || '';
  el('field-terminal').value = data.terminalId || '';
  el('field-filename').value = data.suggestedFilename || '';
  el('review-warning').hidden = !data.needsReview;

  const pdfBlob = base64ToBlob(data.pdfBase64, 'application/pdf');
  const blobUrl = URL.createObjectURL(pdfBlob);
  state.currentScan.blobUrl = blobUrl;
  state.currentScan.pdfBlob = pdfBlob;
  el('pdf-preview').src = blobUrl;

  el('save-status').textContent = '';
  el('review-panel').hidden = false;
  el('review-panel').scrollIntoView({ behavior: 'smooth' });

  el('field-date').oninput = updateFilenameFromFields;
  el('field-terminal').oninput = updateFilenameFromFields;
}

function updateFilenameFromFields() {
  const date = el('field-date').value || 'unknown-date';
  const terminal = (el('field-terminal').value || 'unknown-terminal').replace(/[^A-Za-z0-9-]/g, '');
  el('field-filename').value = `${date}_${terminal}.pdf`;
}

function base64ToBlob(base64, mimeType) {
  const byteChars = atob(base64);
  const byteNumbers = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNumbers[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNumbers);
  return new Blob([byteArray], { type: mimeType });
}

el('discard-btn').addEventListener('click', () => {
  if (state.currentScan && state.currentScan.blobUrl) {
    URL.revokeObjectURL(state.currentScan.blobUrl);
  }
  state.currentScan = null;
  el('review-panel').hidden = true;
});

// ---- Save to Google Drive ---------------------------------------------------

el('save-btn').addEventListener('click', saveToDrive);

async function ensureSignedIn() {
  if (state.accessToken) return true;
  return new Promise((resolve) => {
    if (!state.tokenClient) {
      resolve(false);
      return;
    }
    const original = state.tokenClient.callback;
    state.tokenClient.callback = (resp) => {
      state.tokenClient.callback = original;
      if (resp.error) {
        resolve(false);
        return;
      }
      state.accessToken = resp.access_token;
      onSignedIn();
      resolve(true);
    };
    state.tokenClient.requestAccessToken({ prompt: 'consent' });
  });
}

async function driveFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${state.accessToken}`,
    },
  });
  if (res.status === 401) {
    throw new Error('Google Drive session expired. Please sign in again and retry.');
  }
  return res;
}

async function getOrCreateFolder() {
  if (state.driveFolderId) return state.driveFolderId;

  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`
  );
  const searchRes = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)`
  );
  const searchData = await searchRes.json();
  if (searchData.files && searchData.files.length > 0) {
    state.driveFolderId = searchData.files[0].id;
    return state.driveFolderId;
  }

  const createRes = await driveFetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' }),
  });
  const createData = await createRes.json();
  state.driveFolderId = createData.id;
  return state.driveFolderId;
}

async function findExistingFile(folderId, filename) {
  const q = encodeURIComponent(`name='${filename}' and '${folderId}' in parents and trashed=false`);
  const res = await driveFetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,webViewLink)`
  );
  const data = await res.json();
  return data.files && data.files[0];
}

function buildMultipartBody(metadata, blob, boundary) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      const contentBytes = new Uint8Array(reader.result);
      const encoder = new TextEncoder();
      const preamble = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
          metadata
        )}\r\n--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`
      );
      const closing = encoder.encode(`\r\n--${boundary}--`);
      const body = new Uint8Array(preamble.length + contentBytes.length + closing.length);
      body.set(preamble, 0);
      body.set(contentBytes, preamble.length);
      body.set(closing, preamble.length + contentBytes.length);
      resolve(body);
    };
    reader.readAsArrayBuffer(blob);
  });
}

async function createFile(folderId, filename, blob) {
  const boundary = 'pos_recon_boundary_' + Math.random().toString(36).slice(2);
  const metadata = { name: filename, parents: [folderId], mimeType: 'application/pdf' };
  const body = await buildMultipartBody(metadata, blob, boundary);

  const res = await driveFetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );
  if (!res.ok) throw new Error('Drive upload failed: ' + (await res.text()));
  return res.json();
}

async function updateFile(fileId, blob) {
  const res = await driveFetch(
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,webViewLink`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/pdf' },
      body: blob,
    }
  );
  if (!res.ok) throw new Error('Drive update failed: ' + (await res.text()));
  return res.json();
}

async function saveToDrive() {
  if (!state.currentScan) return;
  const signedIn = await ensureSignedIn();
  if (!signedIn) {
    el('save-status').textContent = 'Please sign in with Google first.';
    return;
  }

  const filename = el('field-filename').value.trim();
  if (!filename) {
    el('save-status').textContent = 'Please enter a file name.';
    return;
  }

  el('save-btn').disabled = true;
  el('save-status').textContent = 'Saving to Google Drive...';

  try {
    const folderId = await getOrCreateFolder();
    const existing = await findExistingFile(folderId, filename);

    let result;
    let action;
    if (existing) {
      result = await updateFile(existing.id, state.currentScan.pdfBlob);
      action = 'Updated existing file';
    } else {
      result = await createFile(folderId, filename, state.currentScan.pdfBlob);
      action = 'Saved';
    }

    const link = result.webViewLink || `https://drive.google.com/file/d/${result.id}/view`;
    el('save-status').textContent = `${action}: ${filename}`;
    saveHistoryEntry({ filename, link, savedAt: new Date().toISOString() });

    URL.revokeObjectURL(state.currentScan.blobUrl);
    state.currentScan = null;
    setTimeout(() => {
      el('review-panel').hidden = true;
    }, 1200);
  } catch (err) {
    el('save-status').textContent = 'Error: ' + err.message;
  } finally {
    el('save-btn').disabled = false;
  }
}

// ---- Init -------------------------------------------------------------------

showConfigWarningIfNeeded();
initGoogleAuth();
renderHistory();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

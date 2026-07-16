const pdfjs = window.pdfjsLib;
const titleEl = document.getElementById("title");
const statusEl = document.getElementById("status");
const canvasEl = document.getElementById("pageCanvas");
const ctx = canvasEl.getContext("2d");

const PDF_DB_NAME = "pdfListeningLibraryDb";
const PDF_DB_VERSION = 2;
const PDF_STORE_NAME = "documents";

let pdfDoc = null;
let currentRenderTask = null;

if (pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "vendor/pdfjs/pdf.worker.min.js"
  );
}

function getPdfId() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("pdfId") || "").trim();
}

function getPdfName() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("name") || "").trim() || "PDF Preview";
}

function getPageFromHash() {
  const hash = String(window.location.hash || "");
  const match = hash.match(/page=(\d+)/i);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

function openPdfLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
  });
}

async function getPdfDocument(id) {
  const db = await openPdfLibraryDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(PDF_STORE_NAME, "readonly");
      const request = tx.objectStore(PDF_STORE_NAME).get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed."));
    });
  } finally {
    db.close();
  }
}

function setStatus(message) {
  statusEl.textContent = message;
}

async function renderPage(pageNumber) {
  if (!pdfDoc) {
    return;
  }
  const safePage = Math.max(1, Math.min(pdfDoc.numPages, Number(pageNumber) || 1));
  if (currentRenderTask) {
    try {
      currentRenderTask.cancel();
    } catch (_error) {
      // Ignore stale render cancellation failures.
    }
  }

  const page = await pdfDoc.getPage(safePage);
  const viewport = page.getViewport({ scale: 1.45 });
  canvasEl.width = viewport.width;
  canvasEl.height = viewport.height;
  currentRenderTask = page.render({
    canvasContext: ctx,
    viewport,
  });
  await currentRenderTask.promise;
  currentRenderTask = null;
  setStatus(`Page ${safePage} of ${pdfDoc.numPages}`);
}

async function loadPreview() {
  const pdfId = getPdfId();
  if (!pdfId) {
    setStatus("Missing PDF id.");
    return;
  }

  titleEl.textContent = getPdfName();
  const record = await getPdfDocument(pdfId);
  if (!record?.buffer) {
    setStatus("This PDF is no longer available locally.");
    return;
  }

  pdfDoc = await pdfjs.getDocument({ data: record.buffer }).promise;
  await renderPage(getPageFromHash());
}

window.addEventListener("hashchange", () => {
  if (pdfDoc) {
    void renderPage(getPageFromHash());
  }
});

void loadPreview().catch((error) => {
  setStatus(error?.message || "Unable to open PDF preview.");
});

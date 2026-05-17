const pdfjs = window.pdfjsLib;
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const fileNameLabelEl = document.getElementById("fileNameLabel");
const heroTitleEl = document.getElementById("heroTitle");
const resumeSectionEl = document.getElementById("resumeSection");
const resumeMetaEl = document.getElementById("resumeMeta");
const resumePlaybackBtn = document.getElementById("resumePlayback");
const bookmarksSectionEl = document.getElementById("bookmarksSection");
const bookmarkListEl = document.getElementById("bookmarkList");
const bookmarkContentEl = document.getElementById("bookmarkContent");
const toggleBookmarksBtn = document.getElementById("toggleBookmarks");
const addBookmarkBtn = document.getElementById("addBookmark");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const speedSelect = document.getElementById("speed");
const startPageInput = document.getElementById("startPage");
const startFromPageBtn = document.getElementById("startFromPage");
const openFileBtn = document.getElementById("openFile");
const replaceFileBtn = document.getElementById("replaceFile");
const fileInput = document.getElementById("fileInput");
const paywallStatusEl = document.getElementById("paywallStatus");
const continueCheckoutMonthlyBtn = document.getElementById("continueCheckoutMonthly");
const continueCheckoutAnnualBtn = document.getElementById("continueCheckoutAnnual");
const accountActionBtn = document.getElementById("accountAction");
const authMessageEl = document.getElementById("authMessage");
const authCopyEl = document.getElementById("authCopy");
const authGoogleBtn = document.getElementById("authGoogle");
const authPanelEl = document.getElementById("authPanel");
const profileTriggerBtn = document.getElementById("profileTrigger");
const closeDrawerBtn = document.getElementById("closeDrawer");
const drawerBackdropEl = document.getElementById("drawerBackdrop");
const drawerPlanNameEl = document.getElementById("drawerPlanName");
const drawerPlanMetaEl = document.getElementById("drawerPlanMeta");
const drawerTrialNoticeEl = document.getElementById("drawerTrialNotice");
const drawerEmailEl = document.getElementById("drawerEmail");
const drawerUpgradeBtn = document.getElementById("drawerUpgrade");
const authToastEl = document.getElementById("authToast");
const authOverlayEl = document.getElementById("authOverlay");
const readerScreenEl = document.getElementById("readerScreen");
const paywallScreenEl = document.getElementById("paywallScreen");
const backToReaderBtn = document.getElementById("backToReader");
const readerControlsEl = document.getElementById("readerControls");
const REMOTE_API_BASE_URL = "https://pdftext2speech.com";
const DEVICE_TOKEN_KEY = "deviceToken";
const TRIAL_STATE_KEY = "trialState";
const PDF_LIBRARY_KEY = "pdfListeningLibrary";
const ANALYTICS_SESSION_ID =
  `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
const PDF_DB_NAME = "pdfListeningLibraryDb";
const PDF_DB_VERSION = 2;
const PDF_STORE_NAME = "documents";
const AUDIO_CACHE_STORE_NAME = "audioCache";
const MAX_RECENT_PDFS = 5;
const MAX_BOOKMARKS_PER_PDF = 10;
const MAX_AUDIO_CACHE_ENTRIES = 80;

const state = {
  status: "idle",
  message: "Open a PDF in Chrome and start playback in the side panel.",
  speed: 1,
  fileName: "",
  totalPages: 0,
  totalChunks: 0,
  currentChunk: 0,
  language: "",
};

let textChunks = [];
let currentChunkIndex = 0;
let detectedLanguage = "";
let currentAudio = null;
let currentAudioUrl = "";
let playbackToken = 0;
let paywallStopTimer = null;
let playbackUiTimer = null;
let playbackUsageFlushTimer = null;
let currentAudioBaseSpeed = 1;
let prefetchedChunk = null;
let prefetchPromise = null;
let prefetchedChunkIndex = -1;
let prefetchedChunkSpeed = null;
let lastKnownRemainingSeconds = null;
let sessionRemainingSeconds = null;
let pendingUsageSeconds = 0;
let lastActivePlaybackTickMs = 0;
let currentFileBuffer = null;
let isPreparingText = false;
let preparationComplete = false;
let pendingStartPlayback = false;
let currentSubscription = { active: false, plan: null };
let authState = { signedIn: false, email: "", method: null };
let minFreePlaybackStartSeconds = 0;
let activeScreen = "reader";
let isAuthenticating = false;
let preAuthRemainingSeconds = null;
let trialAdjustedAfterSignIn = false;
let authSuccessToastTimer = null;
let authPollingTimer = null;
let currentPdfPreviewUrl = "";
let currentPdfId = "";
let libraryState = createEmptyLibraryState();
let isBookmarksExpanded = false;
let authReturnScreen = "drawer";
let activePreparationRunId = 0;
let extensionOpenedTracked = false;
let pageStartChunkMap = [];
let pendingStartPage = null;
const pendingAudioRequests = new Map();

const INITIAL_PREPARED_PAGES = 1;
const FIRST_CHUNK_MAX_LENGTH = 80;
const DEFAULT_CHUNK_MAX_LENGTH = 1100;

const PLAN_META = {
  monthly: {
    label: "Monthly",
    buttonText: "Unlock",
    price: "$0.33",
    unit: "/day",
    billingNote: "Billed monthly $9.99 / month",
    badge: "",
    planSummary: "Monthly Listening",
    planMeta: "$9.99 billed every month for unlimited listening.",
  },
  annual: {
    label: "Annual",
    buttonText: "Unlock",
    price: "$0.25",
    unit: "/day",
    billingNote: "Billed annually $89.99 / year",
    badge: "Best Value",
    planSummary: "Annual Listening",
    planMeta: "$89.99 billed yearly for unlimited listening.",
  },
};

const STATUS_LABELS = {
  idle: "Ready",
  loading: "Preparing",
  reading: "Playing",
  paused: "Paused",
  finished: "Finished",
  error: "Needs attention",
};

function createEmptyLibraryState() {
  return {
    recent: [],
    resumes: {},
    bookmarks: {},
  };
}

function createPdfIdFromMeta({ name = "", size = 0, lastModified = 0 } = {}) {
  const safeName = String(name || "pdf")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "pdf";
  return `${safeName}_${Number(size) || 0}_${Number(lastModified) || 0}`;
}

function openPdfLibraryDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(PDF_STORE_NAME)) {
        db.createObjectStore(PDF_STORE_NAME, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(AUDIO_CACHE_STORE_NAME)) {
        const audioStore = db.createObjectStore(AUDIO_CACHE_STORE_NAME, { keyPath: "key" });
        audioStore.createIndex("updatedAt", "updatedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed."));
  });
}

async function savePdfDocument(record) {
  const db = await openPdfLibraryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readwrite");
    tx.objectStore(PDF_STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB save failed."));
  });
  db.close();
}

async function getPdfDocument(id) {
  const db = await openPdfLibraryDb();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readonly");
    const request = tx.objectStore(PDF_STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("IndexedDB read failed."));
  });
  db.close();
  return result;
}

async function deletePdfDocument(id) {
  const db = await openPdfLibraryDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(PDF_STORE_NAME, "readwrite");
    tx.objectStore(PDF_STORE_NAME).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed."));
  });
  db.close();
}

function computeTextHash(text) {
  let hash = 2166136261;
  const normalized = String(text || "");
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function getAudioCacheKey(text, speed = state.speed, language = detectedLanguage) {
  const normalizedLanguage = (language || "unknown").toLowerCase();
  const normalizedSpeed = String(getEffectiveSpeed(speed));
  return `${normalizedLanguage}:${normalizedSpeed}:${computeTextHash(text)}`;
}

async function getCachedAudioPayload(key) {
  const db = await openPdfLibraryDb();
  try {
    const record = await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_CACHE_STORE_NAME, "readonly");
      const request = tx.objectStore(AUDIO_CACHE_STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error || new Error("IndexedDB audio read failed."));
    });
    if (!record?.bytes?.length) {
      return null;
    }
    return {
      bytes: record.bytes,
      mimeType: record.mimeType || "audio/mpeg",
    };
  } finally {
    db.close();
  }
}

async function pruneAudioCache(db) {
  const records = await new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_CACHE_STORE_NAME, "readonly");
    const request = tx.objectStore(AUDIO_CACHE_STORE_NAME).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error("IndexedDB audio prune read failed."));
  });
  if (records.length <= MAX_AUDIO_CACHE_ENTRIES) {
    return;
  }
  const staleRecords = records
    .slice()
    .sort((a, b) => Number(a.updatedAt || 0) - Number(b.updatedAt || 0))
    .slice(0, records.length - MAX_AUDIO_CACHE_ENTRIES);
  await new Promise((resolve, reject) => {
    const tx = db.transaction(AUDIO_CACHE_STORE_NAME, "readwrite");
    const store = tx.objectStore(AUDIO_CACHE_STORE_NAME);
    staleRecords.forEach((record) => store.delete(record.key));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB audio prune failed."));
  });
}

async function saveCachedAudioPayload(key, payload) {
  if (!Array.isArray(payload?.bytes) || !payload.bytes.length) {
    return;
  }
  const db = await openPdfLibraryDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(AUDIO_CACHE_STORE_NAME, "readwrite");
      tx.objectStore(AUDIO_CACHE_STORE_NAME).put({
        key,
        bytes: payload.bytes,
        mimeType: payload.mimeType || "audio/mpeg",
        updatedAt: Date.now(),
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB audio save failed."));
    });
    await pruneAudioCache(db);
  } finally {
    db.close();
  }
}

if (pdfjs?.GlobalWorkerOptions) {
  pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL(
    "vendor/pdfjs/pdf.worker.min.js"
  );
}

function setStatus(status, message = "") {
  state.status = status;
  state.message = message;
  updateUI();
}

function getFriendlyRuntimeMessage(error, fallback = "Something went wrong.") {
  const raw = error && error.message ? String(error.message) : "";
  const normalized = raw.toLowerCase();
  if (!normalized) {
    return fallback;
  }
  if (
    normalized.includes("504") ||
    normalized.includes("gateway time-out") ||
    normalized.includes("gateway timeout") ||
    normalized.includes("timed out")
  ) {
    return "Audio is taking longer than usual. Please try again in a moment.";
  }
  if (
    normalized.includes("503") ||
    normalized.includes("502") ||
    normalized.includes("bad gateway") ||
    normalized.includes("service unavailable")
  ) {
    return "Audio is temporarily unavailable. Please try again in a moment.";
  }
  if (normalized.includes("<html")) {
    return fallback;
  }
  return raw;
}

function setActiveScreen(screen) {
  activeScreen = screen === "paywall" ? "paywall" : "reader";
  const showingPaywall = activeScreen === "paywall";
  readerScreenEl.classList.toggle("hidden", showingPaywall);
  paywallScreenEl.classList.toggle("hidden", !showingPaywall);
  backToReaderBtn.classList.toggle("hidden", !showingPaywall);
}

function openDrawer() {
  document.body.classList.add("drawer-open");
  drawerBackdropEl.classList.remove("hidden");
}

function closeDrawer() {
  document.body.classList.remove("drawer-open");
  drawerBackdropEl.classList.add("hidden");
}

function setAuthenticating(nextValue) {
  isAuthenticating = Boolean(nextValue);
  authOverlayEl.classList.toggle("hidden", !isAuthenticating);
  if (authPollingTimer) {
    clearInterval(authPollingTimer);
    authPollingTimer = null;
  }
  if (isAuthenticating) {
    authPollingTimer = setInterval(() => {
      void loadAuthState();
    }, 1500);
  }
}

function showAuthSuccessToast() {
  if (authSuccessToastTimer) {
    clearTimeout(authSuccessToastTimer);
    authSuccessToastTimer = null;
  }
  authToastEl.textContent = "Successfully signed in with Google.";
  authToastEl.classList.remove("hidden");
  authSuccessToastTimer = setTimeout(() => {
    authToastEl.classList.add("hidden");
    authSuccessToastTimer = null;
  }, 3200);
}

function getPlanPresentation() {
  if (currentSubscription?.active) {
    const activePlanId = currentSubscription?.plan?.planId || "";
    const activePlanMeta = PLAN_META[activePlanId] || {};
    return {
      name: activePlanMeta.planSummary || "Unlimited Listening",
      meta: activePlanMeta.planMeta || "Unlimited listening is active on this account.",
    };
  }

  return {
    name: "Free Listening",
    meta:
      getLiveRemainingSeconds() > 0
        ? `${formatRemainingSeconds(getLiveRemainingSeconds())} of free listening left today.`
        : hasKnownTrialRemaining()
        ? "Free listening resets tomorrow."
        : "Checking today's listening access...",
  };
}

function updateUI() {
  document.body.dataset.status = state.status;
  statusEl.textContent = STATUS_LABELS[state.status] || "Ready";
  statusEl.classList.toggle("hidden", state.status === "idle" || state.status === "finished");
  hintEl.textContent = state.message || " ";
  heroTitleEl.closest(".hero-card")?.classList.toggle("is-compact", Boolean(currentFileBuffer));
  const isLoading = state.status === "loading";
  const trialExhausted =
    !currentSubscription?.active && hasKnownTrialRemaining() && getLiveRemainingSeconds() <= 0;
  readerControlsEl.classList.toggle("hidden", !currentFileBuffer);
  openFileBtn.classList.toggle("hidden", Boolean(currentFileBuffer));
  playBtn.disabled = !currentFileBuffer || isLoading;
  if (isLoading) {
    playBtn.textContent = "Preparing audio...";
  } else if (state.status === "reading") {
    playBtn.textContent = "Pause";
  } else if (state.status === "paused") {
    playBtn.textContent = "Resume";
  } else {
    playBtn.textContent = "Start Listening";
  }
  playBtn.classList.toggle("is-loading", isLoading);
  playBtn.setAttribute("aria-busy", isLoading ? "true" : "false");
  if (pauseBtn) {
    pauseBtn.disabled = !(state.status === "reading" || state.status === "paused");
  }
  if (stopBtn) {
    stopBtn.disabled = !(state.status === "reading" || state.status === "paused");
  }
  speedSelect.disabled = isLoading;
  if (startPageInput) {
    startPageInput.max = state.totalPages ? String(state.totalPages) : "";
    if (!startPageInput.value && state.totalPages > 0) {
      startPageInput.value = "1";
    }
    startPageInput.disabled = !currentFileBuffer;
  }
  if (startFromPageBtn) {
    startFromPageBtn.disabled = !currentFileBuffer || isLoading;
  }
  const activePlanId = currentSubscription?.plan?.planId || "";
  if (continueCheckoutMonthlyBtn) {
    const isCurrentMonthly = currentSubscription?.active && activePlanId === "monthly";
    continueCheckoutMonthlyBtn.textContent = isCurrentMonthly
      ? "Current monthly plan"
      : authState.signedIn
      ? "Unlock monthly"
      : "Sign in to unlock";
    continueCheckoutMonthlyBtn.disabled = isCurrentMonthly;
  }
  if (continueCheckoutAnnualBtn) {
    const isCurrentAnnual = currentSubscription?.active && activePlanId === "annual";
    continueCheckoutAnnualBtn.textContent = isCurrentAnnual
      ? "Current yearly plan"
      : authState.signedIn
      ? "Unlock yearly"
      : "Sign in to unlock";
    continueCheckoutAnnualBtn.disabled = isCurrentAnnual;
  }
  fileNameLabelEl.textContent = state.fileName || "No file selected";
  heroTitleEl.textContent = getHeroTitle();
  const planPresentation = getPlanPresentation();
  drawerPlanNameEl.textContent = planPresentation.name;
  drawerPlanMetaEl.textContent = planPresentation.meta;
  drawerTrialNoticeEl?.classList.toggle("hidden", !trialAdjustedAfterSignIn);
  drawerEmailEl.textContent = authState.signedIn ? authState.email : "Guest mode";
  accountActionBtn.textContent = authState.signedIn ? "Sign out" : "Sign in with Google";
  drawerUpgradeBtn.classList.toggle("hidden", currentSubscription?.active);
  if (!currentFileBuffer && !trialExhausted) {
    state.message = "Open a PDF in Chrome and start playback in the side panel.";
    hintEl.textContent = state.message;
  }
  updateLibraryUI();
}

function getHeroTitle() {
  if (!currentFileBuffer) {
    return "Ready to Listen";
  }
  if (state.status === "reading") {
    return "Listening";
  }
  if (state.status === "paused") {
    return "Paused";
  }
  if (state.status === "finished") {
    return "Finished";
  }
  return "Current PDF ready";
}

function getLiveRemainingSeconds() {
  if (Number.isFinite(sessionRemainingSeconds)) {
    return Math.max(0, sessionRemainingSeconds);
  }
  if (Number.isFinite(lastKnownRemainingSeconds)) {
    return Math.max(0, lastKnownRemainingSeconds);
  }
  return 0;
}

function hasKnownTrialRemaining() {
  return Number.isFinite(sessionRemainingSeconds) || Number.isFinite(lastKnownRemainingSeconds);
}

function updateReadingStatus() {
  setStatus(
    "reading",
    state.fileName
      ? `Listening to ${state.fileName}`
      : "Listening"
  );
}

function stopPlaybackUiTimer() {
  if (playbackUiTimer) {
    clearInterval(playbackUiTimer);
    playbackUiTimer = null;
  }
}

function stopPlaybackUsageFlushTimer() {
  if (playbackUsageFlushTimer) {
    clearInterval(playbackUsageFlushTimer);
    playbackUsageFlushTimer = null;
  }
}

function isAudioActivelyPlaying() {
  return Boolean(
    currentAudio &&
      !currentAudio.paused &&
      !currentAudio.ended &&
      currentAudio.readyState >= 2
  );
}

function resetPlaybackTracking() {
  pendingUsageSeconds = 0;
  lastActivePlaybackTickMs = 0;
}

function captureActivePlaybackDelta() {
  const now = Date.now();
  if (!lastActivePlaybackTickMs) {
    lastActivePlaybackTickMs = now;
    return 0;
  }

  if (!isAudioActivelyPlaying()) {
    lastActivePlaybackTickMs = now;
    return 0;
  }

  const elapsedSeconds = Math.max(0, (now - lastActivePlaybackTickMs) / 1000);
  lastActivePlaybackTickMs = now;
  if (elapsedSeconds <= 0) {
    return 0;
  }

  pendingUsageSeconds += elapsedSeconds;
  if (Number.isFinite(sessionRemainingSeconds)) {
    sessionRemainingSeconds = Math.max(0, sessionRemainingSeconds - elapsedSeconds);
    lastKnownRemainingSeconds = Math.max(0, sessionRemainingSeconds);
    void persistLocalTrialFloor(sessionRemainingSeconds);
  }
  return elapsedSeconds;
}

function startPlaybackUiTimer() {
  stopPlaybackUiTimer();
  playbackUiTimer = setInterval(() => {
    if (state.status !== "reading") {
      stopPlaybackUiTimer();
      return;
    }
    captureActivePlaybackDelta();
    if (Number.isFinite(sessionRemainingSeconds) && sessionRemainingSeconds <= 0) {
      stopPlaybackUiTimer();
      const tokenAtStart = playbackToken;
      cleanupCurrentAudio();
      void exhaustPlaybackQuota(tokenAtStart).finally(() => {
        if (tokenAtStart !== playbackToken) {
          return;
        }
        playbackToken += 1;
        resetSessionQuotaTracking();
        showPaywallLimitReached();
      });
      return;
    }
    updateReadingStatus();
  }, 1000);
}

function startPlaybackUsageFlushTimer() {
  stopPlaybackUsageFlushTimer();
  playbackUsageFlushTimer = setInterval(() => {
    if (state.status !== "reading") {
      stopPlaybackUsageFlushTimer();
      return;
    }
    const tokenAtStart = playbackToken;
    captureActivePlaybackDelta();
    commitPlaybackUsage()
      .then((usage) => {
        if (tokenAtStart !== playbackToken || state.status !== "reading") {
          return;
        }
        if (usage && Number(usage.remainingSeconds) <= 0) {
          playbackToken += 1;
          cleanupCurrentAudio();
          resetSessionQuotaTracking();
          showPaywallLimitReached();
          return;
        }
        lastActivePlaybackTickMs = Date.now();
      })
      .catch(() => {
        if (tokenAtStart !== playbackToken || state.status !== "reading") {
          return;
        }
        lastActivePlaybackTickMs = Date.now();
      });
  }, 5000);
}

function cleanupCurrentAudio() {
  if (paywallStopTimer) {
    clearTimeout(paywallStopTimer);
    paywallStopTimer = null;
  }
  stopPlaybackUiTimer();
  stopPlaybackUsageFlushTimer();
  resetPlaybackTracking();
  currentAudioBaseSpeed = 1;
  if (currentAudio) {
    currentAudio.onended = null;
    currentAudio.onerror = null;
    currentAudio.pause();
    currentAudio.src = "";
    currentAudio.load();
    currentAudio = null;
  }
  if (currentAudioUrl) {
    URL.revokeObjectURL(currentAudioUrl);
    currentAudioUrl = "";
  }
}

function clearPrefetch() {
  prefetchedChunk = null;
  prefetchPromise = null;
  prefetchedChunkIndex = -1;
  prefetchedChunkSpeed = null;
}

function resetSessionQuotaTracking() {
  sessionRemainingSeconds = null;
}

function schedulePaywallStop(token, remainingSeconds) {
  if (paywallStopTimer) {
    clearTimeout(paywallStopTimer);
    paywallStopTimer = null;
  }
}

function resetPreparedText() {
  cleanupCurrentAudio();
  clearPrefetch();
  textChunks = [];
  pageStartChunkMap = [];
  pendingStartPage = null;
  currentChunkIndex = 0;
  detectedLanguage = "";
  currentPdfId = "";
  isPreparingText = false;
  preparationComplete = false;
  pendingStartPlayback = false;
  state.totalPages = 0;
  state.totalChunks = 0;
  state.currentChunk = 0;
  state.language = "";
}

function normalizeText(text) {
  return text.replace(/\s+/g, " ").trim();
}

function shouldIgnorePdfLine(line) {
  const normalized = normalizeText(line);
  if (!normalized) {
    return true;
  }
  if (/^\d{1,4}$/.test(normalized)) {
    return true;
  }
  if (/^page\s+\d+$/i.test(normalized)) {
    return true;
  }
  if (/^[\W_]+$/.test(normalized)) {
    return true;
  }
  if (normalized.length <= 1) {
    return true;
  }
  return false;
}

function cleanPdfLines(lines) {
  const normalizedLines = lines.map((line) => normalizeText(line)).filter(Boolean);
  if (!normalizedLines.length) {
    return [];
  }

  const deduped = normalizedLines.filter((line, index) => line !== normalizedLines[index - 1]);
  return deduped.filter((line) => !shouldIgnorePdfLine(line));
}

function splitIntoSentences(text) {
  const matches = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g);
  return matches ? matches.map((sentence) => sentence.trim()).filter(Boolean) : [];
}

function splitLongUnit(unit, maxLength) {
  const normalized = normalizeText(unit);
  if (!normalized) {
    return [];
  }
  if (normalized.length <= maxLength) {
    return [normalized];
  }

  const words = normalized.split(" ");
  const parts = [];
  let current = "";

  words.forEach((word) => {
    if (!word) {
      return;
    }
    if (word.length > maxLength) {
      if (current) {
        parts.push(current.trim());
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        parts.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength) {
      parts.push(current.trim());
      current = word;
      return;
    }

    current = candidate;
  });

  if (current) {
    parts.push(current.trim());
  }

  return parts;
}

function buildChunks(pages, options = {}) {
  const chunks = [];
  const useSmallFirstChunk = Boolean(options.useSmallFirstChunk);

  function pushChunk(value) {
    const normalizedValue = String(value || "").trim();
    if (!normalizedValue) {
      return;
    }
    chunks.push(normalizedValue);
  }

  pages.forEach((pageText) => {
    const normalized = normalizeText(pageText);
    if (!normalized) {
      return;
    }

    const parts = splitIntoSentences(normalized);
    const firstLimit =
      useSmallFirstChunk && chunks.length === 0
        ? FIRST_CHUNK_MAX_LENGTH
        : DEFAULT_CHUNK_MAX_LENGTH;
    const units = (parts.length ? parts : [normalized]).flatMap((unit, index) =>
      splitLongUnit(
        unit,
        useSmallFirstChunk && chunks.length === 0 && index === 0
          ? firstLimit
          : DEFAULT_CHUNK_MAX_LENGTH
      )
    );
    let current = "";

    units.forEach((unit) => {
      const maxLength =
        useSmallFirstChunk && chunks.length === 0 && !current
          ? FIRST_CHUNK_MAX_LENGTH
          : DEFAULT_CHUNK_MAX_LENGTH;
      const candidate = current ? `${current} ${unit}` : unit;
      if (candidate.length > maxLength) {
        if (current) {
          pushChunk(current);
          current = unit;
        } else {
          pushChunk(unit);
          current = "";
        }
      } else {
        current = candidate;
      }
    });

    if (current) {
      pushChunk(current);
    }
  });

  return chunks;
}

function detectLanguageFromText(text) {
  return new Promise((resolve) => {
    if (!chrome?.i18n?.detectLanguage) {
      resolve("");
      return;
    }

    chrome.i18n.detectLanguage(text, (result) => {
      if (chrome.runtime.lastError || !result?.languages?.length) {
        resolve("");
        return;
      }

      const best = result.languages
        .slice()
        .sort((a, b) => b.percentage - a.percentage)[0];
      resolve(best?.language || "");
    });
  });
}

function getPlaybackQuota() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "getPlaybackQuota" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to read playback quota."));
        return;
      }
      resolve(response);
    });
  });
}

function addPlaybackUsage(seconds) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "addPlaybackUsage", seconds }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Unable to save playback usage."));
        return;
      }
      resolve(response);
    });
  });
}

async function requestTtsBytes(text, speed = state.speed) {
  const cacheKey = getAudioCacheKey(text, speed, detectedLanguage);
  const cachedPayload = await getCachedAudioPayload(cacheKey).catch(() => null);
  if (cachedPayload) {
    return cachedPayload;
  }

  if (pendingAudioRequests.has(cacheKey)) {
    return pendingAudioRequests.get(cacheKey);
  }

  const requestPromise = new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "synthesizeSpeech",
        text,
        speed: getEffectiveSpeed(speed),
        language: detectedLanguage,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response?.ok || !Array.isArray(response.bytes)) {
          reject(new Error(response?.error || "TTS request failed."));
          return;
        }
        resolve({
          bytes: response.bytes,
          mimeType: response.mimeType || "audio/mpeg",
        });
      }
    );
  })
    .then(async (payload) => {
      void saveCachedAudioPayload(cacheKey, payload).catch(() => null);
      return payload;
    })
    .finally(() => {
      pendingAudioRequests.delete(cacheKey);
    });

  pendingAudioRequests.set(cacheKey, requestPromise);
  return requestPromise;
}

async function prefetchNextChunk(nextIndex, token) {
  if (token !== playbackToken || nextIndex >= textChunks.length) {
    return;
  }
  if (
    prefetchedChunk &&
    prefetchedChunk.index === nextIndex &&
    prefetchedChunk.speed === state.speed
  ) {
    return;
  }
  if (prefetchPromise) {
    return prefetchPromise;
  }

  const chunkText = textChunks[nextIndex];
  const requestedSpeed = state.speed;
  prefetchedChunkIndex = nextIndex;
  prefetchedChunkSpeed = requestedSpeed;
  prefetchPromise = requestTtsBytes(chunkText, requestedSpeed)
    .then((payload) => {
      if (token !== playbackToken) {
        return;
      }
      prefetchedChunk = {
        index: nextIndex,
        speed: requestedSpeed,
        payload,
      };
    })
    .catch(() => null)
    .finally(() => {
      prefetchPromise = null;
      if (!prefetchedChunk || prefetchedChunk.index !== prefetchedChunkIndex) {
        prefetchedChunkIndex = -1;
        prefetchedChunkSpeed = null;
      }
    });

  return prefetchPromise;
}

async function resolveChunkPayload(chunkIndex, token) {
  currentAudioBaseSpeed = getEffectiveSpeed(state.speed);

  if (
    prefetchedChunk &&
    prefetchedChunk.index === chunkIndex &&
    prefetchedChunk.speed === state.speed
  ) {
    const payload = prefetchedChunk.payload;
    prefetchedChunk = null;
    prefetchedChunkIndex = -1;
    prefetchedChunkSpeed = null;
    return payload;
  }

  if (
    prefetchPromise &&
    prefetchedChunkIndex === chunkIndex &&
    prefetchedChunkSpeed === state.speed
  ) {
    await prefetchPromise;
    if (
      token === playbackToken &&
      prefetchedChunk &&
      prefetchedChunk.index === chunkIndex &&
      prefetchedChunk.speed === state.speed
    ) {
      const payload = prefetchedChunk.payload;
      prefetchedChunk = null;
      prefetchedChunkIndex = -1;
      prefetchedChunkSpeed = null;
      return payload;
    }
  }

  return requestTtsBytes(textChunks[chunkIndex]);
}

function commitPlaybackUsageInBackground(token) {
  void commitPlaybackUsage()
    .then((usage) => {
      if (token !== playbackToken || state.status !== "reading") {
        return;
      }
      if (usage && Number(usage.remainingSeconds) <= 0) {
        playbackToken += 1;
        cleanupCurrentAudio();
        lastKnownRemainingSeconds = 0;
        sessionRemainingSeconds = 0;
        resetSessionQuotaTracking();
        showPaywallLimitReached();
      }
    })
    .catch(() => null);
}

function sendRuntimeMessage(message) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response?.ok) {
        reject(new Error(response?.error || "Request failed."));
        return;
      }
      resolve(response);
    });
  });
}

function trackAnalyticsEvent(name, params = {}) {
  return sendRuntimeMessage({
    type: "trackAnalyticsEvent",
    name,
    params,
    sessionId: ANALYTICS_SESSION_ID,
  }).catch(() => null);
}

function readLocalStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result || {}));
  });
}

function getActiveTabUrl() {
  return new Promise((resolve) => {
    if (!chrome?.tabs?.query) {
      resolve("");
      return;
    }

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        resolve("");
        return;
      }

      const currentUrl = typeof tabs?.[0]?.url === "string" ? tabs[0].url.trim() : "";
      if (!currentUrl) {
        resolve("");
        return;
      }

      const allowedProtocols = ["http:", "https:", "file:"];
      try {
        const parsed = new URL(currentUrl);
        resolve(allowedProtocols.includes(parsed.protocol) ? currentUrl : "");
      } catch (_error) {
        resolve("");
      }
    });
  });
}

function writeLocalStorage(payload) {
  return new Promise((resolve) => {
    chrome.storage.local.set(payload, () => resolve());
  });
}

async function loadLibraryState() {
  const result = await readLocalStorage([PDF_LIBRARY_KEY]);
  const nextState = result?.[PDF_LIBRARY_KEY];
  libraryState = {
    ...createEmptyLibraryState(),
    ...(nextState && typeof nextState === "object" ? nextState : {}),
  };
  if (!Array.isArray(libraryState.recent)) {
    libraryState.recent = [];
  }
  if (!libraryState.resumes || typeof libraryState.resumes !== "object") {
    libraryState.resumes = {};
  }
  if (!libraryState.bookmarks || typeof libraryState.bookmarks !== "object") {
    libraryState.bookmarks = {};
  }
  updateLibraryUI();
}

async function persistLibraryState(options = {}) {
  const { skipUi = false } = options;
  await writeLocalStorage({ [PDF_LIBRARY_KEY]: libraryState });
  if (!skipUi) {
    updateLibraryUI();
  }
}

function getCurrentResume() {
  if (!currentPdfId) {
    return null;
  }
  return libraryState.resumes?.[currentPdfId] || null;
}

function getLatestResumeEntry() {
  const recentItems = Array.isArray(libraryState.recent) ? libraryState.recent : [];
  for (const entry of recentItems) {
    const resume = libraryState.resumes?.[entry.id];
    if (
      resume &&
      Number.isFinite(resume.chunkIndex) &&
      resume.chunkIndex > 0 &&
      (!Number.isFinite(resume.totalChunks) || resume.chunkIndex < resume.totalChunks)
    ) {
      return {
        id: entry.id,
        name: entry.name,
        resume,
      };
    }
  }
  return null;
}

function getCurrentBookmarks() {
  if (!currentPdfId) {
    return [];
  }
  return Array.isArray(libraryState.bookmarks?.[currentPdfId])
    ? libraryState.bookmarks[currentPdfId]
    : [];
}

function formatChunkLabel(chunkIndex, totalChunks = state.totalChunks) {
  const safeTotal = Math.max(0, Number(totalChunks) || 0);
  const safeChunk = Math.max(0, Number(chunkIndex) || 0);
  if (!safeTotal) {
    return "Ready to start";
  }
  if (safeChunk >= safeTotal) {
    return "Completed";
  }
  const ratio = Math.min(1, Math.max(0, safeChunk / safeTotal));
  const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
  return percent <= 0 ? "Beginning" : `${percent}% played`;
}

function getPageNumberForChunk(chunkIndex) {
  const safeChunk = Math.max(0, Number(chunkIndex) || 0);
  let fallbackPage = 1;
  for (let page = 1; page <= state.totalPages; page += 1) {
    const pageChunkIndex = pageStartChunkMap[page];
    if (!Number.isFinite(pageChunkIndex)) {
      continue;
    }
    if (pageChunkIndex <= safeChunk) {
      fallbackPage = page;
      continue;
    }
    break;
  }
  return fallbackPage;
}

function formatSectionLabel(chunkIndex) {
  const pageNumber = getPageNumberForChunk(chunkIndex);
  return `Page ${pageNumber}`;
}

function updateRecentEntry(meta) {
  const nextEntry = {
    id: meta.id,
    name: meta.name,
    sizeKb: meta.sizeKb || 0,
    totalPages: meta.totalPages || 0,
    totalChunks: meta.totalChunks || 0,
    updatedAt: Date.now(),
  };
  libraryState.recent = [nextEntry, ...libraryState.recent.filter((entry) => entry.id !== meta.id)].slice(
    0,
    MAX_RECENT_PDFS
  );
  const ids = new Set(libraryState.recent.map((entry) => entry.id));
  const staleIds = Object.keys(libraryState.resumes).filter((id) => !ids.has(id));
  staleIds.forEach((id) => {
    delete libraryState.resumes[id];
    delete libraryState.bookmarks[id];
    void deletePdfDocument(id).catch(() => null);
  });
}

function renderEmptyState(listEl, message) {
  listEl.innerHTML = `<p class="library-empty">${message}</p>`;
}

function syncLibrarySectionToggles() {
  bookmarkContentEl?.classList.toggle("hidden", !isBookmarksExpanded);
  if (toggleBookmarksBtn) {
    toggleBookmarksBtn.textContent = isBookmarksExpanded ? "Hide" : "View";
  }
}

function updateLibraryUI() {
  const currentResume = getCurrentResume();
  const latestResume = getLatestResumeEntry();
  const bookmarks = getCurrentBookmarks();

  const showResume =
    Boolean(latestResume) ||
    (Boolean(currentPdfId) &&
      Boolean(currentResume) &&
      Number.isFinite(currentResume.chunkIndex) &&
      currentResume.chunkIndex > 0 &&
      (!Number.isFinite(currentResume.totalChunks) || currentResume.chunkIndex < currentResume.totalChunks));
  resumeSectionEl.classList.toggle("hidden", !showResume);
  if (showResume) {
    const sourceResume = currentResume && currentPdfId ? { id: currentPdfId, name: state.fileName, resume: currentResume } : latestResume;
    resumePlaybackBtn.dataset.resumeId = sourceResume?.id || "";
    resumeMetaEl.textContent = `${sourceResume?.name || "Last PDF"} · ${formatSectionLabel(
      sourceResume?.resume?.chunkIndex || 0
    )}`;
  } else {
    resumePlaybackBtn.dataset.resumeId = "";
  }

  const showBookmarks = Boolean(currentPdfId);
  bookmarksSectionEl.classList.toggle("hidden", !showBookmarks);
  if (!showBookmarks) {
    isBookmarksExpanded = false;
    syncLibrarySectionToggles();
    return;
  }
  if (!bookmarks.length) {
    renderEmptyState(bookmarkListEl, "Save a section to return to it later.");
  } else {
    bookmarkListEl.innerHTML = bookmarks
      .map(
        (bookmark, index) => `
          <div class="library-item">
            <div class="library-item-main">
              <p class="library-item-title">${bookmark.label || formatSectionLabel(bookmark.chunkIndex)}</p>
              <p class="library-item-meta">${bookmark.note || "Saved section"}</p>
            </div>
            <div class="library-item-actions">
              <button class="library-action" type="button" data-action="resume-bookmark" data-index="${index}">Go there</button>
              <button class="library-action library-action-muted" type="button" data-action="remove-bookmark" data-index="${index}">Remove</button>
            </div>
          </div>
        `
      )
      .join("");
  }
  syncLibrarySectionToggles();
}

async function removeBookmark(index) {
  if (!currentPdfId || !Number.isInteger(index) || index < 0) {
    return;
  }
  const bookmarks = getCurrentBookmarks().slice();
  if (index >= bookmarks.length) {
    return;
  }
  bookmarks.splice(index, 1);
  libraryState.bookmarks[currentPdfId] = bookmarks;
  updateLibraryUI();
  await persistLibraryState({ skipUi: true });
}

async function persistResumePosition(chunkIndex = currentChunkIndex) {
  if (!currentPdfId) {
    return;
  }
  libraryState.resumes[currentPdfId] = {
    chunkIndex: Math.max(0, Number(chunkIndex) || 0),
    totalChunks: state.totalChunks,
    updatedAt: Date.now(),
  };
  await persistLibraryState();
}

async function clearResumePosition() {
  if (!currentPdfId) {
    return;
  }
  libraryState.resumes[currentPdfId] = {
    chunkIndex: 0,
    totalChunks: state.totalChunks,
    updatedAt: Date.now(),
  };
  await persistLibraryState();
}

async function addBookmarkAtCurrentPosition() {
  if (!currentPdfId || !state.totalChunks) {
    return;
  }
  const currentBookmarks = getCurrentBookmarks().slice(0, MAX_BOOKMARKS_PER_PDF - 1);
  const chunkIndex = Math.max(0, currentChunkIndex);
  currentBookmarks.unshift({
    chunkIndex,
    totalChunks: state.totalChunks,
    label: formatSectionLabel(chunkIndex),
    note: state.fileName || "Current document",
    savedAt: Date.now(),
  });
  libraryState.bookmarks[currentPdfId] = currentBookmarks;
  isBookmarksExpanded = true;
  updateLibraryUI();
  void requestTtsBytes(textChunks[chunkIndex], state.speed).catch(() => null);
  if (state.status === "reading" || state.status === "paused") {
    hintEl.textContent = "Section saved.";
  } else {
    setStatus("idle", "Section saved.");
  }
  void persistLibraryState({
    skipUi: state.status === "reading" || state.status === "loading",
  });
}

function warmPreparedChunk(chunkIndex = 0, token = playbackToken) {
  if (
    !textChunks.length ||
    chunkIndex < 0 ||
    chunkIndex >= textChunks.length ||
    token !== playbackToken
  ) {
    return;
  }
  void prefetchNextChunk(chunkIndex, token);
}

function clampPageNumber(pageNumber) {
  const numericPage = Math.floor(Number(pageNumber) || 0);
  if (!state.totalPages) {
    return 0;
  }
  return Math.min(state.totalPages, Math.max(1, numericPage));
}

function getChunkIndexForPage(pageNumber) {
  const safePage = clampPageNumber(pageNumber);
  if (!safePage) {
    return null;
  }
  for (let page = safePage; page <= state.totalPages; page += 1) {
    const value = pageStartChunkMap[page];
    if (Number.isFinite(value)) {
      return value;
    }
    if (value === null) {
      continue;
    }
    break;
  }
  return null;
}

function queuePageJump(pageNumber) {
  const safePage = clampPageNumber(pageNumber);
  if (!safePage) {
    return false;
  }
  pendingStartPage = safePage;
  setStatus("loading", `Preparing page ${safePage}...`);
  return true;
}

function startPlaybackFromChunk(chunkIndex) {
  pendingStartPage = null;
  cleanupCurrentAudio();
  currentChunkIndex = Math.max(0, Number(chunkIndex) || 0);
  state.currentChunk = currentChunkIndex;
  clearPrefetch();
  setStatus("loading", `Preparing ${formatSectionLabel(currentChunkIndex)}...`);
  void startPlayback();
}

function startFromPage(pageNumber) {
  if (!currentFileBuffer) {
    return;
  }
  const safePage = clampPageNumber(pageNumber);
  if (!safePage) {
    setStatus("error", "Enter a valid page number.");
    return;
  }
  const chunkIndex = getChunkIndexForPage(safePage);
  if (chunkIndex !== null) {
    pendingStartPage = null;
    startPlaybackFromChunk(chunkIndex);
    return;
  }
  if (isPreparingText && queuePageJump(safePage)) {
    return;
  }
  setStatus("error", "That page is not ready yet. Try again in a moment.");
}

async function getOrCreateDeviceToken() {
  const result = await readLocalStorage([DEVICE_TOKEN_KEY]);
  const existing = typeof result?.[DEVICE_TOKEN_KEY] === "string" ? result[DEVICE_TOKEN_KEY] : "";
  if (existing) {
    return existing;
  }
  const created =
    (self.crypto && self.crypto.randomUUID && self.crypto.randomUUID()) ||
    `device_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  await writeLocalStorage({ [DEVICE_TOKEN_KEY]: created });
  return created;
}

async function persistLocalTrialFloor(remainingSeconds) {
  const deviceToken = await getOrCreateDeviceToken();
  const safeSeconds = Number.isFinite(Number(remainingSeconds))
    ? Math.max(0, Math.floor(Number(remainingSeconds)))
    : 0;
  await writeLocalStorage({
    [TRIAL_STATE_KEY]: {
      deviceToken,
      remainingSeconds: safeSeconds,
      updatedAt: Date.now(),
    },
  });
  await sendRuntimeMessage({
    type: "persistTrialFloor",
    remainingSeconds: safeSeconds,
  }).catch(() => null);
}

function setPaywallStatus(text, ok = false) {
  paywallStatusEl.textContent = text;
  paywallStatusEl.style.color = ok ? "#24553a" : "#6f665c";
}

function updateAuthUI() {
  authPanelEl?.classList.toggle("hidden", authState.signedIn);
  authCopyEl.classList.toggle("hidden", authState.signedIn);
  authGoogleBtn.classList.toggle("hidden", authState.signedIn);
  authMessageEl.textContent = authState.signedIn
    ? ""
    : !currentSubscription?.active && getLiveRemainingSeconds() <= 0
    ? "Today's free listening is over. Your free limit will reset tomorrow, or you can unlock unlimited listening now."
    : "You can listen for 5 free minutes each day. Sign in with Google when you want unlimited listening.";
  updateUI();
}

async function loadAuthState() {
  const wasSignedIn = authState.signedIn;
  try {
    const result = await sendRuntimeMessage({ type: "getAuthState" });
    authState = {
      signedIn: !!result.signedIn,
      email: result.email || "",
      method: result.method || null,
    };
  } catch (_error) {
    authState = { signedIn: false, email: "", method: null };
  }

  if (isAuthenticating && authState.signedIn) {
    setAuthenticating(false);
    const remainingBeforeAuth = Number.isFinite(preAuthRemainingSeconds)
      ? preAuthRemainingSeconds
      : null;
    preAuthRemainingSeconds = null;
    if (authReturnScreen === "paywall") {
      setActiveScreen("paywall");
      closeDrawer();
      setPaywallStatus("Signed in. Choose your plan to continue.");
      void loadSubscriptionStatus().then(() => {
        const remainingAfterAuth = getLiveRemainingSeconds();
        if (
          Number.isFinite(remainingBeforeAuth) &&
          remainingAfterAuth < remainingBeforeAuth &&
          !currentSubscription?.active
        ) {
          trialAdjustedAfterSignIn = true;
          setPaywallStatus(
            "Your free listening limit refreshes every day."
          );
          updateUI();
        }
      });
    } else {
      void refreshQuotaSnapshot().then(() => {
        const remainingAfterAuth = getLiveRemainingSeconds();
        if (
          Number.isFinite(remainingBeforeAuth) &&
          remainingAfterAuth < remainingBeforeAuth &&
          !currentSubscription?.active
        ) {
          trialAdjustedAfterSignIn = true;
          updateUI();
        }
        openDrawer();
      });
    }
    showAuthSuccessToast();
    authReturnScreen = "drawer";
  } else if (!authState.signedIn && wasSignedIn) {
    trialAdjustedAfterSignIn = false;
    authToastEl.classList.add("hidden");
  }

  updateAuthUI();
}

function trackExtensionOpened() {
  if (extensionOpenedTracked) {
    return;
  }
  extensionOpenedTracked = true;
  void trackAnalyticsEvent("extension_opened", {
    signed_in: authState.signedIn,
    has_pdf: Boolean(currentFileBuffer),
    trial_seconds_left: Number.isFinite(getLiveRemainingSeconds())
      ? getLiveRemainingSeconds()
      : -1,
  });
}

async function refreshQuotaSnapshot() {
  if (state.status === "reading" || state.status === "paused") {
    return;
  }

  try {
    const quota = await getPlaybackQuota();
    if (Number.isFinite(Number(quota.minFreePlaybackStartSeconds))) {
      minFreePlaybackStartSeconds = Math.max(0, Number(quota.minFreePlaybackStartSeconds));
    }
    if (Number.isFinite(Number(quota.remainingSeconds))) {
      lastKnownRemainingSeconds = Math.max(0, Number(quota.remainingSeconds));
      sessionRemainingSeconds = null;
      updateUI();
    }
  } catch (_error) {
    // Keep the last known UI state if quota refresh fails.
  }
}

async function signInWithGoogle(targetScreen = "drawer", source = "unknown") {
  authReturnScreen = targetScreen === "paywall" ? "paywall" : "drawer";
  preAuthRemainingSeconds = hasKnownTrialRemaining() ? getLiveRemainingSeconds() : null;
  void trackAnalyticsEvent("login_started", {
    source,
    target_screen: authReturnScreen,
    signed_in: authState.signedIn,
    trial_seconds_left: Number.isFinite(getLiveRemainingSeconds())
      ? getLiveRemainingSeconds()
      : -1,
  });
  authGoogleBtn.disabled = true;
  accountActionBtn.disabled = true;
  authGoogleBtn.textContent = "Opening Google...";
  accountActionBtn.textContent = "Opening Google...";
  setAuthenticating(true);
  closeDrawer();
  try {
    const returnUrl = await getActiveTabUrl();
    await sendRuntimeMessage({
      type: "startGoogleSignIn",
      returnUrl,
    });
    setPaywallStatus("Complete Google sign-in in the opened tab.");
  } catch (error) {
    setAuthenticating(false);
    setPaywallStatus(error.message || "Unable to start Google sign-in.");
  } finally {
    authGoogleBtn.disabled = false;
    accountActionBtn.disabled = false;
    authGoogleBtn.textContent = "Continue with Google";
    accountActionBtn.textContent = authState.signedIn ? "Sign out" : "Sign in with Google";
  }
}

async function signOutAccount() {
  try {
    const result = await sendRuntimeMessage({ type: "signOut" });
    authState = {
      signedIn: !!result.signedIn,
      email: result.email || "",
      method: result.method || null,
    };
    setPaywallStatus("Signed out. Sign in again before checkout.");
  } catch (error) {
    setPaywallStatus(error.message || "Unable to sign out.");
  }
  updateAuthUI();
}

async function loadSubscriptionStatus() {
  setPaywallStatus("Checking subscription status...");
  try {
    const result = await sendRuntimeMessage({ type: "refreshSubscriptionStatus" });
    currentSubscription = result || { active: false, plan: null };
    if (currentSubscription.active) {
      const currentPlanId = currentSubscription.plan?.planId || "";
      if (currentPlanId) {
        selectedPlanId = currentPlanId;
      }
      setPaywallStatus("Subscription active on this device.", true);
    } else {
      setPaywallStatus(
        authState.signedIn
          ? "No active subscription detected."
          : "Sign in before checkout to keep unlimited listening attached to your account."
      );
    }
    updateUI();
  } catch (error) {
    setPaywallStatus(error.message || "Failed to load subscription status.");
  }
}

function openPaywall(source = "unknown") {
  setActiveScreen("paywall");
  closeDrawer();
  const trialSecondsLeft = Number.isFinite(getLiveRemainingSeconds())
    ? getLiveRemainingSeconds()
    : -1;
  const trialExhausted = !currentSubscription?.active && trialSecondsLeft <= 0;
  void trackAnalyticsEvent("paywall_opened", {
    source,
    signed_in: authState.signedIn,
    trial_seconds_left: trialSecondsLeft,
    trial_exhausted: trialExhausted,
    has_pdf: Boolean(currentFileBuffer),
  });
  if (!currentSubscription?.active && getLiveRemainingSeconds() <= 0) {
    setPaywallStatus("Today's free listening is over. Your free limit will reset tomorrow, or you can unlock unlimited listening now.");
  }
  void loadAuthState().then(() => {
    loadSubscriptionStatus();
  });
}

function closePaywall() {
  setActiveScreen("reader");
}

async function openCheckoutForPlan(planId) {
  if (!authState.signedIn) {
    setPaywallStatus("Continue with Google before checkout.");
    await signInWithGoogle("paywall", `checkout_${planId}`);
    return;
  }

  await loadAuthState();

  if (!authState.signedIn) {
    setPaywallStatus("Continue with Google before checkout.");
    await signInWithGoogle("paywall", `checkout_${planId}`);
    return;
  }

  if (planId === "monthly" && continueCheckoutMonthlyBtn) {
    continueCheckoutMonthlyBtn.disabled = true;
    continueCheckoutMonthlyBtn.setAttribute("aria-busy", "true");
    continueCheckoutMonthlyBtn.textContent = "Opening checkout...";
  }
  if (planId === "annual" && continueCheckoutAnnualBtn) {
    continueCheckoutAnnualBtn.disabled = true;
    continueCheckoutAnnualBtn.setAttribute("aria-busy", "true");
    continueCheckoutAnnualBtn.textContent = "Opening checkout...";
  }
  setPaywallStatus("Creating Stripe Checkout session...");
  try {
    const result = await sendRuntimeMessage({
      type: "createCheckoutSession",
      planId,
      returnUrl: chrome.runtime.getURL("popup.html"),
    });
    if (!result.url) {
      throw new Error("Checkout URL is missing.");
    }
    void trackAnalyticsEvent("checkout_started", {
      plan_id: planId,
      signed_in: authState.signedIn,
      trial_seconds_left: Number.isFinite(getLiveRemainingSeconds())
        ? getLiveRemainingSeconds()
        : -1,
    });
    chrome.tabs.create({ url: result.url });
    setPaywallStatus("Stripe Checkout opened in a new tab.");
  } catch (error) {
    setPaywallStatus(error.message || "Unable to open checkout.");
  } finally {
    if (continueCheckoutMonthlyBtn) {
      continueCheckoutMonthlyBtn.disabled = false;
      continueCheckoutMonthlyBtn.removeAttribute("aria-busy");
    }
    if (continueCheckoutAnnualBtn) {
      continueCheckoutAnnualBtn.disabled = false;
      continueCheckoutAnnualBtn.removeAttribute("aria-busy");
    }
    updateUI();
  }
}

function formatRemainingSeconds(seconds) {
  const safeSeconds = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  return `${Math.ceil(safeSeconds)} sec`;
}

function paywallReachedMessage() {
  return "Today's free listening is over. Your free limit will reset tomorrow, or you can unlock unlimited listening now.";
}

async function exhaustPlaybackQuota(token = playbackToken) {
  if (token !== playbackToken) {
    return;
  }
  const usage = await commitPlaybackUsage().catch(() => null);
  const remainingSeconds = Number(usage?.remainingSeconds);
  if (Number.isFinite(remainingSeconds) && remainingSeconds > 0) {
    await addPlaybackUsage(remainingSeconds).catch(() => null);
  }
  lastKnownRemainingSeconds = 0;
  sessionRemainingSeconds = 0;
}

function getEffectiveSpeed(value = state.speed) {
  const baseSpeed = Number.isFinite(value) ? value : 1;
  if (typeof detectedLanguage === "string" && detectedLanguage.toLowerCase().startsWith("ru")) {
    return Math.min(2, baseSpeed * 1.2);
  }
  return baseSpeed;
}

function showPaywallLimitReached() {
  stopPlaybackUiTimer();
  void trackAnalyticsEvent("trial_exhausted", {
    signed_in: authState.signedIn,
    has_pdf: Boolean(currentFileBuffer),
  });
  void persistResumePosition(currentChunkIndex);
  setStatus("error", paywallReachedMessage());
  updateUI();
  openPaywall("trial_exhausted");
}

async function commitPlaybackUsage() {
  captureActivePlaybackDelta();
  const elapsedSeconds = pendingUsageSeconds;
  pendingUsageSeconds = 0;
  if (elapsedSeconds <= 0) {
    return null;
  }

  const optimisticBaseSeconds = Number.isFinite(sessionRemainingSeconds)
    ? sessionRemainingSeconds
    : Number.isFinite(lastKnownRemainingSeconds)
    ? lastKnownRemainingSeconds
    : 0;
  const optimisticRemainingSeconds = Math.max(0, optimisticBaseSeconds - elapsedSeconds);

  try {
    const result = await addPlaybackUsage(elapsedSeconds);
    if (Number.isFinite(Number(result?.remainingSeconds))) {
      lastKnownRemainingSeconds = Math.max(0, Number(result.remainingSeconds));
      sessionRemainingSeconds = lastKnownRemainingSeconds;
    } else {
      lastKnownRemainingSeconds = optimisticRemainingSeconds;
      sessionRemainingSeconds = optimisticRemainingSeconds;
    }
    return result;
  } catch (_error) {
    lastKnownRemainingSeconds = optimisticRemainingSeconds;
    sessionRemainingSeconds = optimisticRemainingSeconds;
    return {
      remainingSeconds: optimisticRemainingSeconds,
      localOnly: true,
    };
  }
}

async function enforcePaywallBeforePlayback() {
  if (Number.isFinite(sessionRemainingSeconds)) {
    const remainingSeconds = Math.max(0, sessionRemainingSeconds);
    lastKnownRemainingSeconds = remainingSeconds;
    if (remainingSeconds <= 0) {
      showPaywallLimitReached();
      return { allowed: false, remainingSeconds: 0 };
    }
    return { allowed: true, remainingSeconds };
  }

  const quota = await getPlaybackQuota();
  if (Number.isFinite(Number(quota.minFreePlaybackStartSeconds))) {
    minFreePlaybackStartSeconds = Math.max(0, Number(quota.minFreePlaybackStartSeconds));
  }
  const quotaRemainingSeconds = Number(quota.remainingSeconds);
  let remainingSeconds = quotaRemainingSeconds;
  if (Number.isFinite(quotaRemainingSeconds)) {
    const normalizedQuotaSeconds = Math.max(0, quotaRemainingSeconds);
    remainingSeconds =
      Number.isFinite(lastKnownRemainingSeconds) && lastKnownRemainingSeconds >= 0
        ? Math.min(lastKnownRemainingSeconds, normalizedQuotaSeconds)
        : normalizedQuotaSeconds;
    lastKnownRemainingSeconds = remainingSeconds;
    sessionRemainingSeconds = remainingSeconds;
  }
  if (!Number.isFinite(remainingSeconds) || remainingSeconds <= 0) {
    showPaywallLimitReached();
    return { allowed: false, remainingSeconds: 0 };
  }
  if (!currentSubscription?.active && remainingSeconds <= minFreePlaybackStartSeconds) {
    lastKnownRemainingSeconds = 0;
    sessionRemainingSeconds = 0;
    showPaywallLimitReached();
    return { allowed: false, remainingSeconds: 0 };
  }
  return { allowed: true, remainingSeconds };
}

async function openPdfDocument(arrayBuffer) {
  if (!pdfjs) {
    throw new Error("PDF engine not available.");
  }

  const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
  return loadingTask.promise;
}

async function openPdfInBrowserTab(file) {
  if (!file) {
    return;
  }

  if (currentPdfPreviewUrl) {
    URL.revokeObjectURL(currentPdfPreviewUrl);
  }
  currentPdfPreviewUrl = URL.createObjectURL(file);
  await chrome.tabs.create({ url: currentPdfPreviewUrl });
}

async function openPdfBlobInBrowserTab(buffer) {
  if (!buffer) {
    return;
  }
  if (currentPdfPreviewUrl) {
    URL.revokeObjectURL(currentPdfPreviewUrl);
  }
  currentPdfPreviewUrl = URL.createObjectURL(
    new Blob([buffer], { type: "application/pdf" })
  );
  await chrome.tabs.create({ url: currentPdfPreviewUrl });
}

function appendPreparedPage(pageText, pageNumber) {
  const currentPage = Math.max(1, Number(pageNumber) || 1);
  const firstChunkIndexForPage = textChunks.length;
  const nextChunks = buildChunks([pageText], {
    useSmallFirstChunk: textChunks.length === 0,
  });
  if (!nextChunks.length) {
    pageStartChunkMap[currentPage] = null;
    return false;
  }
  pageStartChunkMap[currentPage] = firstChunkIndexForPage;
  textChunks.push(...nextChunks);
  state.totalChunks = textChunks.length;
  return true;
}

async function extractPageText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  const positionedItems = textContent.items
    .map((item) => {
      const text = normalizeText(item?.str || "");
      const x = Number(item?.transform?.[4]);
      const y = Number(item?.transform?.[5]);
      if (!text) {
        return null;
      }
      return {
        text,
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : 0,
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (Math.abs(b.y - a.y) > 3) {
        return b.y - a.y;
      }
      return a.x - b.x;
    });

  const rows = [];
  let currentRow = [];
  let currentY = null;

  positionedItems.forEach((item) => {
    if (currentY === null || Math.abs(currentY - item.y) <= 3) {
      currentY = currentY === null ? item.y : currentY;
      currentRow.push(item);
      return;
    }
    if (currentRow.length) {
      rows.push(
        currentRow
          .slice()
          .sort((a, b) => a.x - b.x)
          .map((entry) => entry.text)
          .join(" ")
      );
    }
    currentRow = [item];
    currentY = item.y;
  });

  if (currentRow.length) {
    rows.push(
      currentRow
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((entry) => entry.text)
        .join(" ")
    );
  }

  return cleanPdfLines(rows).join(" ");
}

async function preparePdfPages(pdf, startPage, endPage, runId, onChunkReady) {
  let languageQueued = false;

  for (let pageNumber = startPage; pageNumber <= endPage; pageNumber += 1) {
    if (runId !== activePreparationRunId) {
      return { cancelled: true, languageQueued };
    }

    const pageText = await extractPageText(pdf, pageNumber);
    if (runId !== activePreparationRunId) {
      return { cancelled: true, languageQueued };
    }

    const addedChunks = appendPreparedPage(pageText, pageNumber);

    if (
      addedChunks &&
      pendingStartPage &&
      pageNumber === pendingStartPage &&
      runId === activePreparationRunId
    ) {
      const targetChunkIndex = getChunkIndexForPage(pendingStartPage);
      pendingStartPage = null;
      if (targetChunkIndex !== null) {
        startPlaybackFromChunk(targetChunkIndex);
      }
    }

    if (addedChunks && !languageQueued) {
      languageQueued = true;
      const sample = textChunks.slice(0, 3).join(" ").slice(0, 1000);
      void detectLanguageFromText(sample).then((language) => {
        if (runId !== activePreparationRunId) {
          return;
        }
        detectedLanguage = language;
        state.language = detectedLanguage;
        updateUI();
      });
    }

    if (addedChunks) {
      onChunkReady?.();
    }
  }

  return { cancelled: false, languageQueued };
}

function finishPreparation(runId) {
  if (runId !== activePreparationRunId) {
    return;
  }
  preparationComplete = true;
  isPreparingText = false;
  warmPreparedChunk(currentChunkIndex, playbackToken);
  if (currentPdfId) {
    updateRecentEntry({
      id: currentPdfId,
      name: state.fileName || "PDF document",
      totalPages: state.totalPages,
      totalChunks: textChunks.length,
    });
    void persistLibraryState();
  }
  if (state.status !== "reading" && state.status !== "paused") {
    setStatus("idle", "Your PDF is ready in the player.");
  }
}

function continuePreparingRemainingPages(pdf, startPage, runId) {
  void (async () => {
    const result = await preparePdfPages(pdf, startPage, pdf.numPages, runId);
    if (result.cancelled) {
      return;
    }
    finishPreparation(runId);
  })().catch((error) => {
    if (runId !== activePreparationRunId) {
      return;
    }
    const details = error && error.message ? error.message : "Unable to prepare the PDF.";
    currentFileBuffer = null;
    isPreparingText = false;
    preparationComplete = false;
    setStatus("error", details);
  });
}

async function waitForPreparedChunks(token) {
  if (token !== playbackToken) {
    return;
  }
  if (currentChunkIndex < textChunks.length) {
    await speakCurrentChunk(token);
    return;
  }
  if (preparationComplete) {
    state.currentChunk = textChunks.length;
    cleanupCurrentAudio();
    resetSessionQuotaTracking();
    await clearResumePosition();
    setStatus("finished", `${state.fileName || "PDF"} finished.`);
    return;
  }
    setStatus("loading", "Loading more pages for playback...");
  setTimeout(() => {
    void waitForPreparedChunks(token);
  }, 250);
}

async function prepareSelectedFile(file) {
  if (!file) {
    return;
  }

  const runId = ++activePreparationRunId;
  resetPreparedText();
  state.fileName = file.name || "";
  setStatus("loading", "Loading your PDF...");

  try {
    const buffer = await file.arrayBuffer();
    const pdfId = createPdfIdFromMeta({
      name: file.name,
      size: file.size,
      lastModified: file.lastModified,
    });
    currentPdfId = pdfId;
    const saveDocumentPromise = savePdfDocument({
      id: pdfId,
      name: file.name || "PDF document",
      sizeKb: Math.max(1, Math.round((file.size || 0) / 1024)),
      buffer,
      lastOpenedAt: Date.now(),
    });
    const openInBrowserPromise = openPdfInBrowserTab(file).catch(() => null);
    isPreparingText = true;
    preparationComplete = false;
    currentFileBuffer = buffer;
    const pdf = await openPdfDocument(currentFileBuffer.slice(0));
    void saveDocumentPromise.catch(() => null);
    void openInBrowserPromise;
    if (runId !== activePreparationRunId) {
      return;
    }
    state.totalPages = pdf.numPages;
    state.currentChunk = 0;
    updateRecentEntry({
      id: pdfId,
      name: file.name || "PDF document",
      sizeKb: Math.max(1, Math.round((file.size || 0) / 1024)),
      totalPages: pdf.numPages,
      totalChunks: 0,
    });
    await clearResumePosition();
    void trackAnalyticsEvent("pdf_selected", {
      page_count: pdf.numPages,
      file_size_kb: Math.max(1, Math.round((file.size || 0) / 1024)),
      signed_in: authState.signedIn,
    });
    let firstChunkReady = false;
    const initialPagesEnd = Math.min(INITIAL_PREPARED_PAGES, pdf.numPages);
    const initialResult = await preparePdfPages(pdf, 1, initialPagesEnd, runId, () => {
      if (firstChunkReady) {
        return;
      }
      firstChunkReady = true;
      if (pendingStartPlayback) {
        pendingStartPlayback = false;
        playbackToken += 1;
        void speakCurrentChunk(playbackToken);
      } else {
        warmPreparedChunk(0, playbackToken);
        setStatus("idle", "Your PDF is ready in the player.");
      }
    });
    if (initialResult.cancelled || runId !== activePreparationRunId) {
      return;
    }

    if (!textChunks.length) {
      setStatus("error", "No readable text found. This PDF may be scanned.");
      isPreparingText = false;
      preparationComplete = true;
      return;
    }

    if (!detectedLanguage) {
      const sample = textChunks.slice(0, 3).join(" ").slice(0, 1000);
      detectedLanguage = await detectLanguageFromText(sample);
      state.language = detectedLanguage;
    }
    warmPreparedChunk(0, playbackToken);

    if (pdf.numPages > initialPagesEnd) {
      updateRecentEntry({
        id: pdfId,
        name: file.name || "PDF document",
        sizeKb: Math.max(1, Math.round((file.size || 0) / 1024)),
        totalPages: pdf.numPages,
        totalChunks: textChunks.length,
      });
      await persistLibraryState();
      continuePreparingRemainingPages(pdf, initialPagesEnd + 1, runId);
      return;
    }

    updateRecentEntry({
      id: pdfId,
      name: file.name || "PDF document",
      sizeKb: Math.max(1, Math.round((file.size || 0) / 1024)),
      totalPages: pdf.numPages,
      totalChunks: textChunks.length,
    });
    await persistLibraryState();
    finishPreparation(runId);
  } catch (error) {
    const details = error && error.message ? error.message : "Unable to prepare the PDF.";
    currentFileBuffer = null;
    isPreparingText = false;
    preparationComplete = false;
    setStatus("error", details);
  }
}

async function openRecentPdf(id) {
  const record = await getPdfDocument(id);
  if (!record?.buffer) {
    setStatus("error", "This PDF is no longer available in your local library.");
    return;
  }
  const resumeState = libraryState.resumes?.[id];
  const shouldResume =
    resumeState && Number.isFinite(resumeState.chunkIndex) && resumeState.chunkIndex > 0;

  const runId = ++activePreparationRunId;
  resetPreparedText();
  currentPdfId = id;
  state.fileName = record.name || "PDF document";
  setStatus("loading", "Loading your PDF...");

  try {
    await openPdfBlobInBrowserTab(record.buffer);
    isPreparingText = true;
    preparationComplete = false;
    currentFileBuffer = record.buffer;
    const pdf = await openPdfDocument(currentFileBuffer.slice(0));
    if (runId !== activePreparationRunId) {
      return;
    }
    state.totalPages = pdf.numPages;
    state.currentChunk = 0;
    updateRecentEntry({
      id,
      name: record.name || "PDF document",
      sizeKb: record.sizeKb || 0,
      totalPages: pdf.numPages,
      totalChunks: 0,
    });

    const initialPagesEnd = Math.min(INITIAL_PREPARED_PAGES, pdf.numPages);
    const initialResult = await preparePdfPages(pdf, 1, initialPagesEnd, runId, () => {
      if (shouldResume) {
        currentChunkIndex = Math.max(0, Number(resumeState.chunkIndex) || 0);
        state.currentChunk = currentChunkIndex;
        warmPreparedChunk(currentChunkIndex, playbackToken);
        void startPlayback();
        return;
      }
      warmPreparedChunk(0, playbackToken);
      setStatus("idle", "Your PDF is ready in the player.");
    });
    if (initialResult.cancelled || runId !== activePreparationRunId) {
      return;
    }

    if (!textChunks.length) {
      setStatus("error", "No readable text found. This PDF may be scanned.");
      isPreparingText = false;
      preparationComplete = true;
      return;
    }

    warmPreparedChunk(shouldResume ? currentChunkIndex : 0, playbackToken);

    if (pdf.numPages > initialPagesEnd) {
      updateRecentEntry({
        id,
        name: record.name || "PDF document",
        sizeKb: record.sizeKb || 0,
        totalPages: pdf.numPages,
        totalChunks: textChunks.length,
      });
      await persistLibraryState();
      continuePreparingRemainingPages(pdf, initialPagesEnd + 1, runId);
      return;
    }

    updateRecentEntry({
      id,
      name: record.name || "PDF document",
      sizeKb: record.sizeKb || 0,
      totalPages: pdf.numPages,
      totalChunks: textChunks.length,
    });
    await persistLibraryState();
    finishPreparation(runId);
  } catch (error) {
    const details = error && error.message ? error.message : "Unable to reopen this PDF.";
    currentFileBuffer = null;
    isPreparingText = false;
    preparationComplete = false;
    setStatus("error", details);
  }
}

async function handleAudioEnded(token) {
  if (token !== playbackToken || state.status !== "reading") {
    return;
  }

  if (paywallStopTimer) {
    clearTimeout(paywallStopTimer);
    paywallStopTimer = null;
  }
  commitPlaybackUsageInBackground(token);
  currentChunkIndex += 1;
  await persistResumePosition(currentChunkIndex);

  if (currentChunkIndex >= textChunks.length) {
    await waitForPreparedChunks(token);
    return;
  }

  await speakCurrentChunk(token);
}

async function speakCurrentChunk(token = playbackToken) {
  if (token !== playbackToken) {
    return;
  }

  if (!textChunks.length) {
    setStatus("error", "Open a PDF with selectable text first.");
    return;
  }

  while (currentChunkIndex < textChunks.length && !textChunks[currentChunkIndex]) {
    currentChunkIndex += 1;
  }

  if (currentChunkIndex >= textChunks.length) {
    await waitForPreparedChunks(token);
    return;
  }

  state.currentChunk = currentChunkIndex + 1;
  setStatus("loading", "Preparing audio for playback...");

  const payloadPromise = resolveChunkPayload(currentChunkIndex, token);

  let quota;
  try {
    quota = await enforcePaywallBeforePlayback();
  } catch (error) {
    const details = getFriendlyRuntimeMessage(
      error,
      "Unable to check your listening access right now."
    );
    setStatus("error", details);
    return;
  }

  if (!quota.allowed) {
    return;
  }

  void prefetchNextChunk(currentChunkIndex + 1, token);

  let payload;
  try {
    payload = await payloadPromise;
  } catch (error) {
    const details = getFriendlyRuntimeMessage(
      error,
      "Audio could not be prepared right now. Please try again."
    );
    setStatus("error", details);
    return;
  }

  if (token !== playbackToken) {
    return;
  }

  cleanupCurrentAudio();
  currentAudio = new Audio();
  currentAudioUrl = URL.createObjectURL(
    new Blob([Uint8Array.from(payload.bytes)], { type: payload.mimeType })
  );
  currentAudio.src = currentAudioUrl;
  currentAudio.playbackRate = getEffectiveSpeed(state.speed);
  currentAudio.onended = () => {
    handleAudioEnded(token);
  };
  currentAudio.onerror = () => {
    cleanupCurrentAudio();
    setStatus("error", "Audio playback failed.");
  };

    lastActivePlaybackTickMs = Date.now();
    sessionRemainingSeconds = quota.remainingSeconds;
    schedulePaywallStop(token, quota.remainingSeconds);

  try {
    await currentAudio.play();
    lastActivePlaybackTickMs = Date.now();
    updateReadingStatus();
    startPlaybackUiTimer();
    startPlaybackUsageFlushTimer();
  } catch (error) {
    cleanupCurrentAudio();
    const details = getFriendlyRuntimeMessage(
      error,
      "Audio could not start right now. Please try again."
    );
    setStatus("error", details);
  }
}

async function startPlayback() {
  if (!textChunks.length && isPreparingText) {
    pendingStartPlayback = true;
    setStatus("loading", "Preparing the first pages...");
    return;
  }

  if (!textChunks.length) {
    setStatus("error", "Open a PDF with selectable text first.");
    return;
  }

  if (state.status === "finished") {
    currentChunkIndex = 0;
  }

  pendingStartPlayback = false;
  void trackAnalyticsEvent("read_aloud_clicked", {
    speed: state.speed,
    page_count: state.totalPages,
    chunk_count: textChunks.length,
    language: detectedLanguage || "unknown",
    signed_in: authState.signedIn,
    trial_seconds_left: Number.isFinite(getLiveRemainingSeconds())
      ? getLiveRemainingSeconds()
      : -1,
  });
  playbackToken += 1;
  clearPrefetch();
  warmPreparedChunk(currentChunkIndex, playbackToken);
  await speakCurrentChunk(playbackToken);
}

async function pausePlayback() {
  if (!currentAudio) {
    return;
  }

  if (state.status === "paused") {
    let quota;
    try {
      quota = await enforcePaywallBeforePlayback();
    } catch (error) {
      const details = getFriendlyRuntimeMessage(
        error,
        "Unable to check your listening access right now."
      );
      setStatus("error", details);
      return;
    }
    if (!quota.allowed) {
      return;
    }
    lastActivePlaybackTickMs = Date.now();
    schedulePaywallStop(playbackToken, quota.remainingSeconds);
    await currentAudio.play();
    updateReadingStatus();
    startPlaybackUiTimer();
    startPlaybackUsageFlushTimer();
    return;
  }

  if (paywallStopTimer) {
    clearTimeout(paywallStopTimer);
    paywallStopTimer = null;
  }
  stopPlaybackUiTimer();
  currentAudio.pause();
  await commitPlaybackUsage().catch(() => null);
  await persistResumePosition(currentChunkIndex);
  setStatus("paused", state.fileName ? `Paused ${state.fileName}` : "Paused");
}

async function stopPlayback() {
  playbackToken += 1;
  await commitPlaybackUsage().catch(() => null);
  await persistResumePosition(currentChunkIndex);
  cleanupCurrentAudio();
  clearPrefetch();
  resetSessionQuotaTracking();
  currentChunkIndex = 0;
  state.currentChunk = 0;
  if (currentFileBuffer) {
    setStatus("idle", state.fileName ? `${state.fileName} is ready to play.` : "Ready");
    return;
  }
  setStatus("idle", "Open a PDF in Chrome and start playback in the side panel.");
}

openFileBtn.addEventListener("click", () => {
  fileInput.click();
});

replaceFileBtn?.addEventListener("click", () => {
  fileInput.click();
});

fileInput.addEventListener("change", async (event) => {
  const [file] = event.target.files || [];
  await prepareSelectedFile(file);
  event.target.value = "";
});

resumePlaybackBtn?.addEventListener("click", () => {
  const resumeId = resumePlaybackBtn.dataset.resumeId || "";
  const resume =
    (resumeId && libraryState.resumes?.[resumeId]) ||
    getCurrentResume();
  if (!resume || !Number.isFinite(resume.chunkIndex) || resume.chunkIndex <= 0) {
    return;
  }
  if (resumeId && resumeId !== currentPdfId) {
    void openRecentPdf(resumeId);
    return;
  }
  currentChunkIndex = Math.max(0, Number(resume.chunkIndex) || 0);
  state.currentChunk = currentChunkIndex;
  clearPrefetch();
  void startPlayback();
});

addBookmarkBtn?.addEventListener("click", () => {
  void addBookmarkAtCurrentPosition();
});

bookmarkListEl?.addEventListener("click", (event) => {
  const removeButton = event.target.closest("[data-action='remove-bookmark']");
  if (removeButton instanceof HTMLElement) {
    const index = Number(removeButton.dataset.index);
    void removeBookmark(index);
    return;
  }
  const button = event.target.closest("[data-action='resume-bookmark']");
  if (!(button instanceof HTMLElement)) {
    return;
  }
  const index = Number(button.dataset.index);
  const bookmark = getCurrentBookmarks()[index];
  if (!bookmark || !Number.isFinite(bookmark.chunkIndex)) {
    return;
  }
  currentChunkIndex = Math.max(0, Number(bookmark.chunkIndex) || 0);
  state.currentChunk = currentChunkIndex;
  clearPrefetch();
  void startPlayback();
});

toggleBookmarksBtn?.addEventListener("click", () => {
  isBookmarksExpanded = !isBookmarksExpanded;
  syncLibrarySectionToggles();
});

playBtn.addEventListener("click", () => {
  if (state.status === "reading") {
    void pausePlayback();
    return;
  }
  void startPlayback();
});

startFromPageBtn?.addEventListener("click", () => {
  startFromPage(startPageInput?.value);
});

startPageInput?.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    startFromPage(startPageInput.value);
  }
});

pauseBtn?.addEventListener("click", () => {
  void pausePlayback();
});

stopBtn?.addEventListener("click", () => {
  void stopPlayback();
});

speedSelect.addEventListener("change", async (event) => {
  state.speed = Number.parseFloat(event.target.value) || 1;
  clearPrefetch();
  if (currentAudio) {
    currentAudio.playbackRate = getEffectiveSpeed(state.speed);
  }
  if (state.status === "reading") {
    setStatus("loading", "Updating speed...");
    if (paywallStopTimer) {
      clearTimeout(paywallStopTimer);
      paywallStopTimer = null;
    }
    setTimeout(() => {
      if (currentAudio && !currentAudio.paused) {
        updateReadingStatus();
        startPlaybackUiTimer();
      }
    }, 250);
  }
});

profileTriggerBtn.addEventListener("click", () => {
  openDrawer();
});

closeDrawerBtn.addEventListener("click", () => {
  closeDrawer();
});

drawerBackdropEl.addEventListener("click", () => {
  closeDrawer();
});

drawerUpgradeBtn.addEventListener("click", () => {
  void trackAnalyticsEvent("upgrade_clicked", { source: "drawer_upgrade" });
  openPaywall("drawer_upgrade");
});

accountActionBtn.addEventListener("click", () => {
  if (authState.signedIn) {
    void signOutAccount();
    return;
  }
  void signInWithGoogle("drawer", "account_button");
});

backToReaderBtn.addEventListener("click", () => {
  closePaywall();
});

continueCheckoutMonthlyBtn?.addEventListener("click", () => {
  if (!authState.signedIn) {
    void signInWithGoogle("paywall", "checkout_monthly");
    return;
  }
  void openCheckoutForPlan("monthly");
});

continueCheckoutAnnualBtn?.addEventListener("click", () => {
  if (!authState.signedIn) {
    void signInWithGoogle("paywall", "checkout_annual");
    return;
  }
  void openCheckoutForPlan("annual");
});

authGoogleBtn.addEventListener("click", () => {
  void signInWithGoogle("paywall", "paywall_google_button");
});

window.addEventListener("focus", () => {
  void loadAuthState()
    .then(() => refreshQuotaSnapshot())
    .then(() => {
      if (isAuthenticating && !authState.signedIn) {
        setAuthenticating(false);
      }
      if (activeScreen === "paywall") {
        return loadSubscriptionStatus();
      }
      return null;
    });
});

setActiveScreen("reader");
updateUI();
void loadLibraryState()
  .then(() => loadAuthState())
  .then(() => refreshQuotaSnapshot())
  .then(() => {
    trackExtensionOpened();
  });

window.addEventListener("beforeunload", () => {
  commitPlaybackUsage().catch(() => null);
  cleanupCurrentAudio();
});

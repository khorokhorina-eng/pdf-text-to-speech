const pdfjs = window.pdfjsLib;
const statusEl = document.getElementById("status");
const hintEl = document.getElementById("hint");
const fileNameLabelEl = document.getElementById("fileNameLabel");
const playBtn = document.getElementById("play");
const pauseBtn = document.getElementById("pause");
const stopBtn = document.getElementById("stop");
const speedSelect = document.getElementById("speed");
const openFileBtn = document.getElementById("openFile");
const replaceFileBtn = document.getElementById("replaceFile");
const fileInput = document.getElementById("fileInput");
const limitUpgradeBtn = document.getElementById("limitUpgrade");
const paywallStatusEl = document.getElementById("paywallStatus");
const trialEndedNoticeEl = document.getElementById("trialEndedNotice");
const trialUpgradeBtn = document.getElementById("trialUpgrade");
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
const ANALYTICS_SESSION_ID =
  `${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;

const state = {
  status: "idle",
  message: "Upload a .pdf file to start reading.",
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
let authReturnScreen = "drawer";
let activePreparationRunId = 0;
let extensionOpenedTracked = false;

const INITIAL_PREPARED_PAGES = 2;
const FIRST_CHUNK_MAX_LENGTH = 140;
const DEFAULT_CHUNK_MAX_LENGTH = 280;

const PLAN_META = {
  monthly: {
    label: "Monthly",
    buttonText: "Subscribe",
    price: "$0.33",
    unit: "/day",
    billingNote: "Billed monthly $9.99 / month",
    badge: "",
    planSummary: "Monthly Plan",
    planMeta: "$9.99 billed every month.",
  },
  annual: {
    label: "Annual",
    buttonText: "Subscribe",
    price: "$0.25",
    unit: "/day",
    billingNote: "Billed annually $89.99 / year",
    badge: "Best Value",
    planSummary: "Annual Plan",
    planMeta: "$89.99 billed yearly.",
  },
};

const STATUS_LABELS = {
  idle: "Ready",
  loading: "Loading",
  reading: "Reading",
  paused: "Paused",
  finished: "Finished",
  error: "Unable to read",
};

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
      name: activePlanMeta.planSummary || "Paid Plan",
      meta: activePlanMeta.planMeta || "Subscription active on this account.",
    };
  }

  return {
    name: "Free Trial",
    meta:
      getLiveRemainingSeconds() > 0
        ? `${formatRemainingSeconds(getLiveRemainingSeconds())} remaining in your free trial.`
        : hasKnownTrialRemaining()
        ? "Upgrade to unlock paid listening."
        : "Checking your free trial...",
  };
}

function updateUI() {
  document.body.dataset.status = state.status;
  statusEl.textContent = STATUS_LABELS[state.status] || "Ready";
  hintEl.textContent = state.message || " ";
  pauseBtn.textContent = state.status === "paused" ? "Resume" : "Pause";
  const isLoading = state.status === "loading";
  const shouldShowLimitUpgrade =
    state.status === "error" &&
    typeof state.message === "string" &&
    state.message.includes("Upgrade to continue");
  limitUpgradeBtn.classList.toggle("hidden", !shouldShowLimitUpgrade);
  const trialExhausted =
    !currentSubscription?.active && hasKnownTrialRemaining() && getLiveRemainingSeconds() <= 0;
  trialEndedNoticeEl.classList.toggle("hidden", !trialExhausted);
  readerControlsEl.classList.toggle("hidden", !currentFileBuffer);
  openFileBtn.classList.toggle("hidden", Boolean(currentFileBuffer));
  playBtn.disabled =
    !currentFileBuffer || state.status === "reading" || isLoading || trialExhausted;
  playBtn.textContent = isLoading ? "Loading..." : "Read Aloud";
  playBtn.classList.toggle("is-loading", isLoading);
  playBtn.setAttribute("aria-busy", isLoading ? "true" : "false");
  pauseBtn.disabled = !(state.status === "reading" || state.status === "paused");
  stopBtn.disabled = !(state.status === "reading" || state.status === "paused");
  speedSelect.disabled = isLoading;
  const activePlanId = currentSubscription?.plan?.planId || "";
  if (continueCheckoutMonthlyBtn) {
    const isCurrentMonthly = currentSubscription?.active && activePlanId === "monthly";
    continueCheckoutMonthlyBtn.textContent = isCurrentMonthly
      ? "Current monthly plan"
      : authState.signedIn
      ? "Subscribe monthly"
      : "Sign in to subscribe";
    continueCheckoutMonthlyBtn.disabled = isCurrentMonthly;
  }
  if (continueCheckoutAnnualBtn) {
    const isCurrentAnnual = currentSubscription?.active && activePlanId === "annual";
    continueCheckoutAnnualBtn.textContent = isCurrentAnnual
      ? "Current yearly plan"
      : authState.signedIn
      ? "Subscribe yearly"
      : "Sign in to subscribe";
    continueCheckoutAnnualBtn.disabled = isCurrentAnnual;
  }
  fileNameLabelEl.textContent = state.fileName || "No file selected";
  const planPresentation = getPlanPresentation();
  drawerPlanNameEl.textContent = planPresentation.name;
  drawerPlanMetaEl.textContent = planPresentation.meta;
  drawerTrialNoticeEl?.classList.toggle("hidden", !trialAdjustedAfterSignIn);
  drawerEmailEl.textContent = authState.signedIn ? authState.email : "Guest mode";
  accountActionBtn.textContent = authState.signedIn ? "Sign out" : "Sign in with Google";
  drawerUpgradeBtn.classList.toggle("hidden", currentSubscription?.active);
  trialUpgradeBtn?.classList.toggle("hidden", !trialExhausted);
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
  const remainingLabel = formatRemainingSeconds(getLiveRemainingSeconds());
  setStatus(
    "reading",
    state.fileName
      ? `Reading ${state.fileName} · about ${remainingLabel} left`
      : `Reading · about ${remainingLabel} left`
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
  currentChunkIndex = 0;
  detectedLanguage = "";
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

function requestTtsBytes(text, speed = state.speed) {
  return new Promise((resolve, reject) => {
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
  });
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
    ? "Your free trial has ended. Pay for a plan to keep listening."
    : "Use your free trial first. Sign in with Google when you want to buy a plan.";
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
            "This Google account already used part of the free trial, so your remaining trial time was updated."
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
          : "Sign in before checkout to keep your paid plan attached to your account."
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
    setPaywallStatus("Your free trial has ended. Pay for a plan to keep listening.");
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
  return "Your free trial has ended. Pay for a plan to keep listening.";
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

  currentPdfPreviewUrl = URL.createObjectURL(file);
  await chrome.tabs.create({ url: currentPdfPreviewUrl });
}

function appendPreparedPage(pageText) {
  const nextChunks = buildChunks([pageText], {
    useSmallFirstChunk: textChunks.length === 0,
  });
  if (!nextChunks.length) {
    return false;
  }
  textChunks.push(...nextChunks);
  state.totalChunks = textChunks.length;
  return true;
}

async function extractPageText(pdf, pageNumber) {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();
  return textContent.items
    .map((item) => item.str)
    .filter(Boolean)
    .join(" ");
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

    const addedChunks = appendPreparedPage(pageText);

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
  if (state.status !== "reading" && state.status !== "paused") {
    setStatus("idle", "Your PDF is being prepared for reading.");
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
    setStatus("finished", `${state.fileName || "PDF"} finished.`);
    return;
  }
  setStatus("loading", "Preparing more pages...");
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
  setStatus("loading", "Preparing PDF text...");

  try {
    await openPdfInBrowserTab(file);
    isPreparingText = true;
    preparationComplete = false;
    currentFileBuffer = await file.arrayBuffer();
    const pdf = await openPdfDocument(currentFileBuffer.slice(0));
    if (runId !== activePreparationRunId) {
      return;
    }
    state.totalPages = pdf.numPages;
    state.currentChunk = 0;
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
        setStatus("idle", "Your PDF is being prepared for reading.");
      }
    });
    if (initialResult.cancelled || runId !== activePreparationRunId) {
      return;
    }

    if (!textChunks.length) {
      setStatus("error", "No selectable text found. This PDF might be scanned.");
      isPreparingText = false;
      preparationComplete = true;
      return;
    }

    if (!detectedLanguage) {
      const sample = textChunks.slice(0, 3).join(" ").slice(0, 1000);
      detectedLanguage = await detectLanguageFromText(sample);
      state.language = detectedLanguage;
    }

    if (pdf.numPages > initialPagesEnd) {
      continuePreparingRemainingPages(pdf, initialPagesEnd + 1, runId);
      return;
    }

    finishPreparation(runId);
  } catch (error) {
    const details = error && error.message ? error.message : "Unable to prepare the PDF.";
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
    setStatus("error", "Upload a PDF with selectable text first.");
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

  let quota;
  try {
    quota = await enforcePaywallBeforePlayback();
  } catch (error) {
    const details = error && error.message ? error.message : "Unable to validate playback quota.";
    setStatus("error", details);
    return;
  }

  if (!quota.allowed) {
    return;
  }

  setStatus("loading", `Generating audio... ${formatRemainingSeconds(quota.remainingSeconds)} left`);

  void prefetchNextChunk(currentChunkIndex + 1, token);

  let payload;
  try {
    payload = await resolveChunkPayload(currentChunkIndex, token);
  } catch (error) {
    const details = error && error.message ? error.message : "TTS request failed.";
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
    const details = error && error.message ? error.message : "Unable to start audio playback.";
    setStatus("error", details);
  }
}

async function startPlayback() {
  if (!textChunks.length && isPreparingText) {
    pendingStartPlayback = true;
    setStatus("loading", "Preparing first pages...");
    return;
  }

  if (!textChunks.length) {
    setStatus("error", "Upload a PDF with selectable text first.");
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
      const details = error && error.message ? error.message : "Unable to validate playback quota.";
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
  setStatus("paused", state.fileName ? `Paused ${state.fileName}` : "Paused");
}

async function stopPlayback() {
  playbackToken += 1;
  await commitPlaybackUsage().catch(() => null);
  cleanupCurrentAudio();
  clearPrefetch();
  resetSessionQuotaTracking();
  currentChunkIndex = 0;
  state.currentChunk = 0;
  if (currentFileBuffer) {
    setStatus("idle", state.fileName ? `${state.fileName} is ready to read.` : "Ready");
    return;
  }
  setStatus("idle", "Upload a .pdf file to start reading.");
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

playBtn.addEventListener("click", () => {
  startPlayback();
});

pauseBtn.addEventListener("click", () => {
  pausePlayback();
});

stopBtn.addEventListener("click", () => {
  stopPlayback();
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

limitUpgradeBtn.addEventListener("click", () => {
  void trackAnalyticsEvent("upgrade_clicked", { source: "limit_notice" });
  openPaywall("limit_notice");
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

trialUpgradeBtn?.addEventListener("click", () => {
  void trackAnalyticsEvent("upgrade_clicked", { source: "trial_ended_notice" });
  openPaywall("trial_ended_notice");
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
void loadAuthState()
  .then(() => refreshQuotaSnapshot())
  .then(() => {
    trackExtensionOpened();
  });

window.addEventListener("beforeunload", () => {
  commitPlaybackUsage().catch(() => null);
  cleanupCurrentAudio();
});

/* The Cursed Canvas — Game client with particles, typewriter, and side panel */

// ── Title screen state ──
let titleScreenDismissed = false;
let titleParticles = [];
let titleParticleFrameId = null;
const TITLE_PARTICLE_COUNT = 220;
const TITLE_PARTICLE_THEME_COLORS = [
    [212, 168, 67],
    [74, 139, 194],
    [123, 94, 167],
    [245, 240, 224],
    [180, 140, 100],
    [100, 160, 210]
];

// ── I18N ──
window.I18N = null;

async function initI18N(targetLang) {
    const resp = await fetch(`/api/i18n/${targetLang}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`Failed to load i18n for ${targetLang}`);
    window.I18N = await resp.json();
    syncPreloadLanguage(window.I18N.lang || targetLang);
    return window.I18N;
}

function t(path, replacements = {}) {
    if (!window.I18N) return path;
    const keys = path.split(".");
    let value = window.I18N;
    for (const key of keys) {
        if (value == null) return path;
        value = value[key];
    }
    if (typeof value !== "string") return path;
    for (const [k, v] of Object.entries(replacements)) {
        value = value.replace(`{${k}}`, v);
    }
    return value;
}

const PRELOAD_FALLBACK_TEXT = {
    en: {
        settings: "Checking saved settings...",
        language: "Loading language resources...",
        interface: "Localizing the interface...",
        saves: "Preparing save slots...",
        state: "Checking adventure state...",
        local_model: "Checking optional local model environment...",
        voice_model: "Preparing voice input...",
        scene: "Preparing the midnight museum...",
        effects: "Warming up visual effects...",
        ready: "Entering the museum..."
    },
    zh: {
        settings: "正在检查已保存设置……",
        language: "正在加载语言资源……",
        interface: "正在本地化界面……",
        saves: "正在准备存档槽位……",
        state: "正在检查冒险状态……",
        local_model: "正在检查可选本地模型环境……",
        voice_model: "正在准备语音输入……",
        scene: "正在准备午夜博物馆……",
        effects: "正在预热视觉效果……",
        ready: "即将进入博物馆……"
    }
};

function syncPreloadLanguage(lang) {
    const normalized = lang === "zh" ? "zh" : "en";
    document.documentElement.setAttribute("data-preload-lang", normalized);
    document.documentElement.lang = normalized === "zh" ? "zh-CN" : "en";
}

function preloadText(key) {
    const lang = (window.I18N && window.I18N.lang === "zh") || document.documentElement.getAttribute("data-preload-lang") === "zh" ? "zh" : "en";
    const localized = window.I18N && window.I18N.preload && window.I18N.preload[key];
    return localized || PRELOAD_FALLBACK_TEXT[lang][key] || PRELOAD_FALLBACK_TEXT.en[key] || "";
}

function setPreloadStage(key, progress) {
    const msg = document.getElementById("loading-msg");
    const bar = document.getElementById("loading-progress-bar");
    if (msg) msg.textContent = preloadText(key);
    if (bar) bar.style.width = `${Math.max(0, Math.min(100, Math.round(progress)))}%`;
}

function finishPreloadOverlay() {
    setPreloadStage("ready", 100);
    window.setTimeout(() => {
        document.body.classList.add("preload-complete");
        if (!titleScreenDismissed) {
            restartTitleScreenEntranceAnimation();
            startTitleParticles({ restart: true });
        }
        scheduleVoiceWarmupAfterFirstPaint(titleScreenDismissed ? 900 : 1900);
        if (loadingOverlay) {
            loadingOverlay.classList.add("hidden");
            window.setTimeout(() => {
                if (loadingOverlay.parentNode) loadingOverlay.remove();
                document.body.classList.remove("is-preloading", "preload-complete");
            }, 760);
        } else {
            document.body.classList.remove("is-preloading", "preload-complete");
        }
        if (titleContinue && window.I18N && window.I18N.title_screen) {
            titleContinue.textContent = window.I18N.title_screen.continue_prompt;
        }
    }, 260);
}

async function probeOptionalLocalRuntimeForPreload(timeoutMs = 2000) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = window.setTimeout(() => {
            if (controller) controller.abort();
            resolve(null);
        }, timeoutMs);
    });
    const requestPromise = fetch("/api/local-runtime/check", {
        cache: "no-store",
        signal: controller ? controller.signal : undefined
    })
        .then((resp) => resp.ok ? resp.json() : null)
        .then((data) => {
            if (data) {
                updateModelStatus(data);
                updateLocalModelSettingsStatus(data);
            }
            return data;
        })
        .catch(() => null);
    const result = await Promise.race([requestPromise, timeoutPromise]);
    if (timeoutId) window.clearTimeout(timeoutId);
    return result;
}

async function warmupVoiceModelForPreload(timeoutMs = 1500) {
    const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    let timeoutId = null;
    const timeoutPromise = new Promise((resolve) => {
        timeoutId = window.setTimeout(() => {
            if (controller) controller.abort();
            resolve(null);
        }, timeoutMs);
    });
    const requestPromise = fetch("/api/voice/warmup", {
        method: "POST",
        cache: "no-store",
        signal: controller ? controller.signal : undefined
    })
        .then(async (resp) => {
            const data = await resp.json().catch(() => null);
            if (data) updateVoiceRuntimeSettingsStatus(data);
            return resp.ok ? data : null;
        })
        .catch(() => null);
    const result = await Promise.race([requestPromise, timeoutPromise]);
    if (timeoutId) window.clearTimeout(timeoutId);
    return result;
}

async function switchLanguage(lang) {
    if (languageSwitchBusy) return;
    if (isNewAdventureTransitionBusy()) {
        setSettingsStatus(t("settings.language_transition_locked"), "success");
        return;
    }
    const currentLang = window.I18N && window.I18N.lang ? window.I18N.lang : null;
    if (lang && currentLang === lang) return;
    languageSwitchBusy = true;
    updateNewAdventureTransitionControls();
    try {
        const resp = await fetch("/api/language", {
            method: "POST",
            headers: {"Content-Type": "application/json"},
            body: JSON.stringify({language: lang}),
        });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.error || "Language switch failed");
        localStorage.setItem("cursed_canvas_lang", lang);
        await initI18N(lang);
        if (settingsData && settingsData.language) {
            settingsData.language.current = lang;
        }
        refreshAllUI(data.ui_state || null);
        await loadSettings(true);
    } catch (err) {
        console.error("Language switch error:", err);
    } finally {
        languageSwitchBusy = false;
        updateNewAdventureTransitionControls();
    }
}

function getCurrentInterfaceLanguage() {
    if (window.I18N && window.I18N.lang) return window.I18N.lang;
    const storedLang = localStorage.getItem("cursed_canvas_lang");
    if (storedLang) return storedLang;
    if (settingsData && settingsData.language && settingsData.language.current) return settingsData.language.current;
    return "en";
}

function refreshAllUI(sidePanelData) {
    if (typeof applyI18N === "function") applyI18N();
    if (locationBadge) locationBadge.textContent = t("game.location_badge_default");
    if (commandInput) commandInput.placeholder = t("game.input_placeholder");
    if (sendBtn) sendBtn.textContent = t("game.send");
    if (voiceStatus && (!voiceStatus.classList.contains("error") || voiceStatus.classList.contains("hint"))) {
        resetVoiceStatus();
    }
    updateVoiceButtonState();
    updateVoiceSettingsUi();
    if (panelToggle) panelToggle.textContent = sidePanel && sidePanel.classList.contains("collapsed") ? t("game.panel_toggle_collapsed") : t("game.panel_toggle");
    if (gameSettingsBtn) gameSettingsBtn.textContent = t("side_panel.settings");
    setLanguageDisplay();
    updateTutorialSettingsUi();
    updateCursorSettingsUi();
    renderTutorialSurfaces();
    updateQuickActions(currentWorld);
    updateSidePanel(sidePanelData || null);
    if (lastModelStatusData) updateModelStatus(lastModelStatusData);
    scheduleSettingsPanelHeightSync();
    // Gallery payload is language-specific, so cached pages must be discarded on language refresh.
    if (galleryPages.length > 0 || isGalleryOpen()) {
        galleryPages = [];
        galleryLanguage = null;
        galleryPageIndex = 0;
        if (isGalleryOpen()) {
            void loadGalleryPages();
        }
    }
}

// ── DOM references ──
const chatLog = document.getElementById("chat-log");
const commandForm = document.getElementById("command-form");
const commandInput = document.getElementById("command-input");
const voiceBtn = document.getElementById("voice-btn");
const voiceStatus = document.getElementById("voice-status");
const sendBtn = document.getElementById("send-btn");
const locationBadge = document.getElementById("location-badge");
const responseBadge = document.getElementById("response-badge");
const quickActions = document.getElementById("quick-actions");
const sidePanel = document.getElementById("side-panel");
const panelToggle = document.getElementById("panel-toggle");
const locationName = document.getElementById("location-name");
const locationDesc = document.getElementById("location-desc");
const exitsList = document.getElementById("exits-list");
const inventoryList = document.getElementById("inventory-list");
const openInventoryBtn = document.getElementById("open-inventory-btn");
const npcCard = document.getElementById("npc-card");
const npcPortraitLarge = document.getElementById("npc-portrait-large");
const npcNameDisplay = document.getElementById("npc-name-display");
const npcRoleDisplay = document.getElementById("npc-role-display");
const apiModelStatusText = document.getElementById("api-model-status-text");
const localChatModelStatusText = document.getElementById("local-chat-model-status-text");
const localVoiceModelStatusText = document.getElementById("local-voice-model-status-text");
const loadingOverlay = document.getElementById("loading-overlay");
const titleScreen = document.getElementById("title-screen");
const titleParticleCanvas = document.getElementById("title-particles-canvas");
const titleParticleCtx = titleParticleCanvas ? titleParticleCanvas.getContext("2d") : null;
const titleContinue = document.querySelector(".title-continue");
const startScreen = document.getElementById("start-screen");
const startParticleCanvas = document.getElementById("start-particles-canvas");
const startParticleCtx = startParticleCanvas ? startParticleCanvas.getContext("2d") : null;
const startMenu = document.getElementById("start-menu");
const introStory = document.getElementById("intro-story");
const introCopy = document.querySelector(".intro-copy");
const newAdventureBtn = document.getElementById("new-adventure-btn");
const continueGameBtn = document.getElementById("continue-game-btn");
const galleryBtn = document.getElementById("gallery-btn");
const settingsBtn = document.getElementById("settings-btn");
const galleryView = document.getElementById("gallery-view");
const galleryBackBtn = document.getElementById("gallery-back-btn");
const galleryPage = document.getElementById("gallery-page");
const galleryPrevBtn = document.getElementById("gallery-prev-btn");
const galleryNextBtn = document.getElementById("gallery-next-btn");
const galleryIndicator = document.getElementById("gallery-indicator");
const settingsView = document.getElementById("settings-view");
const settingsBackBtn = document.getElementById("settings-back-btn");
const settingsCard = settingsView ? settingsView.querySelector(".settings-card") : null;
const settingsTabButtons = Array.from(document.querySelectorAll("[data-settings-tab]"));
const settingsTabPanels = Array.from(document.querySelectorAll("[data-settings-tab-panel]"));
const settingsFlowPrevBtn = document.getElementById("settings-flow-prev-btn");
const settingsFlowNextBtn = document.getElementById("settings-flow-next-btn");
const settingsStatus = document.getElementById("settings-status");
const languagePrevBtn = document.getElementById("language-prev-btn");
const languageNextBtn = document.getElementById("language-next-btn");
const languageValue = document.getElementById("language-value");
const tutorialEnabledCheckbox = document.getElementById("tutorial-enabled-checkbox");
const tutorialPreferenceNote = document.getElementById("tutorial-preference-note");
const modelPrevBtn = document.getElementById("model-prev-btn");
const modelNextBtn = document.getElementById("model-next-btn");
const modelProviderValue = document.getElementById("model-provider-value");
const voiceBackendPrevBtn = document.getElementById("voice-backend-prev-btn");
const voiceBackendNextBtn = document.getElementById("voice-backend-next-btn");
const voiceBackendValue = document.getElementById("voice-backend-value");
const voiceBackendNote = document.getElementById("voice-backend-note");
const voiceRuntimePanel = document.getElementById("voice-runtime-panel");
const voiceCorrectionPrevBtn = document.getElementById("voice-correction-prev-btn");
const voiceCorrectionNextBtn = document.getElementById("voice-correction-next-btn");
const voiceCorrectionValue = document.getElementById("voice-correction-value");
const voiceAutoSendCheckbox = document.getElementById("voice-auto-send-checkbox");
const voicePreferenceNote = document.getElementById("voice-preference-note");
const voiceRuntimeDot = document.getElementById("voice-runtime-dot");
const voiceRuntimeStatus = document.getElementById("voice-runtime-status");
const voiceRuntimeDetail = document.getElementById("voice-runtime-detail");
const cursorStyleCheckbox = document.getElementById("cursor-style-checkbox");
const cursorTrailCheckbox = document.getElementById("cursor-trail-checkbox");
const cursorTipGlowCheckbox = document.getElementById("cursor-tip-glow-checkbox");
const cursorClickEffectCheckbox = document.getElementById("cursor-click-effect-checkbox");
const cursorStyleNote = document.getElementById("cursor-style-note");
const cursorTrailNote = document.getElementById("cursor-trail-note");
const cursorTipGlowNote = document.getElementById("cursor-tip-glow-note");
const cursorClickEffectNote = document.getElementById("cursor-click-effect-note");
const cursorPreviewPanel = document.querySelector(".cursor-preview-panel");
const cursorTipGlowRadiusControl = document.getElementById("cursor-tip-glow-radius-control");
const cursorTipGlowRadiusPrevBtn = document.getElementById("cursor-tip-glow-radius-prev-btn");
const cursorTipGlowRadiusNextBtn = document.getElementById("cursor-tip-glow-radius-next-btn");
const cursorTipGlowRadiusValue = document.getElementById("cursor-tip-glow-radius-value");
const cursorTipGlowRadiusNote = document.getElementById("cursor-tip-glow-radius-note");
const cursorTrailStyleControl = document.getElementById("cursor-trail-style-control");
const cursorTrailStylePrevBtn = document.getElementById("cursor-trail-style-prev-btn");
const cursorTrailStyleNextBtn = document.getElementById("cursor-trail-style-next-btn");
const cursorTrailStyleValue = document.getElementById("cursor-trail-style-value");
const deepseekSettingsPanel = document.getElementById("deepseek-settings-panel");
const localModelSettingsPanel = document.getElementById("local-model-settings-panel");
const experienceTokenPercent = document.getElementById("experience-token-percent");
const experienceTokenBar = document.getElementById("experience-token-bar");
const experienceTokenNote = document.getElementById("experience-token-note");
const experienceServiceDot = document.getElementById("experience-service-dot");
const experienceServiceStatus = document.getElementById("experience-service-status");
const experienceServiceDetail = document.getElementById("experience-service-detail");
const experienceUnlockInput = document.getElementById("experience-unlock-input");
const experienceUnlockBtn = document.getElementById("experience-unlock-btn");
const personalApiToggle = document.getElementById("personal-api-toggle");
const personalApiFields = document.getElementById("personal-api-fields");
const personalApiKeyInput = document.getElementById("personal-api-key-input");
const personalApiSaveBtn = document.getElementById("personal-api-save-btn");
const personalApiHelp = document.getElementById("personal-api-help");
const localModelDot = document.getElementById("local-model-dot");
const localModelStatus = document.getElementById("local-model-status");
const localModelPercent = document.getElementById("local-model-percent");
const localModelProgressBar = document.getElementById("local-model-progress-bar");
const localModelDetail = document.getElementById("local-model-detail");
const startStatus = document.getElementById("start-status");
const saveProgressBtn = document.getElementById("save-progress-btn");
const gameSettingsBtn = document.getElementById("game-settings-btn");
const saveSlotDialog = document.getElementById("save-slot-dialog");
const saveSlotKicker = document.getElementById("save-slot-kicker");
const saveSlotTitle = document.getElementById("save-slot-title");
const saveSlotCopy = document.getElementById("save-slot-copy");
const saveSlotList = document.getElementById("save-slot-list");
const saveSlotStatus = document.getElementById("save-slot-status");
const saveSlotCloseBtn = document.getElementById("save-slot-close-btn");
const inventoryDialog = document.getElementById("inventory-dialog");
const inventorySections = document.getElementById("inventory-sections");
const inventoryStatus = document.getElementById("inventory-status");
const inventoryCloseBtn = document.getElementById("inventory-close-btn");
const tutorialView = document.getElementById("tutorial-view");
const tutorialBackBtn = document.getElementById("tutorial-back-btn");
const tutorialPrevBtn = document.getElementById("tutorial-prev-btn");
const tutorialNextBtn = document.getElementById("tutorial-next-btn");
const tutorialPage = document.getElementById("tutorial-page");
const tutorialDialog = document.getElementById("tutorial-dialog");
const tutorialDialogContent = document.getElementById("tutorial-dialog-content");
const tutorialCloseBtn = document.getElementById("tutorial-close-btn");
const endGameBtn = document.getElementById("end-game-btn");
const endGameDialog = document.getElementById("end-game-dialog");
const cancelEndGameBtn = document.getElementById("cancel-end-game-btn");
const confirmEndGameBtn = document.getElementById("confirm-end-game-btn");
const confirmDialog = document.getElementById("confirm-dialog");
const confirmTitle = document.getElementById("confirm-title");
const confirmMessage = document.getElementById("confirm-message");
const confirmCancelBtn = document.getElementById("confirm-cancel-btn");
const confirmActionBtn = document.getElementById("confirm-action-btn");

let isWaiting = false;
let currentWorld = "museum";
let currentMode = "api";
let settingsModelView = "api";
let gameEndingTriggered = false;
let startScreenDismissed = false;
let galleryPages = [];
let galleryPageIndex = 0;
let galleryIsLoading = false;
let galleryLanguage = null;
let settingsData = null;
let settingsBusy = false;
let voiceSettingsBusy = false;
let pendingVoiceSettingsPatch = null;
let voiceSettingsDraft = null;
let settingsHeightSyncFrame = null;
let languageSwitchBusy = false;
let voiceListening = false;
let voiceBusy = false;
let voiceBaseInput = "";
let voiceInputEnabled = true;
let voiceMediaStream = null;
let voiceAudioContext = null;
let voiceSourceNode = null;
let voiceProcessorNode = null;
let voicePcmChunks = [];
let voiceRecordingSampleRate = 16000;
let voiceRecordingTimer = null;
let voiceFinishing = false;
let voiceRecordingSequence = 0;
let voiceCurrentRecordingId = 0;
let voiceActiveRequestId = 0;
let voiceStatusResetTimer = null;
let voiceWarmupScheduled = false;
let voiceWarmupTimer = null;
let settingsReturnTarget = "menu";
let settingsActiveTab = "display";
let lastModelStatusData = null;
let localModelReadyNoticeShown = false;
let gameInputWasEnabledBeforeSettings = false;
let newAdventureFlowActive = false;
let newAdventurePrepared = false;
let newAdventurePreparing = false;
let newAdventureTransitionLocked = false;
let tutorialDialogReturnFocus = null;
let galleryTransitionDirection = "next";
let galleryTransitionTimer = null;
let galleryBackdropTimer = null;
let saveSlotMode = "load";
let saveSlotBusy = false;
let saveSlots = Array(3).fill(null);
let activeSaveSlotIndex = null;
let hasUnsavedProgress = false;
let pendingConfirmation = null;
let recentlyChangedSlotIndex = null;
let inventoryTimeline = [];
let inventoryDetails = [];
let dynamicWorldOrder = [];
let cursorTrailLayer = null;
let cursorTrailEnabled = false;
let cursorTrailListenerAttached = false;
let cursorTrailPalette = [];
let cursorTrailDots = [];
let cursorTrailLastX = 0;
let cursorTrailLastY = 0;
let cursorTrailLastTime = 0;
let cursorTrailLastDeltaX = 0;
let cursorTrailLastDeltaY = 0;
let cursorTrailPointHistory = [];
let cursorClickFeedbackEnabled = false;
let cursorClickListenerAttached = false;
let cursorClickElements = [];
const worldTransition = document.getElementById("world-transition");
let startParticles = [];
let startParticleFrameId = null;
const START_PARTICLE_COUNT = 130;
const START_PARTICLE_THEME_COLORS = {
    museum: [
        [212, 168, 67],
        [74, 139, 194],
        [123, 94, 167],
        [245, 240, 224]
    ],
    starry_night: [
        [255, 215, 0],
        [91, 155, 213],
        [155, 126, 200],
        [240, 232, 200]
    ],
    great_wave: [
        [216, 186, 98],
        [64, 124, 143],
        [88, 150, 139],
        [242, 247, 239]
    ],
    impression_sunrise: [
        [245, 156, 86],
        [127, 178, 188],
        [154, 143, 188],
        [255, 241, 223]
    ]
};
let startParticlePaletteFrom = START_PARTICLE_THEME_COLORS.museum;
let startParticlePaletteTo = START_PARTICLE_THEME_COLORS.museum;
let startParticlePaletteStartedAt = 0;
const START_PARTICLE_THEME_TRANSITION_MS = 680;
const WORLD_ORDER = ["museum", "starry_night", "great_wave", "impression_sunrise"];
const ITEM_METADATA = {
    "Enchanted Lantern": { id: "lantern", world: "starry_night", emoji: "🏮", descriptionKey: "item_descriptions.lantern" },
    "Stolen Yellow Pigment": { id: "yellow_pigment", world: "starry_night", emoji: "🟡", descriptionKey: "item_descriptions.yellow_pigment" },
    "Shell Flute": { id: "shell_flute", world: "great_wave", emoji: "🐚", descriptionKey: "item_descriptions.shell_flute" },
    "Calming Stone": { id: "calming_stone", world: "great_wave", emoji: "🪨", descriptionKey: "item_descriptions.calming_stone" },
    "Mist Lens": { id: "mist_lens", world: "impression_sunrise", emoji: "🔍", descriptionKey: "item_descriptions.mist_lens" },
    "Sunrise Pigment": { id: "sunrise_pigment", world: "impression_sunrise", emoji: "🧡", descriptionKey: "item_descriptions.sunrise_pigment" },
    // Chinese translated names (for i18n-aware lookup)
    "魔法灯笼": { id: "lantern", world: "starry_night", emoji: "🏮", descriptionKey: "item_descriptions.lantern" },
    "失窃的黄色颜料": { id: "yellow_pigment", world: "starry_night", emoji: "🟡", descriptionKey: "item_descriptions.yellow_pigment" },
    "海螺笛": { id: "shell_flute", world: "great_wave", emoji: "🐚", descriptionKey: "item_descriptions.shell_flute" },
    "安宁石": { id: "calming_stone", world: "great_wave", emoji: "🪨", descriptionKey: "item_descriptions.calming_stone" },
    "雾透镜": { id: "mist_lens", world: "impression_sunrise", emoji: "🔍", descriptionKey: "item_descriptions.mist_lens" },
    "日出颜料": { id: "sunrise_pigment", world: "impression_sunrise", emoji: "🧡", descriptionKey: "item_descriptions.sunrise_pigment" },
};
const ITEM_EMOJI_POOL = [
    "🗝️", "📜", "🧭", "🪞", "💎", "🕯️", "⚙️", "🎨", "🧵", "🪶",
    "🔔", "🧪", "📘", "🌙", "☀️", "🪙", "🧿", "🧰", "🗿", "🎭",
    "🪄", "🧲", "🧱", "🪵", "🧫", "📯", "🔮", "🪤", "🧬", "🎐"
];
const GENERATED_ITEM_METADATA = {};
const UNKNOWN_ITEM_EMOJI = "📦";
const LANG_LABELS = {en: "English", zh: "\u7B80\u4F53\u4E2D\u6587"};
const SETTINGS_MODEL_OPTIONS = [
    { mode: "api", labelKey: "model_status.api_label" },
    { mode: "local", labelKey: "model_status.local_label" },
];
const VOICE_CORRECTION_OPTIONS = [
    { value: "low", labelKey: "settings.voice_correction_low" },
    { value: "balanced", labelKey: "settings.voice_correction_balanced" },
    { value: "high", labelKey: "settings.voice_correction_high" },
];
const VOICE_BACKEND_OPTIONS = [
    { value: "auto", labelKey: "settings.voice_backend_auto", noteKey: "settings.voice_backend_auto_note" },
    { value: "local", labelKey: "settings.voice_backend_local", noteKey: "settings.voice_backend_local_note" },
    { value: "online", labelKey: "settings.voice_backend_online", noteKey: "settings.voice_backend_online_note" },
];
const DEFAULT_VOICE_SETTINGS = {
    correction_strength: "balanced",
    correction_backend: "auto",
    auto_send: false,
};
const VOICE_MAX_RECORDING_MS = 12000;
const VOICE_MIN_RECORDING_SECONDS = 0.25;
const VOICE_ANALYSIS_FRAME_SECONDS = 0.05;
const VOICE_SILENCE_PADDING_SECONDS = 0.12;
const VOICE_MIN_RMS = 0.0035;
const VOICE_MIN_PEAK = 0.018;
const VOICE_FRAME_RMS = 0.006;
const VOICE_FRAME_PEAK = 0.025;
const VOICE_MIN_VOICED_SECONDS = 0.15;
const VOICE_MIN_DYNAMIC_RATIO = 1.7;
const VOICE_MIN_PEAK_RMS_RATIO = 2.6;
const VOICE_MAX_FLAT_VOICED_RATIO = 0.92;
const TUTORIAL_ENABLED_STORAGE_KEY = "theCursedCanvas.tutorialEnabled.v1";
const TUTORIAL_SEEN_STORAGE_KEY = "theCursedCanvas.tutorialSeen.v1";
const CURSOR_STYLE_STORAGE_KEY = "theCursedCanvas.cursorStyleEnabled.v1";
const CURSOR_TRAIL_STORAGE_KEY = "theCursedCanvas.cursorTrailEnabled.v1";
const CURSOR_TIP_GLOW_STORAGE_KEY = "theCursedCanvas.cursorTipGlowEnabled.v1";
const CURSOR_TIP_GLOW_RADIUS_STORAGE_KEY = "theCursedCanvas.cursorTipGlowRadius.v1";
const CURSOR_CLICK_EFFECT_STORAGE_KEY = "theCursedCanvas.cursorClickEffectEnabled.v1";
const CURSOR_TRAIL_STYLE_STORAGE_KEY = "theCursedCanvas.cursorTrailStyle.v1";
const CURSOR_TRAIL_MAX_DOTS = 36;
const CURSOR_CLICK_MAX_ELEMENTS = 30;
const CURSOR_TIP_GLOW_RADIUS_OPTIONS = [
    { value: "small", labelKey: "settings.cursor_tip_glow_radius_small", noteKey: "settings.cursor_tip_glow_radius_small_note", radius: 4.6, blur: 1.7, opacity: 0.34 },
    { value: "medium", labelKey: "settings.cursor_tip_glow_radius_medium", noteKey: "settings.cursor_tip_glow_radius_medium_note", radius: 6.7, blur: 2.25, opacity: 0.4 },
    { value: "large", labelKey: "settings.cursor_tip_glow_radius_large", noteKey: "settings.cursor_tip_glow_radius_large_note", radius: 9.1, blur: 2.95, opacity: 0.46 },
];
const CURSOR_TRAIL_STYLE_OPTIONS = [
    { value: "laser", labelKey: "settings.cursor_trail_style_laser", noteKey: "settings.cursor_trail_laser_note" },
    { value: "stardust", labelKey: "settings.cursor_trail_style_stardust", noteKey: "settings.cursor_trail_stardust_note" },
];

// ── Title screen flow ──

function resizeTitleParticleCanvas() {
    if (!titleParticleCanvas || !titleParticleCtx) return;
    const dpr = window.devicePixelRatio || 1;
    titleParticleCanvas.width = Math.floor(window.innerWidth * dpr);
    titleParticleCanvas.height = Math.floor(window.innerHeight * dpr);
    titleParticleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function createTitleParticle(type) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const kind = type || (Math.random() > 0.68 ? "streak" : "mote");
    return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: kind === "streak" ? Math.random() * 2.0 + 0.8 : Math.random() * 3.0 + 0.5,
        vx: kind === "streak" ? Math.random() * 0.42 + 0.22 : (Math.random() - 0.5) * 0.3,
        vy: kind === "streak" ? -Math.random() * 0.32 - 0.1 : -Math.random() * 0.32 - 0.06,
        opacity: kind === "streak" ? Math.random() * 0.32 + 0.26 : Math.random() * 0.42 + 0.16,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.85 + 0.5,
        length: kind === "streak" ? Math.random() * 40 + 22 : 0,
        colorIndex: Math.floor(Math.random() * TITLE_PARTICLE_THEME_COLORS.length),
        type: kind
    };
}

function resetTitleParticles() {
    titleParticles = [];
    for (let i = 0; i < TITLE_PARTICLE_COUNT; i++) {
        titleParticles.push(createTitleParticle());
    }
}

function drawTitleParticles() {
    if (!titleParticleCanvas || !titleParticleCtx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = Date.now() * 0.001;
    const energy = 1.0;

    titleParticleCtx.clearRect(0, 0, w, h);
    titleParticleCtx.save();
    titleParticleCtx.globalCompositeOperation = "lighter";

    titleParticles.forEach((p) => {
        p.phase += 0.016 * p.speed * energy;
        p.x += p.vx * energy + Math.sin(t * p.speed + p.phase) * 0.15;
        p.y += p.vy * energy + Math.cos(t * 0.9 + p.phase) * 0.08;

        if (p.y < -50 || p.x > w + 60 || p.x < -60) {
            Object.assign(p, createTitleParticle(p.type));
            p.y = h + Math.random() * 40;
            p.x = Math.random() * w;
        }

        const shimmer = Math.sin(t * p.speed * 2.8 + p.phase) * 0.35 + 0.65;
        const alpha = p.opacity * shimmer;
        const palette = TITLE_PARTICLE_THEME_COLORS;
        const color = palette[p.colorIndex % palette.length];
        const particleColor = color.join(", ");

        if (p.type === "streak") {
            const drift = Math.sin(p.phase) * 10;
            const gradient = titleParticleCtx.createLinearGradient(
                p.x, p.y,
                p.x - p.length - drift, p.y + p.length * 0.28
            );
            gradient.addColorStop(0, `rgba(${particleColor}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${particleColor}, 0)`);
            titleParticleCtx.strokeStyle = gradient;
            titleParticleCtx.lineWidth = p.r;
            titleParticleCtx.beginPath();
            titleParticleCtx.moveTo(p.x, p.y);
            titleParticleCtx.lineTo(p.x - p.length - drift, p.y + p.length * 0.28);
            titleParticleCtx.stroke();
        } else {
            titleParticleCtx.beginPath();
            titleParticleCtx.arc(p.x, p.y, p.r * (0.75 + shimmer * 0.4), 0, Math.PI * 2);
            titleParticleCtx.fillStyle = `rgba(${particleColor}, ${alpha})`;
            titleParticleCtx.fill();
        }
    });

    titleParticleCtx.restore();
    titleParticleFrameId = requestAnimationFrame(drawTitleParticles);
}

function startTitleParticles(options = {}) {
    if (!titleParticleCanvas || !titleParticleCtx) return;
    if (options.restart && titleParticleFrameId) {
        stopTitleParticles();
    }
    if (titleParticleFrameId) return;
    resizeTitleParticleCanvas();
    resetTitleParticles();
    drawTitleParticles();
}

function stopTitleParticles() {
    if (titleParticleFrameId) {
        cancelAnimationFrame(titleParticleFrameId);
        titleParticleFrameId = null;
    }
    if (titleParticleCtx) {
        titleParticleCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
}

function restartTitleScreenEntranceAnimation() {
    if (!titleScreen || titleScreen.classList.contains("hidden")) return;
    const animated = [
        titleScreen.querySelector(".title-screen-content"),
        titleScreen.querySelector(".title-kicker"),
        titleScreen.querySelector(".title-main"),
        titleScreen.querySelector(".title-continue"),
    ].filter(Boolean);
    if (titleParticleCanvas) titleParticleCanvas.classList.remove("fading");
    titleScreen.classList.remove("dismissing");
    if (titleContinue) titleContinue.classList.remove("hiding");
    animated.forEach((el) => {
        el.style.animation = "none";
    });
    void titleScreen.offsetHeight;
    animated.forEach((el) => {
        el.style.animation = "";
    });
}

function scheduleVoiceWarmupAfterFirstPaint(delayMs = 1600) {
    if (voiceWarmupScheduled) return;
    voiceWarmupScheduled = true;
    if (voiceWarmupTimer) window.clearTimeout(voiceWarmupTimer);
    voiceWarmupTimer = window.setTimeout(() => {
        const runWarmup = () => {
            warmupVoiceModelForPreload().catch(() => {});
        };
        if (typeof window.requestIdleCallback === "function") {
            window.requestIdleCallback(runWarmup, { timeout: 2500 });
        } else {
            window.setTimeout(runWarmup, 300);
        }
    }, Math.max(0, delayMs));
}

function dismissTitleScreen() {
    if (titleScreenDismissed || !titleScreen) return;
    titleScreenDismissed = true;

    const bridgeTitle = document.getElementById("transition-title");
    const titleMain = document.querySelector(".title-main");
    const titleKicker = document.querySelector(".title-kicker");
    const titleContinue = document.querySelector(".title-continue");
    const startMenuKicker = document.querySelector("#start-menu .start-kicker");
    const startMenuTitle = document.querySelector("#start-menu .start-title");

    if (!bridgeTitle || !startScreen) return;

    // 1. Hide "press any key" instantly
    if (titleContinue) titleContinue.classList.add("hiding");

    // 2. Capture title screen position of the title text
    const fromRect = titleMain.getBoundingClientRect();

    // 3. Show start screen (invisible) and measure its title position
    showStartView("menu");
    startScreen.classList.remove("hidden");
    startScreen.classList.add("entering");
    setStartParticleTheme("museum");
    if (startParticleCanvas) startParticleCanvas.style.opacity = "0";

    const toRect = startMenuTitle.getBoundingClientRect();
    const kickerToRect = startMenuKicker.getBoundingClientRect();

    // 4. Hide start menu's own kicker and title (bridge takes over)
    startMenuKicker.classList.remove("visible");
    startMenuKicker.style.opacity = "0";
    startMenuTitle.classList.remove("visible");
    startMenuTitle.style.opacity = "0";

    // 5. Position bridge overlay at the title screen location
    const dx = toRect.left - fromRect.left + (toRect.width - fromRect.width) / 2;
    const dy = toRect.top - fromRect.top + (toRect.height - fromRect.height) / 2;

    bridgeTitle.classList.remove("hidden");
    bridgeTitle.style.transform = "";

    // Copy current text into bridge (i18n-safe)
    const bridgeKicker = bridgeTitle.querySelector(".transition-title-kicker");
    const bridgeMain = bridgeTitle.querySelector(".transition-title-main");
    if (bridgeKicker) bridgeKicker.textContent = titleKicker ? titleKicker.textContent : "";
    if (bridgeMain) {
        bridgeMain.textContent = titleMain.textContent;
        bridgeMain.setAttribute("data-text", titleMain.getAttribute("data-text") || titleMain.textContent);
    }

    // 6. Start particles on start screen
    startStartParticles();

    // 7. Hide title screen content, fade particles
    const content = titleScreen.querySelector(".title-screen-content");
    if (content) content.style.opacity = "0";
    if (titleParticleCanvas) titleParticleCanvas.classList.add("fading");

    // 8. Animate: bridge slides + shrinks, start screen fades in
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            bridgeTitle.classList.add("animate");
            bridgeTitle.style.transform = `translate(${dx}px, ${dy}px)`;
            startScreen.classList.add("show");
            if (startParticleCanvas) startParticleCanvas.style.transition = "opacity 0.55s ease 0.1s";
            if (startParticleCanvas) startParticleCanvas.style.opacity = "1";
        });
    });

    // 9. After transition completes, remove bridge and reveal real start elements
    setTimeout(() => {
        bridgeTitle.classList.add("hidden");
        bridgeTitle.classList.remove("animate");
        bridgeTitle.style.transform = "";
        titleScreen.classList.add("hidden");
        titleScreen.classList.remove("dismissing");
        if (content) content.style.opacity = "";
        stopTitleParticles();

        // Reveal start menu's real kicker/title
        startMenuKicker.classList.add("visible");
        startMenuTitle.classList.add("visible");

        // Reveal buttons staggered
        const btns = document.querySelectorAll("#start-menu .start-btn");
        btns.forEach((btn, i) => {
            btn.style.animationDelay = (0.08 * i) + "s";
            btn.classList.add("revealed");
        });

        if (newAdventureBtn) newAdventureBtn.focus();
    }, 650);
}

// ── Start screen flow ──
function setGameInputEnabled(enabled) {
    commandInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
    voiceInputEnabled = Boolean(enabled);
    updateVoiceButtonState();
}

function resizeStartParticleCanvas() {
    if (!startParticleCanvas || !startParticleCtx) return;
    const dpr = window.devicePixelRatio || 1;
    startParticleCanvas.width = Math.floor(window.innerWidth * dpr);
    startParticleCanvas.height = Math.floor(window.innerHeight * dpr);
    startParticleCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function createStartParticle(type) {
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const kind = type || (Math.random() > 0.76 ? "streak" : "mote");
    return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: kind === "streak" ? Math.random() * 1.3 + 0.6 : Math.random() * 2.2 + 0.35,
        vx: kind === "streak" ? Math.random() * 0.32 + 0.18 : (Math.random() - 0.5) * 0.22,
        vy: kind === "streak" ? -Math.random() * 0.22 - 0.06 : -Math.random() * 0.24 - 0.04,
        opacity: kind === "streak" ? Math.random() * 0.26 + 0.22 : Math.random() * 0.34 + 0.12,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.7 + 0.45,
        length: kind === "streak" ? Math.random() * 28 + 18 : 0,
        colorIndex: Math.floor(Math.random() * START_PARTICLE_THEME_COLORS.museum.length),
        type: kind
    };
}

function blendRgb(from, to, progress) {
    return from.map((channel, index) => Math.round(channel + (to[index] - channel) * progress));
}

function getCurrentStartParticlePalette() {
    const elapsed = performance.now() - startParticlePaletteStartedAt;
    const rawProgress = Math.min(1, Math.max(0, elapsed / START_PARTICLE_THEME_TRANSITION_MS));
    const easedProgress = 1 - Math.pow(1 - rawProgress, 3);
    return startParticlePaletteTo.map((targetColor, index) => {
        const sourceColor = startParticlePaletteFrom[index % startParticlePaletteFrom.length];
        return blendRgb(sourceColor, targetColor, easedProgress);
    });
}

function getStartParticleColor(colorIndex) {
    const palette = getCurrentStartParticlePalette();
    const color = palette[colorIndex % palette.length];
    return color.join(", ");
}

function setStartParticleTheme(worldId) {
    const targetPalette = START_PARTICLE_THEME_COLORS[worldId] || START_PARTICLE_THEME_COLORS.museum;
    startParticlePaletteFrom = getCurrentStartParticlePalette();
    startParticlePaletteTo = targetPalette;
    startParticlePaletteStartedAt = performance.now();
    applyCursorTheme(worldId);
}

function resetStartParticles() {
    startParticles = [];
    for (let i = 0; i < START_PARTICLE_COUNT; i++) {
        startParticles.push(createStartParticle());
    }
}

function drawStartParticles() {
    if (!startParticleCanvas || !startParticleCtx) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const t = Date.now() * 0.001;
    const storyFlowActive = (introStory && introStory.classList.contains("active"))
        || (tutorialView && tutorialView.classList.contains("active"));
    const energy = storyFlowActive ? 1.22 : 1;

    startParticleCtx.clearRect(0, 0, w, h);
    startParticleCtx.save();
    startParticleCtx.globalCompositeOperation = "lighter";

    startParticles.forEach((p) => {
        p.phase += 0.012 * p.speed * energy;
        p.x += p.vx * energy + Math.sin(t * p.speed + p.phase) * 0.12;
        p.y += p.vy * energy + Math.cos(t * 0.8 + p.phase) * 0.06;

        if (p.y < -40 || p.x > w + 50 || p.x < -50) {
            Object.assign(p, createStartParticle(p.type));
            p.y = h + Math.random() * 35;
            p.x = Math.random() * w;
        }

        const shimmer = Math.sin(t * p.speed * 2.6 + p.phase) * 0.35 + 0.65;
        const alpha = p.opacity * shimmer;
        const particleColor = getStartParticleColor(p.colorIndex);

        if (p.type === "streak") {
            const drift = Math.sin(p.phase) * 8;
            const gradient = startParticleCtx.createLinearGradient(
                p.x,
                p.y,
                p.x - p.length - drift,
                p.y + p.length * 0.28
            );
            gradient.addColorStop(0, `rgba(${particleColor}, ${alpha})`);
            gradient.addColorStop(1, `rgba(${particleColor}, 0)`);
            startParticleCtx.strokeStyle = gradient;
            startParticleCtx.lineWidth = p.r;
            startParticleCtx.beginPath();
            startParticleCtx.moveTo(p.x, p.y);
            startParticleCtx.lineTo(p.x - p.length - drift, p.y + p.length * 0.28);
            startParticleCtx.stroke();
        } else {
            startParticleCtx.beginPath();
            startParticleCtx.arc(p.x, p.y, p.r * (0.8 + shimmer * 0.35), 0, Math.PI * 2);
            startParticleCtx.fillStyle = `rgba(${particleColor}, ${alpha})`;
            startParticleCtx.fill();
        }
    });

    startParticleCtx.restore();
    startParticleFrameId = requestAnimationFrame(drawStartParticles);
}

function startStartParticles() {
    if (!startParticleCanvas || !startParticleCtx || startParticleFrameId) return;
    resizeStartParticleCanvas();
    resetStartParticles();
    drawStartParticles();
}

function stopStartParticles() {
    if (startParticleFrameId) {
        cancelAnimationFrame(startParticleFrameId);
        startParticleFrameId = null;
    }
    if (startParticleCtx) {
        startParticleCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    }
}

function showStartView(view) {
    if (!startMenu || !introStory) return;
    startMenu.classList.toggle("active", view === "menu");
    if (galleryView) galleryView.classList.toggle("active", view === "gallery");
    if (settingsView) settingsView.classList.toggle("active", view === "settings");
    if (tutorialView) tutorialView.classList.toggle("active", view === "tutorial");
    introStory.classList.toggle("active", view === "intro");
}

function resetSettingsScrollPosition() {
    if (settingsCard) settingsCard.scrollTop = 0;
    if (settingsView) settingsView.scrollTop = 0;
    settingsTabPanels.forEach((panel) => {
        panel.scrollTop = 0;
    });
    document.querySelectorAll(".settings-model-panel").forEach((panel) => {
        panel.scrollTop = 0;
    });
}

function measureSettingsCardHeightForPanel(panel, options = {}) {
    if (!settingsCard || !panel) return 0;
    const previousStates = settingsTabPanels.map((item) => ({
        item,
        hidden: item.hidden,
        active: item.classList.contains("active"),
    }));
    settingsTabPanels.forEach((item) => {
        const isTarget = item === panel;
        item.hidden = !isTarget;
        item.classList.toggle("active", isTarget);
    });
    const mutableElements = [
        deepseekSettingsPanel,
        localModelSettingsPanel,
        personalApiFields,
        voiceRuntimePanel,
    ].filter(Boolean);
    const previousMutableStates = mutableElements.map((item) => ({
        item,
        hidden: item.classList.contains("hidden"),
    }));
    if (panel && panel.dataset.settingsTabPanel === "ai") {
        if (options.aiVariant === "api") {
            if (deepseekSettingsPanel) deepseekSettingsPanel.classList.remove("hidden");
            if (localModelSettingsPanel) localModelSettingsPanel.classList.add("hidden");
            if (personalApiFields) personalApiFields.classList.remove("hidden");
        } else if (options.aiVariant === "local") {
            if (deepseekSettingsPanel) deepseekSettingsPanel.classList.add("hidden");
            if (localModelSettingsPanel) localModelSettingsPanel.classList.remove("hidden");
        }
    } else if (panel && panel.dataset.settingsTabPanel === "voice") {
        if (voiceRuntimePanel) voiceRuntimePanel.classList.remove("hidden");
    }
    const hiddenDependentElements = [];
    if (panel && panel.dataset.settingsTabPanel === "cursor") {
        hiddenDependentElements.push(cursorTipGlowRadiusControl, cursorTrailStyleControl);
    }
    const previousHiddenDependentStates = hiddenDependentElements.filter(Boolean).map((item) => ({
        item,
        hidden: item.hidden,
    }));
    previousHiddenDependentStates.forEach(({ item }) => {
        item.hidden = false;
    });
    const cardStyle = window.getComputedStyle(settingsCard);
    const borderY = parseFloat(cardStyle.borderTopWidth || "0") + parseFloat(cardStyle.borderBottomWidth || "0");
    const measuredHeight = settingsCard.scrollHeight + borderY;
    previousHiddenDependentStates.forEach(({ item, hidden }) => {
        item.hidden = hidden;
    });
    previousMutableStates.forEach(({ item, hidden }) => {
        item.classList.toggle("hidden", hidden);
    });
    previousStates.forEach(({ item, hidden, active }) => {
        item.hidden = hidden;
        item.classList.toggle("active", active);
    });
    return measuredHeight;
}

function syncSettingsPanelHeights() {
    settingsHeightSyncFrame = null;
    if (!settingsView || !settingsCard || !settingsTabPanels.length) return;
    if (!settingsView.classList.contains("active")) return;
    if (window.matchMedia && window.matchMedia("(max-width: 480px)").matches) {
        settingsCard.style.setProperty("--settings-card-synced-height", "auto");
        settingsCard.classList.remove("settings-card-scroll-limited");
        return;
    }

    const previousHeight = settingsCard.style.getPropertyValue("--settings-card-synced-height");
    const previousVisibility = settingsCard.style.visibility;
    settingsCard.style.setProperty("--settings-card-synced-height", "auto");
    settingsCard.classList.remove("settings-card-scroll-limited");
    settingsCard.style.visibility = "hidden";

    let maxHeight = 0;
    settingsTabPanels.forEach((panel) => {
        if (panel.dataset.settingsTabPanel === "ai") {
            maxHeight = Math.max(
                maxHeight,
                measureSettingsCardHeightForPanel(panel, { aiVariant: "api" }),
                measureSettingsCardHeightForPanel(panel, { aiVariant: "local" })
            );
            return;
        }
        maxHeight = Math.max(maxHeight, measureSettingsCardHeightForPanel(panel));
    });

    settingsCard.style.visibility = previousVisibility;
    if (!maxHeight) {
        if (previousHeight) settingsCard.style.setProperty("--settings-card-synced-height", previousHeight);
        return;
    }

    const computedCardStyle = window.getComputedStyle(settingsCard);
    const maxAllowed = parseFloat(computedCardStyle.maxHeight || "");
    const hasBoundary = Number.isFinite(maxAllowed) && maxAllowed > 0;
    const exceedsBoundary = hasBoundary && maxHeight > maxAllowed + 1;
    const targetHeight = exceedsBoundary ? maxAllowed : maxHeight;
    settingsCard.style.setProperty("--settings-card-synced-height", `${Math.ceil(targetHeight)}px`);
    settingsCard.classList.toggle("settings-card-scroll-limited", exceedsBoundary);
}

function scheduleSettingsPanelHeightSync() {
    if (!settingsView || !settingsCard) return;
    if (settingsHeightSyncFrame) window.cancelAnimationFrame(settingsHeightSyncFrame);
    settingsHeightSyncFrame = window.requestAnimationFrame(syncSettingsPanelHeights);
}

function setSettingsTab(tab, options = {}) {
    const selected = settingsTabPanels.some((panel) => panel.dataset.settingsTabPanel === tab) ? tab : "display";
    settingsActiveTab = selected;
    settingsTabButtons.forEach((button) => {
        const active = button.dataset.settingsTab === selected;
        button.classList.toggle("active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
        button.tabIndex = active ? 0 : -1;
    });
    settingsTabPanels.forEach((panel) => {
        const active = panel.dataset.settingsTabPanel === selected;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
    });
    if (options.resetScroll !== false) {
        window.requestAnimationFrame(resetSettingsScrollPosition);
    }
    scheduleSettingsPanelHeightSync();
}

function resetSettingsViewForOpen() {
    setSettingsTab("display");
    resetSettingsScrollPosition();
    window.requestAnimationFrame(resetSettingsScrollPosition);
    scheduleSettingsPanelHeightSync();
}

function showStartStatus(message) {
    if (!startStatus) return;
    startStatus.textContent = message;
    window.clearTimeout(showStartStatus.timer);
    showStartStatus.timer = window.setTimeout(() => {
        startStatus.textContent = "";
    }, 2400);
}

function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;"
    }[char]));
}

function readStoredBoolean(key) {
    try {
        const stored = localStorage.getItem(key);
        if (stored === "1") return true;
        if (stored === "0") return false;
    } catch (err) {
        console.warn("Stored preference could not be read:", err);
    }
    return null;
}

function writeStoredBoolean(key, value) {
    try {
        localStorage.setItem(key, value ? "1" : "0");
    } catch (err) {
        console.warn("Stored preference could not be written:", err);
    }
}

function readStoredString(key) {
    try {
        return localStorage.getItem(key);
    } catch (err) {
        console.warn("Stored preference could not be read:", err);
    }
    return null;
}

function writeStoredString(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (err) {
        console.warn("Stored preference could not be written:", err);
    }
}

function hasSeenTutorial() {
    return readStoredBoolean(TUTORIAL_SEEN_STORAGE_KEY) === true;
}

function markTutorialSeen() {
    writeStoredBoolean(TUTORIAL_SEEN_STORAGE_KEY, true);
}

function getTutorialEnabledPreference() {
    const storedPreference = readStoredBoolean(TUTORIAL_ENABLED_STORAGE_KEY);
    if (storedPreference !== null) return storedPreference;
    return !hasSeenTutorial();
}

function updateTutorialSettingsUi() {
    const storedPreference = readStoredBoolean(TUTORIAL_ENABLED_STORAGE_KEY);
    if (tutorialEnabledCheckbox) {
        tutorialEnabledCheckbox.checked = getTutorialEnabledPreference();
    }
    if (tutorialPreferenceNote) {
        if (storedPreference === true) {
            tutorialPreferenceNote.textContent = t("settings.tutorial_enabled_note");
        } else if (storedPreference === false) {
            tutorialPreferenceNote.textContent = t("settings.tutorial_disabled_note");
        } else {
            tutorialPreferenceNote.textContent = hasSeenTutorial()
                ? t("settings.tutorial_returning_note")
                : t("settings.tutorial_first_time_note");
        }
    }
}

function setTutorialEnabledPreference(enabled) {
    writeStoredBoolean(TUTORIAL_ENABLED_STORAGE_KEY, Boolean(enabled));
    updateTutorialSettingsUi();
}

function isTutorialEnabledForNewAdventure() {
    if (tutorialEnabledCheckbox) return Boolean(tutorialEnabledCheckbox.checked);
    return getTutorialEnabledPreference();
}

function getCursorStylePreference() {
    const storedPreference = readStoredBoolean(CURSOR_STYLE_STORAGE_KEY);
    return storedPreference !== false;
}

function getCursorTrailPreference() {
    const storedPreference = readStoredBoolean(CURSOR_TRAIL_STORAGE_KEY);
    return storedPreference !== false;
}

function getCursorTipGlowPreference() {
    const storedPreference = readStoredBoolean(CURSOR_TIP_GLOW_STORAGE_KEY);
    return storedPreference !== false;
}

function getCursorTipGlowRadiusPreference() {
    const storedPreference = readStoredString(CURSOR_TIP_GLOW_RADIUS_STORAGE_KEY);
    return CURSOR_TIP_GLOW_RADIUS_OPTIONS.some((option) => option.value === storedPreference)
        ? storedPreference
        : "medium";
}

function getCursorTipGlowRadiusIndex(radius) {
    const current = radius || getCursorTipGlowRadiusPreference();
    const index = CURSOR_TIP_GLOW_RADIUS_OPTIONS.findIndex((option) => option.value === current);
    return index >= 0 ? index : 1;
}

function getCursorClickEffectPreference() {
    const storedPreference = readStoredBoolean(CURSOR_CLICK_EFFECT_STORAGE_KEY);
    return storedPreference !== false;
}

function getCursorTrailStylePreference() {
    const storedPreference = readStoredString(CURSOR_TRAIL_STYLE_STORAGE_KEY);
    return CURSOR_TRAIL_STYLE_OPTIONS.some((option) => option.value === storedPreference)
        ? storedPreference
        : "laser";
}

function getCursorTrailStyleIndex(style) {
    const current = style || getCursorTrailStylePreference();
    const index = CURSOR_TRAIL_STYLE_OPTIONS.findIndex((option) => option.value === current);
    return index >= 0 ? index : 0;
}

function getCursorThemePalette(worldId) {
    const palette = START_PARTICLE_THEME_COLORS[worldId] || START_PARTICLE_THEME_COLORS.museum;
    return palette.map((color) => color.slice());
}

function getActiveCursorThemeWorld() {
    if (startScreen && !startScreen.classList.contains("hidden") && startScreen.dataset.galleryWorld) {
        return startScreen.dataset.galleryWorld;
    }
    return currentWorld || document.body.dataset.world || "museum";
}

function getCursorTipGlowRadiusOption(radius) {
    return CURSOR_TIP_GLOW_RADIUS_OPTIONS[getCursorTipGlowRadiusIndex(radius)];
}

function buildCursorDataUri(primary, secondary, highlight, tipGlowEnabled, tipGlowRadiusOption) {
    const glowOption = tipGlowRadiusOption || getCursorTipGlowRadiusOption();
    const glowRadius = glowOption.radius;
    const glowCoreRadius = Math.max(1.65, glowRadius * 0.33);
    const tipGlow = tipGlowEnabled ? `
            <circle cx="6.2" cy="3.4" r="${glowRadius}" fill="rgb(${primary.join(",")})" opacity="${glowOption.opacity}" filter="url(#tipGlow)"/>
            <circle cx="6.2" cy="3.4" r="${glowCoreRadius}" fill="rgb(${highlight.join(",")})" opacity="0.84"/>
    ` : "";
    const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="58" height="58" viewBox="-18 -18 58 58">
            <defs>
                <filter id="pointerShadow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur stdDeviation="1.7"/>
                </filter>
                <filter id="tipGlow" x="-80%" y="-80%" width="260%" height="260%">
                    <feGaussianBlur stdDeviation="${glowOption.blur}"/>
                </filter>
                <linearGradient id="edge" x1="7" y1="3" x2="22" y2="28" gradientUnits="userSpaceOnUse">
                    <stop offset="0" stop-color="rgb(${highlight.join(",")})"/>
                    <stop offset="0.58" stop-color="rgb(${primary.join(",")})"/>
                    <stop offset="1" stop-color="rgb(${secondary.join(",")})"/>
                </linearGradient>
            </defs>
            ${tipGlow}
            <path d="M6 3 L24 18.5 L16.2 20.2 L20.1 28.4 L16.2 30 L12.2 21.9 L6.9 27.2 Z" fill="rgb(${secondary.join(",")})" opacity="0.46" filter="url(#pointerShadow)"/>
            <path d="M6 3 L24 18.5 L16.2 20.2 L20.1 28.4 L16.2 30 L12.2 21.9 L6.9 27.2 Z" fill="url(#edge)" stroke="rgb(${highlight.join(",")})" stroke-width="1.15" stroke-linejoin="round"/>
            <path d="M9.4 8 L18.7 16.1 L14 17.1 L16.7 22.7" fill="none" stroke="rgb(13,13,26)" stroke-opacity="0.58" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
    `.trim();
    return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

function applyCursorTheme(worldId) {
    const palette = getCursorThemePalette(worldId || getActiveCursorThemeWorld());
    const primary = palette[0] || [212, 168, 67];
    const secondary = palette[1] || [74, 139, 194];
    const highlight = palette[3] || [245, 240, 224];
    cursorTrailPalette = palette;
    document.documentElement.style.setProperty("--cursor-trail-main-rgb", primary.join(", "));
    document.documentElement.style.setProperty("--cursor-trail-core-rgb", highlight.join(", "));
    document.documentElement.style.setProperty("--cursor-trail-shadow-rgb", secondary.join(", "));
    document.documentElement.style.setProperty("--game-cursor", `${buildCursorDataUri(primary, secondary, highlight, getCursorTipGlowPreference(), getCursorTipGlowRadiusOption())} 24 21`);
}

function ensureCursorTrailLayer() {
    if (cursorTrailLayer && cursorTrailLayer.parentNode) return cursorTrailLayer;
    cursorTrailLayer = document.createElement("div");
    cursorTrailLayer.className = "cursor-trail-layer";
    cursorTrailLayer.setAttribute("aria-hidden", "true");
    document.body.appendChild(cursorTrailLayer);
    return cursorTrailLayer;
}

function removeCursorTrailDot(dot) {
    if (!dot) return;
    cursorTrailDots = cursorTrailDots.filter((item) => item !== dot);
    if (dot.parentNode) dot.parentNode.removeChild(dot);
}

function clearCursorTrailDots() {
    cursorTrailDots.forEach((dot) => {
        if (dot.parentNode) dot.parentNode.removeChild(dot);
    });
    cursorTrailDots = [];
    cursorTrailLastTime = 0;
    cursorTrailLastDeltaX = 0;
    cursorTrailLastDeltaY = 0;
    cursorTrailPointHistory = [];
}

function removeCursorClickElement(element) {
    if (!element) return;
    cursorClickElements = cursorClickElements.filter((item) => item !== element);
    if (element.parentNode) element.parentNode.removeChild(element);
}

function clearCursorClickElements() {
    cursorClickElements.forEach((element) => {
        if (element.parentNode) element.parentNode.removeChild(element);
    });
    cursorClickElements = [];
}

function spawnCursorTrailDot(x, y, distance, now) {
    const layer = ensureCursorTrailLayer();
    const palette = cursorTrailPalette.length ? cursorTrailPalette : getCursorThemePalette(getActiveCursorThemeWorld());
    const colorIndex = Math.floor(now / 120) % palette.length;
    const primary = palette[colorIndex] || palette[0] || [212, 168, 67];
    const core = palette[(colorIndex + 3) % palette.length] || [245, 240, 224];
    const shadow = palette[(colorIndex + 1) % palette.length] || [74, 139, 194];
    const size = Math.max(10, Math.min(22, 10 + distance * 0.16));
    const dot = document.createElement("span");
    dot.className = "cursor-trail-dot";
    dot.style.left = `${x}px`;
    dot.style.top = `${y}px`;
    dot.style.width = `${size}px`;
    dot.style.height = `${size}px`;
    dot.style.setProperty("--trail-rgb", primary.join(", "));
    dot.style.setProperty("--trail-core-rgb", core.join(", "));
    dot.style.setProperty("--trail-shadow-rgb", shadow.join(", "));
    dot.addEventListener("animationend", () => removeCursorTrailDot(dot), { once: true });
    layer.appendChild(dot);
    cursorTrailDots.push(dot);
    while (cursorTrailDots.length > CURSOR_TRAIL_MAX_DOTS) {
        removeCursorTrailDot(cursorTrailDots[0]);
    }
}

function pushCursorTrailPoint(x, y, now) {
    const lastPoint = cursorTrailPointHistory[cursorTrailPointHistory.length - 1];
    if (lastPoint && Math.hypot(x - lastPoint.x, y - lastPoint.y) < 0.5) {
        lastPoint.t = now;
        return;
    }
    cursorTrailPointHistory.push({ x, y, t: now });
    while (cursorTrailPointHistory.length > 4) {
        cursorTrailPointHistory.shift();
    }
}

function sampleCatmullRomPoint(p0, p1, p2, p3, progress) {
    const t2 = progress * progress;
    const t3 = t2 * progress;
    return {
        x: 0.5 * (
            (2 * p1.x)
            + (-p0.x + p2.x) * progress
            + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
            + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3
        ),
        y: 0.5 * (
            (2 * p1.y)
            + (-p0.y + p2.y) * progress
            + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
            + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3
        ),
    };
}

function getCursorTrailTurnAmount() {
    if (cursorTrailPointHistory.length < 3) return 0;
    const p0 = cursorTrailPointHistory[cursorTrailPointHistory.length - 3];
    const p1 = cursorTrailPointHistory[cursorTrailPointHistory.length - 2];
    const p2 = cursorTrailPointHistory[cursorTrailPointHistory.length - 1];
    const ax = p1.x - p0.x;
    const ay = p1.y - p0.y;
    const bx = p2.x - p1.x;
    const by = p2.y - p1.y;
    const aLength = Math.hypot(ax, ay);
    const bLength = Math.hypot(bx, by);
    if (aLength < 0.1 || bLength < 0.1) return 0;
    const cosine = Math.max(-1, Math.min(1, (ax * bx + ay * by) / (aLength * bLength)));
    return Math.acos(cosine) / Math.PI;
}

function buildCursorTrailPathPoints(fromX, fromY, toX, toY, segmentCount) {
    const fallback = [];
    for (let i = 0; i <= segmentCount; i++) {
        const progress = i / segmentCount;
        fallback.push({
            x: fromX + (toX - fromX) * progress,
            y: fromY + (toY - fromY) * progress,
        });
    }
    if (cursorTrailPointHistory.length < 3) return fallback;

    const p0 = cursorTrailPointHistory[cursorTrailPointHistory.length - 3];
    const p1 = cursorTrailPointHistory[cursorTrailPointHistory.length - 2];
    const p2 = cursorTrailPointHistory[cursorTrailPointHistory.length - 1];
    const p3 = {
        x: p2.x + (p2.x - p1.x) * 0.55,
        y: p2.y + (p2.y - p1.y) * 0.55,
    };
    const points = [];
    for (let i = 0; i <= segmentCount; i++) {
        points.push(sampleCatmullRomPoint(p0, p1, p2, p3, i / segmentCount));
    }
    return points;
}

function spawnCursorTrailStreak(fromX, fromY, toX, toY, distance, now, ageIndex = 0, followX = 0, followY = 0) {
    const layer = ensureCursorTrailLayer();
    const palette = cursorTrailPalette.length ? cursorTrailPalette : getCursorThemePalette(getActiveCursorThemeWorld());
    const primary = palette[0] || [212, 168, 67];
    const core = palette[3] || [245, 240, 224];
    const shadow = palette[1] || [74, 139, 194];
    const safeDistance = Math.max(10, Math.min(distance || 10, 40));
    const angle = Math.atan2(toY - fromY, toX - fromX) * 180 / Math.PI;
    const centerX = (fromX + toX) / 2;
    const centerY = (fromY + toY) / 2;
    const thickness = Math.max(1.8, 5.4 - ageIndex * 0.42);
    const followScale = Math.max(0.45, 1 - ageIndex * 0.08);
    const streak = document.createElement("span");
    streak.className = "cursor-trail-streak";
    streak.style.left = `${centerX}px`;
    streak.style.top = `${centerY}px`;
    streak.style.width = `${safeDistance + 18}px`;
    streak.style.setProperty("--streak-thickness", `${thickness}px`);
    streak.style.setProperty("--streak-angle", `${angle}deg`);
    streak.style.setProperty("--streak-follow-x", `${followX * followScale}px`);
    streak.style.setProperty("--streak-follow-y", `${followY * followScale}px`);
    streak.style.setProperty("--trail-rgb", primary.join(", "));
    streak.style.setProperty("--trail-core-rgb", core.join(", "));
    streak.style.setProperty("--trail-shadow-rgb", shadow.join(", "));
    streak.addEventListener("animationend", () => removeCursorTrailDot(streak), { once: true });
    layer.appendChild(streak);
    cursorTrailDots.push(streak);
    while (cursorTrailDots.length > CURSOR_TRAIL_MAX_DOTS) {
        removeCursorTrailDot(cursorTrailDots[0]);
    }
}

function spawnCursorClickFeedback(x, y) {
    const layer = ensureCursorTrailLayer();
    const palette = cursorTrailPalette.length ? cursorTrailPalette : getCursorThemePalette(getActiveCursorThemeWorld());
    const primary = palette[0] || [212, 168, 67];
    const core = palette[3] || [245, 240, 224];
    const ripple = document.createElement("span");
    ripple.className = "cursor-click-ripple";
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.setProperty("--click-rgb", primary.join(", "));
    ripple.style.setProperty("--click-core-rgb", core.join(", "));
    ripple.addEventListener("animationend", () => removeCursorClickElement(ripple), { once: true });
    layer.appendChild(ripple);
    cursorClickElements.push(ripple);

    const sparkOffsets = [
        [9, -7],
        [13, 5],
        [-8, 9],
        [-11, -4],
    ];
    sparkOffsets.forEach(([sparkX, sparkY], index) => {
        const spark = document.createElement("span");
        spark.className = "cursor-click-spark";
        spark.style.left = `${x}px`;
        spark.style.top = `${y}px`;
        spark.style.width = `${index === 0 ? 4 : 3}px`;
        spark.style.height = spark.style.width;
        spark.style.setProperty("--spark-x", `${sparkX}px`);
        spark.style.setProperty("--spark-y", `${sparkY}px`);
        spark.style.setProperty("--click-rgb", primary.join(", "));
        spark.style.setProperty("--click-core-rgb", core.join(", "));
        spark.addEventListener("animationend", () => removeCursorClickElement(spark), { once: true });
        layer.appendChild(spark);
        cursorClickElements.push(spark);
    });

    while (cursorClickElements.length > CURSOR_CLICK_MAX_ELEMENTS) {
        removeCursorClickElement(cursorClickElements[0]);
    }
}

function handleCursorTrailMove(event) {
    if (!cursorTrailEnabled || document.hidden) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    const now = performance.now();
    const x = event.clientX;
    const y = event.clientY;
    const dx = cursorTrailLastTime ? x - cursorTrailLastX : 8;
    const dy = cursorTrailLastTime ? y - cursorTrailLastY : 0;
    const distance = cursorTrailLastTime ? Math.hypot(dx, dy) : 10;
    const elapsed = cursorTrailLastTime ? Math.max(8, now - cursorTrailLastTime) : 16;
    const trailStyle = getCursorTrailStylePreference();
    const minMs = trailStyle === "stardust" ? 16 : 8;
    const minDistance = trailStyle === "stardust" ? 8 : 4;
    if (cursorTrailLastTime && now - cursorTrailLastTime < minMs && distance < minDistance) return;
    const fromX = cursorTrailLastTime ? cursorTrailLastX : x - 8;
    const fromY = cursorTrailLastTime ? cursorTrailLastY : y;
    cursorTrailLastX = x;
    cursorTrailLastY = y;
    cursorTrailLastTime = now;
    cursorTrailLastDeltaX = distance > 0 ? dx : cursorTrailLastDeltaX;
    cursorTrailLastDeltaY = distance > 0 ? dy : cursorTrailLastDeltaY;
    pushCursorTrailPoint(x, y, now);
    if (trailStyle === "stardust") {
        spawnCursorTrailDot(x, y, distance, now);
    } else {
        const turnAmount = getCursorTrailTurnAmount();
        const segmentCount = Math.max(1, Math.min(10, Math.ceil(distance / 32) + Math.ceil(turnAmount * 5)));
        const pathPoints = buildCursorTrailPathPoints(fromX, fromY, x, y, segmentCount);
        const endPoint = pathPoints[pathPoints.length - 1] || { x, y };
        const beforeEndPoint = pathPoints[pathPoints.length - 2] || { x: fromX, y: fromY };
        const tangentX = endPoint.x - beforeEndPoint.x;
        const tangentY = endPoint.y - beforeEndPoint.y;
        const tangentDistance = Math.hypot(tangentX, tangentY);
        const lastDeltaDistance = Math.hypot(cursorTrailLastDeltaX, cursorTrailLastDeltaY) || 1;
        const directionX = tangentDistance > 0.1 ? tangentX / tangentDistance : (cursorTrailLastDeltaX || 1) / lastDeltaDistance;
        const directionY = tangentDistance > 0.1 ? tangentY / tangentDistance : cursorTrailLastDeltaY / lastDeltaDistance;
        const speed = distance / elapsed;
        const followDistance = Math.max(4, Math.min(18, distance * 0.1 + speed * 2.2 + turnAmount * 4));
        const followX = directionX * followDistance;
        const followY = directionY * followDistance;
        for (let i = 1; i < pathPoints.length; i++) {
            const previousPoint = pathPoints[i - 1];
            const nextPoint = pathPoints[i];
            spawnCursorTrailStreak(
                previousPoint.x,
                previousPoint.y,
                nextPoint.x,
                nextPoint.y,
                Math.hypot(nextPoint.x - previousPoint.x, nextPoint.y - previousPoint.y),
                now,
                pathPoints.length - 1 - i,
                followX,
                followY
            );
        }
    }
}

function handleCursorClick(event) {
    if (!cursorClickFeedbackEnabled || document.hidden) return;
    if (event.pointerType && event.pointerType !== "mouse") return;
    if (event.button !== undefined && event.button !== 0) return;
    spawnCursorClickFeedback(event.clientX, event.clientY);
}

function finePointerAvailable() {
    return !window.matchMedia || !window.matchMedia("(pointer: coarse)").matches;
}

function setCursorTrailActive(active) {
    const shouldEnable = Boolean(active) && finePointerAvailable();
    cursorTrailEnabled = shouldEnable;
    document.body.classList.toggle("cursor-trail-enabled", shouldEnable);
    if (shouldEnable && !cursorTrailListenerAttached) {
        window.addEventListener("pointermove", handleCursorTrailMove, { passive: true });
        cursorTrailListenerAttached = true;
    } else if (!shouldEnable && cursorTrailListenerAttached) {
        window.removeEventListener("pointermove", handleCursorTrailMove);
        cursorTrailListenerAttached = false;
        clearCursorTrailDots();
    }
}

function setCursorClickFeedbackActive(active) {
    const shouldEnable = Boolean(active) && finePointerAvailable();
    cursorClickFeedbackEnabled = shouldEnable;
    document.body.classList.toggle("cursor-click-feedback-enabled", shouldEnable);
    if (shouldEnable && !cursorClickListenerAttached) {
        window.addEventListener("pointerdown", handleCursorClick, { passive: true });
        cursorClickListenerAttached = true;
    } else if (!shouldEnable && cursorClickListenerAttached) {
        window.removeEventListener("pointerdown", handleCursorClick);
        cursorClickListenerAttached = false;
        clearCursorClickElements();
    }
}

function updateCursorSettingsUi() {
    const styleEnabled = getCursorStylePreference();
    const trailEnabled = getCursorTrailPreference();
    const tipGlowEnabled = getCursorTipGlowPreference();
    const tipGlowRadius = getCursorTipGlowRadiusPreference();
    const tipGlowRadiusOption = getCursorTipGlowRadiusOption(tipGlowRadius);
    const clickEffectEnabled = getCursorClickEffectPreference();
    const trailStyle = getCursorTrailStylePreference();
    const trailStyleOption = CURSOR_TRAIL_STYLE_OPTIONS[getCursorTrailStyleIndex(trailStyle)];
    if (cursorStyleCheckbox) cursorStyleCheckbox.checked = styleEnabled;
    if (cursorTrailCheckbox) cursorTrailCheckbox.checked = trailEnabled;
    if (cursorTipGlowCheckbox) cursorTipGlowCheckbox.checked = tipGlowEnabled;
    if (cursorClickEffectCheckbox) cursorClickEffectCheckbox.checked = clickEffectEnabled;
    if (cursorTipGlowRadiusValue) cursorTipGlowRadiusValue.textContent = t(tipGlowRadiusOption.labelKey);
    if (cursorTipGlowRadiusPrevBtn) cursorTipGlowRadiusPrevBtn.disabled = !tipGlowEnabled;
    if (cursorTipGlowRadiusNextBtn) cursorTipGlowRadiusNextBtn.disabled = !tipGlowEnabled;
    if (cursorTrailStyleValue) cursorTrailStyleValue.textContent = t(trailStyleOption.labelKey);
    if (cursorTrailStylePrevBtn) cursorTrailStylePrevBtn.disabled = !trailEnabled;
    if (cursorTrailStyleNextBtn) cursorTrailStyleNextBtn.disabled = !trailEnabled;
    if (cursorStyleNote) {
        cursorStyleNote.textContent = styleEnabled
            ? t("settings.cursor_style_enabled_note")
            : t("settings.cursor_style_disabled_note");
    }
    if (cursorTrailNote) {
        cursorTrailNote.textContent = trailEnabled
            ? t(trailStyleOption.noteKey)
            : t("settings.cursor_trail_disabled_note");
    }
    if (cursorTipGlowNote) {
        cursorTipGlowNote.textContent = tipGlowEnabled
            ? t("settings.cursor_tip_glow_enabled_note")
            : t("settings.cursor_tip_glow_disabled_note");
    }
    if (cursorTipGlowRadiusNote) {
        cursorTipGlowRadiusNote.textContent = t(tipGlowRadiusOption.noteKey);
    }
    if (cursorClickEffectNote) {
        cursorClickEffectNote.textContent = clickEffectEnabled
            ? t("settings.cursor_click_effect_enabled_note")
            : t("settings.cursor_click_effect_disabled_note");
    }
    if (cursorTipGlowRadiusControl) cursorTipGlowRadiusControl.hidden = !tipGlowEnabled;
    if (cursorTrailStyleControl) cursorTrailStyleControl.hidden = !trailEnabled;
    if (cursorPreviewPanel) {
        cursorPreviewPanel.dataset.trailStyle = trailStyle;
        cursorPreviewPanel.dataset.tipGlowRadius = tipGlowRadius;
        cursorPreviewPanel.classList.toggle("cursor-preview-style-off", !styleEnabled);
        cursorPreviewPanel.classList.toggle("cursor-preview-trail-off", !trailEnabled);
        cursorPreviewPanel.classList.toggle("cursor-preview-tip-glow-off", !tipGlowEnabled);
        cursorPreviewPanel.classList.toggle("cursor-preview-click-effect-off", !clickEffectEnabled);
    }
    if (settingsView && settingsView.classList.contains("active")) {
        if (settingsHeightSyncFrame) window.cancelAnimationFrame(settingsHeightSyncFrame);
        syncSettingsPanelHeights();
    }
}

function applyCursorPreferences(options = {}) {
    applyCursorTheme(getActiveCursorThemeWorld());
    document.body.classList.toggle("cursor-theme-enabled", getCursorStylePreference());
    setCursorTrailActive(getCursorTrailPreference());
    setCursorClickFeedbackActive(getCursorClickEffectPreference());
    if (options.updateUi !== false) updateCursorSettingsUi();
}

function setCursorStylePreference(enabled) {
    writeStoredBoolean(CURSOR_STYLE_STORAGE_KEY, Boolean(enabled));
    applyCursorPreferences();
}

function setCursorTrailPreference(enabled) {
    writeStoredBoolean(CURSOR_TRAIL_STORAGE_KEY, Boolean(enabled));
    applyCursorPreferences();
}

function setCursorTipGlowPreference(enabled) {
    writeStoredBoolean(CURSOR_TIP_GLOW_STORAGE_KEY, Boolean(enabled));
    applyCursorPreferences();
}

function setCursorTipGlowRadiusPreference(radius) {
    const selectedRadius = CURSOR_TIP_GLOW_RADIUS_OPTIONS.some((option) => option.value === radius) ? radius : "medium";
    writeStoredString(CURSOR_TIP_GLOW_RADIUS_STORAGE_KEY, selectedRadius);
    applyCursorPreferences();
}

function setCursorClickEffectPreference(enabled) {
    writeStoredBoolean(CURSOR_CLICK_EFFECT_STORAGE_KEY, Boolean(enabled));
    applyCursorPreferences();
}

function setCursorTrailStylePreference(style) {
    const selectedStyle = CURSOR_TRAIL_STYLE_OPTIONS.some((option) => option.value === style) ? style : "laser";
    writeStoredString(CURSOR_TRAIL_STYLE_STORAGE_KEY, selectedStyle);
    clearCursorTrailDots();
    applyCursorPreferences();
}

function cycleCursorTrailStyle(direction) {
    const currentIndex = getCursorTrailStyleIndex();
    const nextIndex = (currentIndex + direction + CURSOR_TRAIL_STYLE_OPTIONS.length) % CURSOR_TRAIL_STYLE_OPTIONS.length;
    setCursorTrailStylePreference(CURSOR_TRAIL_STYLE_OPTIONS[nextIndex].value);
}

function cycleCursorTipGlowRadius(direction) {
    const currentIndex = getCursorTipGlowRadiusIndex();
    const nextIndex = (currentIndex + direction + CURSOR_TIP_GLOW_RADIUS_OPTIONS.length) % CURSOR_TIP_GLOW_RADIUS_OPTIONS.length;
    setCursorTipGlowRadiusPreference(CURSOR_TIP_GLOW_RADIUS_OPTIONS[nextIndex].value);
}

function getCurrentVoiceSettings() {
    const source = voiceSettingsDraft || (settingsData && settingsData.voice ? settingsData.voice : {});
    const strength = VOICE_CORRECTION_OPTIONS.some((option) => option.value === source.correction_strength)
        ? source.correction_strength
        : DEFAULT_VOICE_SETTINGS.correction_strength;
    const backend = VOICE_BACKEND_OPTIONS.some((option) => option.value === source.correction_backend)
        ? source.correction_backend
        : DEFAULT_VOICE_SETTINGS.correction_backend;
    return {
        correction_strength: strength,
        correction_backend: backend,
        auto_send: Boolean(source.auto_send),
    };
}

function getVoiceCorrectionIndex(strength) {
    const current = strength || getCurrentVoiceSettings().correction_strength;
    const index = VOICE_CORRECTION_OPTIONS.findIndex((option) => option.value === current);
    return index >= 0 ? index : 1;
}

function getVoiceBackendIndex(backend) {
    const current = backend || getCurrentVoiceSettings().correction_backend;
    const index = VOICE_BACKEND_OPTIONS.findIndex((option) => option.value === current);
    return index >= 0 ? index : 0;
}

function setVoiceStatus(message, type = "", options = {}) {
    if (!voiceStatus) return;
    window.clearTimeout(voiceStatusResetTimer);
    voiceStatusResetTimer = null;
    voiceStatus.textContent = message || t("messages.voice_hint");
    voiceStatus.className = `voice-status${type ? ` ${type}` : " hint"}`;
    if (options.temporary) {
        voiceStatusResetTimer = window.setTimeout(() => {
            resetVoiceStatus();
        }, options.duration || 2400);
    }
}

function resetVoiceStatus() {
    if (!voiceStatus) return;
    window.clearTimeout(voiceStatusResetTimer);
    voiceStatusResetTimer = null;
    voiceStatus.textContent = t("messages.voice_hint");
    voiceStatus.className = "voice-status hint";
}

function updateVoiceSettingsUi() {
    const settings = getCurrentVoiceSettings();
    const option = VOICE_CORRECTION_OPTIONS[getVoiceCorrectionIndex(settings.correction_strength)];
    const backendOption = VOICE_BACKEND_OPTIONS[getVoiceBackendIndex(settings.correction_backend)];
    const showRuntime = settings.correction_backend === "local" || (settings.correction_backend === "auto" && currentMode === "local");
    if (voiceRuntimePanel) voiceRuntimePanel.classList.toggle("hidden", !showRuntime);
    if (voiceBackendValue) voiceBackendValue.textContent = t(backendOption.labelKey);
    if (voiceBackendNote) {
        voiceBackendNote.textContent = t(backendOption.noteKey);
        voiceBackendNote.classList.toggle("warning", settings.correction_backend === "online");
    }
    if (voiceCorrectionValue) voiceCorrectionValue.textContent = t(option.labelKey);
    if (voiceAutoSendCheckbox) voiceAutoSendCheckbox.checked = settings.auto_send;
    if (voicePreferenceNote) {
        voicePreferenceNote.textContent = settings.auto_send
            ? t("settings.voice_auto_send_note")
            : t("settings.voice_manual_send_note");
    }
    scheduleSettingsPanelHeightSync();
}

function updateVoiceButtonState() {
    if (!voiceBtn) return;
    const supported = isVoiceRecordingSupported();
    const label = voiceListening ? t("game.voice_button_stop") : t("game.voice_button");
    voiceBtn.setAttribute("aria-label", label);
    voiceBtn.setAttribute("title", supported ? label : t("messages.voice_not_supported"));
    voiceBtn.setAttribute("aria-pressed", voiceListening ? "true" : "false");
    voiceBtn.classList.toggle("listening", voiceListening);
    voiceBtn.classList.toggle("busy", voiceBusy);
    voiceBtn.disabled = !supported || (!voiceListening && (!voiceInputEnabled || isWaiting || voiceBusy || voiceFinishing));
    if (!supported && window.I18N && voiceStatus && (!voiceStatus.textContent || voiceStatus.textContent === "messages.voice_not_supported")) {
        setVoiceStatus(t("messages.voice_not_supported"), "error");
    }
    if (sendBtn) {
        sendBtn.disabled = Boolean(commandInput && commandInput.disabled) || isWaiting || voiceListening || voiceBusy || voiceFinishing;
    }
}

function getVoiceLanguage() {
    return window.I18N && window.I18N.lang === "zh" ? "zh-CN" : "en-US";
}

function mergeVoiceTranscript(baseValue, transcript) {
    const text = String(transcript || "").trim();
    if (!text) return String(baseValue || "");
    const base = String(baseValue || "");
    const combined = base.trim()
        ? `${base.trimEnd()} ${text}`
        : text;
    const maxLen = Number(commandInput && commandInput.maxLength) || 300;
    return combined.slice(0, maxLen);
}

function normalizeVoiceText(text) {
    return String(text || "")
        .replace(/\s+/g, " ")
        .replace(/([\u3400-\u9fff])\s+([\u3400-\u9fff])/g, "$1$2")
        .trim();
}

function isVoiceRecordingSupported() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    return Boolean(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && AudioContextCtor);
}

function voiceRecordingErrorKey(err) {
    const name = err && err.name ? err.name : "";
    if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") {
        return "errors.voice_permission";
    }
    if (
        name === "NotFoundError"
        || name === "DevicesNotFoundError"
        || name === "NotReadableError"
        || name === "TrackStartError"
        || name === "OverconstrainedError"
    ) {
        return "errors.voice_audio_capture";
    }
    return "errors.voice_start";
}

function combineFloat32Chunks(chunks) {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Float32Array(totalLength);
    let offset = 0;
    chunks.forEach((chunk) => {
        combined.set(chunk, offset);
        offset += chunk.length;
    });
    return combined;
}

function percentile(values, percent) {
    if (!values.length) return 0;
    const sorted = Array.from(values).sort((a, b) => a - b);
    const index = (sorted.length - 1) * percent / 100;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function applyVoiceNoiseGate(samples, noiseFloor) {
    const gate = Math.max(noiseFloor * 0.85, VOICE_MIN_RMS * 0.45);
    if (!Number.isFinite(gate) || gate <= 0) return samples;
    const cleaned = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i += 1) {
        const value = samples[i];
        cleaned[i] = Math.abs(value) < gate ? value * 0.25 : value;
    }
    return cleaned;
}

function analyzeVoiceSamples(samples, sampleRate) {
    const durationSeconds = samples.length / Math.max(1, sampleRate);
    if (!samples.length || durationSeconds < VOICE_MIN_RECORDING_SECONDS) {
        return { hasSpeech: false, reason: "too_short", samples };
    }

    const frameSize = Math.max(1, Math.floor(sampleRate * VOICE_ANALYSIS_FRAME_SECONDS));
    const paddingSamples = Math.max(0, Math.floor(sampleRate * VOICE_SILENCE_PADDING_SECONDS));
    let totalSquares = 0;
    let peak = 0;
    let firstVoicedFrame = -1;
    let lastVoicedFrame = -1;
    let voicedFrames = 0;
    const frameRmsValues = [];
    const framePeakValues = [];

    for (let frameStart = 0, frameIndex = 0; frameStart < samples.length; frameStart += frameSize, frameIndex += 1) {
        const frameEnd = Math.min(samples.length, frameStart + frameSize);
        let frameSquares = 0;
        let framePeak = 0;
        for (let i = frameStart; i < frameEnd; i += 1) {
            const abs = Math.abs(samples[i]);
            const square = samples[i] * samples[i];
            totalSquares += square;
            frameSquares += square;
            if (abs > peak) peak = abs;
            if (abs > framePeak) framePeak = abs;
        }
        const frameLength = Math.max(1, frameEnd - frameStart);
        const frameRms = Math.sqrt(frameSquares / frameLength);
        frameRmsValues.push(frameRms);
        framePeakValues.push(framePeak);
    }

    const noiseFloor = percentile(frameRmsValues, 20);
    const rmsP90 = percentile(frameRmsValues, 90);
    const dynamicRatio = rmsP90 / Math.max(noiseFloor, 0.000001);
    const rms = Math.sqrt(totalSquares / Math.max(1, samples.length));
    const peakRmsRatio = peak / Math.max(rms, 0.000001);
    const adaptiveFrameRms = Math.max(VOICE_FRAME_RMS, noiseFloor * VOICE_MIN_DYNAMIC_RATIO);

    frameRmsValues.forEach((frameRms, frameIndex) => {
        const framePeak = framePeakValues[frameIndex] || 0;
        if (frameRms >= adaptiveFrameRms || framePeak >= VOICE_FRAME_PEAK) {
            if (firstVoicedFrame < 0) firstVoicedFrame = frameIndex;
            lastVoicedFrame = frameIndex;
            voicedFrames += 1;
        }
    });

    const voicedSeconds = voicedFrames * frameSize / Math.max(1, sampleRate);
    const voicedRatio = voicedFrames / Math.max(1, frameRmsValues.length);
    const dynamicOk = dynamicRatio >= VOICE_MIN_DYNAMIC_RATIO || peakRmsRatio >= VOICE_MIN_PEAK_RMS_RATIO;
    const flatNoise = voicedRatio >= VOICE_MAX_FLAT_VOICED_RATIO && dynamicRatio < VOICE_MIN_DYNAMIC_RATIO;
    const hasSpeech = peak >= VOICE_MIN_PEAK
        && rms >= VOICE_MIN_RMS
        && voicedSeconds >= VOICE_MIN_VOICED_SECONDS
        && dynamicOk
        && !flatNoise;
    if (!hasSpeech || firstVoicedFrame < 0) {
        return { hasSpeech: false, reason: dynamicOk ? "quiet" : "noise", rms, peak, voicedSeconds, dynamicRatio, peakRmsRatio, samples };
    }

    const trimStart = Math.max(0, firstVoicedFrame * frameSize - paddingSamples);
    const trimEnd = Math.min(samples.length, (lastVoicedFrame + 1) * frameSize + paddingSamples);
    const trimmedSamples = samples.slice(trimStart, trimEnd);
    return {
        hasSpeech: true,
        reason: "speech",
        rms,
        peak,
        voicedSeconds,
        dynamicRatio,
        peakRmsRatio,
        samples: applyVoiceNoiseGate(trimmedSamples, noiseFloor),
    };
}

function encodeWavFromFloat32(samples, sampleRate) {
    const bytesPerSample = 2;
    const blockAlign = bytesPerSample;
    const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
    const view = new DataView(buffer);
    const writeString = (offset, value) => {
        for (let i = 0; i < value.length; i += 1) {
            view.setUint8(offset + i, value.charCodeAt(i));
        }
    };

    writeString(0, "RIFF");
    view.setUint32(4, 36 + samples.length * bytesPerSample, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(36, "data");
    view.setUint32(40, samples.length * bytesPerSample, true);

    let offset = 44;
    for (let i = 0; i < samples.length; i += 1) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += bytesPerSample;
    }
    return new Blob([buffer], { type: "audio/wav" });
}

function cleanupVoiceRecording() {
    if (voiceRecordingTimer) {
        window.clearTimeout(voiceRecordingTimer);
        voiceRecordingTimer = null;
    }
    if (voiceProcessorNode) {
        voiceProcessorNode.onaudioprocess = null;
        try { voiceProcessorNode.disconnect(); } catch (_err) { /* ignore cleanup failures */ }
        voiceProcessorNode = null;
    }
    if (voiceSourceNode) {
        try { voiceSourceNode.disconnect(); } catch (_err) { /* ignore cleanup failures */ }
        voiceSourceNode = null;
    }
    if (voiceMediaStream) {
        voiceMediaStream.getTracks().forEach((track) => track.stop());
        voiceMediaStream = null;
    }
    if (voiceAudioContext) {
        const contextToClose = voiceAudioContext;
        voiceAudioContext = null;
        if (typeof contextToClose.close === "function") {
            contextToClose.close().catch(() => {});
        }
    }
}

function voiceTranscriptionErrorKey(data) {
    if (data && data.code === "voice_empty") return "errors.voice_empty";
    if (data && data.code === "voice_unusable") return "errors.voice_unusable";
    return "errors.voice_transcribe";
}

async function transcribeVoiceAudio(wavBlob, requestId) {
    try {
        const settings = getCurrentVoiceSettings();
        const formData = new FormData();
        formData.append("audio", wavBlob, "voice-input.wav");
        formData.append("correction_strength", settings.correction_strength);
        formData.append("correction_backend", settings.correction_backend);
        formData.append("language", getVoiceLanguage());
        formData.append("request_id", String(requestId));

        const resp = await fetch("/api/voice/transcribe", {
            method: "POST",
            body: formData,
        });
        const data = await resp.json().catch(() => ({}));
        if (requestId !== voiceActiveRequestId) return { text: "", stale: true };
        if (data && (data.voice_runtime_checked || data.voice_stt_ready !== undefined)) {
            updateVoiceRuntimeSettingsStatus(data);
        }
        if (!resp.ok) {
            setVoiceStatus(t(voiceTranscriptionErrorKey(data)), "error");
            return { text: "", stale: false, blocked: true };
        }
        if (data.experience_remaining_percent !== undefined && settingsData && settingsData.deepseek) {
            settingsData.deepseek.experience_remaining_percent = data.experience_remaining_percent;
            settingsData.deepseek.experience_remaining_tokens = data.experience_remaining_tokens;
            updateExperienceSettings(settingsData.deepseek);
        }
        if (data.code === "voice_unusable") {
            setVoiceStatus(t("errors.voice_unusable"), "error");
            return { text: "", stale: false, blocked: true };
        }
        return { text: normalizeVoiceText(data.text || data.raw_text || ""), stale: false, blocked: false };
    } catch (err) {
        if (requestId !== voiceActiveRequestId) return { text: "", stale: true };
        console.warn("Voice transcription failed:", err);
        setVoiceStatus(t("errors.voice_transcribe"), "error");
        return { text: "", stale: false, blocked: true };
    }
}

async function finishVoiceRecording() {
    if (voiceFinishing) return;
    if (!voiceListening && !voicePcmChunks.length) return;
    voiceFinishing = true;
    const requestId = voiceCurrentRecordingId;
    const chunks = voicePcmChunks.slice();
    const sampleRate = voiceRecordingSampleRate;
    voicePcmChunks = [];
    voiceListening = false;
    cleanupVoiceRecording();
    updateVoiceButtonState();

    if (!chunks.length) {
        voiceActiveRequestId = 0;
        voiceFinishing = false;
        setVoiceStatus(t("errors.voice_empty"), "error");
        updateVoiceButtonState();
        commandInput.focus();
        return;
    }

    const samples = combineFloat32Chunks(chunks);
    const analysis = analyzeVoiceSamples(samples, sampleRate);
    if (!analysis.hasSpeech) {
        voiceActiveRequestId = 0;
        voiceFinishing = false;
        setVoiceStatus(t("errors.voice_empty"), "error");
        updateVoiceButtonState();
        commandInput.focus();
        return;
    }

    voiceBusy = true;
    updateVoiceButtonState();
    setVoiceStatus(t("messages.voice_transcribing"));
    const wavBlob = encodeWavFromFloat32(analysis.samples, sampleRate);
    const result = await transcribeVoiceAudio(wavBlob, requestId);
    voiceBusy = false;
    voiceFinishing = false;
    updateVoiceButtonState();

    if (result.stale || requestId !== voiceActiveRequestId) {
        return;
    }

    if (!result.text) {
        commandInput.value = voiceBaseInput;
        commandInput.focus();
        voiceActiveRequestId = 0;
        updateVoiceButtonState();
        return;
    }

    commandInput.value = mergeVoiceTranscript(voiceBaseInput, result.text);
    commandInput.focus();
    voiceActiveRequestId = 0;

    if (getCurrentVoiceSettings().auto_send && commandInput.value.trim()) {
        setVoiceStatus(t("messages.voice_auto_sent"), "success", { temporary: true });
        if (typeof commandForm.requestSubmit === "function") {
            commandForm.requestSubmit();
        } else {
            commandForm.dispatchEvent(new Event("submit", { cancelable: true }));
        }
    } else {
        setVoiceStatus(t("messages.voice_inserted"), "success", { temporary: true });
    }
}

function stopVoiceInput() {
    if (!voiceListening) return;
    finishVoiceRecording();
}

async function startVoiceInput() {
    if (!isVoiceRecordingSupported()) {
        setVoiceStatus(t("messages.voice_not_supported"), "error");
        updateVoiceButtonState();
        return;
    }
    if (!voiceInputEnabled || isWaiting || voiceBusy || voiceFinishing) return;

    voiceBaseInput = commandInput.value;
    voicePcmChunks = [];
    voiceRecordingSequence += 1;
    voiceCurrentRecordingId = voiceRecordingSequence;
    voiceActiveRequestId = voiceCurrentRecordingId;

    try {
        voiceMediaStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true,
            },
        });
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        voiceAudioContext = new AudioContextCtor();
        if (voiceAudioContext.state === "suspended" && typeof voiceAudioContext.resume === "function") {
            await voiceAudioContext.resume();
        }
        voiceRecordingSampleRate = voiceAudioContext.sampleRate || 16000;
        voiceSourceNode = voiceAudioContext.createMediaStreamSource(voiceMediaStream);
        voiceProcessorNode = voiceAudioContext.createScriptProcessor(4096, 1, 1);
        voiceProcessorNode.onaudioprocess = (event) => {
            if (!voiceListening) return;
            const input = event.inputBuffer.getChannelData(0);
            voicePcmChunks.push(new Float32Array(input));
            const output = event.outputBuffer.getChannelData(0);
            output.fill(0);
        };
        voiceSourceNode.connect(voiceProcessorNode);
        voiceProcessorNode.connect(voiceAudioContext.destination);
        voiceListening = true;
        setVoiceStatus(t("messages.voice_recording"));
        updateVoiceButtonState();
        voiceRecordingTimer = window.setTimeout(() => {
            if (voiceListening) finishVoiceRecording();
        }, VOICE_MAX_RECORDING_MS);
    } catch (err) {
        console.warn("Voice recording start failed:", err);
        voiceListening = false;
        voicePcmChunks = [];
        voiceActiveRequestId = 0;
        voiceCurrentRecordingId = 0;
        cleanupVoiceRecording();
        setVoiceStatus(t(voiceRecordingErrorKey(err)), "error");
        updateVoiceButtonState();
    }
}

async function saveVoiceSettings(partial) {
    const current = voiceSettingsDraft || getCurrentVoiceSettings();
    const next = {
        correction_strength: partial.correction_strength || current.correction_strength,
        correction_backend: partial.correction_backend || current.correction_backend,
        auto_send: partial.auto_send !== undefined ? Boolean(partial.auto_send) : current.auto_send,
    };
    if (!settingsData) settingsData = {};
    settingsData.voice = next;
    voiceSettingsDraft = next;
    updateVoiceSettingsUi();
    pendingVoiceSettingsPatch = next;
    if (voiceSettingsBusy) return;
    voiceSettingsBusy = true;
    try {
        while (pendingVoiceSettingsPatch) {
            const payload = pendingVoiceSettingsPatch;
            pendingVoiceSettingsPatch = null;
            await postSettings({ voice: payload });
            if (pendingVoiceSettingsPatch) {
                settingsData.voice = pendingVoiceSettingsPatch;
                voiceSettingsDraft = pendingVoiceSettingsPatch;
                updateVoiceSettingsUi();
            }
        }
        voiceSettingsDraft = null;
    } catch (err) {
        console.error("Voice settings update failed:", err);
        setSettingsStatus(err.message || t("errors.settings_update"), "error");
        pendingVoiceSettingsPatch = null;
        voiceSettingsDraft = null;
        await loadSettings(true);
    } finally {
        voiceSettingsBusy = false;
        if (!pendingVoiceSettingsPatch) voiceSettingsDraft = null;
        updateVoiceButtonState();
    }
}

function cycleVoiceCorrection(direction) {
    const currentIndex = getVoiceCorrectionIndex();
    const nextIndex = (currentIndex + direction + VOICE_CORRECTION_OPTIONS.length) % VOICE_CORRECTION_OPTIONS.length;
    saveVoiceSettings({ correction_strength: VOICE_CORRECTION_OPTIONS[nextIndex].value });
}

function cycleVoiceBackend(direction) {
    const currentIndex = getVoiceBackendIndex();
    const nextIndex = (currentIndex + direction + VOICE_BACKEND_OPTIONS.length) % VOICE_BACKEND_OPTIONS.length;
    saveVoiceSettings({ correction_backend: VOICE_BACKEND_OPTIONS[nextIndex].value });
}

function renderTutorialContent(container) {
    if (!container || !window.I18N || !window.I18N.tutorial) return;
    const tutorial = window.I18N.tutorial;
    const sections = Array.isArray(tutorial.sections) ? tutorial.sections : [];
    const sectionHtml = sections.map((section) => {
        const paragraphs = Array.isArray(section.body) ? section.body : [];
        const bullets = Array.isArray(section.bullets) ? section.bullets : [];
        const examples = Array.isArray(section.examples) ? section.examples : [];
        return `
            <section class="tutorial-section">
                <h3>${escapeHtml(section.title)}</h3>
                ${paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
                ${bullets.length ? `
                    <ul>
                        ${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join("")}
                    </ul>
                ` : ""}
                ${examples.length ? `
                    <div class="tutorial-examples">
                        ${examples.map((example) => `
                            <article class="tutorial-example">
                                <strong>${escapeHtml(example.label)}</strong>
                                <code>${escapeHtml(example.command)}</code>
                                <span>${escapeHtml(example.description)}</span>
                            </article>
                        `).join("")}
                    </div>
                ` : ""}
            </section>
        `;
    }).join("");

    if (container === tutorialDialogContent) {
        container.innerHTML = `
            <div class="tutorial-content-frame" tabindex="0">
                ${sectionHtml}
            </div>
        `;
        return;
    }

    container.innerHTML = `
        <article class="tutorial-card">
            <p class="tutorial-kicker">${escapeHtml(tutorial.kicker)}</p>
            <h2>${escapeHtml(tutorial.title)}</h2>
            <p class="tutorial-copy">${escapeHtml(tutorial.copy)}</p>
            <div class="tutorial-content-frame" tabindex="0">
                ${sectionHtml}
            </div>
        </article>
    `;
}

function renderTutorialSurfaces() {
    renderTutorialContent(tutorialPage);
    renderTutorialContent(tutorialDialogContent);
    if (tutorialPrevBtn) tutorialPrevBtn.setAttribute("aria-label", t("tutorial.prev_label"));
    if (tutorialNextBtn) tutorialNextBtn.setAttribute("aria-label", t("tutorial.next_label"));
    if (settingsFlowPrevBtn) settingsFlowPrevBtn.setAttribute("aria-label", t("tutorial.prev_label"));
    if (settingsFlowNextBtn) settingsFlowNextBtn.setAttribute("aria-label", t("tutorial.next_label"));
    if (tutorialCloseBtn) tutorialCloseBtn.setAttribute("aria-label", t("tutorial.close_label"));
}

function isTutorialViewOpen() {
    return tutorialView && tutorialView.classList.contains("active");
}

function isTutorialDialogOpen() {
    return tutorialDialog && !tutorialDialog.classList.contains("hidden");
}

function openTutorialDialog() {
    if (!tutorialDialog) return;
    tutorialDialogReturnFocus = document.activeElement;
    renderTutorialContent(tutorialDialogContent);
    tutorialDialog.classList.remove("hidden");
    if (tutorialCloseBtn) tutorialCloseBtn.focus();
}

function closeTutorialDialog() {
    if (!tutorialDialog) return;
    tutorialDialog.classList.add("hidden");
    const focusTarget = tutorialDialogReturnFocus && document.contains(tutorialDialogReturnFocus)
        ? tutorialDialogReturnFocus
        : commandInput;
    tutorialDialogReturnFocus = null;
    if (focusTarget) focusTarget.focus();
}

function getItemMetadata(itemName) {
    const usedEmojis = new Set(Object.values(ITEM_METADATA).map((item) => item.emoji));
    Object.values(GENERATED_ITEM_METADATA).forEach((item) => usedEmojis.add(item.emoji));
    if (ITEM_METADATA[itemName]) return ITEM_METADATA[itemName];
    if (!GENERATED_ITEM_METADATA[itemName]) {
        GENERATED_ITEM_METADATA[itemName] = {
            id: itemName,
            world: "museum",
            emoji: ITEM_EMOJI_POOL.find((emoji) => !usedEmojis.has(emoji)) || UNKNOWN_ITEM_EMOJI,
            descriptionKey: null,
        };
    }
    return GENERATED_ITEM_METADATA[itemName];
}

function formatInventoryCount(count) {
    const n = Number(count) || 0;
    return `${n} ${n === 1 ? t("inventory.item") : t("inventory.items")}`;
}

function formatWorldTitle(worldId) {
    const i18nName = t("world_names." + worldId);
    if (i18nName && !i18nName.startsWith("world_names.")) return i18nName;
    return WORLD_NAMES[worldId] || String(worldId || "museum")
        .split("_")
        .map((part) => part ? part.charAt(0).toUpperCase() + part.slice(1) : part)
        .join(" ");
}

function getDisplayWorldOrder() {
    const merged = [...WORLD_ORDER];
    dynamicWorldOrder.forEach((worldId) => {
        if (!merged.includes(worldId)) merged.push(worldId);
    });
    return merged;
}

function syncInventoryDetails(inventoryNames, locationId) {
    const incoming = Array.isArray(inventoryNames) ? inventoryNames.slice() : [];
    const incomingSet = new Set(incoming);
    inventoryTimeline = inventoryTimeline.filter((name) => incomingSet.has(name));

    incoming.forEach((name) => {
        if (!inventoryTimeline.includes(name)) {
            inventoryTimeline.push(name);
        }
    });

    const detailMap = new Map(
        inventoryDetails
            .filter((entry) => incomingSet.has(entry.name))
            .map((entry) => [entry.name, entry])
    );

    incoming.forEach((name) => {
        if (!detailMap.has(name)) {
            const meta = getItemMetadata(name);
            detailMap.set(name, {
                name,
                world: meta.world === "museum" ? (locationId || currentWorld || "museum") : meta.world,
                emoji: meta.emoji,
                description: meta.descriptionKey ? t(meta.descriptionKey) : (meta.description || t("inventory.stored_collection")),
                acquiredOrder: inventoryTimeline.indexOf(name),
            });
        }
    });

    inventoryDetails = Array.from(detailMap.values()).map((entry) => ({
        ...entry,
        acquiredOrder: inventoryTimeline.indexOf(entry.name),
    }));

    inventoryDetails.sort((a, b) => {
        if (!WORLD_ORDER.includes(a.world) && !dynamicWorldOrder.includes(a.world)) {
            dynamicWorldOrder.push(a.world);
        }
        if (!WORLD_ORDER.includes(b.world) && !dynamicWorldOrder.includes(b.world)) {
            dynamicWorldOrder.push(b.world);
        }
        const aCurrent = a.world === locationId ? 0 : 1;
        const bCurrent = b.world === locationId ? 0 : 1;
        if (aCurrent !== bCurrent) return aCurrent - bCurrent;
        return b.acquiredOrder - a.acquiredOrder;
    });
}

function renderInventorySummary(locationId) {
    if (!inventoryList) return;
    inventoryList.innerHTML = "";

    if (inventoryDetails.length === 0) {
        const li = document.createElement("li");
        li.className = "empty-inv";
        li.textContent = t("side_panel.inventory_empty");
        inventoryList.appendChild(li);
        return;
    }

    const summaryItems = inventoryDetails.slice(0, 4);
    summaryItems.forEach((item) => {
        const li = document.createElement("li");
        li.textContent = `${item.emoji} ${item.name}`;
        inventoryList.appendChild(li);
    });

    if (inventoryDetails.length > 5) {
        const remaining = inventoryDetails.length - 4;
        const li = document.createElement("li");
        li.className = "inventory-more";
        li.textContent = `${remaining} ${t("inventory.more_items")}`;
        inventoryList.appendChild(li);
        return;
    }

    if (inventoryDetails.length === 5) {
        const item = inventoryDetails[4];
        const li = document.createElement("li");
        li.textContent = `${item.emoji} ${item.name}`;
        inventoryList.appendChild(li);
    }
}

function renderInventoryDialog() {
    if (!inventorySections || !inventoryStatus) return;
    inventorySections.innerHTML = "";

    if (inventoryDetails.length === 0) {
        inventorySections.innerHTML = `
            <section class="inventory-section inventory-empty">
                <div class="inventory-item-name">${t("inventory.empty")}</div>
                <div class="inventory-item-meta">${t("inventory.empty_hint")}</div>
            </section>
        `;
        inventoryStatus.textContent = t("inventory.empty_status");
        inventoryStatus.classList.remove("error");
        return;
    }

    const displayWorldOrder = getDisplayWorldOrder();
    const grouped = new Map(displayWorldOrder.map((worldId) => [worldId, []]));
    inventoryDetails.forEach((item) => {
        const worldId = grouped.has(item.world) ? item.world : "museum";
        grouped.get(worldId).push(item);
    });

    displayWorldOrder.forEach((worldId) => {
        const items = grouped.get(worldId) || [];
        if (!items.length) return;
        items.sort((a, b) => a.acquiredOrder - b.acquiredOrder);
        const section = document.createElement("section");
        section.className = "inventory-section";
        section.innerHTML = `
            <div class="inventory-section-header">
                <span class="inventory-section-title">${escapeHtml(formatWorldTitle(worldId))}</span>
                <span class="inventory-section-count">${escapeHtml(formatInventoryCount(items.length))}</span>
            </div>
            <div class="inventory-grid">
                ${items.map((item) => `
                    <article class="inventory-item">
                        <div class="inventory-item-name">${escapeHtml(item.emoji + " " + item.name)}</div>
                        <div class="inventory-item-meta">${escapeHtml(item.description)}</div>
                    </article>
                `).join("")}
            </div>
        `;
        inventorySections.appendChild(section);
    });

    inventoryStatus.textContent = `${inventoryDetails.length} ${t("inventory.total_items")} ${inventoryDetails.length === 1 ? t("inventory.item") : t("inventory.items")} ${t("inventory.stored")}`;
    inventoryStatus.classList.remove("error");
}

function isInventoryDialogOpen() {
    return inventoryDialog && !inventoryDialog.classList.contains("hidden");
}

function openInventoryDialog() {
    if (!inventoryDialog) return;
    renderInventoryDialog();
    inventoryDialog.classList.remove("hidden");
    if (inventoryCloseBtn) inventoryCloseBtn.focus();
}

function closeInventoryDialog() {
    if (!inventoryDialog) return;
    inventoryDialog.classList.add("hidden");
    if (openInventoryBtn) openInventoryBtn.focus();
}

// ── Local file-backed save slots ──
const SAVE_SLOT_STORAGE_KEY = "theCursedCanvas.saveSlots.v1";
const SAVE_SLOT_COUNT = 3;

function normalizeSaveSlots(slots) {
    const normalized = Array(SAVE_SLOT_COUNT).fill(null);
    if (!Array.isArray(slots)) return normalized;
    for (let i = 0; i < SAVE_SLOT_COUNT; i++) {
        const save = slots[i];
        normalized[i] = save && save.summary ? save : null;
    }
    return normalized;
}

function getBrowserSaveSlotsForMigration() {
    try {
        const stored = JSON.parse(localStorage.getItem(SAVE_SLOT_STORAGE_KEY));
        if (!Array.isArray(stored) || !stored.some(save => save && save.state)) {
            return null;
        }
        return stored;
    } catch (err) {
        console.warn("Browser save slots could not be read:", err);
        return null;
    }
}

async function migrateBrowserSaveSlots() {
    const browserSlots = getBrowserSaveSlotsForMigration();
    if (!browserSlots) return;

    try {
        const resp = await fetch("/api/save/migrate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slots: browserSlots })
        });
        if (!resp.ok) return;
        const payload = await resp.json();
        saveSlots = normalizeSaveSlots(payload.slots);
        if (payload.migrated > 0) {
            localStorage.removeItem(SAVE_SLOT_STORAGE_KEY);
        }
    } catch (err) {
        console.warn("Browser save migration failed:", err);
    }
}

async function refreshSaveSlots() {
    const resp = await fetch("/api/save/slots");
    if (!resp.ok) throw new Error("Save slots request failed");
    const payload = await resp.json();
    saveSlots = normalizeSaveSlots(payload.slots);
    return saveSlots;
}

function formatSavedAt(savedAt) {
    const date = new Date(savedAt);
    if (Number.isNaN(date.getTime())) return t("save_slots.unknown_time");
    return new Intl.DateTimeFormat(window.I18N && window.I18N.lang === "zh" ? "zh-CN" : "en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    }).format(date);
}

function buildSummaryFromState(state) {
    const quests = state && state.quests_completed ? state.quests_completed : {};
    const questValues = Object.values(quests);
    const locationId = state && state.current_world ? state.current_world : "museum";
    return {
        location: t("world_names." + locationId) || WORLD_NAMES[locationId] || locationId.replace(/_/g, " "),
        location_id: locationId,
        turn_count: state && Number.isFinite(Number(state.turn_count)) ? Number(state.turn_count) : 0,
        inventory_count: state && Array.isArray(state.inventory) ? state.inventory.length : 0,
        quests_completed: questValues.filter(Boolean).length,
        quests_total: questValues.length || 3,
        game_complete: Boolean(state && state.game_complete)
    };
}

function getSaveSummary(save) {
    return save && save.summary ? save.summary : buildSummaryFromState(save ? save.state : null);
}

function formatCount(count, singularKey, pluralKey) {
    const n = Number(count) || 0;
    const label = n === 1 ? t(singularKey) : t(pluralKey);
    return `${n} ${label}`;
}

function setSaveSlotStatus(message, isError = false) {
    if (!saveSlotStatus) return;
    saveSlotStatus.textContent = message;
    saveSlotStatus.classList.toggle("error", isError);
}

function renderSaveSlots() {
    if (!saveSlotList) return;
    const slots = normalizeSaveSlots(saveSlots);

    saveSlotList.innerHTML = slots.map((save, index) => {
        const hasSave = Boolean(save);
        const summary = hasSave ? getSaveSummary(save) : {};
        const actionLabel = saveSlotMode === "save"
            ? (hasSave ? t("save_slots.overwrite") : t("save_slots.create"))
            : (hasSave ? t("save_slots.load") : t("save_slots.empty"));
        const slotStateClass = hasSave ? "filled" : "empty";
        const unavailableClass = !hasSave && saveSlotMode === "load" ? " unavailable" : "";
        const transitionClass = recentlyChangedSlotIndex === index ? " just-updated" : "";

        const detailHtml = hasSave ? `
            <span class="save-slot-location">${escapeHtml(summary.location || t("save_slots.unknown_location"))}</span>
            <span class="save-slot-meta">${t("save_slots.saved")} ${escapeHtml(formatSavedAt(save.savedAt))}</span>
            <span class="save-slot-stats">
                <span>${escapeHtml(String(summary.quests_completed || 0))}/${escapeHtml(String(summary.quests_total || 3))} ${t("save_slots.restored")}</span>
                <span>${escapeHtml(formatCount(summary.inventory_count, "save_slots.item_singular", "save_slots.item_plural"))}</span>
                <span>${escapeHtml(formatCount(summary.turn_count, "save_slots.turn_singular", "save_slots.turn_plural"))}</span>
            </span>
        ` : `
            <span class="save-slot-location">${t("save_slots.empty_slot")}</span>
            <span class="save-slot-meta">${t("save_slots.no_data")}</span>
        `;

        return `
            <article
                class="save-slot ${slotStateClass}${unavailableClass}${transitionClass}"
                data-save-slot="${index}"
                aria-disabled="${!hasSave && saveSlotMode === "load" ? "true" : "false"}"
            >
                <span class="save-slot-heading">
                    <span>${t("save_slots.slot")} ${index + 1}</span>
                </span>
                ${detailHtml}
                <span class="save-slot-controls">
                    <button
                        class="save-slot-action"
                        type="button"
                        data-slot-action="${saveSlotMode === "save" ? "save" : "load"}"
                        data-save-slot="${index}"
                        ${!hasSave && saveSlotMode === "load" ? "disabled" : ""}
                    >${actionLabel}</button>
                    ${hasSave ? `
                        <button
                            class="save-slot-delete"
                            type="button"
                            data-slot-action="delete"
                            data-save-slot="${index}"
                        >${t("save_slots.delete")}</button>
                    ` : ""}
                </span>
            </article>
        `;
    }).join("");
}

function hasAnySave() {
    return saveSlots.some(Boolean);
}

function isSaveDialogOpen() {
    return saveSlotDialog && !saveSlotDialog.classList.contains("hidden");
}

async function openSaveSlotDialog(mode) {
    if (!saveSlotDialog) return;
    saveSlotMode = mode === "save" ? "save" : "load";

    if (saveSlotKicker) saveSlotKicker.textContent = saveSlotMode === "save" ? t("save_slots.kicker_save") : t("save_slots.kicker_load");
    if (saveSlotTitle) saveSlotTitle.textContent = saveSlotMode === "save" ? t("save_slots.title_save") : t("save_slots.title_load");
    if (saveSlotCopy) {
        saveSlotCopy.textContent = saveSlotMode === "save"
            ? t("save_slots.copy_save")
            : t("save_slots.copy_load");
    }

    setSaveSlotStatus(t("save_slots.opening"));
    saveSlotDialog.classList.remove("hidden");
    try {
        await refreshSaveSlots();
        renderSaveSlots();
        setSaveSlotStatus(
            saveSlotMode === "save"
                ? t("save_slots.save_hint")
                : (hasAnySave() ? t("save_slots.load_hint") : t("save_slots.no_saves")),
            saveSlotMode === "load" && !hasAnySave()
        );
    } catch (err) {
        console.error("Save slots failed:", err);
        renderSaveSlots();
        setSaveSlotStatus(t("save_slots.error_open"), true);
    }

    const firstSlot = saveSlotList ? saveSlotList.querySelector("[data-slot-action]") : null;
    if (firstSlot) firstSlot.focus();
}

function closeSaveSlotDialog() {
    if (!saveSlotDialog) return;
    saveSlotDialog.classList.add("hidden");
    const focusTarget = saveSlotMode === "save" ? saveProgressBtn : continueGameBtn;
    if (focusTarget) focusTarget.focus();
}

function renderSavedTranscript(state) {
    chatLog.innerHTML = "";
    const transcript = state && state.memory && Array.isArray(state.memory.transcript)
        ? state.memory.transcript
        : [];

    if (!transcript.length) {
        addOpeningMessage();
        return;
    }

    transcript.forEach((line) => {
        const text = line && line.text ? line.text : "";
        if (!text) return;
        if (line.type === "player_command") {
            addMessage(text, "player");
        } else if (line.type === "npc_reply") {
            addMessage(text, "npc", line.speaker || "???");
        } else {
            addMessage(text, "narration");
        }
    });
}

function setUnsavedProgress(value) {
    hasUnsavedProgress = Boolean(value);
}

function applyLoadedSave(uiState, state, save, slotIndex) {
    const data = uiState || {};
    resetClientViewForNewAdventure();
    renderSavedTranscript(state);

    titleScreenDismissed = true;
    if (titleScreen) titleScreen.classList.add("hidden");
    stopTitleParticles();
    startScreenDismissed = true;
    if (startScreen) startScreen.classList.add("hidden");
    stopStartParticles();
    setGameInputEnabled(true);

    currentWorld = data.location_id || getSaveSummary(save).location_id || "museum";
    document.body.dataset.world = currentWorld;
    setParticleWorld(currentWorld);
    updateQuickActions(currentWorld);
    updateSidePanel(data);
    responseBadge.style.display = "none";

    const endPageCard = document.getElementById("end-page-card");
    if (data.game_over && data.location_id === "museum") {
        gameEndingTriggered = true;
        showEndPageButton();
    } else {
        gameEndingTriggered = false;
        if (endPageCard) endPageCard.remove();
    }

    addMessage(`${t("save_slots.loaded_msg")} ${slotIndex + 1}.`, "mood");
    activeSaveSlotIndex = slotIndex;
    setUnsavedProgress(false);
    commandInput.focus();
}

async function saveCurrentToSlot(slotIndex) {
    if (isWaiting) {
        setSaveSlotStatus(t("save_slots.wait_for_response"), true);
        return;
    }

    const existingSave = saveSlots[slotIndex];
    if (existingSave) {
        const confirmed = await requestConfirmation({
            title: t("save_slots.confirm_overwrite_title"),
            message: t("save_slots.confirm_overwrite_msg", { n: slotIndex + 1 }),
            confirmLabel: t("save_slots.overwrite"),
            danger: true,
        });
        if (!confirmed) return;
    }

    saveSlotBusy = true;
    setSaveSlotStatus(`${t("save_slots.saving_to")} ${slotIndex + 1}...`);

    try {
        const resp = await fetch(`/api/save/slots/${slotIndex}`, { method: "POST" });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.error || "Slot save failed");

        saveSlots = normalizeSaveSlots(payload.slots);
        recentlyChangedSlotIndex = slotIndex;
        renderSaveSlots();
        window.setTimeout(() => {
            if (recentlyChangedSlotIndex === slotIndex) {
                recentlyChangedSlotIndex = null;
                renderSaveSlots();
            }
        }, 700);
        setSaveSlotStatus(`${t("save_slots.slot")} ${slotIndex + 1} ${t("save_slots.saved_msg")}`);
        activeSaveSlotIndex = slotIndex;
        setUnsavedProgress(false);
    } catch (err) {
        console.error("Slot save failed:", err);
        setSaveSlotStatus(t("save_slots.error_save"), true);
    } finally {
        saveSlotBusy = false;
    }
}

async function loadSaveFromSlot(slotIndex) {
    const save = saveSlots[slotIndex];
    if (!save) {
        setSaveSlotStatus(t("save_slots.error_empty"), true);
        return;
    }

    saveSlotBusy = true;
    setSaveSlotStatus(`${t("save_slots.loading_slot")} ${slotIndex + 1}...`);

    try {
        const resp = await fetch("/api/save/import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slot: slotIndex })
        });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.error || "Save import failed");

        closeSaveSlotDialog();
        applyLoadedSave(payload.ui_state, payload.state, payload.save || save, slotIndex);
    } catch (err) {
        console.error("Load failed:", err);
        setSaveSlotStatus(t("save_slots.error_load"), true);
    } finally {
        saveSlotBusy = false;
        renderSaveSlots();
    }
}

async function deleteSaveSlot(slotIndex) {
    const save = saveSlots[slotIndex];
    if (!save) {
        setSaveSlotStatus(t("save_slots.error_empty"), true);
        return;
    }

    const confirmed = await requestConfirmation({
        title: t("save_slots.confirm_delete_title"),
        message: t("save_slots.confirm_delete_msg", { n: slotIndex + 1 }),
        confirmLabel: t("save_slots.delete"),
        danger: true,
    });
    if (!confirmed) return;

    saveSlotBusy = true;
    setSaveSlotStatus(`${t("save_slots.deleting_slot")} ${slotIndex + 1}...`);

    try {
        const resp = await fetch(`/api/save/slots/${slotIndex}`, { method: "DELETE" });
        const payload = await resp.json();
        if (!resp.ok) throw new Error(payload.error || "Delete failed");

        saveSlots = normalizeSaveSlots(payload.slots);
        if (activeSaveSlotIndex === slotIndex) {
            activeSaveSlotIndex = null;
            if (startScreenDismissed) setUnsavedProgress(true);
        }
        renderSaveSlots();
        setSaveSlotStatus(`${t("save_slots.slot")} ${slotIndex + 1} ${t("save_slots.deleted_msg")}`);
    } catch (err) {
        console.error("Delete failed:", err);
        setSaveSlotStatus(t("save_slots.error_delete"), true);
    } finally {
        saveSlotBusy = false;
    }
}

function requestConfirmation({ title, message, confirmLabel, danger = false }) {
    if (!confirmDialog || !confirmActionBtn || !confirmCancelBtn) {
        return Promise.resolve(false);
    }
    if (pendingConfirmation) {
        pendingConfirmation(false);
        pendingConfirmation = null;
    }

    confirmTitle.textContent = title || "Confirm Action";
    confirmMessage.textContent = message || "Are you sure?";
    confirmActionBtn.textContent = confirmLabel || "Confirm";
    confirmActionBtn.classList.toggle("danger", danger);
    confirmActionBtn.classList.toggle("primary", !danger);
    confirmDialog.classList.remove("hidden");
    confirmCancelBtn.focus();

    return new Promise((resolve) => {
        pendingConfirmation = resolve;
    });
}

function resolveConfirmation(result) {
    if (!pendingConfirmation) return;
    const resolver = pendingConfirmation;
    pendingConfirmation = null;
    if (confirmDialog) confirmDialog.classList.add("hidden");
    resolver(Boolean(result));
}

function isGalleryOpen() {
    return galleryView && galleryView.classList.contains("active");
}

function buildGalleryPages(payload) {
    const artworks = Array.isArray(payload.artworks) ? payload.artworks : [];
    const intro = payload.intro || {};
    const outro = payload.outro || {};

    return [
        { type: "intro", ...intro },
        ...artworks.map((artwork, index) => ({
            type: "artwork",
            page_number: index + 1,
            page_total: artworks.length,
            ...artwork
        })),
        { type: "outro", ...outro }
    ];
}

function renderGalleryParagraphs(paragraphs) {
    return (paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("");
}

function renderGalleryIntroPage(page) {
    return `
        <article class="gallery-card gallery-cover-card">
            <p class="gallery-kicker">${escapeHtml(page.kicker)}</p>
            <h2>${escapeHtml(page.title)}</h2>
            <div class="gallery-body">${renderGalleryParagraphs(page.body)}</div>
        </article>
    `;
}

function renderGalleryArtworkPage(page) {
    const meta = [page.period, page.artist_role].filter(Boolean).join(" / ");
    const image = page.image ? `
        <img src="${escapeHtml(page.image)}" alt="${escapeHtml(page.image_alt)}" loading="lazy" referrerpolicy="no-referrer">
    ` : `<div class="gallery-image-fallback">${escapeHtml(page.artwork_title)}</div>`;
    const credit = page.image_credit ? `<p class="gallery-image-credit">${escapeHtml(page.image_credit)}</p>` : "";

    return `
        <article class="gallery-card gallery-artwork-card">
            <div class="gallery-image-panel">
                <div class="gallery-image-shell">
                    ${image}
                    ${credit}
                </div>
            </div>
            <div class="gallery-copy-panel">
                <p class="gallery-kicker">${t("gallery.artwork")} ${page.page_number} ${t("gallery.page_of")} ${page.page_total}</p>
                <h2>${escapeHtml(page.artwork_title)}</h2>
                <p class="gallery-byline">${t("gallery.by")} ${escapeHtml(page.artist_name)}</p>
                ${meta ? `<p class="gallery-meta">${escapeHtml(meta)}</p>` : ""}
                <div class="gallery-copy-frame" tabindex="0">
                    <section class="gallery-section">
                        <h3>${t("gallery.artwork")}</h3>
                        ${renderGalleryParagraphs(page.artwork_intro)}
                    </section>
                    <section class="gallery-section">
                        <h3>${t("gallery.the_artist")}</h3>
                        ${renderGalleryParagraphs(page.artist_intro)}
                    </section>
                    <section class="gallery-section">
                        <h3>${t("gallery.your_journey")}</h3>
                        ${renderGalleryParagraphs(page.journey_story)}
                    </section>
                </div>
            </div>
        </article>
    `;
}

function renderGalleryOutroPage(page) {
    return `
        <article class="gallery-card gallery-end-card">
            <p class="gallery-kicker">${escapeHtml(page.kicker)}</p>
            <h2>${escapeHtml(page.title)}</h2>
            <div class="gallery-body">${renderGalleryParagraphs(page.body)}</div>
        </article>
    `;
}

function renderGalleryIndicator() {
    if (!galleryIndicator) return;
    galleryIndicator.innerHTML = galleryPages.map((_, index) => `
        <button
            class="gallery-dot${index === galleryPageIndex ? " active" : ""}"
            type="button"
            data-gallery-index="${index}"
            aria-label="${t("gallery.go_to_page")} ${index + 1}"
            ${index === galleryPageIndex ? 'aria-current="page"' : ""}
        ></button>
    `).join("");
}

function getGalleryThemeWorld(page) {
    return page && page.type === "artwork" ? page.id : "museum";
}

function setGalleryTheme(worldId) {
    const themeWorld = worldId || "museum";
    const previousWorld = galleryView ? galleryView.dataset.galleryWorld : "museum";
    if (galleryView) galleryView.dataset.galleryWorld = themeWorld;
    if (startScreen) {
        startScreen.dataset.galleryWorld = themeWorld;
        if (previousWorld !== themeWorld) {
            if (galleryBackdropTimer) {
                window.clearTimeout(galleryBackdropTimer);
                galleryBackdropTimer = null;
            }
            startScreen.classList.remove("gallery-backdrop-shift");
            void startScreen.offsetWidth;
            startScreen.classList.add("gallery-backdrop-shift");
            galleryBackdropTimer = window.setTimeout(() => {
                startScreen.classList.remove("gallery-backdrop-shift");
                galleryBackdropTimer = null;
            }, 720);
        }
    }
    setStartParticleTheme(themeWorld);
}

function setGalleryTransitionClass(animate) {
    if (!galleryPage) return;
    if (galleryTransitionTimer) {
        window.clearTimeout(galleryTransitionTimer);
        galleryTransitionTimer = null;
    }
    galleryPage.classList.remove("gallery-slide-next", "gallery-slide-prev");
    delete galleryPage.dataset.galleryTransition;
    if (!animate) return;
    void galleryPage.offsetWidth;
    const transitionKey = galleryTransitionDirection === "prev" ? "prev" : "next";
    const transitionClass = transitionKey === "prev" ? "gallery-slide-prev" : "gallery-slide-next";
    galleryPage.dataset.galleryTransition = transitionKey;
    galleryPage.classList.add(transitionClass);
    galleryTransitionTimer = window.setTimeout(() => {
        galleryPage.classList.remove(transitionClass);
        delete galleryPage.dataset.galleryTransition;
        galleryTransitionTimer = null;
    }, 560);
}

function renderGalleryPage(options = {}) {
    if (!galleryPage) return;
    const animate = options.animate !== false;

    if (!galleryPages.length) {
        setGalleryTransitionClass(false);
        setGalleryTheme("museum");
        galleryPage.innerHTML = `
            <article class="gallery-card gallery-cover-card">
                <p class="gallery-kicker">${t("gallery.title")}</p>
                <h2>${t("gallery.loading")}</h2>
            </article>
        `;
        if (galleryPrevBtn) galleryPrevBtn.disabled = true;
        if (galleryNextBtn) galleryNextBtn.disabled = true;
        renderGalleryIndicator();
        return;
    }

    galleryPageIndex = Math.max(0, Math.min(galleryPageIndex, galleryPages.length - 1));
    const page = galleryPages[galleryPageIndex];
    const targetGalleryWorld = getGalleryThemeWorld(page);
    if (page.type === "artwork") {
        galleryPage.innerHTML = renderGalleryArtworkPage(page);
    } else if (page.type === "outro") {
        galleryPage.innerHTML = renderGalleryOutroPage(page);
    } else {
        galleryPage.innerHTML = renderGalleryIntroPage(page);
    }
    void galleryPage.offsetWidth;
    setGalleryTheme(targetGalleryWorld);
    setGalleryTransitionClass(animate);

    if (galleryPrevBtn) galleryPrevBtn.disabled = galleryPageIndex === 0;
    if (galleryNextBtn) galleryNextBtn.disabled = galleryPageIndex === galleryPages.length - 1;
    renderGalleryIndicator();
}

function setGalleryPage(index) {
    if (!galleryPages.length) return;
    const nextIndex = Math.max(0, Math.min(index, galleryPages.length - 1));
    if (nextIndex === galleryPageIndex) return;
    galleryTransitionDirection = nextIndex > galleryPageIndex ? "next" : "prev";
    galleryPageIndex = nextIndex;
    renderGalleryPage({ animate: true });
}

async function loadGalleryPages() {
    if (galleryIsLoading) return;
    galleryPages = [];  // Reset so language switch triggers reload
    galleryIsLoading = true;
    const currentLang = getCurrentInterfaceLanguage();
    galleryLanguage = currentLang;
    renderGalleryPage();

    try {
        const resp = await fetch("/api/gallery?lang=" + encodeURIComponent(currentLang));
        if (!resp.ok) throw new Error("Gallery request failed");
        const payload = await resp.json();
        galleryPages = buildGalleryPages(payload);
    } catch (err) {
        console.error("Gallery load failed:", err);
        galleryPages = [{
            type: "outro",
            kicker: t("gallery.unavailable_kicker"),
            title: t("gallery.unavailable_title"),
            body: [t("gallery.unavailable_body")]
        }];
    } finally {
        galleryIsLoading = false;
        renderGalleryPage({ animate: false });
    }
}

async function openGallery() {
    showStartStatus("");
    showStartView("gallery");
    if (galleryView) galleryView.focus();
    if (galleryLanguage && galleryLanguage !== getCurrentInterfaceLanguage()) {
        galleryPages = [];
        galleryPageIndex = 0;
    }
    await loadGalleryPages();
    renderGalleryPage({ animate: false });
}

function closeGallery() {
    galleryPageIndex = 0;
    setGalleryTransitionClass(false);
    setGalleryTheme("museum");
    showStartView("menu");
    if (galleryBtn) galleryBtn.focus();
}

function isSettingsOpen() {
    return settingsView && settingsView.classList.contains("active");
}

function clampPercent(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return 0;
    return Math.max(0, Math.min(100, Math.round(num)));
}

function setSettingsStatus(message, type = "") {
    if (!settingsStatus) return;
    settingsStatus.textContent = message || "";
    settingsStatus.className = type || "";
    window.clearTimeout(setSettingsStatus.timer);
    if (message && type !== "error") {
        setSettingsStatus.timer = window.setTimeout(() => {
            settingsStatus.textContent = "";
            settingsStatus.className = "";
        }, 2600);
    }
}

function setSettingsModelView(mode) {
    settingsModelView = mode || settingsModelView || currentMode;
    const selectedOption = SETTINGS_MODEL_OPTIONS.find((option) => option.mode === settingsModelView) || SETTINGS_MODEL_OPTIONS[0];
    if (modelProviderValue) modelProviderValue.textContent = t(selectedOption.labelKey);
    if (deepseekSettingsPanel) deepseekSettingsPanel.classList.toggle("hidden", settingsModelView !== "api");
    if (localModelSettingsPanel) localModelSettingsPanel.classList.toggle("hidden", settingsModelView !== "local");
    scheduleSettingsPanelHeightSync();
}

function setModeButtonsActive(mode, options = {}) {
    currentMode = mode || currentMode;
    setSettingsModelView(options.settingsMode || currentMode);
    updateVoiceSettingsUi();
}

function setLanguageDisplay() {
    if (!languageValue) return;
    const current = settingsData && settingsData.language && settingsData.language.current ? settingsData.language.current : "en";
    languageValue.textContent = t("lang_label") || LANG_LABELS[current] || current;
}

function setPersonalApiExpanded(expanded) {
    if (personalApiToggle) personalApiToggle.checked = Boolean(expanded);
    if (personalApiFields) personalApiFields.classList.toggle("hidden", !expanded);
}

function updateExperienceSettings(deepseek) {
    const experienceAvailable = Boolean(deepseek.experience_available);
    if (experienceServiceDot) {
        experienceServiceDot.classList.remove("online", "loading", "offline");
        experienceServiceDot.classList.add(experienceAvailable ? "online" : "offline");
    }
    if (experienceServiceStatus) {
        experienceServiceStatus.textContent = experienceAvailable ? "Online" : "Offline";
    }
    if (experienceServiceDetail) {
        experienceServiceDetail.textContent = experienceAvailable
            ? t("settings.experience_detail_online")
            : t("settings.experience_detail_offline");
        experienceServiceDetail.classList.toggle("warning", !experienceAvailable);
    }
    if (experienceUnlockInput) experienceUnlockInput.disabled = !experienceAvailable;
    if (experienceUnlockBtn) experienceUnlockBtn.disabled = !experienceAvailable;

    const percent = clampPercent(deepseek.experience_remaining_percent ?? 100);
    if (experienceTokenPercent) experienceTokenPercent.textContent = `${percent}%`;
    if (experienceTokenBar) experienceTokenBar.style.width = `${percent}%`;
    if (!experienceTokenNote) return;
    if (!experienceAvailable) {
        experienceTokenNote.textContent = deepseek.experience_status_detail || t("settings.experience_detail_offline");
        experienceTokenNote.classList.add("warning");
    } else if (deepseek.experience_unlimited) {
        experienceTokenNote.textContent = t("settings.experience_unlocked");
        experienceTokenNote.classList.remove("warning");
    } else {
        const remainingTokens = Number(deepseek.experience_remaining_tokens ?? 0);
        const tokenLimit = Number(deepseek.experience_token_limit ?? 0);
        if (tokenLimit > 0) {
            experienceTokenNote.textContent = t("settings.experience_token_pool", { remaining: remainingTokens.toLocaleString(), limit: tokenLimit.toLocaleString() });
        } else {
            experienceTokenNote.textContent = t("settings.experience_no_tokens");
        }
        experienceTokenNote.classList.toggle("warning", percent <= 10);
    }
}

function updatePersonalApiSettings(deepseek) {
    if (!personalApiKeyInput || !personalApiHelp) return;
    const maskedKey = deepseek.personal_key_masked || "";
    setPersonalApiExpanded(deepseek.api_mode === "personal" || !deepseek.experience_available);
    personalApiKeyInput.dataset.maskedValue = maskedKey;
    personalApiKeyInput.value = maskedKey;
    personalApiKeyInput.placeholder = deepseek.personal_configured
        ? t("settings.personal_key_placeholder_paste")
        : t("settings.personal_key_placeholder");
    if (deepseek.personal_configured) {
        const source = deepseek.personal_key_source === "environment" ? "environment" : "settings";
        personalApiHelp.textContent = t("settings.personal_key_loaded", { source: source });
        personalApiHelp.classList.remove("warning");
    } else if (!deepseek.experience_available) {
        personalApiHelp.textContent = t("settings.personal_key_help_offline");
        personalApiHelp.classList.add("warning");
    } else {
        personalApiHelp.textContent = t("settings.personal_key_help");
        personalApiHelp.classList.add("warning");
    }
}

function updateLocalModelSettingsStatus(data) {
    if (!localModelDot || !localModelStatus || !localModelPercent || !localModelProgressBar || !localModelDetail) return;
    const isReady = Boolean(data.local_ready);
    const isLoading = Boolean(data.local_loading) && !isReady;
    const progress = clampPercent(data.local_progress_percent ?? (isReady ? 100 : isLoading ? 35 : 0));
    localModelProgressBar.style.width = `${progress}%`;
    localModelPercent.textContent = `${progress}%`;
    localModelDot.classList.remove("online", "loading", "offline");
    if (isReady) {
        localModelDot.classList.add("online");
        localModelStatus.textContent = t("settings.local_model_ready");
        localModelDetail.textContent = t("settings.local_model_ready_detail");
    } else if (isLoading) {
        localModelDot.classList.add("loading");
        localModelStatus.textContent = t("settings.local_model_loading");
        localModelDetail.textContent = t("settings.local_model_loading_detail");
    } else {
        localModelDot.classList.add("offline");
        localModelStatus.textContent = t("settings.local_model_unavailable");
        localModelDetail.textContent = data.local_error
            ? `${t("settings.local_model_unavailable_detail")} ${t("settings.local_model_diagnostic")} ${data.local_error}`
            : t("settings.local_model_unavailable_detail");
    }
}

function updateVoiceRuntimeSettingsStatus(data) {
    if (!data) return;
    lastModelStatusData = {...(lastModelStatusData || {}), ...data};
    updateSidePanelModelStatusRows(lastModelStatusData);
    if (!voiceRuntimeDot || !voiceRuntimeStatus || !voiceRuntimeDetail) return;
    const runtimeOk = data.voice_runtime_ok === true || data.ok === true;
    const loading = Boolean(data.voice_stt_loading);
    const checked = data.voice_runtime_checked === true || data.voice_runtime_ok !== undefined || data.ok !== undefined || Boolean(data.voice_stt_error);
    const ready = Boolean(data.voice_stt_ready);
    const failed = data.voice_runtime_ok === false || Boolean(data.voice_stt_error || data.voice_runtime_error || data.error);
    voiceRuntimeDot.classList.remove("online", "loading", "offline");
    voiceRuntimeDetail.classList.remove("warning");
    if (ready) {
        voiceRuntimeDot.classList.add("online");
        voiceRuntimeStatus.textContent = t("settings.voice_runtime_ready");
        voiceRuntimeDetail.textContent = t("settings.voice_runtime_ready_detail");
    } else if (failed && checked) {
        voiceRuntimeDot.classList.add("offline");
        voiceRuntimeStatus.textContent = t("settings.voice_runtime_unavailable");
        const diagnostic = data.voice_stt_error || data.voice_runtime_error || data.error || "";
        voiceRuntimeDetail.textContent = diagnostic
            ? `${t("settings.voice_runtime_unavailable_detail")} ${t("settings.local_model_diagnostic")} ${diagnostic}`
            : t("settings.voice_runtime_unavailable_detail");
        voiceRuntimeDetail.classList.add("warning");
    } else if (loading || runtimeOk) {
        voiceRuntimeDot.classList.add("loading");
        voiceRuntimeStatus.textContent = t("settings.voice_runtime_loading");
        voiceRuntimeDetail.textContent = t("settings.voice_runtime_loading_detail");
    } else if (checked) {
        voiceRuntimeDot.classList.add("offline");
        voiceRuntimeStatus.textContent = t("settings.voice_runtime_unavailable");
        const diagnostic = data.voice_stt_error || data.voice_runtime_error || data.error || "";
        voiceRuntimeDetail.textContent = diagnostic
            ? `${t("settings.voice_runtime_unavailable_detail")} ${t("settings.local_model_diagnostic")} ${diagnostic}`
            : t("settings.voice_runtime_unavailable_detail");
        voiceRuntimeDetail.classList.add("warning");
    } else {
        voiceRuntimeDot.classList.add("loading");
        voiceRuntimeStatus.textContent = t("settings.voice_runtime_checking");
        voiceRuntimeDetail.textContent = t("settings.voice_runtime_detail");
    }
}

function updateSettingsUi(data) {
    if (!data) return;
    settingsData = data;
    setLanguageDisplay();
    updateTutorialSettingsUi();
    updateCursorSettingsUi();
    setModeButtonsActive(data.active_mode || currentMode, { settingsMode: data.active_mode || currentMode });
    const deepseek = data.deepseek || {};
    updateExperienceSettings(deepseek);
    updatePersonalApiSettings(deepseek);
    updateLocalModelSettingsStatus(data);
    updateVoiceRuntimeSettingsStatus(data);
    updateVoiceSettingsUi();
    scheduleSettingsPanelHeightSync();
}

async function loadSettings(silent = false) {
    if (!settingsView) return null;
    try {
        const resp = await fetch("/api/settings");
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Settings request failed");
        updateSettingsUi(data);
        return data;
    } catch (err) {
        console.error("Settings load failed:", err);
        if (!silent) setSettingsStatus(t("errors.settings_load"), "error");
    }
    return null;
}

async function postSettings(payload) {
    const resp = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    const data = await resp.json();
    if (!resp.ok) {
        if (data && data.deepseek) updateSettingsUi(data);
        throw new Error(data.error || t("errors.settings_update"));
    }
    updateSettingsUi(data);
    updateModelStatus(data);
    return data;
}

async function switchModelMode(mode) {
    if (!mode || mode === currentMode) {
        setModeButtonsActive(mode || currentMode);
        return null;
    }
    const previousMode = currentMode;
    setModeButtonsActive(mode);
    let failedModeData = null;

    try {
        const resp = await fetch("/api/mode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode })
        });
        const data = await resp.json();
        if (!resp.ok) {
            if (data) {
                failedModeData = data;
                updateModelStatus(data, { settingsMode: mode });
                updateLocalModelSettingsStatus(data);
            }
            throw new Error(data.error || "Mode switch failed");
        }
        updateModelStatus(data);
        await loadSettings(true);
        return data;
    } catch (err) {
        console.error("Mode switch failed:", err);
        if (!(mode === "local" && failedModeData && failedModeData.local_runtime_ok === false)) {
            setModeButtonsActive(previousMode);
        }
        setSettingsStatus(err.message || t("errors.mode_switch"), "error");
        return null;
    }
}

function cycleSettingsModel(direction) {
    const currentIndex = Math.max(0, SETTINGS_MODEL_OPTIONS.findIndex((option) => option.mode === settingsModelView));
    const nextIndex = (currentIndex + direction + SETTINGS_MODEL_OPTIONS.length) % SETTINGS_MODEL_OPTIONS.length;
    switchModelMode(SETTINGS_MODEL_OPTIONS[nextIndex].mode);
}

function isNewAdventureTransitionBusy() {
    return Boolean(newAdventurePreparing || newAdventureTransitionLocked);
}

function updateLanguageControlsDisabled() {
    const disabled = Boolean(languageSwitchBusy || isNewAdventureTransitionBusy());
    if (languagePrevBtn) languagePrevBtn.disabled = disabled;
    if (languageNextBtn) languageNextBtn.disabled = disabled;
}

function updateNewAdventureTransitionControls() {
    const busy = Boolean(languageSwitchBusy || isNewAdventureTransitionBusy());
    if (settingsFlowNextBtn) settingsFlowNextBtn.disabled = busy;
    if (tutorialNextBtn) tutorialNextBtn.disabled = busy;
    updateLanguageControlsDisabled();
}

function setNewAdventureTransitionLocked(locked) {
    newAdventureTransitionLocked = Boolean(locked);
    if (settingsView) settingsView.classList.toggle("new-adventure-transition-locked", newAdventureTransitionLocked);
    if (tutorialView) tutorialView.classList.toggle("new-adventure-transition-locked", newAdventureTransitionLocked);
    updateNewAdventureTransitionControls();
}

function setNewAdventureFlowActive(active) {
    newAdventureFlowActive = Boolean(active);
    if (settingsView) settingsView.classList.toggle("onboarding-flow", newAdventureFlowActive);
    if (tutorialView) tutorialView.classList.toggle("onboarding-flow", newAdventureFlowActive);
    updateNewAdventureTransitionControls();
}

function cancelNewAdventureFlow() {
    setNewAdventureTransitionLocked(false);
    setNewAdventureFlowActive(false);
    settingsReturnTarget = "menu";
    newAdventurePrepared = false;
    newAdventurePreparing = false;
    setSettingsStatus("");
    showStartView("menu");
    showStartStatus("");
    if (newAdventureBtn) newAdventureBtn.focus();
}

async function openSettings(source = "menu") {
    settingsReturnTarget = source === "game" ? "game" : (source === "new-adventure" ? "new-adventure" : "menu");
    setNewAdventureFlowActive(settingsReturnTarget === "new-adventure");
    const settingsThemeWorld = settingsReturnTarget === "game" ? currentWorld : "museum";
    showStartStatus("");
    if (startScreen) startScreen.dataset.galleryWorld = settingsThemeWorld;
    setStartParticleTheme(settingsThemeWorld);
    if (settingsReturnTarget === "game") {
        gameInputWasEnabledBeforeSettings = commandInput && !commandInput.disabled;
        setGameInputEnabled(false);
        if (startScreen) startScreen.classList.remove("hidden");
        startStartParticles();
    }
    showStartView("settings");
    resetSettingsViewForOpen();
    if (settingsView) settingsView.focus();
    await loadSettings();
    resetSettingsScrollPosition();
    updateTutorialSettingsUi();
}

function closeSettings() {
    setSettingsStatus("");
    if (settingsReturnTarget === "game") {
        showStartView("menu");
        if (startScreen) startScreen.classList.add("hidden");
        stopTitleParticles();
        stopStartParticles();
        if (gameInputWasEnabledBeforeSettings) {
            if (isWaiting) {
                commandInput.disabled = false;
                sendBtn.disabled = true;
                voiceInputEnabled = true;
                updateVoiceButtonState();
            } else {
                setGameInputEnabled(true);
            }
        }
        if (gameSettingsBtn) gameSettingsBtn.focus();
        settingsReturnTarget = "menu";
        gameInputWasEnabledBeforeSettings = false;
        return;
    }
    if (settingsReturnTarget === "new-adventure") {
        settingsReturnTarget = "menu";
        cancelNewAdventureFlow();
        return;
    }
    setNewAdventureFlowActive(false);
    showStartView("menu");
    if (settingsBtn) settingsBtn.focus();
}

async function selectDeepSeekApiMode(apiMode) {
    if (settingsBusy) return;
    if (apiMode === "experience" && settingsData && settingsData.deepseek && !settingsData.deepseek.experience_available) {
        setPersonalApiExpanded(true);
        setSettingsStatus(t("errors.experience_offline"), "error");
        if (personalApiKeyInput) personalApiKeyInput.focus();
        return;
    }
    settingsBusy = true;
    try {
        await postSettings({ api_mode: apiMode });
        await switchModelMode("api");
        setSettingsStatus(apiMode === "personal" ? t("settings.api_mode_personal_selected") : t("settings.api_mode_experience_selected"), "success");
    } catch (err) {
        console.error("DeepSeek mode update failed:", err);
        setSettingsStatus(err.message || t("errors.deepseek_update"), "error");
    } finally {
        settingsBusy = false;
    }
}

async function savePersonalApiKey() {
    if (!personalApiKeyInput || settingsBusy) return;
    settingsBusy = true;
    const rawKey = personalApiKeyInput.value.trim();
    const maskedKey = personalApiKeyInput.dataset.maskedValue || "";
    const payload = { api_mode: "personal" };
    if (rawKey && rawKey !== maskedKey && !rawKey.includes("*")) {
        payload.personal_api_key = rawKey;
    }

    try {
        await postSettings(payload);
        await switchModelMode("api");
        setSettingsStatus(rawKey && rawKey !== maskedKey ? t("settings.api_key_saved") : t("settings.api_mode_personal_selected"), "success");
    } catch (err) {
        console.error("Personal API save failed:", err);
        setSettingsStatus(err.message || t("errors.personal_api_save"), "error");
    } finally {
        settingsBusy = false;
    }
}

async function unlockExperienceMode() {
    if (!experienceUnlockInput || settingsBusy) return;
    const unlockKey = experienceUnlockInput.value.trim();
    if (!unlockKey) {
        setSettingsStatus(t("errors.no_unlock_key"), "error");
        experienceUnlockInput.focus();
        return;
    }

    settingsBusy = true;
    try {
        await postSettings({ api_mode: "experience", unlock_key: unlockKey });
        await switchModelMode("api");
        experienceUnlockInput.value = "";
        setSettingsStatus(t("settings.experience_unlock_success"), "success");
    } catch (err) {
        console.error("Experience unlock failed:", err);
        setSettingsStatus(err.message || t("errors.unlock_fail"), "error");
    } finally {
        settingsBusy = false;
    }
}

function addOpeningMessage() {
    addMessage(t("messages.opening"), "narration");
}

function resetClientViewForNewAdventure() {
    chatLog.innerHTML = "";
    currentWorld = "museum";
    inventoryTimeline = [];
    inventoryDetails = [];
    dynamicWorldOrder = [];
    gameEndingTriggered = false;
    document.body.dataset.world = currentWorld;
    locationBadge.textContent = t("world_names.museum");
    locationName.textContent = t("world_names.museum");
    locationDesc.textContent = "";
    exitsList.innerHTML = "";
    inventoryList.innerHTML = `<li class="empty-inv">${t("side_panel.inventory_empty")}</li>`;
    if (inventorySections) inventorySections.innerHTML = "";
    if (inventoryStatus) inventoryStatus.textContent = t("inventory.empty_status");
    if (inventoryDialog) inventoryDialog.classList.add("hidden");
    document.querySelectorAll(".quest-status").forEach((status) => {
        status.textContent = "\u25CB";
        status.className = "quest-status pending";
    });
    if (npcCard) npcCard.style.display = "none";
    responseBadge.style.display = "none";
    const endPageCard = document.getElementById("end-page-card");
    if (endPageCard) endPageCard.remove();
    setParticleWorld(currentWorld);
    updateQuickActions(currentWorld);
}

function enterGameFromIntro() {
    if (startScreenDismissed || !introStory || !introStory.classList.contains("active")) return;
    if (languageSwitchBusy || newAdventurePreparing) return;
    setNewAdventureTransitionLocked(true);
    markTutorialSeen();
    setNewAdventureFlowActive(false);
    newAdventurePrepared = false;
    newAdventurePreparing = false;
    settingsReturnTarget = "menu";
    titleScreenDismissed = true;
    if (titleScreen) titleScreen.classList.add("hidden");
    stopTitleParticles();
    startScreenDismissed = true;
    if (startScreen) {
        startScreen.classList.add("hidden");
    }
    stopStartParticles();
    setGameInputEnabled(true);
    addOpeningMessage();
    activeSaveSlotIndex = null;
    setUnsavedProgress(true);
    commandInput.focus();
    setNewAdventureTransitionLocked(false);
}

function showMainMenuOverlay() {
    if (!startScreen) return;
    titleScreenDismissed = true;
    if (titleScreen) titleScreen.classList.add("hidden");
    stopTitleParticles();

    // Reset bridge overlay
    const bridgeTitle = document.getElementById("transition-title");
    if (bridgeTitle) {
        bridgeTitle.classList.add("hidden");
        bridgeTitle.classList.remove("animate");
        bridgeTitle.style.transform = "";
    }

    startScreenDismissed = false;
    if (inventoryDialog) inventoryDialog.classList.add("hidden");
    currentWorld = "museum";
    document.body.dataset.world = currentWorld;
    startScreen.dataset.galleryWorld = "museum";
    setStartParticleTheme("museum");
    setParticleWorld(currentWorld);
    showStartView("menu");
    showStartStatus("");

    // Show start screen elements immediately (no transition needed when returning from game)
    const startMenuKicker = document.querySelector("#start-menu .start-kicker");
    const startMenuTitle = document.querySelector("#start-menu .start-title");
    if (startMenuKicker) { startMenuKicker.classList.add("visible"); startMenuKicker.style.opacity = "1"; }
    if (startMenuTitle) { startMenuTitle.classList.add("visible"); startMenuTitle.style.opacity = "1"; }
    document.querySelectorAll("#start-menu .start-btn").forEach(function(btn) {
        btn.classList.add("revealed");
        btn.style.animationDelay = "0s";
    });

    startScreen.classList.remove("hidden", "entering", "show");
    startScreen.style.opacity = "1";
    if (startParticleCanvas) { startParticleCanvas.style.opacity = "1"; startParticleCanvas.style.transition = ""; }
    startStartParticles();
    setGameInputEnabled(false);
    if (newAdventureBtn) newAdventureBtn.focus();
}

function showEndGameDialog() {
    if (!endGameDialog) return;
    endGameDialog.classList.remove("hidden");
    if (cancelEndGameBtn) cancelEndGameBtn.focus();
}

function hideEndGameDialog() {
    if (!endGameDialog) return;
    endGameDialog.classList.add("hidden");
    if (endGameBtn) endGameBtn.focus();
}

function returnToMainMenuFromGame() {
    if (endGameDialog) endGameDialog.classList.add("hidden");
    activeSaveSlotIndex = null;
    setUnsavedProgress(false);
    showMainMenuOverlay();
}

async function beginNewAdventure() {
    if (!newAdventureBtn) return;
    newAdventureBtn.disabled = true;
    setNewAdventureTransitionLocked(false);
    setNewAdventureFlowActive(true);
    newAdventurePrepared = false;
    newAdventurePreparing = false;
    showStartStatus("");

    await openSettings("new-adventure");
    newAdventureBtn.disabled = false;
}

async function prepareNewAdventureRun() {
    if (newAdventurePrepared) return true;
    if (newAdventurePreparing) return false;
    newAdventurePreparing = true;
    updateNewAdventureTransitionControls();
    setSettingsStatus(t("start.starting_adventure"));
    try {
        await fetch("/api/reset", { method: "POST" });
    } catch (e) {
        console.warn("Reset before new adventure failed:", e);
    } finally {
        newAdventurePreparing = false;
        updateNewAdventureTransitionControls();
    }

    resetClientViewForNewAdventure();
    activeSaveSlotIndex = null;
    setUnsavedProgress(false);
    newAdventurePrepared = true;
    return true;
}

async function showIntroForNewAdventure() {
    if (languageSwitchBusy || newAdventureTransitionLocked) return;
    setNewAdventureTransitionLocked(true);
    const prepared = await prepareNewAdventureRun();
    if (!prepared) {
        setNewAdventureTransitionLocked(false);
        return;
    }
    setSettingsStatus("");
    setNewAdventureFlowActive(false);
    showStartView("intro");
    if (introStory) introStory.focus();
    setNewAdventureTransitionLocked(false);
}

function advanceFromNewAdventureSettings() {
    if (!newAdventureFlowActive || newAdventurePreparing || newAdventureTransitionLocked || languageSwitchBusy) return;
    if (isTutorialEnabledForNewAdventure()) {
        renderTutorialContent(tutorialPage);
        showStartView("tutorial");
        if (tutorialView) tutorialView.focus();
        return;
    }
    showIntroForNewAdventure();
}

function backFromTutorialView() {
    if (!newAdventureFlowActive) return;
    showStartView("settings");
    if (settingsView) settingsView.focus();
}

if (titleScreen) {
    // Click or tap on title screen dismisses it
    titleScreen.addEventListener("click", () => {
        if (!titleScreenDismissed) dismissTitleScreen();
    });
}

if (startScreen) {
    setGameInputEnabled(false);

    startScreen.addEventListener("click", (e) => {
        if (introStory && introStory.classList.contains("active") && !startScreenDismissed) {
            enterGameFromIntro();
            return;
        }
        const placeholderBtn = e.target.closest(".start-btn[data-placeholder]");
        if (!placeholderBtn) return;
        e.stopPropagation();
        showStartStatus(placeholderBtn.dataset.placeholder);
    });
}

if (newAdventureBtn) {
    newAdventureBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        beginNewAdventure();
    });
}

if (continueGameBtn) {
    continueGameBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSaveSlotDialog("load");
    });
}

if (galleryBtn) {
    galleryBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openGallery();
    });
}

if (settingsBtn) {
    settingsBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openSettings();
    });
}

if (galleryBackBtn) {
    galleryBackBtn.addEventListener("click", closeGallery);
}

if (settingsBackBtn) {
    settingsBackBtn.addEventListener("click", closeSettings);
}

if (settingsFlowPrevBtn) {
    settingsFlowPrevBtn.addEventListener("click", cancelNewAdventureFlow);
}

if (settingsFlowNextBtn) {
    settingsFlowNextBtn.addEventListener("click", advanceFromNewAdventureSettings);
}

settingsTabButtons.forEach((button) => {
    button.addEventListener("click", () => {
        setSettingsTab(button.dataset.settingsTab || settingsActiveTab);
    });
});

if (tutorialEnabledCheckbox) {
    tutorialEnabledCheckbox.addEventListener("change", () => {
        setTutorialEnabledPreference(tutorialEnabledCheckbox.checked);
    });
}

if (galleryPrevBtn) {
    galleryPrevBtn.addEventListener("click", () => setGalleryPage(galleryPageIndex - 1));
}

if (galleryNextBtn) {
    galleryNextBtn.addEventListener("click", () => setGalleryPage(galleryPageIndex + 1));
}

if (galleryIndicator) {
    galleryIndicator.addEventListener("click", (e) => {
        const dot = e.target.closest(".gallery-dot");
        if (!dot) return;
        setGalleryPage(Number(dot.dataset.galleryIndex));
    });
}

if (tutorialBackBtn) {
    tutorialBackBtn.addEventListener("click", backFromTutorialView);
}

if (tutorialPrevBtn) {
    tutorialPrevBtn.addEventListener("click", backFromTutorialView);
}

if (tutorialNextBtn) {
    tutorialNextBtn.addEventListener("click", showIntroForNewAdventure);
}

if (languagePrevBtn) {
    languagePrevBtn.addEventListener("click", () => {
        const available = settingsData && settingsData.language && settingsData.language.available ? settingsData.language.available : ["en"];
        if (available.length <= 1) {
            setSettingsStatus(t("settings.only_one_language"), "success");
            return;
        }
        const current = settingsData && settingsData.language && settingsData.language.current ? settingsData.language.current : "en";
        const idx = available.indexOf(current);
        const next = available[(idx - 1 + available.length) % available.length];
        switchLanguage(next);
    });
}

if (languageNextBtn) {
    languageNextBtn.addEventListener("click", () => {
        const available = settingsData && settingsData.language && settingsData.language.available ? settingsData.language.available : ["en"];
        if (available.length <= 1) {
            setSettingsStatus(t("settings.only_one_language"), "success");
            return;
        }
        const current = settingsData && settingsData.language && settingsData.language.current ? settingsData.language.current : "en";
        const idx = available.indexOf(current);
        const next = available[(idx + 1) % available.length];
        switchLanguage(next);
    });
}

if (modelPrevBtn) {
    modelPrevBtn.addEventListener("click", () => cycleSettingsModel(-1));
}

if (modelNextBtn) {
    modelNextBtn.addEventListener("click", () => cycleSettingsModel(1));
}

if (voiceBackendPrevBtn) {
    voiceBackendPrevBtn.addEventListener("click", () => cycleVoiceBackend(-1));
}

if (voiceBackendNextBtn) {
    voiceBackendNextBtn.addEventListener("click", () => cycleVoiceBackend(1));
}

if (voiceCorrectionPrevBtn) {
    voiceCorrectionPrevBtn.addEventListener("click", () => cycleVoiceCorrection(-1));
}

if (voiceCorrectionNextBtn) {
    voiceCorrectionNextBtn.addEventListener("click", () => cycleVoiceCorrection(1));
}

if (voiceAutoSendCheckbox) {
    voiceAutoSendCheckbox.addEventListener("change", () => {
        saveVoiceSettings({ auto_send: voiceAutoSendCheckbox.checked });
    });
}

if (cursorStyleCheckbox) {
    cursorStyleCheckbox.addEventListener("change", () => {
        setCursorStylePreference(cursorStyleCheckbox.checked);
    });
}

if (cursorTrailCheckbox) {
    cursorTrailCheckbox.addEventListener("change", () => {
        setCursorTrailPreference(cursorTrailCheckbox.checked);
    });
}

if (cursorTipGlowCheckbox) {
    cursorTipGlowCheckbox.addEventListener("change", () => {
        setCursorTipGlowPreference(cursorTipGlowCheckbox.checked);
    });
}

if (cursorTipGlowRadiusPrevBtn) {
    cursorTipGlowRadiusPrevBtn.addEventListener("click", () => cycleCursorTipGlowRadius(-1));
}

if (cursorTipGlowRadiusNextBtn) {
    cursorTipGlowRadiusNextBtn.addEventListener("click", () => cycleCursorTipGlowRadius(1));
}

if (cursorClickEffectCheckbox) {
    cursorClickEffectCheckbox.addEventListener("change", () => {
        setCursorClickEffectPreference(cursorClickEffectCheckbox.checked);
    });
}

if (cursorTrailStylePrevBtn) {
    cursorTrailStylePrevBtn.addEventListener("click", () => cycleCursorTrailStyle(-1));
}

if (cursorTrailStyleNextBtn) {
    cursorTrailStyleNextBtn.addEventListener("click", () => cycleCursorTrailStyle(1));
}

if (personalApiToggle) {
    personalApiToggle.addEventListener("change", () => {
        if (personalApiToggle.checked) {
            setPersonalApiExpanded(true);
            const hasConfiguredKey = Boolean(
                (settingsData && settingsData.deepseek && settingsData.deepseek.personal_configured)
                || (personalApiKeyInput && personalApiKeyInput.dataset.maskedValue)
            );
            if (hasConfiguredKey) {
                selectDeepSeekApiMode("personal");
            } else {
                setSettingsStatus(t("settings.personal_api_fields_available"), "success");
            }
            if (personalApiKeyInput) personalApiKeyInput.focus();
            return;
        }
        setPersonalApiExpanded(false);
        if (settingsData && settingsData.deepseek && !settingsData.deepseek.experience_available) {
            setPersonalApiExpanded(true);
            setSettingsStatus(t("errors.experience_offline"), "error");
            if (personalApiKeyInput) personalApiKeyInput.focus();
            return;
        }
        selectDeepSeekApiMode("experience");
    });
}

if (personalApiSaveBtn) {
    personalApiSaveBtn.addEventListener("click", savePersonalApiKey);
}

if (personalApiKeyInput) {
    personalApiKeyInput.addEventListener("focus", () => {
        if (personalApiKeyInput.value && personalApiKeyInput.value.includes("*")) {
            personalApiKeyInput.value = "";
        }
    });
    personalApiKeyInput.addEventListener("blur", () => {
        if (!personalApiKeyInput.value && personalApiKeyInput.dataset.maskedValue) {
            personalApiKeyInput.value = personalApiKeyInput.dataset.maskedValue;
        }
    });
    personalApiKeyInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            savePersonalApiKey();
        }
    });
}

if (experienceUnlockBtn) {
    experienceUnlockBtn.addEventListener("click", unlockExperienceMode);
}

if (experienceUnlockInput) {
    experienceUnlockInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
            e.preventDefault();
            unlockExperienceMode();
        }
    });
}

if (introCopy) {
    introCopy.addEventListener("click", (e) => {
        if (!e.target.closest(".intro-copy p")) return;
        enterGameFromIntro();
    });
}

window.addEventListener("keydown", (e) => {
    if (confirmDialog && !confirmDialog.classList.contains("hidden") && e.key === "Escape") {
        e.preventDefault();
        resolveConfirmation(false);
        return;
    }
    if (isSaveDialogOpen() && e.key === "Escape") {
        e.preventDefault();
        closeSaveSlotDialog();
        return;
    }
    if (isInventoryDialogOpen() && e.key === "Escape") {
        e.preventDefault();
        closeInventoryDialog();
        return;
    }
    if (isTutorialDialogOpen() && e.key === "Escape") {
        e.preventDefault();
        closeTutorialDialog();
        return;
    }
    if (isSettingsOpen() && e.key === "Escape") {
        e.preventDefault();
        closeSettings();
        return;
    }
    if (isSettingsOpen() && newAdventureFlowActive) {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            cancelNewAdventureFlow();
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            advanceFromNewAdventureSettings();
            return;
        }
    }
    if (endGameDialog && !endGameDialog.classList.contains("hidden") && e.key === "Escape") {
        hideEndGameDialog();
        return;
    }
    if (isGalleryOpen()) {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            setGalleryPage(galleryPageIndex - 1);
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            setGalleryPage(galleryPageIndex + 1);
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            closeGallery();
            return;
        }
    }
    if (isTutorialViewOpen()) {
        if (e.key === "ArrowLeft") {
            e.preventDefault();
            backFromTutorialView();
            return;
        }
        if (e.key === "ArrowRight") {
            e.preventDefault();
            showIntroForNewAdventure();
            return;
        }
        if (e.key === "Escape") {
            e.preventDefault();
            backFromTutorialView();
            return;
        }
    }
    // Title screen: any key dismisses it
    if (!titleScreenDismissed && titleScreen && !titleScreen.classList.contains("hidden")) {
        e.preventDefault();
        dismissTitleScreen();
        return;
    }
    if (!introStory || !introStory.classList.contains("active") || startScreenDismissed) return;
    e.preventDefault();
    enterGameFromIntro();
});

if (endGameBtn) {
    endGameBtn.addEventListener("click", async () => {
        if (hasUnsavedProgress) {
            const confirmed = await requestConfirmation({
                title: t("end_game.unsaved_title"),
                message: t("end_game.unsaved_message"),
                confirmLabel: t("end_game.return_without_saving"),
                danger: true,
            });
            if (confirmed) returnToMainMenuFromGame();
            return;
        }
        showEndGameDialog();
    });
}

if (saveProgressBtn) {
    saveProgressBtn.addEventListener("click", () => openSaveSlotDialog("save"));
}

if (gameSettingsBtn) {
    gameSettingsBtn.addEventListener("click", () => openSettings("game"));
}

if (saveSlotCloseBtn) {
    saveSlotCloseBtn.addEventListener("click", closeSaveSlotDialog);
}

if (saveSlotDialog) {
    saveSlotDialog.addEventListener("click", (e) => {
        if (e.target === saveSlotDialog) closeSaveSlotDialog();
    });
}

if (openInventoryBtn) {
    openInventoryBtn.addEventListener("click", openInventoryDialog);
}

if (inventoryCloseBtn) {
    inventoryCloseBtn.addEventListener("click", closeInventoryDialog);
}

if (inventoryDialog) {
    inventoryDialog.addEventListener("click", (e) => {
        if (e.target === inventoryDialog) closeInventoryDialog();
    });
}

if (tutorialCloseBtn) {
    tutorialCloseBtn.addEventListener("click", closeTutorialDialog);
}

if (tutorialDialog) {
    tutorialDialog.addEventListener("click", (e) => {
        if (e.target === tutorialDialog) closeTutorialDialog();
    });
}

if (saveSlotList) {
    saveSlotList.addEventListener("click", (e) => {
        const actionButton = e.target.closest("[data-slot-action]");
        if (!actionButton || saveSlotBusy) return;
        const slotIndex = Number(actionButton.dataset.saveSlot);
        if (!Number.isInteger(slotIndex)) return;
        const action = actionButton.dataset.slotAction;
        if (action === "save") {
            saveCurrentToSlot(slotIndex);
        } else if (action === "load") {
            loadSaveFromSlot(slotIndex);
        } else if (action === "delete") {
            deleteSaveSlot(slotIndex);
        }
    });
}

if (confirmCancelBtn) {
    confirmCancelBtn.addEventListener("click", () => resolveConfirmation(false));
}

if (confirmActionBtn) {
    confirmActionBtn.addEventListener("click", () => resolveConfirmation(true));
}

if (confirmDialog) {
    confirmDialog.addEventListener("click", (e) => {
        if (e.target === confirmDialog) resolveConfirmation(false);
    });
}

if (cancelEndGameBtn) {
    cancelEndGameBtn.addEventListener("click", hideEndGameDialog);
}

if (confirmEndGameBtn) {
    confirmEndGameBtn.addEventListener("click", returnToMainMenuFromGame);
}

// ── World transition effect ──
// WORLD_NAMES is a static fallback; prefer t("world_names.*") for i18n-aware display
const WORLD_NAMES = {};

let transitionInProgress = false;

function triggerWorldTransition(newWorldId) {
    return new Promise((resolve) => {
        if (newWorldId === currentWorld || !worldTransition) {
            resolve();
            return;
        }
        transitionInProgress = true;

        // Hide NPC card immediately when transitioning (with fade)
        if (newWorldId === "museum" || !WORLD_NAMES[newWorldId]) {
            npcCard.style.transition = "opacity 0.3s ease";
            npcCard.style.opacity = "0";
            setTimeout(() => {
                npcCard.style.display = "none";
                npcCard.style.opacity = "1";
            }, 300);
        }

        worldTransition.classList.remove("hidden");
        worldTransition.className = newWorldId;

        const worldName = t("world_names." + newWorldId) || WORLD_NAMES[newWorldId] || newWorldId;
        worldTransition.innerHTML = `<div class="transition-text">${t("messages.enter_world", {world: worldName})}</div>`;

        currentWorld = newWorldId;
        document.body.dataset.world = currentWorld;
        setParticleWorld(currentWorld);
        updateQuickActions(currentWorld);

        void worldTransition.offsetHeight;

        worldTransition.classList.add("active");

        setTimeout(() => {
            worldTransition.classList.remove("active");
            setTimeout(() => {
                worldTransition.classList.add("hidden");
                worldTransition.innerHTML = "";
                transitionInProgress = false;
                resolve();
            }, 700);
        }, 1200);
    });
}

// ── Detect move command and predict target world ──
function detectMoveTarget(command) {
    const cmd = command.toLowerCase();
    const moveVerbs = ["go to", "move to", "enter", "step into", "return to",
                       "head to", "visit", "travel to", "walk into", "go into", "go back"];
    const isMove = moveVerbs.some(v => cmd.includes(v));
    if (!isMove) return null;

    // Predict target world from keywords
    if (cmd.includes("starry") || cmd.includes("night") || cmd.includes("van gogh")) {
        return "starry_night";
    }
    if (cmd.includes("wave") || cmd.includes("kanagawa") || cmd.includes("hokusai") || cmd.includes("sea")) {
        return "great_wave";
    }
    if (cmd.includes("impression") || cmd.includes("sunrise") || cmd.includes("monet") || cmd.includes("harbor") || cmd.includes("havre")) {
        return "impression_sunrise";
    }
    if (cmd.includes("museum") || cmd.includes("gallery") || cmd.includes("back") || cmd.includes("return")) {
        return "museum";
    }
    return null;
}

// ── Quick action configs per world ──
const QUICK_ACTIONS = {
    museum: [
        { labelKey: "quick_actions.museum.look_around", cmd: { en: "(look around)", zh: "（四处看看）" } },
        { labelKey: "quick_actions.museum.inventory", cmd: "__open_inventory__" },
        { labelKey: "quick_actions.museum.enter_starry_night", cmd: { en: "(enter starry night)", zh: "（进入星月夜）" } },
        { labelKey: "quick_actions.museum.enter_great_wave", cmd: { en: "(enter great wave)", zh: "（进入神奈川冲浪里）" } },
        { labelKey: "quick_actions.museum.enter_sunrise", cmd: { en: "(enter impression sunrise)", zh: "（进入印象·日出）" } },
        { labelKey: "quick_actions.museum.help", cmd: "__open_tutorial__" }
    ],
    starry_night: [
        { labelKey: "quick_actions.starry_night.look_around", cmd: { en: "(look around)", zh: "（四处看看）" } },
        { labelKey: "quick_actions.starry_night.inventory", cmd: "__open_inventory__" },
        { labelKey: "quick_actions.starry_night.return_museum", cmd: { en: "(return to museum)", zh: "（返回博物馆）" } },
        { labelKey: "quick_actions.starry_night.help", cmd: "__open_tutorial__" }
    ],
    great_wave: [
        { labelKey: "quick_actions.great_wave.look_around", cmd: { en: "(look around)", zh: "（四处看看）" } },
        { labelKey: "quick_actions.great_wave.inventory", cmd: "__open_inventory__" },
        { labelKey: "quick_actions.great_wave.return_museum", cmd: { en: "(return to museum)", zh: "（返回博物馆）" } },
        { labelKey: "quick_actions.great_wave.help", cmd: "__open_tutorial__" }
    ],
    impression_sunrise: [
        { labelKey: "quick_actions.impression_sunrise.look_around", cmd: { en: "(look around)", zh: "（四处看看）" } },
        { labelKey: "quick_actions.impression_sunrise.inventory", cmd: "__open_inventory__" },
        { labelKey: "quick_actions.impression_sunrise.return_museum", cmd: { en: "(return to museum)", zh: "（返回博物馆）" } },
        { labelKey: "quick_actions.impression_sunrise.help", cmd: "__open_tutorial__" }
    ]
};

const WORLD_EXIT_TARGETS = {
    museum: ["starry_night", "great_wave", "impression_sunrise"],
    starry_night: ["museum"],
    great_wave: ["museum"],
    impression_sunrise: ["museum"],
};

function getLocalizedMoveCommand(targetWorldId) {
    const lang = window.I18N && window.I18N.lang ? window.I18N.lang : "en";
    if (targetWorldId === "museum") {
        return lang === "zh" ? "（返回博物馆）" : "(return to museum)";
    }
    const commandMap = {
        starry_night: { en: "(enter starry night)", zh: "（进入星月夜）" },
        great_wave: { en: "(enter great wave)", zh: "（进入神奈川冲浪里）" },
        impression_sunrise: { en: "(enter impression sunrise)", zh: "（进入印象·日出）" },
    };
    const command = commandMap[targetWorldId];
    return command ? (command[lang] || command.en) : `(${targetWorldId.replace(/_/g, " ")})`;
}

function renderLocalizedExitsForWorld(worldId) {
    if (!exitsList) return;
    const targets = WORLD_EXIT_TARGETS[worldId] || [];
    exitsList.innerHTML = "";
    targets.forEach((targetWorldId) => {
        const btn = document.createElement("button");
        btn.className = "exit-btn";
        btn.textContent = "\u2192 " + formatWorldTitle(targetWorldId);
        btn.addEventListener("click", () => {
            commandInput.value = getLocalizedMoveCommand(targetWorldId);
            commandForm.dispatchEvent(new Event("submit"));
        });
        exitsList.appendChild(btn);
    });
}

// ══════════════════════════════════════════════════════════════
// Message display
// ══════════════════════════════════════════════════════════════

function scrollToBottom() {
    chatLog.scrollTop = chatLog.scrollHeight;
}

function addMessage(text, cls, speaker) {
    const div = document.createElement("div");
    div.className = "message " + cls;
    if (speaker) {
        const portrait = document.createElement("div");
        portrait.className = "npc-portrait";
        portrait.textContent = speaker.substring(0, 2).toUpperCase();
        div.appendChild(portrait);
        const content = document.createElement("div");
        content.className = "npc-content";
        const sp = document.createElement("span");
        sp.className = "speaker";
        sp.textContent = speaker;
        content.appendChild(sp);
        content.appendChild(document.createTextNode(text));
        div.appendChild(content);
    } else {
        div.appendChild(document.createTextNode(text));
    }
    chatLog.appendChild(div);
    scrollToBottom();
    return div;
}

// ── Typewriter effect (returns a Promise that resolves when done) ──
function addMessageTypewriter(text, cls, speaker) {
    return new Promise((resolve) => {
        const div = document.createElement("div");
        div.className = "message " + cls;
        let contentEl = div;

        if (speaker) {
            const portrait = document.createElement("div");
            portrait.className = "npc-portrait";
            portrait.textContent = speaker.substring(0, 2).toUpperCase();
            div.appendChild(portrait);
            const wrapper = document.createElement("div");
            wrapper.className = "npc-content";
            const sp = document.createElement("span");
            sp.className = "speaker";
            sp.textContent = speaker;
            wrapper.appendChild(sp);
            div.appendChild(wrapper);
            contentEl = wrapper;
        }

        const textSpan = document.createElement("span");
        textSpan.className = "typewriter-text";
        contentEl.appendChild(textSpan);

        const cursor = document.createElement("span");
        cursor.className = "typewriter-cursor";
        contentEl.appendChild(cursor);

        chatLog.appendChild(div);
        scrollToBottom();

        // Animate character by character
        let i = 0;
        const speed = 20; // ms per character
        let skipped = false;
        let finished = false;

        function finish() {
            if (finished) return;
            finished = true;
            textSpan.textContent = text;
            if (cursor.parentNode) cursor.remove();
            resolve();
        }

        function typeChar() {
            if (skipped || i >= text.length) {
                finish();
                return;
            }
            textSpan.textContent = text.substring(0, i + 1);
            i++;
            scrollToBottom();
            setTimeout(typeChar, speed);
        }

        // Click to skip animation
        div.addEventListener("click", () => { skipped = true; finish(); }, { once: true });
        typeChar();
    });
}

function showTyping() {
    const div = document.createElement("div");
    div.className = "message narration typing-indicator";
    div.id = "typing";
    for (let i = 0; i < 3; i++) {
        const dot = document.createElement("span");
        div.appendChild(dot);
    }
    chatLog.appendChild(div);
    scrollToBottom();
}

function hideTyping() {
    const el = document.getElementById("typing");
    if (el) el.remove();
}

// ══════════════════════════════════════════════════════════════
// Side panel updates
// ══════════════════════════════════════════════════════════════

function updateSidePanel(data) {
    // --- Refresh current-world UI on language switch (no game-event data) ---
    if (!data) {
        const worldDisplayName = t("world_names." + currentWorld);
        if (worldDisplayName && !worldDisplayName.startsWith("world_names.")) {
            locationBadge.textContent = worldDisplayName;
            locationName.textContent = worldDisplayName;
        }
        const worldDescription = t("world_descriptions." + currentWorld);
        if (worldDescription && !worldDescription.startsWith("world_descriptions.")) {
            locationDesc.textContent = worldDescription;
        }
        renderLocalizedExitsForWorld(currentWorld);
        updateQuickActions(currentWorld);
        // Re-render inventory with existing detail list (if any)
        renderInventorySummary(currentWorld);
        renderInventoryDialog();
        // Re-apply quest label text
        document.querySelectorAll(".quest-item span:last-child").forEach(el => {
            const qId = el.parentElement && el.parentElement.dataset.quest;
            if (qId) {
                const label = t("quest_names." + qId);
                if (label && !label.startsWith("quest_names.")) el.textContent = label;
            }
        });
        return;
    }

    if (data.location_id && data.location && !WORLD_NAMES[data.location_id]) {
        WORLD_NAMES[data.location_id] = data.location;
    }

    // Location
    if (data.location) {
        const worldName = data.location_id ? t("world_names." + data.location_id) : data.location;
        const displayName = worldName !== ("world_names." + data.location_id) ? worldName : data.location;
        locationBadge.textContent = displayName;
        locationName.textContent = displayName;
    }
    if (data.location_desc) {
        locationDesc.textContent = data.location_desc;
    }

    // Exits
    if (data.exits) {
        exitsList.innerHTML = "";
        data.exits.forEach(ex => {
            const btn = document.createElement("button");
            btn.className = "exit-btn";
            btn.textContent = "→ " + ex.name;
            btn.addEventListener("click", () => {
                commandInput.value = getLocalizedMoveCommand(ex.target);
                commandForm.dispatchEvent(new Event("submit"));
            });
            exitsList.appendChild(btn);
        });
    }

    // Inventory
    if (data.inventory !== undefined) {
        syncInventoryDetails(data.inventory, data.location_id || currentWorld);
        renderInventorySummary(data.location_id || currentWorld);
        renderInventoryDialog();
    }

    // Quests
    if (data.quests) {
        for (const [questId, done] of Object.entries(data.quests)) {
            const qEl = document.querySelector(`.quest-item[data-quest="${questId}"]`);
            if (qEl) {
                const status = qEl.querySelector(".quest-status");
                if (done) {
                    status.textContent = "\u2713";
                    status.className = "quest-status complete";
                } else {
                    status.textContent = "\u25CB";
                    status.className = "quest-status pending";
                }
            }
        }
    }

    // Ensure quest panel reflects completion even after world transition frames.
    if (data.all_quests_done && data.quests) {
        for (const [questId] of Object.entries(data.quests)) {
            const qEl = document.querySelector(`.quest-item[data-quest="${questId}"]`);
            if (!qEl) continue;
            const status = qEl.querySelector(".quest-status");
            status.textContent = "\u2713";
            status.className = "quest-status complete";
        }
    }

    // NPC card with smooth fade
    if (data.npc_name) {
        if (npcCard.style.display === "none" || !npcCard.style.display) {
            npcCard.style.display = "block";
            npcCard.style.opacity = "0";
            npcCard.style.transition = "opacity 0.4s ease";
            setTimeout(() => { npcCard.style.opacity = "1"; }, 10);
        }
        npcPortraitLarge.textContent = data.npc_name.substring(0, 2).toUpperCase();
        npcNameDisplay.textContent = data.npc_name;
        npcRoleDisplay.textContent = data.npc_role || "";
    } else if (data.intent === "move" || data.location_id === "museum") {
        // Hide NPC card when moving to museum or no NPC
        if (npcCard.style.display !== "none") {
            npcCard.style.transition = "opacity 0.3s ease";
            npcCard.style.opacity = "0";
            setTimeout(() => {
                npcCard.style.display = "none";
                npcCard.style.opacity = "1";
            }, 300);
        }
    }

    // Response type badge
    if (data.response_type) {
        responseBadge.style.display = "inline";
        responseBadge.textContent = data.response_type.toUpperCase();
        responseBadge.className = data.response_type;
    }
}

function getQuickActionCommand(action) {
    if (!action) return "";
    if (action.cmd === "__open_inventory__") return action.cmd;
    if (action.cmd === "__open_tutorial__") return action.cmd;
    if (typeof action.cmd === "string") return action.cmd;
    const lang = window.I18N && window.I18N.lang ? window.I18N.lang : "en";
    return action.cmd[lang] || action.cmd.en || "";
}

function getQuickActionPriority(action) {
    if (!action) return 4;
    if (action.cmd === "__open_inventory__" || action.labelKey.endsWith(".inventory")) return 1;
    if (action.cmd === "__open_tutorial__" || action.labelKey.endsWith(".help")) return 2;
    if (action.labelKey.endsWith(".look_around")) return 3;
    return 4;
}

function sortQuickActions(actions) {
    return actions
        .map((action, index) => ({ action, index }))
        .sort((a, b) => {
            const priorityDiff = getQuickActionPriority(a.action) - getQuickActionPriority(b.action);
            return priorityDiff || a.index - b.index;
        })
        .map(entry => entry.action);
}

function updateQuickActions(worldId) {
    const actions = sortQuickActions(QUICK_ACTIONS[worldId] || QUICK_ACTIONS.museum);
    quickActions.innerHTML = "";
    actions.forEach(a => {
        const btn = document.createElement("button");
        btn.className = "quick-btn";
        btn.textContent = t(a.labelKey);
        const command = getQuickActionCommand(a);
        btn.dataset.cmd = command;
        if (command === "__open_inventory__") {
            btn.dataset.action = "open-inventory";
        } else if (command === "__open_tutorial__") {
            btn.dataset.action = "open-tutorial";
        }
        quickActions.appendChild(btn);
    });
}

// ── Panel toggle ──
panelToggle.addEventListener("click", () => {
    sidePanel.classList.toggle("collapsed");
    panelToggle.classList.toggle("collapsed");
    panelToggle.textContent = sidePanel.classList.contains("collapsed") ? t("game.panel_toggle_collapsed") : t("game.panel_toggle");
});

function setModelStatusRow(row, dotClass, label) {
    if (!row) return;
    const dot = row.querySelector(".status-dot");
    const text = row.querySelector("span:last-child");
    if (dot) {
        dot.classList.remove("online", "loading", "offline");
        dot.classList.add(dotClass);
    }
    if (text) text.textContent = label;
}

function updateSidePanelModelStatusRows(data) {
    const localProgress = clampPercent(data.local_progress_percent ?? (data.local_ready ? 100 : data.local_loading ? 35 : 0));
    const apiAvailable = data.api_available !== false;
    setModelStatusRow(
        apiModelStatusText,
        apiAvailable ? "online" : "offline",
        apiAvailable ? t("model_status.deepseek_ready") : t("model_status.deepseek_unavailable")
    );

    if (data.local_ready) {
        setModelStatusRow(localChatModelStatusText, "online", t("model_status.local_chat_ready"));
    } else if (data.local_loading) {
        setModelStatusRow(localChatModelStatusText, "loading", t("model_status.local_chat_loading", {pct: localProgress}));
    } else {
        setModelStatusRow(localChatModelStatusText, "offline", t("model_status.local_chat_unavailable"));
    }

    const voiceKnown = data.voice_stt_ready !== undefined ||
        data.voice_stt_loading !== undefined ||
        data.voice_runtime_ok !== undefined ||
        data.voice_runtime_checked !== undefined ||
        Boolean(data.voice_stt_error || data.voice_runtime_error);
    const voiceReady = Boolean(data.voice_stt_ready);
    const voiceLoading = Boolean(data.voice_stt_loading) && !voiceReady;
    if (voiceReady) {
        setModelStatusRow(localVoiceModelStatusText, "online", t("model_status.local_voice_ready"));
    } else if (voiceLoading) {
        setModelStatusRow(localVoiceModelStatusText, "loading", t("model_status.local_voice_loading"));
    } else if (voiceKnown && (data.voice_runtime_ok === false || data.voice_stt_error || data.voice_runtime_error)) {
        setModelStatusRow(localVoiceModelStatusText, "offline", t("model_status.local_voice_unavailable"));
    } else {
        setModelStatusRow(localVoiceModelStatusText, "loading", t("model_status.local_voice_idle"));
    }
}

function updateModelStatus(data, options = {}) {
    if (!data) return;
    lastModelStatusData = {...(lastModelStatusData || {}), ...data};
    const mode = data.active_mode || currentMode;
    currentMode = mode;
    setModeButtonsActive(mode, {
        settingsMode: options.settingsMode || (isSettingsOpen() ? settingsModelView : mode)
    });
    updateSidePanelModelStatusRows(lastModelStatusData);
    updateLocalModelSettingsStatus(lastModelStatusData);
}

// ══════════════════════════════════════════════════════════════
// Command handling
// ══════════════════════════════════════════════════════════════

async function sendCommand(command) {
    if (isWaiting || !command.trim()) return;
    isWaiting = true;
    sendBtn.disabled = true;
    updateVoiceButtonState();

    addMessage(command, "player");

    showTyping();

    try {
        const resp = await fetch("/api/command", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ command: command })
        });

        if (!resp.ok) {
            const err = await resp.json();
            hideTyping();
            addMessage(t("messages.connection_error"), "narration");
            return;
        }

        const data = await resp.json();
        if (data.experience_remaining_percent !== undefined && settingsData && settingsData.deepseek) {
            settingsData.deepseek.experience_remaining_percent = data.experience_remaining_percent;
            settingsData.deepseek.experience_remaining_tokens = data.experience_remaining_tokens;
            updateExperienceSettings(settingsData.deepseek);
        }

        // Trigger world transition based on API response (not prediction)
        if (data.location_id && data.location_id !== currentWorld) {
            await triggerWorldTransition(data.location_id);
        }

        hideTyping();

        // Mood message (instant, no typewriter)
        if (data.mood && data.mood !== "neutral") {
            const moods = {
                tense: t("moods.tense"),
                hopeful: t("moods.hopeful"),
                melancholy: t("moods.melancholy"),
                joyful: t("moods.joyful")
            };
            if (moods[data.mood]) {
                addMessage(moods[data.mood], "mood");
            }
        }

        // Scene narration (typewriter) — wait for it to finish
        if (data.scene) {
            await addMessageTypewriter(data.scene, "narration");
        }

        // NPC reply (typewriter) — starts AFTER scene finishes
        if (data.npc_reply) {
            await addMessageTypewriter(data.npc_reply, "npc", data.npc_name || "???");
        }

        // Update side panel
        updateSidePanel(data);
        setUnsavedProgress(true);

        // All quests done but not in museum — show hint
        if (data.all_quests_done && data.location_id !== "museum" && !gameEndingTriggered) {
            await addMessageTypewriter(t("messages.all_restored_hint"), "narration");
        }

        // Game ending: returned to museum with all quests done
        if (data.game_over && data.location_id === "museum" && !gameEndingTriggered) {
            gameEndingTriggered = true;
            await addMessageTypewriter(t("messages.game_ending"), "narration");
            showEndPageButton();
        }
    } catch (err) {
        hideTyping();
        addMessage(t("messages.connection_error"), "narration");
        console.error(err);
    } finally {
        isWaiting = false;
        sendBtn.disabled = commandInput.disabled;
        updateVoiceButtonState();
        commandInput.focus();
    }
}

// ── Form submit ──
commandForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = commandInput.value;
    commandInput.value = "";
    resetVoiceStatus();
    sendCommand(cmd);
});

if (voiceBtn) {
    voiceBtn.addEventListener("click", () => {
        if (voiceListening) {
            stopVoiceInput();
        } else {
            startVoiceInput();
        }
    });
    updateVoiceButtonState();
}

// ── Quick actions ──
quickActions.addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-btn");
    if (btn) {
        if (btn.dataset.action === "open-inventory") {
            openInventoryDialog();
            return;
        }
        if (btn.dataset.action === "open-tutorial") {
            openTutorialDialog();
            return;
        }
        sendCommand(btn.dataset.cmd);
    }
});

// ══════════════════════════════════════════════════════════════
// Particle system
// ══════════════════════════════════════════════════════════════

const particleCanvas = document.getElementById("particles-canvas");
const ctx = particleCanvas.getContext("2d");
let particles = [];
let particleWorld = "museum";
let animFrameId = null;
const MAX_PARTICLES = 70;

function resizeCanvas() {
    particleCanvas.width = window.innerWidth;
    particleCanvas.height = window.innerHeight;
}

window.addEventListener("resize", () => {
    resizeCanvas();
    resizeTitleParticleCanvas();
    resizeStartParticleCanvas();
    scheduleSettingsPanelHeightSync();
});
resizeCanvas();

function createParticle(world) {
    const w = particleCanvas.width;
    const h = particleCanvas.height;

    if (world === "starry_night") {
        return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 2 + 0.5,
            opacity: Math.random() * 0.6 + 0.2,
            phase: Math.random() * Math.PI * 2,
            speed: Math.random() * 0.3 + 0.1,
            type: "star"
        };
    } else if (world === "great_wave") {
        return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.5 + 0.5,
            vx: Math.random() * 0.5 + 0.2,
            vy: Math.sin(Math.random() * Math.PI) * 0.2,
            opacity: Math.random() * 0.3 + 0.1,
            type: "foam"
        };
    } else if (world === "impression_sunrise") {
        return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 2 + 0.4,
            vx: (Math.random() - 0.5) * 0.18,
            vy: -Math.random() * 0.08,
            opacity: Math.random() * 0.25 + 0.08,
            phase: Math.random() * Math.PI * 2,
            type: "mist"
        };
    } else {
        // museum
        return {
            x: Math.random() * w,
            y: Math.random() * h,
            r: Math.random() * 1.5 + 0.3,
            vx: (Math.random() - 0.5) * 0.15,
            vy: -Math.random() * 0.2 - 0.05,
            opacity: Math.random() * 0.3 + 0.1,
            type: "dust"
        };
    }
}

function setParticleWorld(world) {
    particleWorld = world;
    applyCursorTheme(world);
    particles = [];
    for (let i = 0; i < MAX_PARTICLES; i++) {
        particles.push(createParticle(world));
    }
}

function updateParticles() {
    const w = particleCanvas.width;
    const h = particleCanvas.height;
    ctx.clearRect(0, 0, w, h);
    const t = Date.now() * 0.001;

    particles.forEach(p => {
        if (p.type === "star") {
            // Twinkling stars
            const flicker = Math.sin(t * p.speed * 3 + p.phase) * 0.3 + 0.7;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 215, 0, ${p.opacity * flicker})`;
            ctx.fill();
        } else if (p.type === "foam") {
            // Drifting foam particles
            p.x += p.vx;
            p.y += Math.sin(t + p.x * 0.01) * 0.3;
            if (p.x > w + 10) { p.x = -10; p.y = Math.random() * h; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(216, 186, 98, ${p.opacity})`;
            ctx.fill();
        } else if (p.type === "mist") {
            p.x += p.vx + Math.sin(t + p.phase) * 0.08;
            p.y += p.vy;
            if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
            if (p.x < -10 || p.x > w + 10) { p.x = Math.random() * w; p.y = Math.random() * h; }
            const glow = Math.sin(t * 0.7 + p.phase) * 0.25 + 0.75;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(245, 156, 86, ${p.opacity * glow})`;
            ctx.fill();
        } else {
            // Dust motes
            p.x += p.vx;
            p.y += p.vy;
            if (p.y < -10) { p.y = h + 10; p.x = Math.random() * w; }
            if (p.x < -10 || p.x > w + 10) { p.x = Math.random() * w; p.y = h + 10; }
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(212, 168, 67, ${p.opacity})`;
            ctx.fill();
        }
    });

    animFrameId = requestAnimationFrame(updateParticles);
}

// ══════════════════════════════════════════════════════════════
// Model status polling
// ══════════════════════════════════════════════════════════════

let pollActive = true;

async function checkModelStatus() {
    try {
        const r = await fetch("/api/status");
        if (!r.ok) return;
        const s = await r.json();

        updateModelStatus(s);
        updateVoiceRuntimeSettingsStatus(s);

        // Notify when local model comes online
        if (!s.local_ready) {
            localModelReadyNoticeShown = false;
        }
        if (s.active_mode === "local" && s.local_ready && currentMode === "local" && !localModelReadyNoticeShown) {
            addMessage(t("messages.local_model_ready"), "mood");
            localModelReadyNoticeShown = true;
        }
    } catch (e) { /* server not up yet */ }
}

async function pollLoop() {
    if (!pollActive) return;
    await checkModelStatus();
    setTimeout(pollLoop, 5000);
}

// ══════════════════════════════════════════════════════════════
// End page
// ══════════════════════════════════════════════════════════════

function showEndPageButton() {
    const existingBtn = document.getElementById("end-page-btn");
    if (existingBtn) return;

    const card = document.createElement("div");
    card.className = "info-card";
    card.id = "end-page-card";
    card.innerHTML = `
        <h3>${t("messages.your_adventure")}</h3>
        <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 10px;">
            ${t("messages.view_story_desc")}
        </p>
        <button class="quick-btn" id="end-page-btn" style="width: 100%; padding: 10px;">
            ${t("messages.view_story_btn")}
        </button>
    `;

    const sidePanel = document.getElementById("side-panel");
    sidePanel.appendChild(card);

    const currentLang = (settingsData && settingsData.language && settingsData.language.current) || localStorage.getItem("cursed_canvas_lang") || "en";
    localStorage.setItem("cursed_canvas_lang", currentLang);
    document.getElementById("end-page-btn").addEventListener("click", () => {
        window.location.href = "/ending";
    });
}

// ══════════════════════════════════════════════════════════════
// Initialization
// ══════════════════════════════════════════════════════════════

window.addEventListener("load", async () => {
    setPreloadStage("settings", 12);
    applyCursorPreferences({ updateUi: false });
    // Language: localStorage is authoritative for persistence across sessions
    const storedLang = localStorage.getItem("cursed_canvas_lang");
    let initialLang = storedLang || null;
    try {
        const settingsResp = await fetch("/api/settings");
        if (settingsResp.ok) {
            const sd = await settingsResp.json();
            settingsData = sd;
            // If server has no preference and localStorage does, sync server
            if (!sd.language || !sd.language.current || sd.language.current === "en") {
                if (storedLang && storedLang !== "en") {
                    initialLang = storedLang;
                    try {
                        await fetch("/api/language", {
                            method: "POST",
                            headers: {"Content-Type": "application/json"},
                            body: JSON.stringify({language: storedLang}),
                        });
                    } catch (e) { /* ignore */ }
                }
            } else {
                // Server has a preference — use it, and update localStorage
                initialLang = sd.language.current;
                if (sd.language.current !== storedLang) {
                    localStorage.setItem("cursed_canvas_lang", sd.language.current);
                }
            }
        }
    } catch (e) { /* ignore */ }
    if (!initialLang) {
        initialLang = "en";
    }
    syncPreloadLanguage(initialLang);
    setPreloadStage("language", 28);
    try {
        await initI18N(initialLang);
    } catch (e) {
        console.warn("I18N init failed, trying en...", e);
        try { await initI18N("en"); } catch (e2) { /* ignore */ }
    }
    localStorage.setItem("cursed_canvas_lang", window.I18N && window.I18N.lang ? window.I18N.lang : initialLang);
    if (settingsData) {
        settingsData.language = settingsData.language || {};
        settingsData.language.current = window.I18N && window.I18N.lang ? window.I18N.lang : initialLang;
    }
    // Apply I18N to HTML immediately after init, before any view rendering
    setPreloadStage("interface", 44);
    if (typeof applyI18N === "function") applyI18N();
    updateTutorialSettingsUi();
    updateCursorSettingsUi();
    renderTutorialSurfaces();

    setPreloadStage("saves", 58);
    await migrateBrowserSaveSlots();

    // Check if returning from ending page (existing game state)
    setPreloadStage("state", 68);
    let isReturning = false;
    try {
        const resp = await fetch("/api/status");
        if (resp.ok) {
            const statusData = await resp.json();
            if (statusData.game_state_exists) {
                isReturning = true;
            }
        }
    } catch (e) { /* ignore */ }

    setPreloadStage("local_model", 76);
    await probeOptionalLocalRuntimeForPreload();

    setPreloadStage("voice_model", 82);

    setPreloadStage("scene", 88);
    if (isReturning) {
        titleScreenDismissed = true;
        if (titleScreen) titleScreen.classList.add("hidden");
        stopTitleParticles();
        // bridge overlay hidden too
        var bta = document.getElementById("transition-title");
        if (bta) { bta.classList.add("hidden"); bta.classList.remove("animate"); bta.style.transform = ""; }
        startScreenDismissed = true;
        if (startScreen) {
            startScreen.classList.add("hidden");
            startScreen.classList.remove("entering", "show");
        }
        stopStartParticles();
        setGameInputEnabled(true);
        addMessage(t("messages.welcome_back"), "narration");
        gameEndingTriggered = true;
        setUnsavedProgress(true);
        showEndPageButton();
    } else {
        // Show title screen first, not menu
        titleScreenDismissed = false;
        if (titleScreen) {
            titleScreen.classList.remove("hidden");
            titleScreen.style.opacity = "1";
        }
        // Ensure bridge is hidden and start screen reset
        var bt2 = document.getElementById("transition-title");
        if (bt2) { bt2.classList.add("hidden"); bt2.classList.remove("animate"); bt2.style.transform = ""; }
        if (startScreen) { startScreen.classList.remove("entering", "show"); if (startScreen.classList.contains("hidden")) startScreen.classList.remove("hidden"); startScreen.style.opacity = ""; }
        startTitleParticles();
        setGameInputEnabled(false);
    }

    // Initialize particles
    setPreloadStage("effects", 94);
    setParticleWorld("museum");
    updateParticles();

    // Initialize quick actions
    updateQuickActions("museum");

    // Start polling
    pollLoop();

    finishPreloadOverlay();
});

window.addEventListener("storage", (e) => {
    if (e.key === TUTORIAL_ENABLED_STORAGE_KEY || e.key === TUTORIAL_SEEN_STORAGE_KEY) {
        updateTutorialSettingsUi();
    }
    if (
        e.key === CURSOR_STYLE_STORAGE_KEY
        || e.key === CURSOR_TRAIL_STORAGE_KEY
        || e.key === CURSOR_TIP_GLOW_STORAGE_KEY
        || e.key === CURSOR_TIP_GLOW_RADIUS_STORAGE_KEY
        || e.key === CURSOR_CLICK_EFFECT_STORAGE_KEY
        || e.key === CURSOR_TRAIL_STYLE_STORAGE_KEY
    ) {
        applyCursorPreferences();
    }
    if (e.key === "cursed_canvas_lang" && e.newValue && e.newValue !== (window.I18N && window.I18N.lang)) {
        switchLanguage(e.newValue);
    }
});

window.addEventListener("beforeunload", () => {
    if (settingsData && settingsData.deepseek && settingsData.deepseek.experience_unlimited) {
        const payload = new Blob(["{}"], { type: "application/json" });
        if (navigator.sendBeacon) {
            navigator.sendBeacon("/api/settings/experience/lock", payload);
        } else {
            fetch("/api/settings/experience/lock", {
                method: "POST",
                body: payload,
                keepalive: true
            }).catch(() => {});
        }
    }
    pollActive = false;
    setCursorTrailActive(false);
    setCursorClickFeedbackActive(false);
    stopTitleParticles();
    stopStartParticles();
    if (animFrameId) cancelAnimationFrame(animFrameId);
});

/* The Cursed Canvas — Game client with particles, typewriter, and side panel */

// ── DOM references ──
const chatLog = document.getElementById("chat-log");
const commandForm = document.getElementById("command-form");
const commandInput = document.getElementById("command-input");
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
const modelStatusText = document.getElementById("model-status-text");
const loadingOverlay = document.getElementById("loading-overlay");
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
const settingsStatus = document.getElementById("settings-status");
const languagePrevBtn = document.getElementById("language-prev-btn");
const languageNextBtn = document.getElementById("language-next-btn");
const languageValue = document.getElementById("language-value");
const modelPrevBtn = document.getElementById("model-prev-btn");
const modelNextBtn = document.getElementById("model-next-btn");
const modelProviderValue = document.getElementById("model-provider-value");
const deepseekSettingsPanel = document.getElementById("deepseek-settings-panel");
const localModelSettingsPanel = document.getElementById("local-model-settings-panel");
const experienceTokenPercent = document.getElementById("experience-token-percent");
const experienceTokenBar = document.getElementById("experience-token-bar");
const experienceTokenNote = document.getElementById("experience-token-note");
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
let gameEndingTriggered = false;
let startScreenDismissed = false;
let galleryPages = [];
let galleryPageIndex = 0;
let galleryIsLoading = false;
let settingsData = null;
let settingsBusy = false;
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
    "Enchanted Lantern": { id: "lantern", world: "starry_night", emoji: "🏮", description: "Reveals what shadow tries to hide." },
    "Stolen Yellow Pigment": { id: "yellow_pigment", world: "starry_night", emoji: "🟡", description: "A bright stolen note of starlight." },
    "Shell Flute": { id: "shell_flute", world: "great_wave", emoji: "🐚", description: "Calls rhythm back into the sea." },
    "Calming Stone": { id: "calming_stone", world: "great_wave", emoji: "🪨", description: "A steady weight for the restless wave." },
    "Mist Lens": { id: "mist_lens", world: "impression_sunrise", emoji: "🔍", description: "Clarifies reflections without breaking the haze." },
    "Sunrise Pigment": { id: "sunrise_pigment", world: "impression_sunrise", emoji: "🧡", description: "The orange breath that dawn was missing." },
};
const ITEM_EMOJI_POOL = [
    "🗝️", "📜", "🧭", "🪞", "💎", "🕯️", "⚙️", "🎨", "🧵", "🪶",
    "🔔", "🧪", "📘", "🌙", "☀️", "🪙", "🧿", "🧰", "🗿", "🎭",
    "🪄", "🧲", "🧱", "🪵", "🧫", "📯", "🔮", "🪤", "🧬", "🎐"
];
const GENERATED_ITEM_METADATA = {};
const UNKNOWN_ITEM_EMOJI = "📦";
const SETTINGS_LANGUAGES = ["English"];
const SETTINGS_MODEL_OPTIONS = [
    { mode: "api", label: "DeepSeek API" },
    { mode: "local", label: "Local Model" },
];

// ── Start screen flow ──
function setGameInputEnabled(enabled) {
    commandInput.disabled = !enabled;
    sendBtn.disabled = !enabled;
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
    const introActive = introStory && introStory.classList.contains("active");
    const energy = introActive ? 1.22 : 1;

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
    introStory.classList.toggle("active", view === "intro");
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

function getItemMetadata(itemName) {
    const usedEmojis = new Set(Object.values(ITEM_METADATA).map((item) => item.emoji));
    Object.values(GENERATED_ITEM_METADATA).forEach((item) => usedEmojis.add(item.emoji));
    if (ITEM_METADATA[itemName]) return ITEM_METADATA[itemName];
    if (!GENERATED_ITEM_METADATA[itemName]) {
        GENERATED_ITEM_METADATA[itemName] = {
            id: itemName,
            world: "museum",
            emoji: ITEM_EMOJI_POOL.find((emoji) => !usedEmojis.has(emoji)) || UNKNOWN_ITEM_EMOJI,
            description: "Stored in your collection."
        };
    }
    return GENERATED_ITEM_METADATA[itemName];
}

function formatInventoryCount(count) {
    return `${count} ${count === 1 ? "item" : "items"}`;
}

function formatWorldTitle(worldId) {
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
                description: meta.description,
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
        li.textContent = "Empty";
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
        li.textContent = `${remaining} More Items`;
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
                <div class="inventory-item-name">No items stored yet.</div>
                <div class="inventory-item-meta">Explore the paintings to build your collection.</div>
            </section>
        `;
        inventoryStatus.textContent = "Your inventory is empty.";
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

    inventoryStatus.textContent = `${inventoryDetails.length} total ${inventoryDetails.length === 1 ? "item" : "items"} stored.`;
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
    if (Number.isNaN(date.getTime())) return "Unknown time";
    return new Intl.DateTimeFormat("en-US", {
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
        location: WORLD_NAMES[locationId] || locationId.replace(/_/g, " "),
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

function formatCount(count, singular, plural) {
    const n = Number(count) || 0;
    return `${n} ${n === 1 ? singular : (plural || `${singular}s`)}`;
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
            ? (hasSave ? "Overwrite" : "Create")
            : (hasSave ? "Load" : "Empty");
        const slotStateClass = hasSave ? "filled" : "empty";
        const unavailableClass = !hasSave && saveSlotMode === "load" ? " unavailable" : "";
        const transitionClass = recentlyChangedSlotIndex === index ? " just-updated" : "";

        const detailHtml = hasSave ? `
            <span class="save-slot-location">${escapeHtml(summary.location || "Unknown Location")}</span>
            <span class="save-slot-meta">Saved ${escapeHtml(formatSavedAt(save.savedAt))}</span>
            <span class="save-slot-stats">
                <span>${escapeHtml(String(summary.quests_completed || 0))}/${escapeHtml(String(summary.quests_total || 3))} Restored</span>
                <span>${escapeHtml(formatCount(summary.inventory_count, "item"))}</span>
                <span>${escapeHtml(formatCount(summary.turn_count, "turn"))}</span>
            </span>
        ` : `
            <span class="save-slot-location">Empty Slot</span>
            <span class="save-slot-meta">No slot data yet.</span>
        `;

        return `
            <article
                class="save-slot ${slotStateClass}${unavailableClass}${transitionClass}"
                data-save-slot="${index}"
                aria-disabled="${!hasSave && saveSlotMode === "load" ? "true" : "false"}"
            >
                <span class="save-slot-heading">
                    <span>Slot ${index + 1}</span>
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
                        >Delete</button>
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

    if (saveSlotKicker) saveSlotKicker.textContent = saveSlotMode === "save" ? "Local Slot Archive" : "Slot Archive";
    if (saveSlotTitle) saveSlotTitle.textContent = saveSlotMode === "save" ? "Create or Overwrite Slot" : "Load Slot";
    if (saveSlotCopy) {
        saveSlotCopy.textContent = saveSlotMode === "save"
            ? "Create a slot or overwrite an existing slot on this device."
            : "Choose an existing slot to load.";
    }

    setSaveSlotStatus("Opening slot archive...");
    saveSlotDialog.classList.remove("hidden");
    try {
        await refreshSaveSlots();
        renderSaveSlots();
        setSaveSlotStatus(
            saveSlotMode === "save"
                ? "Your progress will be stored in a local save file."
                : (hasAnySave() ? "Select a slot." : "No slots have been created yet."),
            saveSlotMode === "load" && !hasAnySave()
        );
    } catch (err) {
        console.error("Save slots failed:", err);
        renderSaveSlots();
        setSaveSlotStatus("Slot archive could not be opened.", true);
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

    addMessage(`Loaded Slot ${slotIndex + 1}.`, "mood");
    activeSaveSlotIndex = slotIndex;
    setUnsavedProgress(false);
    commandInput.focus();
}

async function saveCurrentToSlot(slotIndex) {
    if (isWaiting) {
        setSaveSlotStatus("Wait until the current response finishes before saving.", true);
        return;
    }

    const existingSave = saveSlots[slotIndex];
    if (existingSave) {
        const confirmed = await requestConfirmation({
            title: "Overwrite Slot?",
            message: `Overwrite Slot ${slotIndex + 1} with your current progress?`,
            confirmLabel: "Overwrite",
            danger: true,
        });
        if (!confirmed) return;
    }

    saveSlotBusy = true;
    setSaveSlotStatus(`Saving to Slot ${slotIndex + 1}...`);

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
        setSaveSlotStatus(`Slot ${slotIndex + 1} saved on this device.`);
        activeSaveSlotIndex = slotIndex;
        setUnsavedProgress(false);
    } catch (err) {
        console.error("Slot save failed:", err);
        setSaveSlotStatus("Slot could not be saved. Please try again.", true);
    } finally {
        saveSlotBusy = false;
    }
}

async function loadSaveFromSlot(slotIndex) {
    const save = saveSlots[slotIndex];
    if (!save) {
        setSaveSlotStatus("This slot is empty.", true);
        return;
    }

    saveSlotBusy = true;
    setSaveSlotStatus(`Loading Slot ${slotIndex + 1}...`);

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
        setSaveSlotStatus("This slot could not be loaded.", true);
    } finally {
        saveSlotBusy = false;
        renderSaveSlots();
    }
}

async function deleteSaveSlot(slotIndex) {
    const save = saveSlots[slotIndex];
    if (!save) {
        setSaveSlotStatus("This slot is already empty.", true);
        return;
    }

    const confirmed = await requestConfirmation({
        title: "Delete Slot?",
        message: `Delete Slot ${slotIndex + 1}? This slot cannot be restored after deletion.`,
        confirmLabel: "Delete",
        danger: true,
    });
    if (!confirmed) return;

    saveSlotBusy = true;
    setSaveSlotStatus(`Deleting Slot ${slotIndex + 1}...`);

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
        setSaveSlotStatus(`Slot ${slotIndex + 1} deleted.`);
    } catch (err) {
        console.error("Delete failed:", err);
        setSaveSlotStatus("Delete failed. Please try again.", true);
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
                <p class="gallery-kicker">Artwork ${page.page_number} of ${page.page_total}</p>
                <h2>${escapeHtml(page.artwork_title)}</h2>
                <p class="gallery-byline">by ${escapeHtml(page.artist_name)}</p>
                ${meta ? `<p class="gallery-meta">${escapeHtml(meta)}</p>` : ""}
                <div class="gallery-copy-frame" tabindex="0">
                    <section class="gallery-section">
                        <h3>Artwork</h3>
                        ${renderGalleryParagraphs(page.artwork_intro)}
                    </section>
                    <section class="gallery-section">
                        <h3>The Artist</h3>
                        ${renderGalleryParagraphs(page.artist_intro)}
                    </section>
                    <section class="gallery-section">
                        <h3>Your Journey Together</h3>
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
            aria-label="Go to gallery page ${index + 1}"
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
                <p class="gallery-kicker">Restoration Gallery</p>
                <h2>Opening the gallery...</h2>
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
    if (galleryPages.length || galleryIsLoading) return;
    galleryIsLoading = true;
    renderGalleryPage();

    try {
        const resp = await fetch("/api/gallery");
        if (!resp.ok) throw new Error("Gallery request failed");
        const payload = await resp.json();
        galleryPages = buildGalleryPages(payload);
    } catch (err) {
        console.error("Gallery load failed:", err);
        galleryPages = [{
            type: "outro",
            kicker: "Gallery Unavailable",
            title: "The gallery doors did not open",
            body: ["The restoration records could not be loaded. Please try again after the server is ready."]
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

function setModeButtonsActive(mode) {
    currentMode = mode || currentMode;
    document.querySelectorAll("#model-toggle .toggle-btn").forEach((btn) => {
        btn.classList.toggle("active", btn.dataset.mode === currentMode);
    });
    const selectedOption = SETTINGS_MODEL_OPTIONS.find((option) => option.mode === currentMode) || SETTINGS_MODEL_OPTIONS[0];
    if (modelProviderValue) modelProviderValue.textContent = selectedOption.label;
    if (deepseekSettingsPanel) deepseekSettingsPanel.classList.toggle("hidden", currentMode !== "api");
    if (localModelSettingsPanel) localModelSettingsPanel.classList.toggle("hidden", currentMode !== "local");
}

function setLanguageDisplay() {
    if (languageValue) languageValue.textContent = SETTINGS_LANGUAGES[0];
}

function setPersonalApiExpanded(expanded) {
    if (personalApiToggle) personalApiToggle.checked = Boolean(expanded);
    if (personalApiFields) personalApiFields.classList.toggle("hidden", !expanded);
}

function updateExperienceSettings(deepseek) {
    const percent = clampPercent(deepseek.experience_remaining_percent ?? 100);
    if (experienceTokenPercent) experienceTokenPercent.textContent = `${percent}%`;
    if (experienceTokenBar) experienceTokenBar.style.width = `${percent}%`;
    if (!experienceTokenNote) return;
    if (deepseek.experience_unlimited) {
        experienceTokenNote.textContent = "Experience mode is unlocked for this visit.";
        experienceTokenNote.classList.remove("warning");
    } else {
        const remainingTokens = Number(deepseek.experience_remaining_tokens ?? 0);
        const tokenLimit = Number(deepseek.experience_token_limit ?? 0);
        if (tokenLimit > 0) {
            experienceTokenNote.textContent = `Trial pool: ${remainingTokens.toLocaleString()} / ${tokenLimit.toLocaleString()} tokens remaining. It does not refill.`;
        } else {
            experienceTokenNote.textContent = "Experience mode has no trial tokens configured.";
        }
        experienceTokenNote.classList.toggle("warning", percent <= 10);
    }
}

function updatePersonalApiSettings(deepseek) {
    if (!personalApiKeyInput || !personalApiHelp) return;
    const maskedKey = deepseek.personal_key_masked || "";
    setPersonalApiExpanded(deepseek.api_mode === "personal");
    personalApiKeyInput.dataset.maskedValue = maskedKey;
    personalApiKeyInput.value = maskedKey;
    personalApiKeyInput.placeholder = deepseek.personal_configured
        ? "Paste a new DeepSeek API Key"
        : "Enter your DeepSeek API Key";
    if (deepseek.personal_configured) {
        const source = deepseek.personal_key_source === "environment" ? "environment" : "settings";
        personalApiHelp.textContent = `API key loaded from ${source}. Only the first and last four characters are shown.`;
        personalApiHelp.classList.remove("warning");
    } else {
        personalApiHelp.textContent = "No API key is configured. Enter your DeepSeek API Key here.";
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
        localModelStatus.textContent = "Ready";
        localModelDetail.textContent = "The local model is available for offline play.";
    } else if (isLoading) {
        localModelDot.classList.add("loading");
        localModelStatus.textContent = "Loading";
        localModelDetail.textContent = "The local model is prewarming in the background. You can keep playing while it finishes.";
    } else {
        localModelDot.classList.add("offline");
        localModelStatus.textContent = "Unavailable";
        localModelDetail.textContent = "The local model is not ready yet. It may become available after background prewarming finishes.";
    }
}

function updateSettingsUi(data) {
    if (!data) return;
    settingsData = data;
    setLanguageDisplay();
    setModeButtonsActive(data.active_mode || currentMode);
    const deepseek = data.deepseek || {};
    updateExperienceSettings(deepseek);
    updatePersonalApiSettings(deepseek);
    updateLocalModelSettingsStatus(data);
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
        if (!silent) setSettingsStatus("Settings could not be loaded.", "error");
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
    if (!resp.ok) throw new Error(data.error || "Settings update failed");
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
    document.querySelectorAll(`[data-mode="${mode}"]`).forEach((btn) => {
        btn.classList.add("loading");
    });

    try {
        const resp = await fetch("/api/mode", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mode })
        });
        const data = await resp.json();
        if (!resp.ok) throw new Error(data.error || "Mode switch failed");
        updateModelStatus(data);
        await loadSettings(true);
        return data;
    } catch (err) {
        console.error("Mode switch failed:", err);
        setModeButtonsActive(previousMode);
        setSettingsStatus("Model switch failed.", "error");
        return null;
    } finally {
        document.querySelectorAll(`[data-mode="${mode}"]`).forEach((btn) => {
            btn.classList.remove("loading");
        });
    }
}

function cycleSettingsModel(direction) {
    const currentIndex = Math.max(0, SETTINGS_MODEL_OPTIONS.findIndex((option) => option.mode === currentMode));
    const nextIndex = (currentIndex + direction + SETTINGS_MODEL_OPTIONS.length) % SETTINGS_MODEL_OPTIONS.length;
    switchModelMode(SETTINGS_MODEL_OPTIONS[nextIndex].mode);
}

async function openSettings() {
    showStartStatus("");
    if (startScreen) startScreen.dataset.galleryWorld = "museum";
    setStartParticleTheme("museum");
    showStartView("settings");
    if (settingsView) settingsView.focus();
    await loadSettings();
}

function closeSettings() {
    showStartView("menu");
    setSettingsStatus("");
    if (settingsBtn) settingsBtn.focus();
}

async function selectDeepSeekApiMode(apiMode) {
    if (settingsBusy) return;
    settingsBusy = true;
    try {
        await postSettings({ api_mode: apiMode });
        await switchModelMode("api");
        setSettingsStatus(apiMode === "personal" ? "Personal API selected." : "Experience mode selected.", "success");
    } catch (err) {
        console.error("DeepSeek mode update failed:", err);
        setSettingsStatus(err.message || "DeepSeek mode could not be updated.", "error");
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
        setSettingsStatus(rawKey && rawKey !== maskedKey ? "Personal API key saved." : "Personal API selected.", "success");
    } catch (err) {
        console.error("Personal API save failed:", err);
        setSettingsStatus(err.message || "Personal API could not be saved.", "error");
    } finally {
        settingsBusy = false;
    }
}

async function unlockExperienceMode() {
    if (!experienceUnlockInput || settingsBusy) return;
    const unlockKey = experienceUnlockInput.value.trim();
    if (!unlockKey) {
        setSettingsStatus("Enter the author unlock key first.", "error");
        experienceUnlockInput.focus();
        return;
    }

    settingsBusy = true;
    try {
        await postSettings({ api_mode: "experience", unlock_key: unlockKey });
        await switchModelMode("api");
        experienceUnlockInput.value = "";
        setSettingsStatus("Experience mode unlocked.", "success");
    } catch (err) {
        console.error("Experience unlock failed:", err);
        setSettingsStatus(err.message || "Unlock key was not accepted.", "error");
    } finally {
        settingsBusy = false;
    }
}

function addOpeningMessage() {
    addMessage(
        "The museum waits in moonlit silence. The paintings are alive, and three worlds shimmer before you: " +
        "Starry Night, The Great Wave, and Impression, Sunrise.\n\n" +
        "How to play:\n" +
        "• Actions: wrap in parentheses, e.g. (look around), (take lantern), (enter starry night)\n" +
        "• Dialogue: just type, e.g. Where is the lantern? Tell me about the curse.\n\n" +
        "Use the quick action buttons below for common actions.",
        "narration"
    );
}

function resetClientViewForNewAdventure() {
    chatLog.innerHTML = "";
    currentWorld = "museum";
    inventoryTimeline = [];
    inventoryDetails = [];
    dynamicWorldOrder = [];
    gameEndingTriggered = false;
    document.body.dataset.world = currentWorld;
    locationBadge.textContent = "Museum";
    locationName.textContent = "The Enchanted Museum";
    locationDesc.textContent = "A grand, moonlit gallery with marble floors.";
    exitsList.innerHTML = "";
    inventoryList.innerHTML = '<li class="empty-inv">Empty</li>';
    if (inventorySections) inventorySections.innerHTML = "";
    if (inventoryStatus) inventoryStatus.textContent = "Your inventory is empty.";
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
}

function showMainMenuOverlay() {
    if (!startScreen) return;
    startScreenDismissed = false;
    if (inventoryDialog) inventoryDialog.classList.add("hidden");
    currentWorld = "museum";
    document.body.dataset.world = currentWorld;
    setParticleWorld(currentWorld);
    showStartView("menu");
    showStartStatus("");
    startScreen.classList.remove("hidden");
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
    showStartStatus("Starting a new adventure...");

    try {
        await fetch("/api/reset", { method: "POST" });
    } catch (e) {
        console.warn("Reset before new adventure failed:", e);
    }

    resetClientViewForNewAdventure();
    activeSaveSlotIndex = null;
    setUnsavedProgress(false);
    showStartView("intro");
    newAdventureBtn.disabled = false;
    if (introStory) introStory.focus();
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

if (languagePrevBtn) {
    languagePrevBtn.addEventListener("click", () => {
        setLanguageDisplay();
        setSettingsStatus("Only English is available in this version.", "success");
    });
}

if (languageNextBtn) {
    languageNextBtn.addEventListener("click", () => {
        setLanguageDisplay();
        setSettingsStatus("Only English is available in this version.", "success");
    });
}

if (modelPrevBtn) {
    modelPrevBtn.addEventListener("click", () => cycleSettingsModel(-1));
}

if (modelNextBtn) {
    modelNextBtn.addEventListener("click", () => cycleSettingsModel(1));
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
                setSettingsStatus("Personal API fields are available below.", "success");
            }
            if (personalApiKeyInput) personalApiKeyInput.focus();
            return;
        }
        setPersonalApiExpanded(false);
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
    if (isSettingsOpen() && e.key === "Escape") {
        e.preventDefault();
        closeSettings();
        return;
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
    if (!introStory || !introStory.classList.contains("active") || startScreenDismissed) return;
    e.preventDefault();
    enterGameFromIntro();
});

if (endGameBtn) {
    endGameBtn.addEventListener("click", async () => {
        if (hasUnsavedProgress) {
            const confirmed = await requestConfirmation({
                title: "Unsaved Progress",
                message: "Your current progress has not been saved. Return to the main menu without saving?",
                confirmLabel: "Return Without Saving",
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
const WORLD_NAMES = {
    museum: "The Enchanted Museum",
    starry_night: "Starry Night",
    great_wave: "The Great Wave",
    impression_sunrise: "Impression, Sunrise"
};

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

        const worldName = WORLD_NAMES[newWorldId] || newWorldId;
        worldTransition.innerHTML = `<div class="transition-text">Entering ${worldName}...</div>`;

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
        { label: "Look Around", cmd: "(look around)" },
        { label: "Enter Starry Night", cmd: "(enter starry night)" },
        { label: "Enter Great Wave", cmd: "(enter great wave)" },
        { label: "Enter Sunrise", cmd: "(enter impression sunrise)" },
        { label: "Help", cmd: "(help)" }
    ],
    starry_night: [
        { label: "Look Around", cmd: "(look around)" },
        { label: "Inventory", cmd: "__open_inventory__" },
        { label: "Return to Museum", cmd: "(return to museum)" },
        { label: "Help", cmd: "(help)" }
    ],
    great_wave: [
        { label: "Look Around", cmd: "(look around)" },
        { label: "Inventory", cmd: "__open_inventory__" },
        { label: "Return to Museum", cmd: "(return to museum)" },
        { label: "Help", cmd: "(help)" }
    ],
    impression_sunrise: [
        { label: "Look Around", cmd: "(look around)" },
        { label: "Inventory", cmd: "__open_inventory__" },
        { label: "Return to Museum", cmd: "(return to museum)" },
        { label: "Help", cmd: "(help)" }
    ]
};

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
    if (data.location_id && data.location && !WORLD_NAMES[data.location_id]) {
        WORLD_NAMES[data.location_id] = data.location;
    }

    // Location
    if (data.location) {
        locationBadge.textContent = data.location;
        locationName.textContent = data.location;
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
                commandInput.value = "(go to " + ex.name.toLowerCase() + ")";
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

function updateQuickActions(worldId) {
    const actions = QUICK_ACTIONS[worldId] || QUICK_ACTIONS.museum;
    quickActions.innerHTML = "";
    actions.forEach(a => {
        const btn = document.createElement("button");
        btn.className = "quick-btn";
        btn.textContent = a.label;
        btn.dataset.cmd = a.cmd;
        if (a.cmd === "__open_inventory__") {
            btn.dataset.action = "open-inventory";
        }
        quickActions.appendChild(btn);
    });
}

// ── Panel toggle ──
panelToggle.addEventListener("click", () => {
    sidePanel.classList.toggle("collapsed");
    panelToggle.classList.toggle("collapsed");
    panelToggle.textContent = sidePanel.classList.contains("collapsed") ? "INFO" : "INFO";
});

// ── Model toggle ──
document.getElementById("model-toggle").addEventListener("click", (e) => {
    const btn = e.target.closest(".toggle-btn");
    if (!btn) return;
    const mode = btn.dataset.mode;
    switchModelMode(mode);
});

function updateModelStatus(data) {
    const mode = data.active_mode || currentMode;
    currentMode = mode;
    setModeButtonsActive(mode);
    let dotClass = "online";
    let text = "";
    const localProgress = clampPercent(data.local_progress_percent ?? (data.local_ready ? 100 : data.local_loading ? 35 : 0));

    if (mode === "api") {
        dotClass = "online";
        text = "DeepSeek API \u2014 Ready";
    } else if (mode === "local") {
        if (data.local_ready) {
            dotClass = "online";
            text = "Local Model \u2014 Ready";
        } else if (data.local_loading) {
            dotClass = "loading";
            text = `Local Model \u2014 Loading ${localProgress}%`;
        } else {
            dotClass = "offline";
            text = "Local Model \u2014 Unavailable";
        }
    }

    modelStatusText.innerHTML = `<span class="status-dot ${dotClass}"></span> ${text}`;
    updateLocalModelSettingsStatus(data);
}

// ══════════════════════════════════════════════════════════════
// Command handling
// ══════════════════════════════════════════════════════════════

async function sendCommand(command) {
    if (isWaiting || !command.trim()) return;
    isWaiting = true;
    sendBtn.disabled = true;

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
            addMessage("Error: " + (err.error || "Unknown error"), "narration");
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
                tense: "A tense feeling fills the air...",
                hopeful: "A sense of hope fills the air...",
                melancholy: "A quiet sadness settles...",
                joyful: "A warm joy washes over you..."
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
            await addMessageTypewriter(
                "You have successfully restored all paintings! You can return to the museum whenever you're ready. " +
                "Of course, you're welcome to stay a while longer and chat with the artists.",
                "narration"
            );
        }

        // Game ending: returned to museum with all quests done
        if (data.game_over && data.location_id === "museum" && !gameEndingTriggered) {
            gameEndingTriggered = true;
            await addMessageTypewriter(
                "All paintings restored! The museum's magic flows freely. The great doors open — you are free.\n\n" +
                "You can explore the museum, revisit the paintings to chat with the artists, " +
                "or click the \"View Your Story\" button on the right to see your adventure summarized.",
                "narration"
            );
            showEndPageButton();
        }
    } catch (err) {
        hideTyping();
        addMessage("Connection error. Is the server running?", "narration");
        console.error(err);
    } finally {
        isWaiting = false;
        sendBtn.disabled = commandInput.disabled;
        commandInput.focus();
    }
}

// ── Form submit ──
commandForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const cmd = commandInput.value;
    commandInput.value = "";
    sendCommand(cmd);
});

// ── Quick actions ──
quickActions.addEventListener("click", (e) => {
    const btn = e.target.closest(".quick-btn");
    if (btn) {
        if (btn.dataset.action === "open-inventory") {
            openInventoryDialog();
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
    resizeStartParticleCanvas();
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

        // Hide loading overlay (game is always ready now)
        if (s.game_ready && loadingOverlay) {
            loadingOverlay.classList.add("hidden");
            setTimeout(() => { if (loadingOverlay.parentNode) loadingOverlay.remove(); }, 500);
        }

        updateModelStatus(s);

        // Notify when local model comes online
        if (s.active_mode === "local" && s.local_ready && currentMode === "local") {
            addMessage("The paintings' spirits awaken — local model is ready.", "mood");
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
        <h3>Your Adventure</h3>
        <p style="font-size: 0.85rem; color: var(--text-dim); margin-bottom: 10px;">
            Your journey through The Cursed Canvas is complete. View your story!
        </p>
        <button class="quick-btn" id="end-page-btn" style="width: 100%; padding: 10px;">
            View Your Story
        </button>
    `;

    const sidePanel = document.getElementById("side-panel");
    sidePanel.appendChild(card);

    document.getElementById("end-page-btn").addEventListener("click", () => {
        window.location.href = "/ending";
    });
}

// ══════════════════════════════════════════════════════════════
// Initialization
// ══════════════════════════════════════════════════════════════

window.addEventListener("load", async () => {
    await migrateBrowserSaveSlots();

    // Check if returning from ending page (existing game state)
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

    if (isReturning) {
        startScreenDismissed = true;
        if (startScreen) startScreen.classList.add("hidden");
        stopStartParticles();
        setGameInputEnabled(true);
        addMessage(
            "Welcome back! You can continue exploring the museum or revisit the paintings. " +
            "Thank you for playing The Cursed Canvas!",
            "narration"
        );
        gameEndingTriggered = true;
        setUnsavedProgress(true);
        showEndPageButton();
    } else {
        showStartView("menu");
        startStartParticles();
        setGameInputEnabled(false);
    }

    // Initialize particles
    setParticleWorld("museum");
    updateParticles();

    // Initialize quick actions
    updateQuickActions("museum");

    // Start polling
    pollLoop();

    // Hide loading overlay quickly (game is ready with API mode)
    setTimeout(() => {
        if (loadingOverlay) {
            loadingOverlay.classList.add("hidden");
            setTimeout(() => { if (loadingOverlay.parentNode) loadingOverlay.remove(); }, 500);
        }
        if (!isReturning && !startScreenDismissed && startMenu && startMenu.classList.contains("active")) {
            newAdventureBtn.focus();
        }
    }, 800);
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
    stopStartParticles();
    if (animFrameId) cancelAnimationFrame(animFrameId);
});

// Get canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Get HTML elements
const towerPanel = document.getElementById('towerPanel');
const towerPanelTitle = document.getElementById('towerPanelTitle');
const towerStats = document.getElementById('towerStats');
const upgradeButton = document.getElementById('upgradeButton');
const sellButton = document.getElementById('sellButton');
const startButton = document.getElementById('startButton');
const resetButton = document.getElementById('resetButton');
const nextWaveButton = document.getElementById('nextWaveButton');
const pauseButton = document.getElementById('pauseButton');
const loadButton = document.getElementById('loadButton');
const difficultySelect = document.getElementById('difficultySelect');
const enemyDeathSound = document.getElementById('enemyDeathSound');
const towerSounds = {
    pellet: document.getElementById('sound-pellet'),
    squirt: document.getElementById('sound-squirt'),
    dart:   document.getElementById('sound-dart'),
    swarm:  document.getElementById('sound-swarm'),
    frost:  document.getElementById('sound-frost'),
    bash:   document.getElementById('sound-bash'),
};
const towerTypeButtons = document.querySelectorAll('.tower-type-btn');

const SOUND_POOL_CONFIG = {
    enemyDeath: { source: enemyDeathSound, channels: 8, minGapMs: 14, gain: 0.58, maxVoices: 7, priority: 5 },
    pellet: { source: towerSounds.pellet, channels: 12, minGapMs: 4, gain: 0.24, maxVoices: 10, priority: 1 },
    squirt: { source: towerSounds.squirt, channels: 8, minGapMs: 8, gain: 0.28, maxVoices: 6, priority: 4 },
    dart: { source: towerSounds.dart, channels: 6, minGapMs: 12, gain: 0.30, maxVoices: 5, priority: 5 },
    swarm: { source: towerSounds.swarm, channels: 14, minGapMs: 3, gain: 0.22, maxVoices: 12, priority: 2 },
    frost: { source: towerSounds.frost, channels: 9, minGapMs: 6, gain: 0.26, maxVoices: 7, priority: 4 },
    bash: { source: towerSounds.bash, channels: 5, minGapMs: 10, gain: 0.32, maxVoices: 4, priority: 5 }
};
const soundPools = {};
let audioUnlocked = false;
let audioContext = null;
let audioCompressor = null;
let audioMasterGain = null;
let webAudioReady = false;
const soundBuffers = {};
const soundLoadPromises = new Map();
const MIX_WINDOW_MS = 140;
const MIX_TARGET_EVENTS = 24;
const MIX_HARD_EVENTS = 40;
const mixRecentPlayTimes = [];

function createSoundPool(source, channelCount) {
    const channels = [];
    for (let i = 0; i < channelCount; i++) {
        const audio = i === 0 ? source : source.cloneNode(true);
        audio.preload = 'auto';
        audio.volume = source.volume;
        channels.push(audio);
    }
    return {
        channels,
        nextIndex: 0,
        minGapMs: 0,
        lastPlayTs: -Infinity,
        maxVoices: channelCount,
        gain: 1,
        priority: 3,
        voiceEnds: []
    };
}

function pruneRecentMixPlays(nowMs) {
    let write = 0;
    for (let i = 0; i < mixRecentPlayTimes.length; i++) {
        if (nowMs - mixRecentPlayTimes[i] <= MIX_WINDOW_MS) {
            mixRecentPlayTimes[write++] = mixRecentPlayTimes[i];
        }
    }
    mixRecentPlayTimes.length = write;
}

function getMixLoad(nowMs) {
    pruneRecentMixPlays(nowMs);
    return mixRecentPlayTimes.length;
}

function getEffectiveMinGapMs(pool, currentLoad) {
    if (currentLoad <= MIX_TARGET_EVENTS) return pool.minGapMs;
    const overload = currentLoad - MIX_TARGET_EVENTS;
    const pressure = Math.min(1, overload / (MIX_HARD_EVENTS - MIX_TARGET_EVENTS));
    const throttlingStrength = Math.max(0, 4 - pool.priority);
    return pool.minGapMs + pressure * throttlingStrength * 8;
}

function shouldDropForMix(pool, currentLoad) {
    if (currentLoad < MIX_HARD_EVENTS) return false;
    if (pool.priority >= 5) return false;
    if (pool.priority === 4) return currentLoad >= MIX_HARD_EVENTS + 10;
    if (pool.priority === 3) return currentLoad >= MIX_HARD_EVENTS + 7;
    if (pool.priority === 2) return currentLoad >= MIX_HARD_EVENTS + 5;
    return currentLoad >= MIX_HARD_EVENTS + 3;
}

function recordMixPlay(nowMs) {
    mixRecentPlayTimes.push(nowMs);
}

function getAudioSourceUrl(sourceEl) {
    if (!sourceEl) return null;
    const sourceNode = sourceEl.querySelector('source');
    return sourceNode?.src || sourceEl.currentSrc || sourceEl.src || null;
}

function decodeAudioDataCompat(context, raw) {
    const buffer = raw.slice(0);
    try {
        const promise = context.decodeAudioData(buffer);
        if (promise && typeof promise.then === 'function') return promise;
    } catch (_) {}
    return new Promise((resolve, reject) => {
        context.decodeAudioData(buffer, resolve, reject);
    });
}

function initWebAudio() {
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    try {
        audioContext = new AudioCtor({ latencyHint: 'interactive' });
    } catch (_) {
        try {
            audioContext = new AudioCtor();
        } catch (__){
            return;
        }
    }

    audioCompressor = audioContext.createDynamicsCompressor();
    audioCompressor.threshold.value = -18;
    audioCompressor.knee.value = 22;
    audioCompressor.ratio.value = 6;
    audioCompressor.attack.value = 0.003;
    audioCompressor.release.value = 0.16;

    audioMasterGain = audioContext.createGain();
    audioMasterGain.gain.value = 0.85;

    audioCompressor.connect(audioMasterGain);
    audioMasterGain.connect(audioContext.destination);
    webAudioReady = true;
}

function loadSoundBuffer(key, cfg) {
    if (!webAudioReady || !cfg?.source) return;
    if (soundLoadPromises.has(key)) return;

    const url = getAudioSourceUrl(cfg.source);
    if (!url) return;

    const loadPromise = fetch(url)
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.arrayBuffer();
        })
        .then(arrayBuffer => decodeAudioDataCompat(audioContext, arrayBuffer))
        .then(decoded => { soundBuffers[key] = decoded; })
        .catch(() => {});

    soundLoadPromises.set(key, loadPromise);
}

function pruneEndedVoices(pool, nowCtxTime) {
    let write = 0;
    for (let i = 0; i < pool.voiceEnds.length; i++) {
        const endTime = pool.voiceEnds[i];
        if (endTime > nowCtxTime) {
            pool.voiceEnds[write++] = endTime;
        }
    }
    pool.voiceEnds.length = write;
}

function playBufferedSound(key, pool, nowMs) {
    if (!webAudioReady || !audioContext || !audioCompressor) return false;
    const buffer = soundBuffers[key];
    if (!buffer) return false;

    const nowCtxTime = audioContext.currentTime;
    pruneEndedVoices(pool, nowCtxTime);
    if (pool.voiceEnds.length >= pool.maxVoices) return false;

    try {
        const source = audioContext.createBufferSource();
        source.buffer = buffer;

        const gainNode = audioContext.createGain();
        gainNode.gain.value = pool.gain;
        source.connect(gainNode);
        gainNode.connect(audioCompressor);

        source.start(nowCtxTime);
        pool.voiceEnds.push(nowCtxTime + buffer.duration);
        pool.lastPlayTs = nowMs;
        return true;
    } catch (_) {
        return false;
    }
}

function unlockAudio() {
    audioUnlocked = true;
    if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(() => {});
    }
}

function initSoundPools() {
    initWebAudio();
    for (const [key, cfg] of Object.entries(SOUND_POOL_CONFIG)) {
        if (!cfg.source) continue;
        const pool = createSoundPool(cfg.source, cfg.channels);
        pool.minGapMs = cfg.minGapMs || 0;
        pool.maxVoices = cfg.maxVoices || cfg.channels;
        pool.gain = cfg.gain ?? 1;
        pool.priority = cfg.priority ?? 3;
        for (let i = 0; i < pool.channels.length; i++) {
            pool.channels[i].volume = pool.gain;
        }
        soundPools[key] = pool;
        loadSoundBuffer(key, cfg);
    }
}

function playSound(key) {
    const pool = soundPools[key];
    if (!pool || !audioUnlocked) return;
    const now = performance.now();
    const mixLoad = getMixLoad(now);
    if (shouldDropForMix(pool, mixLoad)) return;

    const effectiveMinGapMs = getEffectiveMinGapMs(pool, mixLoad);
    if (effectiveMinGapMs > 0 && now - pool.lastPlayTs < effectiveMinGapMs) return;

    if (playBufferedSound(key, pool, now)) {
        recordMixPlay(now);
        return;
    }
    if (pool.channels.length === 0) return;

    const audio = pool.channels[pool.nextIndex];
    pool.nextIndex = (pool.nextIndex + 1) % pool.channels.length;
    audio.currentTime = 0;
    pool.lastPlayTs = now;
    recordMixPlay(now);
    const playback = audio.play();
    if (playback && typeof playback.catch === 'function') {
        playback.catch(() => {});
    }
}

initSoundPools();
document.addEventListener('pointerdown', unlockAudio, { once: true });
document.addEventListener('keydown', unlockAudio, { once: true });

// Game constants
const GRID_SIZE = 20;                // halved from 40 — pathfinding cell size
const TOWER_PX = GRID_SIZE * 2;      // 40px — visual tower size (same as old GRID_SIZE)
const BORDER_CELLS = 2;              // border thickness in grid cells (2*20 = 40px visual)
const COLS = Math.floor(canvas.width / GRID_SIZE);   // 40 (was 20)
const ROWS = Math.floor(canvas.height / GRID_SIZE);  // 30 (was 15)
const MAX_TOWER_LEVEL = 6;

// Tower type definitions
const TOWER_TYPES = {
    pellet: {
        name: 'Pellet',
        evolutionName: 'Sniper',
        description: 'Fast, cheap basic tower',
        cost: 30,
        levels: [
            { damage: 5,   range: 80,  fireRate: 30, upgradeCost: 0   },
            { damage: 10,  range: 90,  fireRate: 25, upgradeCost: 25  },
            { damage: 18,  range: 100, fireRate: 20, upgradeCost: 40  },
            { damage: 30,  range: 110, fireRate: 18, upgradeCost: 65  },
            { damage: 50,  range: 120, fireRate: 15, upgradeCost: 100 },
            { damage: 120, range: 200, fireRate: 50, upgradeCost: 200 },
        ],
        colors: {
            ring: ['#5a8a3a', '#8ab030', '#b0d040', '#c8e050', '#d8f060', '#ffe880'],
            dark: ['#3a6a2a', '#6a8a20', '#8ab028', '#a0c030', '#b8d838', '#d4c040'],
        },
        barrelColor: '#4a7a3a',
        projectileColor: '#8ab030',
        projectileSpeed: 6,
        barrelStyle: 'thin',
        splashRadius: 0,
        multiTarget: false,
    },
    squirt: {
        name: 'Squirt',
        evolutionName: 'Typhoon',
        description: 'Splash damage in an area',
        cost: 80,
        levels: [
            { damage: 8,  range: 90,  fireRate: 50, upgradeCost: 0   },
            { damage: 15, range: 100, fireRate: 45, upgradeCost: 60  },
            { damage: 25, range: 115, fireRate: 40, upgradeCost: 90  },
            { damage: 38, range: 120, fireRate: 35, upgradeCost: 130 },
            { damage: 55, range: 130, fireRate: 30, upgradeCost: 180 },
            { damage: 90, range: 150, fireRate: 25, splashRadius: 60, upgradeCost: 350 },
        ],
        colors: {
            ring: ['#2a6a9a', '#3080b0', '#40a0d0', '#50b8e0', '#60d0f0', '#90e8ff'],
            dark: ['#1a4a7a', '#206090', '#3080a8', '#3898c0', '#48b0d8', '#70c8e0'],
        },
        barrelColor: '#2a6a9a',
        projectileColor: '#40a0d0',
        projectileSpeed: 4,
        barrelStyle: 'wide',
        splashRadius: 40,
        multiTarget: false,
    },
    dart: {
        name: 'Dart',
        evolutionName: 'ICBM',
        description: 'Slow, powerful, long range',
        cost: 100,
        levels: [
            { damage: 25,  range: 140, fireRate: 90,  upgradeCost: 0   },
            { damage: 45,  range: 170, fireRate: 80,  upgradeCost: 80  },
            { damage: 75,  range: 200, fireRate: 70,  upgradeCost: 120 },
            { damage: 110, range: 220, fireRate: 65,  upgradeCost: 175 },
            { damage: 160, range: 240, fireRate: 60,  upgradeCost: 250 },
            { damage: 350, range: 300, fireRate: 100, upgradeCost: 500 },
        ],
        colors: {
            ring: ['#aa5030', '#cc6030', '#ee7040', '#ff8850', '#ffa060', '#ffd080'],
            dark: ['#883820', '#aa4820', '#cc5828', '#dd6830', '#ee7838', '#d4a040'],
        },
        barrelColor: '#aa5030',
        projectileColor: '#ff6600',
        projectileSpeed: 7,
        barrelStyle: 'long',
        splashRadius: 0,
        multiTarget: false,
    },
    swarm: {
        name: 'Swarm',
        evolutionName: 'Storm',
        description: 'Anti-air, fires missiles at flyers',
        cost: 120,
        levels: [
            { damage: 12, range: 100, fireRate: 20, targets: 2, upgradeCost: 0   },
            { damage: 18, range: 115, fireRate: 18, targets: 3, upgradeCost: 90  },
            { damage: 28, range: 130, fireRate: 15, targets: 4, upgradeCost: 130 },
            { damage: 40, range: 140, fireRate: 12, targets: 5, upgradeCost: 190 },
            { damage: 55, range: 155, fireRate: 10, targets: 7, upgradeCost: 270 },
            { damage: 80, range: 170, fireRate: 8,  targets: 10, upgradeCost: 450 },
        ],
        colors: {
            ring: ['#8a5aa0', '#a070b8', '#b888d0', '#c898e0', '#d8a8f0', '#f0d0ff'],
            dark: ['#6a3a80', '#805098', '#9868b0', '#a878c8', '#b888d8', '#d0a8e0'],
        },
        barrelColor: '#8a5aa0',
        projectileColor: '#b888d0',
        projectileSpeed: 9,
        barrelStyle: 'multi',
        splashRadius: 0,
        multiTarget: true,
    },
    frost: {
        name: 'Frost',
        evolutionName: 'Blizzard',
        description: 'Slows enemies, low damage',
        cost: 60,
        levels: [
            { damage: 3,  range: 90,  fireRate: 45, slowFactor: 0.4,  slowDuration: 90,  upgradeCost: 0   },
            { damage: 5,  range: 105, fireRate: 40, slowFactor: 0.5,  slowDuration: 120, upgradeCost: 50  },
            { damage: 8,  range: 120, fireRate: 35, slowFactor: 0.6,  slowDuration: 150, upgradeCost: 75  },
            { damage: 12, range: 130, fireRate: 30, slowFactor: 0.65, slowDuration: 170, upgradeCost: 110 },
            { damage: 18, range: 140, fireRate: 25, slowFactor: 0.70, slowDuration: 200, upgradeCost: 160 },
            { damage: 30, range: 160, fireRate: 20, slowFactor: 0.80, slowDuration: 250, upgradeCost: 300 },
        ],
        colors: {
            ring: ['#50a0b0', '#60c0d8', '#80e0f0', '#90e8f8', '#a0f0ff', '#d0ffff'],
            dark: ['#3080a0', '#40a0b8', '#50c0d0', '#60d0e0', '#70e0f0', '#a0e8f0'],
        },
        barrelColor: '#50a0b0',
        projectileColor: '#80e0f0',
        projectileSpeed: 4,
        barrelStyle: 'cone',
        splashRadius: 0,
        multiTarget: false,
    },
    bash: {
        name: 'Bash',
        evolutionName: 'Quake',
        description: 'Melee AoE, chance to stun',
        cost: 90,
        levels: [
            { damage: 12,  range: 50, fireRate: 40, stunChance: 0.15, stunDuration: 30,  upgradeCost: 0   },
            { damage: 22,  range: 55, fireRate: 35, stunChance: 0.20, stunDuration: 45,  upgradeCost: 70  },
            { damage: 35,  range: 60, fireRate: 30, stunChance: 0.25, stunDuration: 60,  upgradeCost: 100 },
            { damage: 50,  range: 65, fireRate: 28, stunChance: 0.30, stunDuration: 70,  upgradeCost: 150 },
            { damage: 70,  range: 70, fireRate: 25, stunChance: 0.35, stunDuration: 80,  upgradeCost: 220 },
            { damage: 120, range: 80, fireRate: 20, stunChance: 0.50, stunDuration: 120, upgradeCost: 400 },
        ],
        colors: {
            ring: ['#a07030', '#c08838', '#e0a040', '#e8b050', '#f0c060', '#ffe080'],
            dark: ['#705020', '#906828', '#b08030', '#c09038', '#d0a040', '#d4b048'],
        },
        barrelColor: '#a07030',
        projectileColor: '#e0a040',
        projectileSpeed: 0,
        barrelStyle: 'bash',
        splashRadius: 0,
        multiTarget: false,
        melee: true,
    },
};

// Enemy type definitions
const ENEMY_TYPES = {
    normal:  { name: 'Normal',  hpMult: 1.0, speedMult: 1.0, gold: 5,  score: 10, color: { main: '#3a3a4a', dark: '#1a1a2a', accent: '#5a5a70' } },
    group:   { name: 'Group',   hpMult: 0.4, speedMult: 1.0, gold: 2,  score: 5,  color: { main: '#6a5040', dark: '#3a2820', accent: '#8a7060' }, sizeMult: 0.7 },
    fast:    { name: 'Fast',    hpMult: 0.6, speedMult: 2.0, gold: 8,  score: 12, color: { main: '#aa4420', dark: '#662200', accent: '#cc6640' } },
    immune:  { name: 'Immune',  hpMult: 1.3, speedMult: 0.9, gold: 10, score: 15, color: { main: '#2a6a2a', dark: '#104010', accent: '#4a8a4a' }, slowImmune: true },
    spawn:   { name: 'Spawn',   hpMult: 0.8, speedMult: 0.9, gold: 5,  score: 8,  color: { main: '#aa8a20', dark: '#665510', accent: '#ccaa40' }, spawnsOnDeath: 2 },
    flying:  { name: 'Flying',  hpMult: 0.7, speedMult: 1.2, gold: 12, score: 15, color: { main: '#4080b0', dark: '#205070', accent: '#60a0d0' }, flying: true },
    dark:    { name: 'Dark',    hpMult: 1.5, speedMult: 0.7, gold: 15, score: 20, color: { main: '#1a1a1a', dark: '#080808', accent: '#333' }, armor: true },
};

// Difficulty settings
const DIFFICULTY_LEVELS = {
    easy: 20,
    normal: 10,
    hard: 5
};

const MAX_WAVES = 100;
const HUD_WAVE_COLORS = {
    normal: '#aaaaaa', group: '#8a7060', fast: '#cc6640', immune: '#4a8a4a',
    spawn: '#ccaa40', flying: '#60a0d0', dark: '#888', boss: '#cc44cc'
};
const WAVE_BAR_COLORS = {
    normal: '#999', group: '#7a9060', fast: '#dd7750', immune: '#5a9a5a',
    spawn: '#ddbb50', flying: '#70b0e0', dark: '#777', boss: '#cc55cc'
};
const WAVE_BAR_BG = {
    normal: '#444', group: '#3a4a30', fast: '#663320', immune: '#254525',
    spawn: '#665520', flying: '#304860', dark: '#222', boss: '#552255'
};

let waveScheduleMeta = null;
function getWaveMeta(wave) {
    const clamped = Math.max(1, Math.min(MAX_WAVES, wave));
    if (!waveScheduleMeta) {
        waveScheduleMeta = new Array(MAX_WAVES + 1);
        for (let w = 1; w <= MAX_WAVES; w++) {
            const type = getWaveType(w);
            waveScheduleMeta[w] = {
                type,
                label: type === 'boss' ? 'BOSS' : (ENEMY_TYPES[type]?.name.toUpperCase() || type.toUpperCase()),
                color: WAVE_BAR_COLORS[type] || '#999',
                bg: WAVE_BAR_BG[type] || '#333'
            };
        }
    }
    return waveScheduleMeta[clamped];
}

// Game state
let enemies = [];
let towers = [];
let projectiles = [];
let money = 1000;
let score = 0;
let baseHealth = 20;
let gameOver = false;
let level = 1;
let selectedTower = null;
let selectedTowerType = 'pellet';
let gameStarted = false;
let gamePaused = false;
let waveTimer = 0;
let difficulty = 'easy';
let WAVE_DELAY = DIFFICULTY_LEVELS[difficulty];
let waveJustCleared = false;
let hoverCell = null;
let currentWaveType = 'normal';
let selectedEnemy = null;
let floatingTexts = [];
let hoverPreviewType = null;
let pendingEnemyDeaths = [];
let enemyListDirty = false;
let projectileListDirty = false;
let frameNow = 0;
let touchActive = false; // suppress click after touch
let touchDragging = false; // true while finger is on canvas during tower placement

// Mobile detection
const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && window.innerWidth <= 860);

// Translate client coordinates to canvas coordinates (handles CSS scaling)
function canvasCoords(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY
    };
}

// Grid for pathfinding (0 = open, 1 = blocked)
let grid = Array(ROWS).fill().map(() => Array(COLS).fill(0));

// Opening sizes in grid cells (towers are 2 cells wide)
const TOP_OPENING_W = 8;   // 4 towers wide (8 cells × 20px = 160px)
const SIDE_OPENING_H = 6;  // 3 towers tall (6 cells × 20px = 120px)

// Opening start positions (centered on each wall)
const topOpening = Math.floor((COLS - TOP_OPENING_W) / 2);     // 16
const leftOpening = Math.floor((ROWS - SIDE_OPENING_H) / 2);   // 12
const bottomOpening = topOpening;
const rightOpening = leftOpening;

function setupBorders() {
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            const isTop = y < BORDER_CELLS;
            const isBottom = y >= ROWS - BORDER_CELLS;
            const isLeft = x < BORDER_CELLS;
            const isRight = x >= COLS - BORDER_CELLS;
            if (isTop || isBottom || isLeft || isRight) {
                const inOpening =
                    (isTop    && x >= topOpening && x < topOpening + TOP_OPENING_W) ||
                    (isBottom && x >= bottomOpening && x < bottomOpening + TOP_OPENING_W) ||
                    (isLeft   && y >= leftOpening && y < leftOpening + SIDE_OPENING_H) ||
                    (isRight  && y >= rightOpening && y < rightOpening + SIDE_OPENING_H);
                if (!inOpening) grid[y][x] = 1;
            }
        }
    }
}
setupBorders();

const CARDINAL_DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]];
let pathCacheVersion = 0;
const pathCache = new Map();
const pathCheckVisited = new Uint32Array(ROWS * COLS);
const pathCheckQueue = new Int32Array(ROWS * COLS);
let pathCheckToken = 1;

function invalidatePathCache() {
    pathCacheVersion++;
    pathCache.clear();
}

function pathCacheKey(start, goal) {
    return `${pathCacheVersion}:${start.x},${start.y}->${goal.x},${goal.y}`;
}

function placementBlocksCell(x, y, blockX, blockY) {
    return (x === blockX || x === blockX + 1) && (y === blockY || y === blockY + 1);
}

function pathIntersectsPlacement(path, startIndex, blockX, blockY) {
    for (let i = startIndex; i < path.length; i++) {
        const p = path[i];
        if (placementBlocksCell(p.x, p.y, blockX, blockY)) return true;
    }
    return false;
}

function hasPathWithPlacement(start, goal, blockX, blockY) {
    if (placementBlocksCell(start.x, start.y, blockX, blockY)) return false;
    if (placementBlocksCell(goal.x, goal.y, blockX, blockY)) return false;

    pathCheckToken++;
    if (pathCheckToken === 0xffffffff) {
        pathCheckVisited.fill(0);
        pathCheckToken = 1;
    }
    const token = pathCheckToken;

    const startIdx = start.y * COLS + start.x;
    pathCheckVisited[startIdx] = token;
    let head = 0;
    let tail = 0;
    pathCheckQueue[tail++] = startIdx;

    while (head < tail) {
        const idx = pathCheckQueue[head++];
        const x = idx % COLS;
        const y = (idx / COLS) | 0;
        if (x === goal.x && y === goal.y) return true;

        for (let i = 0; i < CARDINAL_DIRS.length; i++) {
            const dir = CARDINAL_DIRS[i];
            const nx = x + dir[0];
            const ny = y + dir[1];
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
            if (grid[ny][nx] === 1) continue;
            if (placementBlocksCell(nx, ny, blockX, blockY)) continue;

            const nIdx = ny * COLS + nx;
            if (pathCheckVisited[nIdx] === token) continue;
            pathCheckVisited[nIdx] = token;
            pathCheckQueue[tail++] = nIdx;
        }
    }
    return false;
}

function despawnEnemy(enemy) {
    if (!enemy || !enemy.alive) return;
    enemy.alive = false;
    enemyListDirty = true;
    if (selectedEnemy === enemy) selectedEnemy = null;
}

function queueEnemyDeath(enemy) {
    if (!enemy || !enemy.alive || enemy.pendingDeath) return;
    enemy.pendingDeath = true;
    enemy.alive = false;
    enemyListDirty = true;
    if (selectedEnemy === enemy) selectedEnemy = null;
    pendingEnemyDeaths.push(enemy);
}

function removeProjectile(projectile) {
    if (!projectile || !projectile.alive) return;
    projectile.alive = false;
    projectileListDirty = true;
}

function processPendingEnemyDeaths() {
    if (pendingEnemyDeaths.length === 0) return;

    for (const dead of pendingEnemyDeaths) {
        dead.pendingDeath = false;
        money += dead.goldReward;
        score += dead.scoreReward;
        floatingTexts.push({
            x: dead.x, y: dead.y - 10,
            text: `+${dead.goldReward}`,
            color: '#ffcc00', life: 50
        });
        spawnChildren(dead);
    }

    pendingEnemyDeaths.length = 0;
    playSound('enemyDeath');
}

function compactAliveEntities() {
    if (enemyListDirty) {
        let write = 0;
        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (enemy.alive) {
                enemies[write++] = enemy;
            }
        }
        enemies.length = write;
        enemyListDirty = false;
    }

    if (projectileListDirty) {
        let write = 0;
        for (let i = 0; i < projectiles.length; i++) {
            const projectile = projectiles[i];
            if (projectile.alive) {
                projectiles[write++] = projectile;
            }
        }
        projectiles.length = write;
        projectileListDirty = false;
    }
}

// Entry/exit points — A* start/goal at center cell of each opening
const openings = {
    top: { x: topOpening + Math.floor(TOP_OPENING_W / 2), y: 0,
           goal: { x: bottomOpening + Math.floor(TOP_OPENING_W / 2), y: ROWS - 1 } },
    left: { x: 0, y: leftOpening + Math.floor(SIDE_OPENING_H / 2),
            goal: { x: COLS - 1, y: rightOpening + Math.floor(SIDE_OPENING_H / 2) } }
};

// IndexedDB Setup
let db;
const dbRequest = indexedDB.open('TowerDefenseDB', 1);

dbRequest.onupgradeneeded = function(event) {
    db = event.target.result;
    db.createObjectStore('gameState', { keyPath: 'id' });
};

dbRequest.onsuccess = function(event) {
    db = event.target.result;
};

dbRequest.onerror = function(event) {
    console.error('IndexedDB error:', event.target.errorCode);
};

// Save game state to IndexedDB
function saveGameState() {
    const state = {
        id: 'currentGame',
        version: 2,
        money,
        score,
        baseHealth,
        level,
        gameStarted,
        difficulty,
        towers: towers.map(t => ({
            gridX: t.gridX,
            gridY: t.gridY,
            level: t.level,
            totalCost: t.totalCost,
            type: t.type
        })),
        grid: grid.map(row => [...row])
    };

    const transaction = db.transaction(['gameState'], 'readwrite');
    const store = transaction.objectStore('gameState');
    store.put(state);

    transaction.oncomplete = () => console.log('Game state saved');
    transaction.onerror = () => console.error('Save error:', transaction.error);
}

// Load game state from IndexedDB
function loadGameState() {
    const transaction = db.transaction(['gameState'], 'readonly');
    const store = transaction.objectStore('gameState');
    const request = store.get('currentGame');

    request.onsuccess = function(event) {
        const state = event.target.result;
        if (state && state.version !== 2) {
            console.log('Incompatible save (old grid format). Starting fresh.');
            return;
        }
        if (state) {
            money = state.money;
            score = state.score;
            baseHealth = state.baseHealth;
            level = state.level;
            gameStarted = state.gameStarted;
            difficulty = state.difficulty;
            WAVE_DELAY = DIFFICULTY_LEVELS[difficulty];
            difficultySelect.value = difficulty;
            towers = state.towers.map(t => {
                const type = t.type || 'dart'; // backward compat for old saves
                const tower = new Tower(t.gridX * GRID_SIZE, t.gridY * GRID_SIZE, type);
                tower.level = t.level;
                const typeDef = TOWER_TYPES[type];
                const levelStats = typeDef.levels[t.level - 1];
                tower.damage = levelStats.damage;
                tower.range = levelStats.range;
                tower.fireRate = levelStats.fireRate;
                tower.totalCost = t.totalCost;
                return tower;
            });
            grid = state.grid.map(row => [...row]);
            enemies = [];
            projectiles = [];
            pendingEnemyDeaths = [];
            enemyListDirty = false;
            projectileListDirty = false;
            invalidatePathCache();
            markBoardVisualDirty();
            gameOver = false;
            gamePaused = true;
            waveTimer = WAVE_DELAY;
            waveJustCleared = false;
            startButton.disabled = true;
            nextWaveButton.disabled = false;
            pauseButton.disabled = false;
            pauseButton.textContent = 'Resume';
            towerPanel.style.display = 'none';
            selectedTower = null;
            console.log('Game state loaded');
        } else {
            console.log('No saved game state found');
        }
    };

    request.onerror = function(event) {
        console.error('Load error:', event.target.errorCode);
    };
}

// A* Pathfinding
function aStar(start, goal, useCache = true) {
    const cacheKey = useCache ? pathCacheKey(start, goal) : null;
    if (cacheKey && pathCache.has(cacheKey)) {
        return pathCache.get(cacheKey);
    }

    const heuristic = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    let openSet = [{ x: start.x, y: start.y, g: 0, h: heuristic(start, goal), f: heuristic(start, goal), path: [] }];
    let closedSet = new Set();

    while (openSet.length > 0) {
        openSet.sort((a, b) => a.f - b.f);
        let current = openSet.shift();
        let key = `${current.x},${current.y}`;
        if (closedSet.has(key)) continue;
        closedSet.add(key);

        if (current.x === goal.x && current.y === goal.y) {
            const finalPath = current.path.concat([{ x: current.x, y: current.y }]);
            if (cacheKey) {
                pathCache.set(cacheKey, finalPath);
            }
            return finalPath;
        }

        for (let [dx, dy] of CARDINAL_DIRS) {
            let nx = current.x + dx, ny = current.y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || grid[ny][nx] === 1 || closedSet.has(`${nx},${ny}`)) continue;

            let g = current.g + 1;
            let h = heuristic({ x: nx, y: ny }, goal);
            let f = g + h;
            let newPath = current.path.concat([{ x: current.x, y: current.y }]);
            openSet.push({ x: nx, y: ny, g, h, f, path: newPath });
        }
    }

    if (cacheKey) {
        pathCache.set(cacheKey, []);
    }
    return [];
}

// Check if placement blocks all paths (2x2 tower footprint)
function canPlaceTower(gridX, gridY) {
    // Check all 4 cells are in bounds and open
    for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
            const cx = gridX + dx, cy = gridY + dy;
            if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) return false;
            if (grid[cy][cx] === 1) return false;
        }

    return hasPathWithPlacement(openings.top, openings.top.goal, gridX, gridY) &&
        hasPathWithPlacement(openings.left, openings.left.goal, gridX, gridY);
}

// Spawn children when a spawn-type enemy dies
function spawnChildren(dead) {
    if (dead.spawnsOnDeath <= 0 || dead.isChild) return;

    const parentGx = Math.floor(dead.x / GRID_SIZE);
    const parentGy = Math.floor(dead.y / GRID_SIZE);

    for (let i = 0; i < dead.spawnsOnDeath; i++) {
        const child = new Enemy(dead.type, false);
        child.isChild = true;
        child.spawnsOnDeath = 0;
        child.maxHealth = Math.floor(dead.maxHealth * 0.4);
        child.health = child.maxHealth;
        child.size = Math.floor(dead.size * 0.7);
        child.goldReward = 3;
        child.scoreReward = 3;
        child.goal = dead.goal;

        // 50% chance to pop through a crack between edge-to-edge towers
        let popped = false;
        if (Math.random() < 0.5) {
            // Scan 4 cardinal directions for tower-wall → open-cell transition
            const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
            // Shuffle directions so crack direction is random
            for (let j = dirs.length - 1; j > 0; j--) {
                const k = Math.floor(Math.random() * (j + 1));
                [dirs[j], dirs[k]] = [dirs[k], dirs[j]];
            }
            for (const [ddx, ddy] of dirs) {
                // Walk outward from parent cell until we cross a blocked→open boundary
                let foundWall = false;
                for (let step = 1; step <= 6; step++) {
                    const nx = parentGx + ddx * step;
                    const ny = parentGy + ddy * step;
                    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) break;
                    if (grid[ny][nx] === 1) {
                        foundWall = true;
                    } else if (foundWall) {
                        // Found open cell on far side of a wall — try to pathfind from here
                        const testPath = aStar({ x: nx, y: ny }, dead.goal);
                        if (testPath.length > 0) {
                            child.x = nx * GRID_SIZE + GRID_SIZE / 2;
                            child.y = ny * GRID_SIZE + GRID_SIZE / 2;
                            child.path = testPath;
                            child.pathIndex = 0;
                            popped = true;
                            break;
                        }
                    }
                }
                if (popped) break;
            }
        }

        if (!popped) {
            // Normal spawn at parent position
            child.x = dead.x + (Math.random() - 0.5) * 10;
            child.y = dead.y + (Math.random() - 0.5) * 10;
            child.path = aStar({ x: parentGx, y: parentGy }, dead.goal);
            child.pathIndex = 0;
            if (child.path.length === 0) {
                for (const [ox, oy] of CARDINAL_DIRS) {
                    child.path = aStar({ x: parentGx + ox, y: parentGy + oy }, dead.goal);
                    child.pathIndex = 0;
                    if (child.path.length > 0) break;
                }
            }
        }

        enemies.push(child);
    }
}

// ==========================================
// Drawing Helper Functions
// ==========================================

function drawRoundedRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawArrow(cx, cy, size, direction, drawCtx = ctx) {
    drawCtx.save();
    drawCtx.translate(cx, cy);
    switch (direction) {
        case 'down': drawCtx.rotate(Math.PI / 2); break;
        case 'up': drawCtx.rotate(-Math.PI / 2); break;
        case 'right': break;
        case 'left': drawCtx.rotate(Math.PI); break;
    }
    drawCtx.beginPath();
    drawCtx.moveTo(size, 0);
    drawCtx.lineTo(-size * 0.5, -size * 0.7);
    drawCtx.lineTo(-size * 0.2, 0);
    drawCtx.lineTo(-size * 0.5, size * 0.7);
    drawCtx.closePath();
    drawCtx.fill();
    drawCtx.restore();
}

const towerCoreSpriteCache = new Map();
const enemyCoreSpriteCache = new Map();

function drawTowerCoreShape(drawCtx, type, level, angle, cx, cy, gs, color, dark) {
    const lvl = Math.min(level, 5);
    switch (type) {
        case 'pellet': {
            const len = gs * 0.52;
            const w = 1.5 + lvl * 0.3;
            const cosA = Math.cos(angle);
            const sinA = Math.sin(angle);
            drawCtx.strokeStyle = '#222';
            drawCtx.lineWidth = w + 2;
            drawCtx.beginPath();
            drawCtx.moveTo(cx, cy);
            drawCtx.lineTo(cx + cosA * len, cy + sinA * len);
            drawCtx.stroke();

            drawCtx.strokeStyle = color;
            drawCtx.lineWidth = w;
            drawCtx.beginPath();
            drawCtx.moveTo(cx + cosA * 3, cy + sinA * 3);
            drawCtx.lineTo(cx + cosA * (len - 1), cy + sinA * (len - 1));
            drawCtx.stroke();

            drawCtx.fillStyle = '#222';
            drawCtx.beginPath();
            drawCtx.arc(cx + cosA * len, cy + sinA * len, w * 0.8 + 1, 0, Math.PI * 2);
            drawCtx.fill();

            const baseR = 5 + Math.min(lvl, 4);
            drawCtx.fillStyle = '#333';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, baseR + 1, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.fillStyle = dark;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, baseR, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.strokeStyle = color;
            drawCtx.lineWidth = 1.5;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, baseR - 1.5, 0, Math.PI * 2);
            drawCtx.stroke();
            drawCtx.fillStyle = '#555';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 2.5, 0, Math.PI * 2);
            drawCtx.fill();
            break;
        }
        case 'squirt': {
            const arcCount = 2 + Math.floor(lvl / 2);
            for (let i = 0; i < arcCount; i++) {
                const dist = 7 + i * 4;
                const span = 0.6 + i * 0.12;
                const thick = 2.5 - i * 0.3;
                drawCtx.strokeStyle = '#1a4a7a';
                drawCtx.lineWidth = thick + 1.5;
                drawCtx.beginPath();
                drawCtx.arc(cx, cy, dist, angle - span, angle + span);
                drawCtx.stroke();
                drawCtx.strokeStyle = color;
                drawCtx.lineWidth = thick;
                drawCtx.beginPath();
                drawCtx.arc(cx, cy, dist, angle - span, angle + span);
                drawCtx.stroke();
            }
            drawCtx.fillStyle = '#222';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 5, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.fillStyle = dark;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 4, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.fillStyle = '#555';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 2, 0, Math.PI * 2);
            drawCtx.fill();
            break;
        }
        case 'dart': {
            const r = 10 + Math.min(lvl, 3);
            const ext = r + 4;
            drawCtx.save();
            drawCtx.translate(cx, cy);
            drawCtx.rotate(angle);
            drawCtx.strokeStyle = '#333';
            drawCtx.lineWidth = 2.5;
            drawCtx.beginPath();
            drawCtx.arc(0, 0, r, 0, Math.PI * 2);
            drawCtx.stroke();
            drawCtx.strokeStyle = color;
            drawCtx.lineWidth = 1.5;
            drawCtx.beginPath();
            drawCtx.arc(0, 0, r * 0.5, 0, Math.PI * 2);
            drawCtx.stroke();
            drawCtx.strokeStyle = '#333';
            drawCtx.lineWidth = 2;
            drawCtx.beginPath();
            drawCtx.moveTo(-ext, 0); drawCtx.lineTo(-r * 0.3, 0);
            drawCtx.moveTo(r * 0.3, 0); drawCtx.lineTo(ext, 0);
            drawCtx.moveTo(0, -ext); drawCtx.lineTo(0, -r * 0.3);
            drawCtx.moveTo(0, r * 0.3); drawCtx.lineTo(0, ext);
            drawCtx.stroke();
            drawCtx.fillStyle = color;
            drawCtx.beginPath();
            drawCtx.arc(0, 0, 2.5, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.restore();
            break;
        }
        case 'swarm': {
            const armCount = 4 + Math.min(Math.floor(lvl / 1.5), 4);
            const armLen = 10 + Math.min(lvl, 3);
            for (let i = 0; i < armCount; i++) {
                const a = angle + (i / armCount) * Math.PI * 2;
                const ac = Math.cos(a), as = Math.sin(a);
                drawCtx.strokeStyle = '#222';
                drawCtx.lineWidth = 2.5;
                drawCtx.beginPath();
                drawCtx.moveTo(cx + ac * 4, cy + as * 4);
                drawCtx.lineTo(cx + ac * armLen, cy + as * armLen);
                drawCtx.stroke();
                drawCtx.strokeStyle = color;
                drawCtx.lineWidth = 1.5;
                drawCtx.beginPath();
                drawCtx.moveTo(cx + ac * 5, cy + as * 5);
                drawCtx.lineTo(cx + ac * (armLen - 1), cy + as * (armLen - 1));
                drawCtx.stroke();
                drawCtx.fillStyle = color;
                drawCtx.beginPath();
                drawCtx.arc(cx + ac * armLen, cy + as * armLen, 2, 0, Math.PI * 2);
                drawCtx.fill();
            }
            drawCtx.fillStyle = '#222';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 5, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.fillStyle = dark;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 4, 0, Math.PI * 2);
            drawCtx.fill();
            break;
        }
        case 'frost': {
            const armLen = 11 + Math.min(lvl, 3);
            const branchDist = armLen * 0.55;
            const branchLen = armLen * 0.35;
            for (let i = 0; i < 6; i++) {
                const a = angle + (i / 6) * Math.PI * 2;
                const ac = Math.cos(a), as = Math.sin(a);
                drawCtx.strokeStyle = '#183848';
                drawCtx.lineWidth = 3;
                drawCtx.beginPath();
                drawCtx.moveTo(cx, cy);
                drawCtx.lineTo(cx + ac * armLen, cy + as * armLen);
                drawCtx.stroke();
                drawCtx.strokeStyle = color;
                drawCtx.lineWidth = 2;
                drawCtx.beginPath();
                drawCtx.moveTo(cx, cy);
                drawCtx.lineTo(cx + ac * armLen, cy + as * armLen);
                drawCtx.stroke();
                const bx = cx + ac * branchDist;
                const by = cy + as * branchDist;
                drawCtx.strokeStyle = color;
                drawCtx.lineWidth = 1.5;
                for (const sign of [-1, 1]) {
                    drawCtx.beginPath();
                    drawCtx.moveTo(bx, by);
                    drawCtx.lineTo(
                        bx + Math.cos(a + sign * 1.0) * branchLen,
                        by + Math.sin(a + sign * 1.0) * branchLen
                    );
                    drawCtx.stroke();
                }
                drawCtx.fillStyle = color;
                drawCtx.beginPath();
                drawCtx.arc(cx + ac * armLen, cy + as * armLen, 1.5, 0, Math.PI * 2);
                drawCtx.fill();
            }
            drawCtx.fillStyle = '#183848';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 4, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.fillStyle = dark;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 3, 0, Math.PI * 2);
            drawCtx.fill();
            break;
        }
        case 'bash': {
            const weightR = 10 + Math.min(lvl, 4);
            for (let i = -2; i <= 2; i++) {
                const a = angle + i * 0.3;
                const startD = weightR + 2;
                const endD = startD + 5 - Math.abs(i);
                drawCtx.strokeStyle = color;
                drawCtx.lineWidth = 2 - Math.abs(i) * 0.3;
                drawCtx.beginPath();
                drawCtx.moveTo(cx + Math.cos(a) * startD, cy + Math.sin(a) * startD);
                drawCtx.lineTo(cx + Math.cos(a) * endD, cy + Math.sin(a) * endD);
                drawCtx.stroke();
            }
            drawCtx.fillStyle = '#111';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, weightR + 1.5, 0, Math.PI * 2);
            drawCtx.fill();
            const wGrad = drawCtx.createRadialGradient(cx - 2, cy - 2, weightR * 0.1, cx, cy, weightR);
            wGrad.addColorStop(0, '#555');
            wGrad.addColorStop(0.5, dark);
            wGrad.addColorStop(1, '#111');
            drawCtx.fillStyle = wGrad;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, weightR, 0, Math.PI * 2);
            drawCtx.fill();
            drawCtx.strokeStyle = color;
            drawCtx.lineWidth = 2;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, weightR - 3, 0, Math.PI * 2);
            drawCtx.stroke();
            drawCtx.strokeStyle = '#444';
            drawCtx.lineWidth = 1;
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, weightR * 0.5, 0, Math.PI * 2);
            drawCtx.stroke();
            drawCtx.fillStyle = '#666';
            drawCtx.beginPath();
            drawCtx.arc(cx, cy, 3, 0, Math.PI * 2);
            drawCtx.fill();
            break;
        }
    }
}

function getTowerCoreSprite(type, level) {
    const key = `${type}|${level}`;
    if (towerCoreSpriteCache.has(key)) return towerCoreSpriteCache.get(key);

    const typeDef = TOWER_TYPES[type];
    const color = typeDef.colors.ring[level - 1];
    const dark = typeDef.colors.dark[level - 1];
    const size = Math.ceil(TOWER_PX * 1.9);
    const center = size / 2;

    const sprite = document.createElement('canvas');
    sprite.width = size;
    sprite.height = size;
    const sctx = sprite.getContext('2d');
    drawTowerCoreShape(sctx, type, level, 0, center, center, TOWER_PX, color, dark);
    const result = { canvas: sprite, center };
    towerCoreSpriteCache.set(key, result);
    return result;
}

function buildEnemyCoreSprite(type, isBoss, isChild, size) {
    const key = `${type}|${isBoss ? 1 : 0}|${isChild ? 1 : 0}|${size}`;
    if (enemyCoreSpriteCache.has(key)) return enemyCoreSpriteCache.get(key);

    const r = size / 2;
    const canvasSize = Math.ceil(size * 3.0);
    const center = canvasSize / 2;
    const sprite = document.createElement('canvas');
    sprite.width = canvasSize;
    sprite.height = canvasSize;
    const sctx = sprite.getContext('2d');
    const typeDef = ENEMY_TYPES[type];

    let mainColor, darkColor, accentColor;
    if (isBoss) {
        mainColor = '#4a2060';
        darkColor = '#2a1040';
        accentColor = '#7050a0';
    } else {
        mainColor = typeDef.color.main;
        darkColor = typeDef.color.dark;
        accentColor = typeDef.color.accent;
    }

    if (typeDef.flying) {
        const triLen = r * 1.3;
        const triW = r * 0.9;
        const nx = center + triLen;
        const ny = center;
        const lx = center - triLen * 0.6;
        const ly = center + triW;
        const rx = center - triLen * 0.6;
        const ry = center - triW;

        sctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        sctx.beginPath();
        sctx.moveTo(nx + 1, ny + 1);
        sctx.lineTo(lx + 1, ly + 1);
        sctx.lineTo(rx + 1, ry + 1);
        sctx.closePath();
        sctx.fill();

        const grad = sctx.createLinearGradient(center - triLen * 0.6, center, nx, ny);
        grad.addColorStop(0, darkColor);
        grad.addColorStop(0.5, mainColor);
        grad.addColorStop(1, accentColor);
        sctx.fillStyle = grad;
        sctx.beginPath();
        sctx.moveTo(nx, ny);
        sctx.lineTo(lx, ly);
        sctx.lineTo(rx, ry);
        sctx.closePath();
        sctx.fill();
        sctx.strokeStyle = darkColor;
        sctx.lineWidth = 1.5;
        sctx.stroke();
    } else {
        sctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
        sctx.beginPath();
        sctx.ellipse(center + 1, center + 1, r + 1, r * 0.92, 0, 0, Math.PI * 2);
        sctx.fill();

        if (type === 'dark' && !isBoss) {
            sctx.strokeStyle = '#444';
            sctx.lineWidth = 3;
            sctx.beginPath();
            sctx.arc(center, center, r + 2, 0, Math.PI * 2);
            sctx.stroke();
            sctx.strokeStyle = '#222';
            sctx.lineWidth = 1.5;
            sctx.beginPath();
            sctx.arc(center, center, r + 3.5, 0, Math.PI * 2);
            sctx.stroke();
        }

        const grad = sctx.createRadialGradient(
            center - r * 0.2, center - r * 0.2, r * 0.1,
            center, center, r
        );
        grad.addColorStop(0, accentColor);
        grad.addColorStop(0.6, mainColor);
        grad.addColorStop(1, darkColor);
        sctx.fillStyle = grad;
        sctx.beginPath();
        if (type === 'fast' && !isBoss) {
            sctx.ellipse(center, center, r * 1.3, r * 0.8, 0, 0, Math.PI * 2);
        } else if (type === 'spawn' && !isChild && !isBoss) {
            sctx.ellipse(center, center, r * 0.8, r * 1.25, 0, 0, Math.PI * 2);
        } else {
            sctx.arc(center, center, r, 0, Math.PI * 2);
        }
        sctx.fill();
        sctx.strokeStyle = darkColor;
        sctx.lineWidth = 1.5;
        sctx.stroke();

        sctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        sctx.lineWidth = 1;
        sctx.beginPath();
        sctx.moveTo(center, center + r * 0.7);
        sctx.lineTo(center, center - r * 0.7);
        sctx.stroke();

        if (type === 'immune' && !isBoss) {
            sctx.fillStyle = '#4a8a4a';
            const spikeCount = 8;
            for (let i = 0; i < spikeCount; i++) {
                const a = (i / spikeCount) * Math.PI * 2;
                const sx = center + Math.cos(a) * (r + 1);
                const sy = center + Math.sin(a) * (r + 1);
                sctx.beginPath();
                sctx.moveTo(sx + Math.cos(a) * 3, sy + Math.sin(a) * 3);
                sctx.lineTo(sx + Math.cos(a + 0.4) * 1.5, sy + Math.sin(a + 0.4) * 1.5);
                sctx.lineTo(sx + Math.cos(a - 0.4) * 1.5, sy + Math.sin(a - 0.4) * 1.5);
                sctx.closePath();
                sctx.fill();
            }
        }

        if (type === 'fast' && !isBoss) {
            sctx.strokeStyle = 'rgba(255, 100, 50, 0.3)';
            sctx.lineWidth = 1;
            for (let i = 0; i < 3; i++) {
                const offset = (i - 1) * r * 0.4;
                const sx = center - r * 1.2;
                const sy = center + offset;
                sctx.beginPath();
                sctx.moveTo(sx, sy);
                sctx.lineTo(sx - r * 0.6, sy);
                sctx.stroke();
            }
        }

        const eyeOffset = r * 0.3;
        const eyeR = r * 0.2;
        const eyeX1 = center + eyeOffset;
        const eyeY1 = center + eyeOffset * 0.55;
        const eyeX2 = center + eyeOffset;
        const eyeY2 = center - eyeOffset * 0.55;
        sctx.fillStyle = '#ccc';
        sctx.beginPath();
        sctx.arc(eyeX1, eyeY1, eyeR, 0, Math.PI * 2);
        sctx.fill();
        sctx.beginPath();
        sctx.arc(eyeX2, eyeY2, eyeR, 0, Math.PI * 2);
        sctx.fill();
        const po = eyeR * 0.3;
        sctx.fillStyle = '#111';
        sctx.beginPath();
        sctx.arc(eyeX1 + po, eyeY1, eyeR * 0.55, 0, Math.PI * 2);
        sctx.fill();
        sctx.beginPath();
        sctx.arc(eyeX2 + po, eyeY2, eyeR * 0.55, 0, Math.PI * 2);
        sctx.fill();

        if (isBoss) {
            sctx.strokeStyle = darkColor;
            sctx.lineWidth = 2;
            const antLen = r * 0.6;
            for (let side of [-1, 1]) {
                const baseX = center + r * 0.7;
                const baseY = center + side * r * 0.3;
                const tipAngle = side * 0.5;
                const tipX = baseX + Math.cos(tipAngle) * antLen;
                const tipY = baseY + Math.sin(tipAngle) * antLen;
                sctx.beginPath();
                sctx.moveTo(baseX, baseY);
                sctx.quadraticCurveTo(
                    baseX + Math.cos(tipAngle) * antLen * 0.5,
                    baseY + Math.sin(tipAngle) * antLen * 0.5 + side * 3,
                    tipX, tipY
                );
                sctx.stroke();
                sctx.fillStyle = '#cc44cc';
                sctx.beginPath();
                sctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
                sctx.fill();
            }
        }
    }

    const spriteObj = { canvas: sprite, center };
    enemyCoreSpriteCache.set(key, spriteObj);
    return spriteObj;
}

// Pre-render the static desk background
let deskBgCanvas = null;
let boardBaseCanvas = null;
let boardArrowsCanvas = null;
let boardWallsCanvas = null;
let boardWallsDirty = true;

function markBoardVisualDirty() {
    boardWallsDirty = true;
}

function createDeskBackground() {
    deskBgCanvas = document.createElement('canvas');
    deskBgCanvas.width = canvas.width;
    deskBgCanvas.height = canvas.height;
    const bg = deskBgCanvas.getContext('2d');

    const deskGrad = bg.createLinearGradient(0, 0, canvas.width, canvas.height);
    deskGrad.addColorStop(0, '#8a7e5a');
    deskGrad.addColorStop(0.25, '#9a8e68');
    deskGrad.addColorStop(0.5, '#8a7e58');
    deskGrad.addColorStop(0.75, '#7a6e4a');
    deskGrad.addColorStop(1, '#6a5e3a');
    bg.fillStyle = deskGrad;
    bg.fillRect(0, 0, canvas.width, canvas.height);

    bg.strokeStyle = 'rgba(0, 0, 0, 0.04)';
    bg.lineWidth = 1;
    for (let i = 0; i < canvas.height; i += 2) {
        bg.beginPath();
        bg.moveTo(0, i + 0.5);
        bg.lineTo(canvas.width, i + 0.5);
        bg.stroke();
    }
    bg.strokeStyle = 'rgba(255, 255, 255, 0.02)';
    for (let i = 0; i < canvas.width; i += 4) {
        bg.beginPath();
        bg.moveTo(i + 0.5, 0);
        bg.lineTo(i + 0.5, canvas.height);
        bg.stroke();
    }

    // Dollar bill
    bg.save();
    bg.translate(580, 30);
    bg.rotate(0.15);
    bg.fillStyle = 'rgba(95, 125, 75, 0.3)';
    bg.fillRect(0, 0, 180, 76);
    bg.strokeStyle = 'rgba(65, 95, 50, 0.35)';
    bg.lineWidth = 1.5;
    bg.strokeRect(5, 5, 170, 66);
    bg.strokeRect(10, 10, 160, 56);
    bg.fillStyle = 'rgba(65, 95, 50, 0.15)';
    bg.beginPath();
    bg.ellipse(90, 38, 22, 18, 0, 0, Math.PI * 2);
    bg.fill();
    bg.restore();

    // Second bill
    bg.save();
    bg.translate(420, 520);
    bg.rotate(-0.08);
    bg.fillStyle = 'rgba(95, 125, 75, 0.2)';
    bg.fillRect(0, 0, 180, 76);
    bg.strokeStyle = 'rgba(65, 95, 50, 0.25)';
    bg.lineWidth = 1;
    bg.strokeRect(5, 5, 170, 66);
    bg.restore();

    // Coin
    bg.fillStyle = 'rgba(175, 135, 75, 0.35)';
    bg.beginPath();
    bg.arc(650, 490, 32, 0, Math.PI * 2);
    bg.fill();
    bg.strokeStyle = 'rgba(145, 110, 55, 0.4)';
    bg.lineWidth = 3;
    bg.stroke();
    bg.strokeStyle = 'rgba(145, 110, 55, 0.25)';
    bg.lineWidth = 1;
    bg.beginPath();
    bg.arc(650, 490, 25, 0, Math.PI * 2);
    bg.stroke();
    bg.fillStyle = 'rgba(220, 200, 150, 0.15)';
    bg.beginPath();
    bg.arc(645, 484, 15, 0, Math.PI * 2);
    bg.fill();

    // Small coin
    bg.fillStyle = 'rgba(160, 120, 70, 0.3)';
    bg.beginPath();
    bg.arc(15, 15, 18, 0, Math.PI * 2);
    bg.fill();
    bg.strokeStyle = 'rgba(130, 100, 50, 0.3)';
    bg.lineWidth = 2;
    bg.stroke();
}

function createBoardBaseLayer() {
    boardBaseCanvas = document.createElement('canvas');
    boardBaseCanvas.width = canvas.width;
    boardBaseCanvas.height = canvas.height;
    const bg = boardBaseCanvas.getContext('2d');

    const paperX = BORDER_CELLS * GRID_SIZE;
    const paperY = BORDER_CELLS * GRID_SIZE;
    const paperW = (COLS - 2 * BORDER_CELLS) * GRID_SIZE;
    const paperH = (ROWS - 2 * BORDER_CELLS) * GRID_SIZE;

    bg.fillStyle = 'rgba(0, 0, 0, 0.12)';
    bg.fillRect(paperX + 3, paperY + 3, paperW + 1, paperH + 1);
    bg.fillStyle = '#ece6d0';
    bg.fillRect(paperX, paperY, paperW, paperH);
    bg.fillStyle = 'rgba(255, 255, 255, 0.2)';
    bg.fillRect(paperX, paperY, paperW, 1);
    bg.fillRect(paperX, paperY, 1, paperH);

    // Openings (wider gaps in border)
    const topOpenW = TOP_OPENING_W * GRID_SIZE;
    const sideOpenH = SIDE_OPENING_H * GRID_SIZE;
    const borderPx = BORDER_CELLS * GRID_SIZE;
    bg.fillStyle = '#ece6d0';
    bg.fillRect(topOpening * GRID_SIZE, 0, topOpenW, borderPx);
    bg.fillRect(bottomOpening * GRID_SIZE, (ROWS - BORDER_CELLS) * GRID_SIZE, topOpenW, borderPx);
    bg.fillRect(0, leftOpening * GRID_SIZE, borderPx, sideOpenH);
    bg.fillRect((COLS - BORDER_CELLS) * GRID_SIZE, rightOpening * GRID_SIZE, borderPx, sideOpenH);
}

function createBoardArrowsLayer() {
    boardArrowsCanvas = document.createElement('canvas');
    boardArrowsCanvas.width = canvas.width;
    boardArrowsCanvas.height = canvas.height;
    const bg = boardArrowsCanvas.getContext('2d');

    const topOpenW = TOP_OPENING_W * GRID_SIZE;
    const sideOpenH = SIDE_OPENING_H * GRID_SIZE;
    const borderPx = BORDER_CELLS * GRID_SIZE;
    const topCx = topOpening * GRID_SIZE + topOpenW / 2;
    const leftCy = leftOpening * GRID_SIZE + sideOpenH / 2;
    const borderMid = borderPx / 2;

    bg.fillStyle = 'rgba(76, 175, 80, 0.6)';
    drawArrow(topCx, borderMid, 8, 'down', bg);
    drawArrow(borderMid, leftCy, 8, 'right', bg);
    bg.fillStyle = 'rgba(200, 60, 50, 0.5)';
    drawArrow(topCx, (ROWS - BORDER_CELLS) * GRID_SIZE + borderMid, 8, 'down', bg);
    drawArrow((COLS - BORDER_CELLS) * GRID_SIZE + borderMid, leftCy, 8, 'right', bg);
}

function rebuildBoardWallsLayer() {
    if (!boardWallsCanvas) {
        boardWallsCanvas = document.createElement('canvas');
        boardWallsCanvas.width = canvas.width;
        boardWallsCanvas.height = canvas.height;
    }

    const bg = boardWallsCanvas.getContext('2d');
    bg.clearRect(0, 0, boardWallsCanvas.width, boardWallsCanvas.height);

    const towerMask = new Uint8Array(ROWS * COLS);
    for (let i = 0; i < towers.length; i++) {
        const tower = towers[i];
        for (let dy = 0; dy < 2; dy++) {
            for (let dx = 0; dx < 2; dx++) {
                const gx = tower.gridX + dx;
                const gy = tower.gridY + dy;
                if (gx >= 0 && gx < COLS && gy >= 0 && gy < ROWS) {
                    towerMask[gy * COLS + gx] = 1;
                }
            }
        }
    }

    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] !== 1 || towerMask[y * COLS + x]) continue;

            const wx = x * GRID_SIZE;
            const wy = y * GRID_SIZE;
            bg.fillStyle = 'rgba(0, 0, 0, 0.06)';
            bg.fillRect(wx, wy, GRID_SIZE, 1);
            bg.fillRect(wx, wy, 1, GRID_SIZE);
            bg.fillStyle = 'rgba(255, 255, 255, 0.04)';
            bg.fillRect(wx, wy + GRID_SIZE - 1, GRID_SIZE, 1);
            bg.fillRect(wx + GRID_SIZE - 1, wy, 1, GRID_SIZE);
        }
    }

    boardWallsDirty = false;
}

// Draw the game board
function drawBoard() {
    if (!deskBgCanvas) createDeskBackground();
    if (!boardBaseCanvas) createBoardBaseLayer();
    if (!boardArrowsCanvas) createBoardArrowsLayer();
    if (!boardWallsCanvas || boardWallsDirty) rebuildBoardWallsLayer();

    ctx.drawImage(deskBgCanvas, 0, 0);
    ctx.drawImage(boardBaseCanvas, 0, 0);
    ctx.drawImage(boardWallsCanvas, 0, 0);
    ctx.drawImage(boardArrowsCanvas, 0, 0);

    // (hover highlight drawn later in render order via drawHoverPreview)
}

// Draw the HUD
function drawHUD() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, 26);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, 26, canvas.width, 1);

    ctx.font = 'bold 14px Arial, sans-serif';
    ctx.textBaseline = 'middle';
    const y = 13;

    ctx.fillStyle = '#ffffff';
    if (gameStarted && waveTimer > 0) {
        ctx.fillText(`Time: ${Math.ceil(waveTimer)}`, 12, y);
    } else {
        ctx.fillText('Time: --', 12, y);
    }

    ctx.fillStyle = '#00ccff';
    ctx.fillText(`Level: ${level}`, 120, y);

    ctx.fillStyle = '#00ff00';
    ctx.fillText(`Lives: ${baseHealth}`, 250, y);

    ctx.fillStyle = '#ffcc00';
    ctx.fillText(`Gold: ${money}`, 390, y);

    ctx.fillStyle = '#ff4444';
    ctx.fillText(`Score: ${score}`, 530, y);

    // Wave type indicator
    if (gameStarted && currentWaveType) {
        const typeName = currentWaveType === 'boss' ? 'BOSS' : ENEMY_TYPES[currentWaveType]?.name || currentWaveType;
        ctx.fillStyle = HUD_WAVE_COLORS[currentWaveType] || '#aaa';
        ctx.fillText(typeName, 650, y);
    }

    if (gamePaused && gameStarted) {
        ctx.fillStyle = '#ffff00';
        ctx.fillText('PAUSED', 750, y);
    }

    ctx.textBaseline = 'alphabetic';
}

// Draw overlay message
function drawOverlayMessage(text, subText, color) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const boxW = 340;
    const boxH = subText ? 100 : 70;
    const boxX = (canvas.width - boxW) / 2;
    const boxY = (canvas.height - boxH) / 2;

    ctx.fillStyle = 'rgba(20, 20, 30, 0.92)';
    drawRoundedRect(boxX, boxY, boxW, boxH, 8);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    drawRoundedRect(boxX, boxY, boxW, boxH, 8);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.font = 'bold 30px Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, canvas.width / 2, boxY + 38);

    if (subText) {
        ctx.fillStyle = '#aaa';
        ctx.font = '15px Arial, sans-serif';
        ctx.fillText(subText, canvas.width / 2, boxY + 70);
    }

    ctx.textAlign = 'start';
}

// Draw selected enemy info tooltip
function drawEnemyInfo() {
    if (!selectedEnemy || !selectedEnemy.alive) {
        selectedEnemy = null;
        return;
    }
    const e = selectedEnemy;
    const typeDef = ENEMY_TYPES[e.type];
    const hp = e.health;
    const maxHp = e.maxHealth;
    const pct = Math.round((hp / maxHp) * 100);

    const label = e.isBoss ? `Boss (${typeDef.name})` : typeDef.name;
    const line1 = label;
    const line2 = `HP: ${Math.ceil(hp)} / ${maxHp} (${pct}%)`;
    const line3 = `Gold: ${e.goldReward}` + (e.armor > 0 ? ` | Armor: ${e.armor}` : '') +
                  (e.slowImmune ? ' | Immune' : '');

    ctx.font = 'bold 11px Arial, sans-serif';
    const w1 = ctx.measureText(line1).width;
    ctx.font = '10px Arial, sans-serif';
    const w2 = ctx.measureText(line2).width;
    const w3 = ctx.measureText(line3).width;
    const boxW = Math.max(w1, w2, w3) + 16;
    const boxH = 44;

    let bx = e.x - boxW / 2;
    let by = e.y - e.size / 2 - boxH - 14;
    // Keep on screen
    if (bx < 2) bx = 2;
    if (bx + boxW > canvas.width - 2) bx = canvas.width - boxW - 2;
    if (by < 28) by = e.y + e.size / 2 + 8;

    ctx.fillStyle = 'rgba(10, 10, 20, 0.9)';
    drawRoundedRect(bx, by, boxW, boxH, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 1;
    drawRoundedRect(bx, by, boxW, boxH, 4);
    ctx.stroke();

    const waveColors = {
        normal: '#aaaaaa', group: '#8a7060', fast: '#cc6640', immune: '#4a8a4a',
        spawn: '#ccaa40', flying: '#60a0d0', dark: '#888'
    };
    ctx.fillStyle = e.isBoss ? '#cc44cc' : (waveColors[e.type] || '#ccc');
    ctx.font = 'bold 11px Arial, sans-serif';
    ctx.fillText(line1, bx + 8, by + 13);

    ctx.fillStyle = '#ccc';
    ctx.font = '10px Arial, sans-serif';
    ctx.fillText(line2, bx + 8, by + 26);
    ctx.fillStyle = '#aaa';
    ctx.fillText(line3, bx + 8, by + 39);
}

// Floating text system
function updateFloatingTexts() {
    for (let i = floatingTexts.length - 1; i >= 0; i--) {
        const ft = floatingTexts[i];
        ft.y -= 0.8;
        ft.life--;
        if (ft.life <= 0) {
            floatingTexts.splice(i, 1);
        }
    }
}

function drawFloatingTexts() {
    for (const ft of floatingTexts) {
        const alpha = Math.min(1, ft.life / 30);
        ctx.globalAlpha = alpha;
        ctx.fillStyle = ft.color;
        ctx.font = 'bold 12px Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(ft.text, ft.x, ft.y);
        ctx.textAlign = 'start';
    }
    ctx.globalAlpha = 1;
}

// Draw wave schedule bar at bottom
function drawWaveBar() {
    if (!gameStarted) return;
    const barH = 32;
    const barY = canvas.height - barH;

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(0, barY, canvas.width, barH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillRect(0, barY, canvas.width, 1);

    const cellW = 58;
    const cellGap = 3;
    const cellStep = cellW + cellGap;
    const cellH = barH - 6;
    const cellY = barY + 3;

    // Current wave = level - 1 (level increments immediately after spawnWave)
    const currentWave = Math.min(MAX_WAVES, Math.max(1, level - 1));

    // Progress toward next wave: 0 = just spawned, 1 = about to spawn next
    const waveProgress = WAVE_DELAY > 0 ? Math.max(0, Math.min(1, 1 - waveTimer / WAVE_DELAY)) : 1;

    // Smooth scroll: anchor the current wave at ~20% from left edge
    const anchorX = canvas.width * 0.18;
    const scrollOffset = anchorX - (currentWave - 1) * cellStep - waveProgress * cellStep;
    const visiblePad = 20;
    const minWave = Math.max(1, Math.ceil(((-visiblePad - scrollOffset - cellW) / cellStep) + 1));
    const maxWave = Math.min(MAX_WAVES, Math.floor(((canvas.width + visiblePad - scrollOffset) / cellStep) + 1));

    // Clip to bar area
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, barY, canvas.width, barH);
    ctx.clip();

    ctx.textBaseline = 'middle';

    // Draw wave cells
    for (let w = minWave; w <= maxWave; w++) {
        const x = scrollOffset + (w - 1) * cellStep;
        const wMeta = getWaveMeta(w);
        const isCurrent = w === currentWave;
        const isPast = w < currentWave;

        // Cell background
        if (isPast) {
            ctx.fillStyle = 'rgba(25, 25, 25, 0.85)';
        } else {
            ctx.fillStyle = wMeta.bg;
        }
        drawRoundedRect(x, cellY, cellW, cellH, 4);
        ctx.fill();

        if (isCurrent) {
            // Progress fill inside current cell
            ctx.save();
            ctx.beginPath();
            ctx.rect(x, cellY, cellW * waveProgress, cellH);
            ctx.clip();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            drawRoundedRect(x, cellY, cellW, cellH, 4);
            ctx.fill();
            ctx.restore();

            // Glowing border
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.shadowColor = '#fff';
            ctx.shadowBlur = 6;
            drawRoundedRect(x, cellY, cellW, cellH, 4);
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        // Wave number
        ctx.fillStyle = isPast ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.35)';
        ctx.font = '9px Arial, sans-serif';
        ctx.fillText(`${w}`, x + 3, cellY + 9);

        // Wave type label
        ctx.font = 'bold 12px Arial, sans-serif';
        if (isPast) {
            ctx.fillStyle = 'rgba(100,100,100,0.5)';
        } else if (isCurrent) {
            ctx.fillStyle = '#fff';
        } else {
            ctx.fillStyle = wMeta.color;
        }
        ctx.fillText(wMeta.label, x + 7, cellY + cellH / 2 + 2);
    }

    // Small triangle marker pointing down at the current wave
    const markerCenterX = scrollOffset + (currentWave - 1) * cellStep + cellW / 2;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(markerCenterX - 5, barY + 1);
    ctx.lineTo(markerCenterX + 5, barY + 1);
    ctx.lineTo(markerCenterX, barY + 6);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
    ctx.textBaseline = 'alphabetic';
}

// Draw hover preview on top of everything (except HUD/wave bar)
function drawHoverPreview() {
    if (!hoverCell || gameOver) return;
    const hx = hoverCell.x * GRID_SIZE;
    const hy = hoverCell.y * GRID_SIZE;

    // Check if all 4 cells of the 2x2 block are open
    let allOpen = selectedTowerType ? true : false;
    if (selectedTowerType) {
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++) {
                const cx = hoverCell.x + dx, cy = hoverCell.y + dy;
                if (cx >= COLS || cy >= ROWS || grid[cy][cx] !== 0) allOpen = false;
            }
    }

    if (allOpen) {
        const placeCost = TOWER_TYPES[selectedTowerType].cost;
        if (money >= placeCost) {
            ctx.fillStyle = 'rgba(76, 175, 80, 0.25)';
            ctx.strokeStyle = 'rgba(76, 175, 80, 0.6)';
        } else {
            ctx.fillStyle = 'rgba(200, 50, 50, 0.2)';
            ctx.strokeStyle = 'rgba(200, 50, 50, 0.5)';
        }
        ctx.fillRect(hx, hy, TOWER_PX, TOWER_PX);
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.strokeRect(hx + 1, hy + 1, TOWER_PX - 2, TOWER_PX - 2);
        ctx.setLineDash([]);

        // Range preview circle centered on 2x2 block
        if (money >= placeCost) {
            const previewRange = TOWER_TYPES[selectedTowerType].levels[0].range;
            ctx.beginPath();
            ctx.arc(hx + TOWER_PX / 2, hy + TOWER_PX / 2, previewRange, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255, 220, 50, 0.25)';
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    } else {
        // Highlight existing tower's 2x2 area on hover
        const ownerTower = towers.find(t =>
            hoverCell.x >= t.gridX && hoverCell.x < t.gridX + 2 &&
            hoverCell.y >= t.gridY && hoverCell.y < t.gridY + 2);
        if (ownerTower) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(ownerTower.gridX * GRID_SIZE, ownerTower.gridY * GRID_SIZE, TOWER_PX, TOWER_PX);
        }
    }
}

// ==========================================
// Enemy class
// ==========================================
class Enemy {
    constructor(type = 'normal', isBoss = false) {
        this.type = type;
        const typeDef = ENEMY_TYPES[type];
        this.alive = true;
        this.pendingDeath = false;
        this.spawnDirection = Math.random() < 0.5 ? 'top' : 'left';
        this.start = openings[this.spawnDirection];
        this.goal = openings[this.spawnDirection].goal;
        // Spawn at center of the wider opening
        if (this.spawnDirection === 'top') {
            this.x = topOpening * GRID_SIZE + (TOP_OPENING_W * GRID_SIZE) / 2;
            this.y = GRID_SIZE; // center of border depth
        } else {
            this.x = GRID_SIZE;
            this.y = leftOpening * GRID_SIZE + (SIDE_OPENING_H * GRID_SIZE) / 2;
        }
        this.isBoss = isBoss;

        // HP scales with level and type
        const baseHP = isBoss ? (500 + level * 50) : (50 + level * 5);
        this.maxHealth = Math.floor(baseHP * typeDef.hpMult);
        this.health = this.maxHealth;

        // Speed scales with level and type (capped so enemies can't outrun projectiles)
        this.speed = (1 + Math.min(Math.floor(level / 5) * 0.2, 1.5)) * typeDef.speedMult;
        if (isBoss) this.speed *= 0.6;
        this.baseSpeed = this.speed;

        // Size
        const baseSize = isBoss ? 40 : 20;
        this.size = typeDef.sizeMult ? Math.floor(baseSize * typeDef.sizeMult) : baseSize;

        // Rewards
        this.goldReward = isBoss ? (50 + level * 5) : typeDef.gold;
        this.scoreReward = isBoss ? (100 + level * 10) : typeDef.score;

        this.leakDamage = isBoss ? 5 : 1;
        this.angle = 0;
        this.slowTimer = 0;
        this.slowFactor = 0;
        this.stunTimer = 0;

        // Type-specific properties
        this.slowImmune = typeDef.slowImmune || false;
        this.armor = typeDef.armor ? Math.floor(2 + level * 0.5) : 0;
        this.spawnsOnDeath = typeDef.spawnsOnDeath || 0;
        this.isFlying = typeDef.flying || false;
        this.isChild = false;

        // Flying enemies go straight to exit, ignoring maze
        if (this.isFlying) {
            // Fly to center of exit opening
            if (this.spawnDirection === 'top') {
                this.flyTargetX = bottomOpening * GRID_SIZE + (TOP_OPENING_W * GRID_SIZE) / 2;
                this.flyTargetY = (ROWS - 1) * GRID_SIZE + GRID_SIZE;
            } else {
                this.flyTargetX = (COLS - 1) * GRID_SIZE + GRID_SIZE;
                this.flyTargetY = rightOpening * GRID_SIZE + (SIDE_OPENING_H * GRID_SIZE) / 2;
            }
            this.path = []; // empty path — uses fly logic
            this.pathIndex = 0;
        } else {
            this.path = aStar(this.start, this.goal);
            this.pathIndex = 0;
        }

        if (!this.isFlying && this.path.length === 0) console.log(`Enemy spawned with no path: ${this.spawnDirection}`);
    }

    update() {
        if (!this.alive || !gameStarted || gamePaused) return;

        // Stun: skip all movement
        if (this.stunTimer > 0) {
            this.stunTimer--;
            return;
        }

        // Flying enemy movement — straight line to exit
        if (this.isFlying) {
            // Handle slow effect (if not immune)
            if (this.slowTimer > 0 && !this.slowImmune) {
                this.slowTimer--;
                this.speed = this.baseSpeed * (1 - this.slowFactor);
                if (this.slowTimer === 0) {
                    this.speed = this.baseSpeed;
                    this.slowFactor = 0;
                }
            }

            const dx = this.flyTargetX - this.x;
            const dy = this.flyTargetY - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < this.speed) {
                // Reached exit — leak
                baseHealth -= this.leakDamage;
                despawnEnemy(this);
                if (baseHealth <= 0) gameOver = true;
            } else {
                this.x += (dx / distance) * this.speed;
                this.y += (dy / distance) * this.speed;
                this.angle = Math.atan2(dy, dx);
            }
            return;
        }

        // Non-flying path following
        if (this.pathIndex >= this.path.length) {
            if (Math.abs(this.x - this.goal.x * GRID_SIZE - GRID_SIZE / 2) < this.speed &&
                Math.abs(this.y - this.goal.y * GRID_SIZE - GRID_SIZE / 2) < this.speed) {
                baseHealth -= this.leakDamage;
                despawnEnemy(this);
                if (baseHealth <= 0) gameOver = true;
            }
            return;
        }

        // Handle slow effect (skip if slow immune)
        if (this.slowTimer > 0 && !this.slowImmune) {
            this.slowTimer--;
            this.speed = this.baseSpeed * (1 - this.slowFactor);
            if (this.slowTimer === 0) {
                this.speed = this.baseSpeed;
                this.slowFactor = 0;
            }
        }

        let target = this.path[this.pathIndex];
        let tx = target.x * GRID_SIZE + GRID_SIZE / 2;
        let ty = target.y * GRID_SIZE + GRID_SIZE / 2;
        let dx = tx - this.x;
        let dy = ty - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.speed) {
            this.x = tx;
            this.y = ty;
            this.pathIndex++;
        } else {
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
            this.angle = Math.atan2(dy, dx);
        }
    }

    draw() {
        const r = this.size / 2;
        if (this.type === 'spawn' && !this.isBoss) {
            const pulse = 0.15 + Math.sin(frameNow * 0.006) * 0.1;
            ctx.fillStyle = `rgba(200, 170, 50, ${pulse})`;
            ctx.beginPath();
            ctx.arc(this.x, this.y, r + 4, 0, Math.PI * 2);
            ctx.fill();
        }

        const sprite = buildEnemyCoreSprite(this.type, this.isBoss, this.isChild, this.size);
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(this.angle);
        ctx.drawImage(sprite.canvas, -sprite.center, -sprite.center);
        ctx.restore();

        if (this.slowTimer > 0) {
            ctx.fillStyle = 'rgba(100, 200, 255, 0.25)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, r + 2, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this === selectedEnemy) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(this.x, this.y, r + 4, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Health bar
        const hbW = this.size + 4;
        const hbH = 3;
        const hbX = this.x - hbW / 2;
        const hbY = this.y - r - (this.isFlying ? 10 : 8);
        const hp = this.health / this.maxHealth;

        ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.fillRect(hbX, hbY, hbW, hbH);

        if (hp > 0) {
            ctx.fillStyle = hp > 0.5 ? '#44aa44' : hp > 0.25 ? '#ddaa44' : '#dd4444';
            ctx.fillRect(hbX, hbY, hbW * hp, hbH);
        }

        ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
        ctx.lineWidth = 0.5;
        ctx.strokeRect(hbX, hbY, hbW, hbH);

        // Slow snowflake indicator
        if (this.slowTimer > 0) {
            ctx.fillStyle = '#80e0f0';
            ctx.font = '9px Arial';
            ctx.textAlign = 'center';
            ctx.fillText('*', this.x, hbY - 2);
            ctx.textAlign = 'start';
        }

        // Stun indicator — spinning stars
        if (this.stunTimer > 0) {
            const starCount = 3;
            const orbit = r + 6;
            const spin = frameNow * 0.005;
            ctx.fillStyle = '#ffe040';
            ctx.font = 'bold 9px Arial';
            ctx.textAlign = 'center';
            for (let i = 0; i < starCount; i++) {
                const sa = spin + (i / starCount) * Math.PI * 2;
                const sx = this.x + Math.cos(sa) * orbit;
                const sy = this.y - r * 0.3 + Math.sin(sa) * (orbit * 0.4);
                ctx.fillText('\u2729', sx, sy);
            }
            ctx.textAlign = 'start';
        }
    }
}

// ==========================================
// Projectile class
// ==========================================
class Projectile {
    constructor(x, y, target, damage, type = 'pellet') {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = damage;
        this.type = type;
        this.size = 5;

        const typeDef = TOWER_TYPES[this.type];
        this.speed = typeDef.projectileSpeed;
        this.color = typeDef.projectileColor;
        this.splashRadius = typeDef.splashRadius;

        // Frost slow properties, splash override (set by tower after creation)
        this.slowFactor = 0;
        this.slowDuration = 0;
        this.alive = true;
    }

    update() {
        if (!this.alive || !gameStarted || gamePaused) return;

        // Guard: target already dead
        if (!this.target || !this.target.alive) {
            removeProjectile(this);
            return;
        }

        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const distanceSq = dx * dx + dy * dy;
        const speedSq = this.speed * this.speed;

        if (distanceSq < speedSq) {
            // Apply armor damage reduction
            const actualDamage = this.target.armor > 0
                ? Math.max(1, this.damage - this.target.armor)
                : this.damage;

            // Primary hit
            this.target.health -= actualDamage;
            if (this.target.health <= 0) {
                queueEnemyDeath(this.target);
            }

            // Splash damage (Squirt)
            if (this.type === 'squirt' && this.splashRadius > 0) {
                const baseSplash = Math.floor(this.damage * 0.5);
                const splashRadiusSq = this.splashRadius * this.splashRadius;
                for (let enemy of enemies) {
                    if (!enemy.alive || enemy === this.target) continue;
                    const sdx = enemy.x - this.target.x;
                    const sdy = enemy.y - this.target.y;
                    const sdistSq = sdx * sdx + sdy * sdy;
                    if (sdistSq <= splashRadiusSq) {
                        const splashActual = enemy.armor > 0
                            ? Math.max(1, baseSplash - enemy.armor)
                            : baseSplash;
                        enemy.health -= splashActual;
                        if (enemy.health <= 0) {
                            queueEnemyDeath(enemy);
                        }
                    }
                }
            }

            // Slow effect (Frost) — skip if target is slow immune
            if (this.type === 'frost' && this.target.alive && this.target.health > 0 && !this.target.slowImmune) {
                if (!this.target.slowTimer || this.target.slowFactor < this.slowFactor) {
                    this.target.slowFactor = this.slowFactor;
                }
                this.target.slowTimer = Math.max(this.target.slowTimer, this.slowDuration);
            }

            removeProjectile(this);
        } else {
            const distance = Math.sqrt(distanceSq);
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
        }
    }

    draw() {
        if (!this.alive || !this.target || !this.target.alive) return;

        const angle = Math.atan2(this.target.y - this.y, this.target.x - this.x);
        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.rotate(angle);

        switch (this.type) {
            case 'pellet':
                // Small green circle
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(0, 0, 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.5)';
                ctx.beginPath();
                ctx.arc(0.5, -0.5, 1, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'squirt':
                // Blue teardrop
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.moveTo(5, 0);
                ctx.quadraticCurveTo(0, -4, -4, 0);
                ctx.quadraticCurveTo(0, 4, 5, 0);
                ctx.fill();
                ctx.fillStyle = 'rgba(255,255,255,0.35)';
                ctx.beginPath();
                ctx.arc(1, -1, 1.5, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'dart':
                // Dark dart with orange tip
                ctx.fillStyle = '#333';
                ctx.beginPath();
                ctx.moveTo(5, 0);
                ctx.lineTo(-3, -2.5);
                ctx.lineTo(-1, 0);
                ctx.lineTo(-3, 2.5);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.arc(4, 0, 1.5, 0, Math.PI * 2);
                ctx.fill();
                break;

            case 'swarm':
                // Small purple triangle
                ctx.fillStyle = this.color;
                ctx.beginPath();
                ctx.moveTo(4, 0);
                ctx.lineTo(-3, -2);
                ctx.lineTo(-3, 2);
                ctx.closePath();
                ctx.fill();
                break;

            case 'frost':
                // Cyan diamond/crystal
                ctx.fillStyle = this.color;
                ctx.globalAlpha = 0.8;
                ctx.beginPath();
                ctx.moveTo(4, 0);
                ctx.lineTo(0, -3);
                ctx.lineTo(-4, 0);
                ctx.lineTo(0, 3);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = 0.5;
                ctx.beginPath();
                ctx.arc(0, 0, 1.5, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1.0;
                break;
        }

        ctx.restore();
    }
}

// ==========================================
// Tower class
// ==========================================
class Tower {
    constructor(x, y, type = 'pellet') {
        this.type = type;
        this.gridX = Math.floor(x / GRID_SIZE);
        this.gridY = Math.floor(y / GRID_SIZE);
        // Center of the 2x2 block
        this.x = this.gridX * GRID_SIZE + TOWER_PX / 2;
        this.y = this.gridY * GRID_SIZE + TOWER_PX / 2;

        const typeDef = TOWER_TYPES[this.type];
        const stats = typeDef.levels[0];
        this.range = stats.range;
        this.damage = stats.damage;
        this.fireRate = stats.fireRate;
        this.cooldown = 0;
        this.level = 1;
        this.angle = 0;
        this.totalCost = typeDef.cost;
        this.upgradeTimer = 0;
        this.upgradeTotal = 0;
        this.pendingLevel = null;
        // Mark all 4 cells as blocked
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
                grid[this.gridY + dy][this.gridX + dx] = 1;
        markBoardVisualDirty();
    }

    upgrade() {
        const typeDef = TOWER_TYPES[this.type];
        if (this.level >= MAX_TOWER_LEVEL) return;
        if (this.upgradeTimer > 0) return; // already upgrading
        const nextLevel = typeDef.levels[this.level];
        const upgradeCost = nextLevel.upgradeCost;
        if (money < upgradeCost) return;

        // Pay cost immediately, start upgrade timer
        money -= upgradeCost;
        this.totalCost += upgradeCost;
        this.pendingLevel = nextLevel;
        // Delay scales with level
        const delays = [60, 90, 120, 150, 210];
        const delay = delays[Math.min(this.level - 1, delays.length - 1)];
        this.upgradeTimer = delay;
        this.upgradeTotal = delay;
        updateTowerPanel();
    }

    completeUpgrade() {
        if (!this.pendingLevel) return;
        if (this.level >= MAX_TOWER_LEVEL) { this.pendingLevel = null; return; }
        this.level++;
        this.damage = this.pendingLevel.damage;
        this.range = this.pendingLevel.range;
        this.fireRate = this.pendingLevel.fireRate;
        this.pendingLevel = null;
        this.upgradeTimer = 0;
        this.upgradeTotal = 0;
        updateTowerPanel();
    }

    sell() {
        const sellValue = gameStarted ? Math.floor(this.totalCost * 0.6) : this.totalCost;
        money += sellValue;
        // Release all 4 cells
        for (let dy = 0; dy < 2; dy++)
            for (let dx = 0; dx < 2; dx++)
                grid[this.gridY + dy][this.gridX + dx] = 0;
        invalidatePathCache();
        markBoardVisualDirty();
        towers = towers.filter(t => t !== this);
        selectedTower = null;
        towerPanel.style.display = 'none';
        // No repath on sell — existing paths are still valid (cells only opened, not blocked)
    }

    update() {
        if (!gameStarted || gamePaused) return;

        // Upgrade in progress — count down and don't fire
        if (this.upgradeTimer > 0) {
            this.upgradeTimer--;
            if (this.upgradeTimer === 0) {
                this.completeUpgrade();
            }
            return;
        }

        if (this.cooldown > 0) this.cooldown--;

        const typeDef = TOWER_TYPES[this.type];
        const levelStats = typeDef.levels[this.level - 1];
        const isMelee = !!typeDef.melee;
        const isMultiTarget = !!typeDef.multiTarget;
        const swarmAirOnly = this.type === 'swarm';
        const rangeSq = this.range * this.range;

        let nearestEnemy = null;
        let nearestDistSq = Infinity;
        const meleeTargets = isMelee ? [] : null;
        const multiTargets = isMultiTarget ? [] : null;
        const multiLimit = isMultiTarget ? (levelStats.targets || 1) : 0;

        for (let i = 0; i < enemies.length; i++) {
            const enemy = enemies[i];
            if (!enemy.alive) continue;
            if (swarmAirOnly && !enemy.isFlying) continue;
            if (isMelee && enemy.isFlying) continue;

            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const distSq = dx * dx + dy * dy;
            if (distSq > rangeSq) continue;

            if (distSq < nearestDistSq) {
                nearestDistSq = distSq;
                nearestEnemy = enemy;
            }

            if (isMelee) {
                meleeTargets.push(enemy);
                continue;
            }

            if (isMultiTarget) {
                let insertAt = multiTargets.length;
                while (insertAt > 0 && distSq < multiTargets[insertAt - 1].distSq) {
                    insertAt--;
                }
                if (insertAt < multiLimit) {
                    multiTargets.splice(insertAt, 0, { enemy, distSq });
                    if (multiTargets.length > multiLimit) {
                        multiTargets.length = multiLimit;
                    }
                }
            }
        }

        if (nearestEnemy) {
            this.angle = Math.atan2(
                nearestEnemy.y - this.y,
                nearestEnemy.x - this.x
            );

            if (this.cooldown === 0) {
                if (isMelee) {
                    // Bash: melee AoE — damage all enemies in range instantly
                    for (const enemy of meleeTargets) {
                        const actualDamage = enemy.armor > 0
                            ? Math.max(1, this.damage - enemy.armor)
                            : this.damage;
                        enemy.health -= actualDamage;
                        if (enemy.health <= 0) {
                            queueEnemyDeath(enemy);
                            continue;
                        }
                        // Stun chance
                        if (Math.random() < levelStats.stunChance) {
                            enemy.stunTimer = levelStats.stunDuration;
                        }
                    }
                    // Track shockwave animation
                    this.bashFlashTimer = 10;
                } else if (isMultiTarget) {
                    // Multi-target: fire at nearest valid targets (up to per-level limit)
                    for (let i = 0; i < multiTargets.length; i++) {
                        projectiles.push(new Projectile(
                            this.x, this.y,
                            multiTargets[i].enemy,
                            this.damage,
                            this.type
                        ));
                    }
                } else {
                    // Single target
                    const proj = new Projectile(
                        this.x, this.y,
                        nearestEnemy,
                        this.damage,
                        this.type
                    );
                    // Pass frost slow values from current level
                    if (this.type === 'frost') {
                        proj.slowFactor = levelStats.slowFactor;
                        proj.slowDuration = levelStats.slowDuration;
                    }
                    // Per-level splash radius override (e.g. Typhoon)
                    if (this.type === 'squirt' && levelStats.splashRadius) {
                        proj.splashRadius = levelStats.splashRadius;
                    }
                    projectiles.push(proj);
                }
                playSound(this.type);
                this.cooldown = this.fireRate;
            }
        }

        // Decay bash flash timer
        if (this.bashFlashTimer > 0) this.bashFlashTimer--;
    }

    draw() {
        const cx = this.x;
        const cy = this.y;
        const gs = TOWER_PX;
        const gx = this.gridX * GRID_SIZE;
        const gy = this.gridY * GRID_SIZE;
        const typeDef = TOWER_TYPES[this.type];

        // Range indicator
        if (this === selectedTower) {
            ctx.beginPath();
            ctx.arc(cx, cy, this.range, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 220, 50, 0.08)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 220, 50, 0.5)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Dashed border
        ctx.strokeStyle = 'rgba(40, 40, 40, 0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.strokeRect(gx + 2, gy + 2, gs - 4, gs - 4);
        ctx.setLineDash([]);

        // Type color by level
        const color = typeDef.colors.ring[this.level - 1];

        // Evolution glow for max-level towers
        if (this.level >= MAX_TOWER_LEVEL) {
            const pulse = 0.15 + Math.sin(frameNow * 0.003) * 0.08;
            ctx.fillStyle = `rgba(255, 224, 100, ${pulse})`;
            ctx.beginPath();
            ctx.arc(cx, cy, gs * 0.46, 0, Math.PI * 2);
            ctx.fill();
        }

        // Cached static tower core
        const coreSprite = getTowerCoreSprite(this.type, this.level);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(this.angle);
        ctx.drawImage(coreSprite.canvas, -coreSprite.center, -coreSprite.center);
        ctx.restore();

        // Dynamic direction-dependent overlays
        const cosA = Math.cos(this.angle);
        const sinA = Math.sin(this.angle);

        // Bash shockwave effect
        if (typeDef.melee && this.bashFlashTimer > 0) {
            const progress = 1 - (this.bashFlashTimer / 10);
            const waveR = this.range * progress;
            const alpha = 0.4 * (1 - progress);
            ctx.strokeStyle = `rgba(224, 160, 64, ${alpha})`;
            ctx.lineWidth = 3 * (1 - progress) + 1;
            ctx.beginPath();
            ctx.arc(cx, cy, waveR, 0, Math.PI * 2);
            ctx.stroke();
            if (this.bashFlashTimer > 7) {
                ctx.fillStyle = `rgba(255, 200, 80, ${0.3 * (this.bashFlashTimer - 7) / 3})`;
                ctx.beginPath();
                ctx.arc(cx, cy, this.range * 0.3, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Muzzle flash (skip for melee towers)
        if (!typeDef.melee && this.cooldown > this.fireRate - 4) {
            const flashLens = { pellet: 0.52, squirt: 0.40, dart: 0.38, swarm: 0.30, frost: 0.33 };
            const flashLen = gs * (flashLens[this.type] || 0.45);
            const tipX = cx + cosA * flashLen;
            const tipY = cy + sinA * flashLen;
            ctx.fillStyle = 'rgba(255, 200, 50, 0.6)';
            ctx.beginPath();
            ctx.arc(tipX, tipY, 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = 'rgba(255, 255, 200, 0.8)';
            ctx.beginPath();
            ctx.arc(tipX, tipY, 3, 0, Math.PI * 2);
            ctx.fill();
        }

        // Level pips (type-colored)
        const pipDist = gs * 0.45;
        const pipSpacing = this.level > 3 ? 0.5 : 0.8;
        for (let i = 0; i < this.level; i++) {
            const pipAngle = -Math.PI / 2 + (i - (this.level - 1) / 2) * pipSpacing;
            const ppx = cx + Math.cos(pipAngle) * pipDist;
            const ppy = cy + Math.sin(pipAngle) * pipDist;
            if (this.level >= MAX_TOWER_LEVEL) {
                ctx.fillStyle = 'rgba(255, 224, 100, 0.4)';
                ctx.beginPath();
                ctx.arc(ppx, ppy, 4, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(ppx, ppy, 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Upgrade progress indicator
        if (this.upgradeTimer > 0 && this.upgradeTotal > 0) {
            const progress = 1 - (this.upgradeTimer / this.upgradeTotal);
            ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
            ctx.fillRect(gx, gy, gs, gs);
            ctx.strokeStyle = '#ffcc00';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, gs * 0.35, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
            ctx.stroke();
            ctx.fillStyle = '#ffcc00';
            ctx.font = 'bold 10px Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(`${Math.floor(progress * 100)}%`, cx, cy);
            ctx.textAlign = 'start';
            ctx.textBaseline = 'alphabetic';
        }
    }
}

// Determine wave enemy type based on level
function getWaveType(lvl) {
    if (lvl % 10 === 0) return 'boss';
    if (lvl <= 5) return 'normal';
    // Fixed introduction schedule
    const introWaves = { 6: 'group', 7: 'fast', 8: 'normal', 9: 'immune',
        11: 'flying', 12: 'fast', 13: 'spawn', 14: 'dark', 15: 'group',
        16: 'normal', 17: 'flying', 18: 'fast', 19: 'immune' };
    if (introWaves[lvl]) return introWaves[lvl];
    // Rotating types for waves 21+
    const rotation = ['normal', 'group', 'fast', 'immune', 'spawn', 'flying', 'dark'];
    return rotation[(lvl - 21) % rotation.length];
}

// Get enemy count for wave type and level
function getWaveCount(type, lvl) {
    switch (type) {
        case 'group': return 12 + Math.floor(lvl / 5);
        case 'fast':  return 4 + Math.floor(lvl / 10);
        default:      return 5 + Math.floor(lvl / 10);
    }
}

// Wave spawning function
function spawnWave() {
    if (gameOver || !gameStarted) return;
    waveTimer = WAVE_DELAY;
    waveJustCleared = false;

    const waveType = getWaveType(level);
    currentWaveType = waveType;

    if (waveType === 'boss') {
        // Boss gets a random type trait
        const bossTypes = ['normal', 'fast', 'immune', 'spawn', 'dark', 'flying'];
        const bossVariant = bossTypes[Math.floor(Math.random() * bossTypes.length)];
        currentWaveType = 'boss';
        enemies.push(new Enemy(bossVariant, true));
    } else {
        const count = getWaveCount(waveType, level);
        const spawnDelay = waveType === 'group' ? 300 : 500;
        for (let i = 0; i < count; i++) {
            setTimeout(() => {
                if (!gameOver) enemies.push(new Enemy(waveType, false));
            }, i * spawnDelay);
        }
    }
    level++;
}

// Reset game function
function resetGame() {
    enemies = [];
    towers = [];
    projectiles = [];
    pendingEnemyDeaths = [];
    enemyListDirty = false;
    projectileListDirty = false;
    money = 1000;
    score = 0;
    baseHealth = 20;
    gameOver = false;
    level = 1;
    selectedTower = null;
    gameStarted = false;
    gamePaused = false;
    waveTimer = 0;
    difficulty = difficultySelect.value;
    WAVE_DELAY = DIFFICULTY_LEVELS[difficulty];
    waveJustCleared = false;
    currentWaveType = 'normal';
    selectedEnemy = null;
    floatingTexts = [];
    grid = Array(ROWS).fill().map(() => Array(COLS).fill(0));
    setupBorders();
    invalidatePathCache();
    markBoardVisualDirty();
    towerPanel.style.display = 'none';
    startButton.disabled = false;
    nextWaveButton.disabled = true;
    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause';
}

// Show tower preview on hover (before placing)
function showTowerPreview(type) {
    if (selectedTower) return; // don't override selected tower info
    const typeDef = TOWER_TYPES[type];
    const stats = typeDef.levels[0];

    towerPanel.style.display = 'block';
    upgradeButton.style.display = 'none';
    sellButton.style.display = 'none';
    towerPanelTitle.textContent = typeDef.name + ' Tower';

    // Human-readable fire speed
    const speed = stats.fireRate <= 30 ? 'Fast' : stats.fireRate <= 50 ? 'Medium' : 'Slow';

    let statsHtml = `
        <span style="color:#aaa;font-style:italic">${typeDef.description}</span><br>
        <span style="color:#ffcc00">Cost: $${typeDef.cost}</span><br>
        Damage: ${stats.damage}<br>
        Range: ${stats.range}<br>
        Speed: ${speed}
    `;

    if (type === 'squirt') {
        statsHtml += `<br>Splash: ${typeDef.splashRadius}px`;
    }
    if (type === 'frost') {
        statsHtml += `<br>Slow: ${Math.round(stats.slowFactor * 100)}%`;
    }
    if (type === 'swarm') {
        statsHtml += `<br>Targets: ${stats.targets} (air only)`;
    }
    if (type === 'bash') {
        statsHtml += `<br>Stun: ${Math.round(stats.stunChance * 100)}%`;
        statsHtml += `<br>Melee AoE`;
    }

    if (typeDef.evolutionName) {
        statsHtml += `<br><span style="color:#ffe080;font-size:11px">Evolves to ${typeDef.evolutionName} at Lv${MAX_TOWER_LEVEL}</span>`;
    }

    towerStats.innerHTML = statsHtml;
}

// Update tower panel
function updateTowerPanel() {
    if (!selectedTower) {
        towerPanel.style.display = 'none';
        return;
    }
    towerPanel.style.display = 'block';
    upgradeButton.style.display = '';
    sellButton.style.display = '';
    resetSellConfirm();

    const typeDef = TOWER_TYPES[selectedTower.type];
    const displayName = selectedTower.level >= MAX_TOWER_LEVEL && typeDef.evolutionName
        ? typeDef.evolutionName : typeDef.name;
    towerPanelTitle.textContent = displayName + ' Tower';

    const lvlStats = typeDef.levels[selectedTower.level - 1];
    const currentSplash = lvlStats.splashRadius || typeDef.splashRadius;

    let statsHtml = `
        Level: ${selectedTower.level}/${MAX_TOWER_LEVEL}<br>
        Damage: ${selectedTower.damage}<br>
        Range: ${selectedTower.range}<br>
        Fire Rate: ${selectedTower.fireRate} frames<br>
        Total Cost: $${selectedTower.totalCost}<br>
        Sell Value: $${gameStarted ? Math.floor(selectedTower.totalCost * 0.6) : selectedTower.totalCost}
    `;

    if (selectedTower.type === 'squirt') {
        statsHtml += `<br>Splash: ${currentSplash}px`;
    }
    if (selectedTower.type === 'frost') {
        statsHtml += `<br>Slow: ${Math.round(lvlStats.slowFactor * 100)}% for ${(lvlStats.slowDuration / 60).toFixed(1)}s`;
    }
    if (selectedTower.type === 'swarm') {
        statsHtml += `<br>Targets: ${lvlStats.targets}`;
    }
    if (selectedTower.type === 'bash') {
        statsHtml += `<br>Stun: ${Math.round(lvlStats.stunChance * 100)}% for ${(lvlStats.stunDuration / 60).toFixed(1)}s`;
        statsHtml += `<br>Melee AoE`;
    }

    towerStats.innerHTML = statsHtml;

    if (selectedTower.upgradeTimer > 0) {
        const pct = Math.floor((1 - selectedTower.upgradeTimer / selectedTower.upgradeTotal) * 100);
        upgradeButton.textContent = `Upgrading... ${pct}%`;
        upgradeButton.disabled = true;
    } else if (selectedTower.level < MAX_TOWER_LEVEL) {
        const nextUpgradeCost = typeDef.levels[selectedTower.level].upgradeCost;
        if (selectedTower.level === MAX_TOWER_LEVEL - 1 && typeDef.evolutionName) {
            upgradeButton.textContent = `Evolve to ${typeDef.evolutionName} ($${nextUpgradeCost})`;
        } else {
            upgradeButton.textContent = `Upgrade ($${nextUpgradeCost})`;
        }
        upgradeButton.disabled = money < nextUpgradeCost;
    } else {
        upgradeButton.textContent = 'Max Level';
        upgradeButton.disabled = true;
    }
}

// ==========================================
// Game loop
// ==========================================
function gameLoop(timestamp) {
    frameNow = timestamp || performance.now();
    if (gameOver) {
        drawBoard();
        for (let tower of towers) tower.draw();
        drawHUD();
        if (level === 100 && enemies.length === 0) {
            drawOverlayMessage('You Win!', `Final Score: ${score}`, '#4CAF50');
        } else {
            drawOverlayMessage('Game Over', `Score: ${score}`, '#f44336');
        }
        return;
    }

    drawBoard();

    for (let enemy of enemies) {
        if (!enemy.alive) continue;
        enemy.update();
        if (enemy.alive) enemy.draw();
    }

    for (let tower of towers) {
        tower.update();
        tower.draw();
    }

    // Resolve melee/splash deaths from tower phase before projectile phase.
    processPendingEnemyDeaths();
    compactAliveEntities();

    for (let projectile of projectiles) {
        if (!projectile.alive) continue;
        projectile.update();
        if (projectile.alive) projectile.draw();
    }

    processPendingEnemyDeaths();
    compactAliveEntities();

    // Hover preview drawn on top of enemies/towers/projectiles
    drawHoverPreview();

    // Floating text
    if (!gamePaused) updateFloatingTexts();
    drawFloatingTexts();

    // Selected enemy info tooltip
    drawEnemyInfo();

    // Update wave timer
    if (gameStarted && !gamePaused && waveTimer > 0) {
        waveTimer -= 1 / 60;
        if (waveTimer <= 0 && level < 100) {
            spawnWave();
        }
    }

    // Save game state once when wave clears
    if (gameStarted && enemies.length === 0 && level < 100 && db && !waveJustCleared) {
        saveGameState();
        waveJustCleared = true;
    }

    // Check for win condition
    if (level === 100 && enemies.length === 0) {
        gameOver = true;
        startButton.disabled = true;
        nextWaveButton.disabled = true;
        pauseButton.disabled = true;
    }

    // Update upgrade button state and panel text during upgrade
    if (selectedTower) {
        const typeDef = TOWER_TYPES[selectedTower.type];
        if (selectedTower.upgradeTimer > 0) {
            upgradeButton.disabled = true;
            const pct = Math.floor((1 - selectedTower.upgradeTimer / selectedTower.upgradeTotal) * 100);
            upgradeButton.textContent = `Upgrading... ${pct}%`;
        } else if (selectedTower.level >= MAX_TOWER_LEVEL) {
            upgradeButton.disabled = true;
        } else {
            upgradeButton.disabled = money < typeDef.levels[selectedTower.level].upgradeCost;
        }
    } else {
        upgradeButton.disabled = true;
    }

    // Update tower selector affordability
    towerTypeButtons.forEach(btn => {
        const typeCost = TOWER_TYPES[btn.dataset.type].cost;
        if (money < typeCost) {
            btn.classList.add('cant-afford');
        } else {
            btn.classList.remove('cant-afford');
        }
    });

    drawHUD();
    drawWaveBar();

    if (!gameStarted && towers.length === 0) {
        drawOverlayMessage('-DesktopTowerDefense-', 'Click "Start Game" to begin', '#ece6d0');
    }

    requestAnimationFrame(gameLoop);
}

// ==========================================
// Event listeners
// ==========================================

// Tower type selector
towerTypeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const type = btn.dataset.type;
        // If tapping the already-selected type, toggle the preview panel
        if (selectedTowerType === type && hoverPreviewType === type) {
            hoverPreviewType = null;
            if (selectedTower) {
                updateTowerPanel();
            } else {
                towerPanel.style.display = 'none';
            }
        } else {
            selectedTowerType = type;
            towerTypeButtons.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            hoverPreviewType = type;
            showTowerPreview(type);
        }
    });
    btn.addEventListener('mouseenter', () => {
        hoverPreviewType = btn.dataset.type;
        showTowerPreview(btn.dataset.type);
    });
    btn.addEventListener('mouseleave', () => {
        hoverPreviewType = null;
        if (selectedTower) {
            updateTowerPanel();
        } else {
            towerPanel.style.display = 'none';
        }
    });
});

// Place or select tower on canvas click
canvas.addEventListener('click', (e) => {
    if (gameOver) return;
    // Suppress click that fires after touchend to avoid double-action
    if (touchActive) { touchActive = false; return; }

    const { x, y } = canvasCoords(e.clientX, e.clientY);
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    if (handleCanvasAction(x, y, gridX, gridY)) {
        e.stopPropagation();
    }
});

// Mouse tracking for hover effect
canvas.addEventListener('mousemove', (e) => {
    const { x, y } = canvasCoords(e.clientX, e.clientY);
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    if (gridX >= BORDER_CELLS && gridX + 1 < COLS - BORDER_CELLS &&
        gridY >= BORDER_CELLS && gridY + 1 < ROWS - BORDER_CELLS) {
        hoverCell = { x: gridX, y: gridY };
    } else {
        hoverCell = null;
    }
});

canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
});

// Update hoverCell from touch coordinates (no offset - direct position)
function updateHoverFromTouch(touch) {
    const { x, y } = canvasCoords(touch.clientX, touch.clientY);
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    if (gridX >= BORDER_CELLS && gridX + 1 < COLS - BORDER_CELLS &&
        gridY >= BORDER_CELLS && gridY + 1 < ROWS - BORDER_CELLS) {
        hoverCell = { x: gridX, y: gridY };
    } else {
        hoverCell = null;
    }
}

function handleCanvasAction(x, y, gridX, gridY) {
    // Shared logic for click/touchend placement and selection
    selectedEnemy = null;
    const inPlayArea = gridX >= BORDER_CELLS && gridX + 1 < COLS - BORDER_CELLS &&
        gridY >= BORDER_CELLS && gridY + 1 < ROWS - BORDER_CELLS;

    if (inPlayArea) {
        for (let tower of towers) {
            if (gridX >= tower.gridX && gridX < tower.gridX + 2 &&
                gridY >= tower.gridY && gridY < tower.gridY + 2) {
                selectedTower = tower;
                updateTowerPanel();
                return true;
            }
        }
    }

    if (selectedTowerType && inPlayArea) {
        const placeCost = TOWER_TYPES[selectedTowerType].cost;
        if (money >= placeCost && canPlaceTower(gridX, gridY)) {
            towers.push(new Tower(gridX * GRID_SIZE, gridY * GRID_SIZE, selectedTowerType));
            money -= placeCost;
            invalidatePathCache();
            enemies.forEach(e => {
                if (!e.alive || e.isFlying) return;
                if (pathIntersectsPlacement(e.path, e.pathIndex, gridX, gridY)) {
                    const cx = Math.floor(e.x / GRID_SIZE);
                    const cy = Math.floor(e.y / GRID_SIZE);
                    e.path = aStar({ x: cx, y: cy }, e.goal);
                    e.pathIndex = 0;
                }
            });
            selectedTower = null;
            towerPanel.style.display = 'none';
            return true;
        }
    }

    // Check enemy selection
    for (let enemy of enemies) {
        if (!enemy.alive) continue;
        const edx = enemy.x - x;
        const edy = enemy.y - y;
        const clickRadius = enemy.size / 2 + 5;
        if (edx * edx + edy * edy <= clickRadius * clickRadius) {
            selectedEnemy = enemy;
            return true;
        }
    }
    return false;
}

// Touch events for mobile tower placement
// UX: touch down → show preview, drag → preview follows, release on canvas → place,
//      drag off valid area → cancel (no placement)
canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    touchActive = true;
    if (gameOver) return;
    const touch = e.touches[0];
    if (selectedTowerType) {
        touchDragging = true;
        updateHoverFromTouch(touch);
    }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    if (gameOver) return;
    const touch = e.touches[0];
    if (touchDragging && selectedTowerType) {
        updateHoverFromTouch(touch);
    }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    touchActive = true;
    if (gameOver) return;
    const touch = e.changedTouches[0];
    const { x, y } = canvasCoords(touch.clientX, touch.clientY);

    if (touchDragging && selectedTowerType && hoverCell) {
        // Place tower at the current hover cell
        handleCanvasAction(x, y, hoverCell.x, hoverCell.y);
    } else if (!touchDragging || !selectedTowerType) {
        // No tower type selected: tap to select existing tower or enemy
        const gridX = Math.floor(x / GRID_SIZE);
        const gridY = Math.floor(y / GRID_SIZE);
        handleCanvasAction(x, y, gridX, gridY);
    }
    // If hoverCell was null (finger dragged off valid area), nothing is placed
    hoverCell = null;
    touchDragging = false;
}, { passive: false });

canvas.addEventListener('touchcancel', (e) => {
    hoverCell = null;
    touchDragging = false;
}, { passive: false });

// Right-click to deselect tower placement mode
canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (selectedTowerType) {
        selectedTowerType = null;
        towerTypeButtons.forEach(b => b.classList.remove('selected'));
    }
});

upgradeButton.addEventListener('click', (e) => {
    if (selectedTower) {
        selectedTower.upgrade();
        e.stopPropagation();
    }
});

let sellConfirmPending = false;
let sellConfirmTimer = null;

function resetSellConfirm() {
    sellConfirmPending = false;
    sellButton.textContent = 'Sell';
    sellButton.style.background = '';
    sellButton.style.borderColor = '';
    if (sellConfirmTimer) { clearTimeout(sellConfirmTimer); sellConfirmTimer = null; }
}

sellButton.addEventListener('click', (e) => {
    if (!selectedTower) return;
    e.stopPropagation();
    if (sellConfirmPending) {
        selectedTower.sell();
        resetSellConfirm();
    } else {
        sellConfirmPending = true;
        sellButton.textContent = 'Confirm?';
        sellButton.style.background = '#882222';
        sellButton.style.borderColor = '#e55';
        // Auto-reset after 2 seconds
        sellConfirmTimer = setTimeout(resetSellConfirm, 2000);
    }
});

startButton.addEventListener('click', () => {
    if (!gameStarted) {
        gameStarted = true;
        startButton.disabled = true;
        nextWaveButton.disabled = false;
        pauseButton.disabled = false;
        spawnWave();
    }
});

resetButton.addEventListener('click', () => {
    resetGame();
});

nextWaveButton.addEventListener('click', () => {
    if (gameStarted) {
        spawnWave();
    }
});

pauseButton.addEventListener('click', () => {
    if (gameStarted && !gameOver) {
        gamePaused = !gamePaused;
        pauseButton.textContent = gamePaused ? 'Resume' : 'Pause';
    }
});

loadButton.addEventListener('click', () => {
    if (db) {
        loadGameState();
    } else {
        console.log('Database not ready yet');
    }
});

difficultySelect.addEventListener('change', () => {
    difficulty = difficultySelect.value;
    WAVE_DELAY = DIFFICULTY_LEVELS[difficulty];
    if (waveTimer > WAVE_DELAY) waveTimer = WAVE_DELAY;
});

document.addEventListener('click', (e) => {
    if (!gameOver && e.target !== canvas && e.target !== upgradeButton && e.target !== sellButton &&
        !e.target.closest('.tower-type-btn')) {
        selectedTower = null;
        selectedEnemy = null;
        towerPanel.style.display = 'none';
        resetSellConfirm();
    }
});

// Start game loop
gameLoop();

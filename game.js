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
};
const towerTypeButtons = document.querySelectorAll('.tower-type-btn');

// Game constants
const GRID_SIZE = 40;
const COLS = Math.floor(canvas.width / GRID_SIZE);
const ROWS = Math.floor(canvas.height / GRID_SIZE);

// Tower type definitions
const TOWER_TYPES = {
    pellet: {
        name: 'Pellet',
        description: 'Fast, cheap basic tower',
        cost: 30,
        levels: [
            { damage: 5,  range: 80,  fireRate: 30, upgradeCost: 0  },
            { damage: 10, range: 90,  fireRate: 25, upgradeCost: 25 },
            { damage: 18, range: 100, fireRate: 20, upgradeCost: 40 },
        ],
        colors: {
            ring: ['#5a8a3a', '#8ab030', '#b0d040'],
            dark: ['#3a6a2a', '#6a8a20', '#8ab028'],
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
        description: 'Splash damage in an area',
        cost: 80,
        levels: [
            { damage: 8,  range: 90,  fireRate: 50, upgradeCost: 0  },
            { damage: 15, range: 100, fireRate: 45, upgradeCost: 60 },
            { damage: 25, range: 115, fireRate: 40, upgradeCost: 90 },
        ],
        colors: {
            ring: ['#2a6a9a', '#3080b0', '#40a0d0'],
            dark: ['#1a4a7a', '#206090', '#3080a8'],
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
        description: 'Slow, powerful, long range',
        cost: 100,
        levels: [
            { damage: 25, range: 140, fireRate: 90, upgradeCost: 0   },
            { damage: 45, range: 170, fireRate: 80, upgradeCost: 80  },
            { damage: 75, range: 200, fireRate: 70, upgradeCost: 120 },
        ],
        colors: {
            ring: ['#aa5030', '#cc6030', '#ee7040'],
            dark: ['#883820', '#aa4820', '#cc5828'],
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
        description: 'Fires at multiple targets',
        cost: 120,
        levels: [
            { damage: 6,  range: 100, fireRate: 50, targets: 2, upgradeCost: 0   },
            { damage: 10, range: 110, fireRate: 45, targets: 3, upgradeCost: 90  },
            { damage: 15, range: 120, fireRate: 40, targets: 4, upgradeCost: 130 },
        ],
        colors: {
            ring: ['#8a5aa0', '#a070b8', '#b888d0'],
            dark: ['#6a3a80', '#805098', '#9868b0'],
        },
        barrelColor: '#8a5aa0',
        projectileColor: '#b888d0',
        projectileSpeed: 5,
        barrelStyle: 'multi',
        splashRadius: 0,
        multiTarget: true,
    },
    frost: {
        name: 'Frost',
        description: 'Slows enemies, low damage',
        cost: 60,
        levels: [
            { damage: 3,  range: 90,  fireRate: 45, slowFactor: 0.4, slowDuration: 90,  upgradeCost: 0  },
            { damage: 5,  range: 105, fireRate: 40, slowFactor: 0.5, slowDuration: 120, upgradeCost: 50 },
            { damage: 8,  range: 120, fireRate: 35, slowFactor: 0.6, slowDuration: 150, upgradeCost: 75 },
        ],
        colors: {
            ring: ['#50a0b0', '#60c0d8', '#80e0f0'],
            dark: ['#3080a0', '#40a0b8', '#50c0d0'],
        },
        barrelColor: '#50a0b0',
        projectileColor: '#80e0f0',
        projectileSpeed: 4,
        barrelStyle: 'cone',
        splashRadius: 0,
        multiTarget: false,
    },
};

// Difficulty settings
const DIFFICULTY_LEVELS = {
    easy: 20,
    normal: 10,
    hard: 5
};

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

// Grid for pathfinding (0 = open, 1 = blocked)
let grid = Array(ROWS).fill().map(() => Array(COLS).fill(0));

// Define openings and set borders
const topOpening = Math.floor(COLS / 2);
const leftOpening = Math.floor(ROWS / 2);
const bottomOpening = Math.floor(COLS / 2);
const rightOpening = Math.floor(ROWS / 2);
for (let x = 0; x < COLS; x++) {
    if (x !== topOpening) grid[0][x] = 1;
}
for (let y = 0; y < ROWS; y++) {
    if (y !== leftOpening) grid[y][0] = 1;
}
for (let x = 0; x < COLS; x++) {
    if (x !== bottomOpening) grid[ROWS - 1][x] = 1;
}
for (let y = 0; y < ROWS; y++) {
    if (y !== rightOpening) grid[y][COLS - 1] = 1;
}

// Entry/exit points
const openings = {
    top: { x: topOpening, y: 0, goal: { x: bottomOpening, y: ROWS - 1 } },
    left: { x: 0, y: leftOpening, goal: { x: COLS - 1, y: rightOpening } }
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
function aStar(start, goal) {
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
            return current.path.concat([{ x: current.x, y: current.y }]);
        }

        let directions = [[0, 1], [1, 0], [0, -1], [-1, 0]];
        for (let [dx, dy] of directions) {
            let nx = current.x + dx, ny = current.y + dy;
            if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS || grid[ny][nx] === 1 || closedSet.has(`${nx},${ny}`)) continue;

            let g = current.g + 1;
            let h = heuristic({ x: nx, y: ny }, goal);
            let f = g + h;
            let newPath = current.path.concat([{ x: current.x, y: current.y }]);
            openSet.push({ x: nx, y: ny, g, h, f, path: newPath });
        }
    }
    return [];
}

// Check if placement blocks all paths
function canPlaceTower(gridX, gridY) {
    if (grid[gridY][gridX] === 1) return false;

    grid[gridY][gridX] = 1;
    const topPath = aStar(openings.top, openings.top.goal);
    const leftPath = aStar(openings.left, openings.left.goal);
    grid[gridY][gridX] = 0;

    if (topPath.length === 0 || leftPath.length === 0) {
        return false;
    }
    return true;
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

function drawArrow(x, y, size, direction) {
    ctx.save();
    ctx.translate(x + GRID_SIZE / 2, y + GRID_SIZE / 2);
    switch (direction) {
        case 'down': ctx.rotate(Math.PI / 2); break;
        case 'up': ctx.rotate(-Math.PI / 2); break;
        case 'right': break;
        case 'left': ctx.rotate(Math.PI); break;
    }
    ctx.beginPath();
    ctx.moveTo(size, 0);
    ctx.lineTo(-size * 0.5, -size * 0.7);
    ctx.lineTo(-size * 0.2, 0);
    ctx.lineTo(-size * 0.5, size * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
}

// Pre-render the static desk background
let deskBgCanvas = null;
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

// Draw the game board
function drawBoard() {
    if (!deskBgCanvas) createDeskBackground();
    ctx.drawImage(deskBgCanvas, 0, 0);

    // Paper play area
    const paperX = GRID_SIZE;
    const paperY = GRID_SIZE;
    const paperW = (COLS - 2) * GRID_SIZE;
    const paperH = (ROWS - 2) * GRID_SIZE;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    ctx.fillRect(paperX + 3, paperY + 3, paperW + 1, paperH + 1);
    ctx.fillStyle = '#ece6d0';
    ctx.fillRect(paperX, paperY, paperW, paperH);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.fillRect(paperX, paperY, paperW, 1);
    ctx.fillRect(paperX, paperY, 1, paperH);

    // Grid lines
    ctx.strokeStyle = 'rgba(160, 150, 130, 0.4)';
    ctx.lineWidth = 0.5;
    for (let x = 2; x < COLS - 1; x++) {
        ctx.beginPath();
        ctx.moveTo(x * GRID_SIZE + 0.5, paperY);
        ctx.lineTo(x * GRID_SIZE + 0.5, paperY + paperH);
        ctx.stroke();
    }
    for (let y = 2; y < ROWS - 1; y++) {
        ctx.beginPath();
        ctx.moveTo(paperX, y * GRID_SIZE + 0.5);
        ctx.lineTo(paperX + paperW, y * GRID_SIZE + 0.5);
        ctx.stroke();
    }

    // Border wall edges
    const towerPositions = new Set(towers.map(t => `${t.gridX},${t.gridY}`));
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === 1 && !towerPositions.has(`${x},${y}`)) {
                const wx = x * GRID_SIZE;
                const wy = y * GRID_SIZE;
                ctx.fillStyle = 'rgba(0, 0, 0, 0.06)';
                ctx.fillRect(wx, wy, GRID_SIZE, 1);
                ctx.fillRect(wx, wy, 1, GRID_SIZE);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
                ctx.fillRect(wx, wy + GRID_SIZE - 1, GRID_SIZE, 1);
                ctx.fillRect(wx + GRID_SIZE - 1, wy, 1, GRID_SIZE);
            }
        }
    }

    // Openings
    ctx.fillStyle = '#ece6d0';
    ctx.fillRect(topOpening * GRID_SIZE, 0, GRID_SIZE, GRID_SIZE);
    ctx.fillRect(bottomOpening * GRID_SIZE, (ROWS - 1) * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    ctx.fillRect(0, leftOpening * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    ctx.fillRect((COLS - 1) * GRID_SIZE, rightOpening * GRID_SIZE, GRID_SIZE, GRID_SIZE);

    ctx.fillStyle = 'rgba(76, 175, 80, 0.6)';
    drawArrow(topOpening * GRID_SIZE, 0, 8, 'down');
    drawArrow(0, leftOpening * GRID_SIZE, 8, 'right');
    ctx.fillStyle = 'rgba(200, 60, 50, 0.5)';
    drawArrow(bottomOpening * GRID_SIZE, (ROWS - 1) * GRID_SIZE, 8, 'down');
    drawArrow((COLS - 1) * GRID_SIZE, rightOpening * GRID_SIZE, 8, 'right');

    // Hover highlight
    if (hoverCell && !gameOver) {
        const hx = hoverCell.x * GRID_SIZE;
        const hy = hoverCell.y * GRID_SIZE;
        if (grid[hoverCell.y][hoverCell.x] === 0) {
            const placeCost = TOWER_TYPES[selectedTowerType].cost;
            if (money >= placeCost) {
                ctx.fillStyle = 'rgba(76, 175, 80, 0.15)';
                ctx.strokeStyle = 'rgba(76, 175, 80, 0.4)';
            } else {
                ctx.fillStyle = 'rgba(200, 50, 50, 0.12)';
                ctx.strokeStyle = 'rgba(200, 50, 50, 0.3)';
            }
            ctx.fillRect(hx, hy, GRID_SIZE, GRID_SIZE);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(hx + 1, hy + 1, GRID_SIZE - 2, GRID_SIZE - 2);
            ctx.setLineDash([]);

            // Range preview circle
            if (money >= placeCost) {
                const previewRange = TOWER_TYPES[selectedTowerType].levels[0].range;
                ctx.beginPath();
                ctx.arc(hx + GRID_SIZE / 2, hy + GRID_SIZE / 2, previewRange, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255, 220, 50, 0.2)';
                ctx.lineWidth = 1;
                ctx.setLineDash([4, 4]);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        } else if (towerPositions.has(`${hoverCell.x},${hoverCell.y}`)) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
            ctx.fillRect(hx, hy, GRID_SIZE, GRID_SIZE);
        }
    }
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

    if (gamePaused && gameStarted) {
        ctx.fillStyle = '#ffff00';
        ctx.fillText('PAUSED', 700, y);
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

// ==========================================
// Enemy class
// ==========================================
class Enemy {
    constructor(isBoss = false) {
        this.spawnDirection = Math.random() < 0.5 ? 'top' : 'left';
        this.start = openings[this.spawnDirection];
        this.goal = openings[this.spawnDirection].goal;
        this.x = this.start.x * GRID_SIZE + GRID_SIZE / 2;
        this.y = this.start.y * GRID_SIZE + GRID_SIZE / 2;
        this.speed = 1 + Math.floor(level / 5) * 0.2;
        this.baseSpeed = this.speed;
        this.isBoss = isBoss;
        this.maxHealth = isBoss ? 500 + level * 50 : 50 + level * 5;
        this.health = this.maxHealth;
        this.size = isBoss ? 40 : 20;
        this.leakDamage = isBoss ? 5 : 1;
        this.path = aStar(this.start, this.goal);
        this.angle = 0;
        this.slowTimer = 0;
        this.slowFactor = 0;
        if (this.path.length === 0) console.log(`Enemy spawned with no path: ${this.spawnDirection}`);
    }

    update() {
        if (!gameStarted || gamePaused || this.path.length === 0) {
            if (this.path.length === 0 && Math.abs(this.x - this.goal.x * GRID_SIZE - GRID_SIZE / 2) < this.speed &&
                Math.abs(this.y - this.goal.y * GRID_SIZE - GRID_SIZE / 2) < this.speed) {
                baseHealth -= this.leakDamage;
                enemies = enemies.filter(e => e !== this);
                if (baseHealth <= 0) gameOver = true;
            }
            return;
        }

        // Handle slow effect
        if (this.slowTimer > 0) {
            this.slowTimer--;
            this.speed = this.baseSpeed * (1 - this.slowFactor);
            if (this.slowTimer === 0) {
                this.speed = this.baseSpeed;
                this.slowFactor = 0;
            }
        }

        let target = this.path[0];
        let tx = target.x * GRID_SIZE + GRID_SIZE / 2;
        let ty = target.y * GRID_SIZE + GRID_SIZE / 2;
        let dx = tx - this.x;
        let dy = ty - this.y;
        let distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.speed) {
            this.x = tx;
            this.y = ty;
            this.path.shift();
        } else {
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
            this.angle = Math.atan2(dy, dx);
        }
    }

    draw() {
        const r = this.size / 2;
        const fwdX = Math.cos(this.angle);
        const fwdY = Math.sin(this.angle);
        const perpX = -Math.sin(this.angle);
        const perpY = Math.cos(this.angle);

        // Drop shadow
        ctx.fillStyle = 'rgba(0, 0, 0, 0.25)';
        ctx.beginPath();
        ctx.arc(this.x + 1, this.y + 1, r + 1, 0, Math.PI * 2);
        ctx.fill();

        // Body colors
        let mainColor, darkColor, accentColor;
        if (this.isBoss) {
            mainColor = '#4a2060';
            darkColor = '#2a1040';
            accentColor = '#7050a0';
        } else {
            mainColor = '#3a3a4a';
            darkColor = '#1a1a2a';
            accentColor = '#5a5a70';
        }

        // Legs
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = 1;
        for (let i = -1; i <= 1; i++) {
            for (let side of [-1, 1]) {
                const legAngle = this.angle + (Math.PI / 2) * side + i * 0.5;
                const bx = this.x + Math.cos(legAngle) * r * 0.3;
                const by = this.y + Math.sin(legAngle) * r * 0.3;
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(bx + Math.cos(legAngle) * r * 0.45, by + Math.sin(legAngle) * r * 0.45);
                ctx.stroke();
            }
        }

        // Body
        const grad = ctx.createRadialGradient(
            this.x - r * 0.2, this.y - r * 0.2, r * 0.1,
            this.x, this.y, r
        );
        grad.addColorStop(0, accentColor);
        grad.addColorStop(0.6, mainColor);
        grad.addColorStop(1, darkColor);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = darkColor;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Segment line
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.3)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(this.x + perpX * r * 0.7, this.y + perpY * r * 0.7);
        ctx.lineTo(this.x - perpX * r * 0.7, this.y - perpY * r * 0.7);
        ctx.stroke();

        // Slow indicator (blue tint)
        if (this.slowTimer > 0) {
            ctx.fillStyle = 'rgba(100, 200, 255, 0.25)';
            ctx.beginPath();
            ctx.arc(this.x, this.y, r + 2, 0, Math.PI * 2);
            ctx.fill();
        }

        // Eyes
        const eyeOffset = r * 0.3;
        const eyeR = r * 0.2;
        const eyeX1 = this.x + fwdX * eyeOffset + perpX * eyeOffset * 0.55;
        const eyeY1 = this.y + fwdY * eyeOffset + perpY * eyeOffset * 0.55;
        const eyeX2 = this.x + fwdX * eyeOffset - perpX * eyeOffset * 0.55;
        const eyeY2 = this.y + fwdY * eyeOffset - perpY * eyeOffset * 0.55;

        ctx.fillStyle = '#ccc';
        ctx.beginPath();
        ctx.arc(eyeX1, eyeY1, eyeR, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(eyeX2, eyeY2, eyeR, 0, Math.PI * 2);
        ctx.fill();

        const po = eyeR * 0.3;
        ctx.fillStyle = '#111';
        ctx.beginPath();
        ctx.arc(eyeX1 + fwdX * po, eyeY1 + fwdY * po, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(eyeX2 + fwdX * po, eyeY2 + fwdY * po, eyeR * 0.55, 0, Math.PI * 2);
        ctx.fill();

        // Boss antennae
        if (this.isBoss) {
            ctx.strokeStyle = darkColor;
            ctx.lineWidth = 2;
            const antLen = r * 0.6;
            for (let side of [-1, 1]) {
                const baseX = this.x + fwdX * r * 0.7 + perpX * side * r * 0.3;
                const baseY = this.y + fwdY * r * 0.7 + perpY * side * r * 0.3;
                const tipAngle = this.angle + side * 0.5;
                const tipX = baseX + Math.cos(tipAngle) * antLen;
                const tipY = baseY + Math.sin(tipAngle) * antLen;
                ctx.beginPath();
                ctx.moveTo(baseX, baseY);
                ctx.quadraticCurveTo(
                    baseX + Math.cos(tipAngle) * antLen * 0.5 + perpX * side * 3,
                    baseY + Math.sin(tipAngle) * antLen * 0.5 + perpY * side * 3,
                    tipX, tipY
                );
                ctx.stroke();
                ctx.fillStyle = '#cc44cc';
                ctx.beginPath();
                ctx.arc(tipX, tipY, 2, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        // Health bar
        const hbW = this.size + 4;
        const hbH = 3;
        const hbX = this.x - hbW / 2;
        const hbY = this.y - r - 8;
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

        // Frost slow properties (set by tower after creation)
        this.slowFactor = 0;
        this.slowDuration = 0;
    }

    update() {
        if (!gameStarted || gamePaused) return;

        // Guard: target already dead
        if (!enemies.includes(this.target)) {
            projectiles = projectiles.filter(p => p !== this);
            return;
        }

        const dx = this.target.x - this.x;
        const dy = this.target.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.speed) {
            // Primary hit
            this.target.health -= this.damage;

            // Splash damage (Squirt)
            if (this.type === 'squirt' && this.splashRadius > 0) {
                const splashDamage = Math.floor(this.damage * 0.5);
                for (let enemy of enemies) {
                    if (enemy === this.target) continue;
                    const sdx = enemy.x - this.target.x;
                    const sdy = enemy.y - this.target.y;
                    const sdist = Math.sqrt(sdx * sdx + sdy * sdy);
                    if (sdist <= this.splashRadius) {
                        enemy.health -= splashDamage;
                    }
                }
            }

            // Slow effect (Frost)
            if (this.type === 'frost' && this.target.health > 0) {
                if (!this.target.slowTimer || this.target.slowFactor < this.slowFactor) {
                    this.target.slowFactor = this.slowFactor;
                }
                this.target.slowTimer = Math.max(this.target.slowTimer, this.slowDuration);
            }

            // Batch death check (handles splash killing multiple enemies)
            const deadEnemies = enemies.filter(e => e.health <= 0);
            if (deadEnemies.length > 0) {
                enemies = enemies.filter(e => e.health > 0);
                money += deadEnemies.length * 5;
                score += deadEnemies.length * 10;
                enemyDeathSound.currentTime = 0;
                enemyDeathSound.play();
            }

            projectiles = projectiles.filter(p => p !== this);
        } else {
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
        }
    }

    draw() {
        if (!enemies.includes(this.target)) return;

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
        this.x = this.gridX * GRID_SIZE + GRID_SIZE / 2;
        this.y = this.gridY * GRID_SIZE + GRID_SIZE / 2;

        const typeDef = TOWER_TYPES[this.type];
        const stats = typeDef.levels[0];
        this.range = stats.range;
        this.damage = stats.damage;
        this.fireRate = stats.fireRate;
        this.cooldown = 0;
        this.level = 1;
        this.angle = 0;
        this.totalCost = typeDef.cost;
        grid[this.gridY][this.gridX] = 1;
    }

    upgrade() {
        const typeDef = TOWER_TYPES[this.type];
        if (this.level >= 3) return;
        const nextLevel = typeDef.levels[this.level];
        const upgradeCost = nextLevel.upgradeCost;
        if (money < upgradeCost) return;

        this.level++;
        this.damage = nextLevel.damage;
        this.range = nextLevel.range;
        this.fireRate = nextLevel.fireRate;
        this.totalCost += upgradeCost;
        money -= upgradeCost;
        updateTowerPanel();
    }

    sell() {
        const sellValue = Math.floor(this.totalCost * 0.6);
        money += sellValue;
        grid[this.gridY][this.gridX] = 0;
        towers = towers.filter(t => t !== this);
        selectedTower = null;
        towerPanel.style.display = 'none';
        enemies.forEach(e => {
            const currentGridX = Math.floor(e.x / GRID_SIZE);
            const currentGridY = Math.floor(e.y / GRID_SIZE);
            e.path = aStar({ x: currentGridX, y: currentGridY }, e.goal);
        });
    }

    update() {
        if (!gameStarted || gamePaused) return;
        if (this.cooldown > 0) this.cooldown--;

        const typeDef = TOWER_TYPES[this.type];

        // Find enemies in range sorted by distance
        let enemiesInRange = [];
        for (let enemy of enemies) {
            const dx = enemy.x - this.x;
            const dy = enemy.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance <= this.range) {
                enemiesInRange.push({ enemy, distance });
            }
        }
        enemiesInRange.sort((a, b) => a.distance - b.distance);

        if (enemiesInRange.length > 0) {
            this.angle = Math.atan2(
                enemiesInRange[0].enemy.y - this.y,
                enemiesInRange[0].enemy.x - this.x
            );

            if (this.cooldown === 0) {
                if (typeDef.multiTarget) {
                    // Swarm: fire at multiple targets
                    const levelStats = typeDef.levels[this.level - 1];
                    const targetCount = Math.min(levelStats.targets, enemiesInRange.length);
                    for (let i = 0; i < targetCount; i++) {
                        projectiles.push(new Projectile(
                            this.x, this.y,
                            enemiesInRange[i].enemy,
                            this.damage,
                            this.type
                        ));
                    }
                } else {
                    // Single target
                    const proj = new Projectile(
                        this.x, this.y,
                        enemiesInRange[0].enemy,
                        this.damage,
                        this.type
                    );
                    // Pass frost slow values from current level
                    if (this.type === 'frost') {
                        const levelStats = typeDef.levels[this.level - 1];
                        proj.slowFactor = levelStats.slowFactor;
                        proj.slowDuration = levelStats.slowDuration;
                    }
                    projectiles.push(proj);
                }
                const snd = towerSounds[this.type];
                if (snd) { snd.currentTime = 0; snd.play(); }
                this.cooldown = this.fireRate;
            }
        }
    }

    draw() {
        const cx = this.x;
        const cy = this.y;
        const gs = GRID_SIZE;
        const gx = this.gridX * gs;
        const gy = this.gridY * gs;
        const typeDef = TOWER_TYPES[this.type];

        // Range indicator (yellow, classic DTD)
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

        // Type-specific colors by level
        const color = typeDef.colors.ring[this.level - 1];
        const dark = typeDef.colors.dark[this.level - 1];

        // Outer ring
        const outerR = gs * 0.36;
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.stroke();

        // Colored ring
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR - 3, 0, Math.PI * 2);
        ctx.stroke();

        // Inner ring
        ctx.strokeStyle = '#444';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR - 6, 0, Math.PI * 2);
        ctx.stroke();

        // Center hub
        ctx.fillStyle = dark;
        ctx.beginPath();
        ctx.arc(cx, cy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#222';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Barrel (varies by type)
        const cosA = Math.cos(this.angle);
        const sinA = Math.sin(this.angle);
        const pX = -sinA; // perpendicular
        const pY = cosA;

        switch (typeDef.barrelStyle) {
            case 'thin': {
                const len = gs * 0.42;
                const w = 1.2 + this.level * 0.5;
                ctx.strokeStyle = '#222';
                ctx.lineWidth = w + 1.5;
                ctx.beginPath();
                ctx.moveTo(cx + cosA * 5, cy + sinA * 5);
                ctx.lineTo(cx + cosA * len, cy + sinA * len);
                ctx.stroke();
                ctx.strokeStyle = '#666';
                ctx.lineWidth = w;
                ctx.beginPath();
                ctx.moveTo(cx + cosA * 6, cy + sinA * 6);
                ctx.lineTo(cx + cosA * (len - 1), cy + sinA * (len - 1));
                ctx.stroke();
                break;
            }
            case 'wide': {
                const len = gs * 0.48;
                const baseW = 1.5 + this.level * 0.6;
                const tipW = baseW + 2.5;
                const bx = cx + cosA * 5, by = cy + sinA * 5;
                const tx = cx + cosA * len, ty = cy + sinA * len;
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.moveTo(bx + pX * baseW, by + pY * baseW);
                ctx.lineTo(tx + pX * tipW, ty + pY * tipW);
                ctx.lineTo(tx - pX * tipW, ty - pY * tipW);
                ctx.lineTo(bx - pX * baseW, by - pY * baseW);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#4a8ab0';
                ctx.beginPath();
                ctx.moveTo(bx + pX * (baseW - 0.8), by + pY * (baseW - 0.8));
                ctx.lineTo(tx + pX * (tipW - 0.8), ty + pY * (tipW - 0.8));
                ctx.lineTo(tx - pX * (tipW - 0.8), ty - pY * (tipW - 0.8));
                ctx.lineTo(bx - pX * (baseW - 0.8), by - pY * (baseW - 0.8));
                ctx.closePath();
                ctx.fill();
                break;
            }
            case 'long': {
                const len = gs * 0.60;
                const w = 1.5 + this.level * 0.8;
                ctx.strokeStyle = '#222';
                ctx.lineWidth = w + 2;
                ctx.beginPath();
                ctx.moveTo(cx + cosA * 5, cy + sinA * 5);
                ctx.lineTo(cx + cosA * len, cy + sinA * len);
                ctx.stroke();
                ctx.strokeStyle = '#555';
                ctx.lineWidth = w;
                ctx.beginPath();
                ctx.moveTo(cx + cosA * 6, cy + sinA * 6);
                ctx.lineTo(cx + cosA * (len - 1), cy + sinA * (len - 1));
                ctx.stroke();
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.arc(cx + cosA * len, cy + sinA * len, this.level + 1.5, 0, Math.PI * 2);
                ctx.fill();
                break;
            }
            case 'multi': {
                const len = gs * 0.40;
                const w = 1.0 + this.level * 0.4;
                const barrelCount = Math.min(this.level + 1, 3);
                const spread = 0.4;
                for (let i = 0; i < barrelCount; i++) {
                    const bAngle = this.angle + (i - (barrelCount - 1) / 2) * spread;
                    const bc = Math.cos(bAngle), bs = Math.sin(bAngle);
                    ctx.strokeStyle = '#222';
                    ctx.lineWidth = w + 1.5;
                    ctx.beginPath();
                    ctx.moveTo(cx + bc * 5, cy + bs * 5);
                    ctx.lineTo(cx + bc * len, cy + bs * len);
                    ctx.stroke();
                    ctx.strokeStyle = '#7a5a90';
                    ctx.lineWidth = w;
                    ctx.beginPath();
                    ctx.moveTo(cx + bc * 6, cy + bs * 6);
                    ctx.lineTo(cx + bc * (len - 1), cy + bs * (len - 1));
                    ctx.stroke();
                }
                break;
            }
            case 'cone': {
                const len = gs * 0.45;
                const bx = cx + cosA * 5, by = cy + sinA * 5;
                const tx = cx + cosA * len, ty = cy + sinA * len;
                const coneW = 2.5 + this.level;
                ctx.fillStyle = '#222';
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(tx + pX * coneW, ty + pY * coneW);
                ctx.lineTo(tx - pX * coneW, ty - pY * coneW);
                ctx.closePath();
                ctx.fill();
                ctx.fillStyle = '#50a0b0';
                ctx.beginPath();
                ctx.moveTo(bx, by);
                ctx.lineTo(tx + pX * (coneW - 1), ty + pY * (coneW - 1));
                ctx.lineTo(tx - pX * (coneW - 1), ty - pY * (coneW - 1));
                ctx.closePath();
                ctx.fill();
                break;
            }
        }

        // Muzzle flash
        if (this.cooldown > this.fireRate - 4) {
            const flashLen = typeDef.barrelStyle === 'long' ? gs * 0.60 :
                             typeDef.barrelStyle === 'thin' ? gs * 0.42 :
                             typeDef.barrelStyle === 'wide' ? gs * 0.48 :
                             typeDef.barrelStyle === 'multi' ? gs * 0.40 : gs * 0.45;
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
        for (let i = 0; i < this.level; i++) {
            const pipAngle = -Math.PI / 2 + (i - (this.level - 1) / 2) * 0.8;
            const pipDist = outerR + 5;
            const px = cx + Math.cos(pipAngle) * pipDist;
            const py = cy + Math.sin(pipAngle) * pipDist;
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(px, py, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    }
}

// Wave spawning function
function spawnWave() {
    if (gameOver || !gameStarted) return;
    waveTimer = WAVE_DELAY;
    waveJustCleared = false;

    if (level % 10 === 0) {
        enemies.push(new Enemy(true));
    } else {
        for (let i = 0; i < 5; i++) {
            setTimeout(() => enemies.push(new Enemy()), i * 500);
        }
    }
    level++;
}

// Reset game function
function resetGame() {
    enemies = [];
    towers = [];
    projectiles = [];
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
    grid = Array(ROWS).fill().map(() => Array(COLS).fill(0));
    for (let x = 0; x < COLS; x++) {
        if (x !== topOpening) grid[0][x] = 1;
        if (x !== bottomOpening) grid[ROWS - 1][x] = 1;
    }
    for (let y = 0; y < ROWS; y++) {
        if (y !== leftOpening) grid[y][0] = 1;
        if (y !== rightOpening) grid[y][COLS - 1] = 1;
    }
    towerPanel.style.display = 'none';
    startButton.disabled = false;
    nextWaveButton.disabled = true;
    pauseButton.disabled = true;
    pauseButton.textContent = 'Pause';
}

// Update tower panel
function updateTowerPanel() {
    if (!selectedTower) {
        towerPanel.style.display = 'none';
        return;
    }
    towerPanel.style.display = 'block';

    const typeDef = TOWER_TYPES[selectedTower.type];
    towerPanelTitle.textContent = typeDef.name + ' Tower';

    let statsHtml = `
        Level: ${selectedTower.level}/3<br>
        Damage: ${selectedTower.damage}<br>
        Range: ${selectedTower.range}<br>
        Fire Rate: ${selectedTower.fireRate} frames<br>
        Total Cost: $${selectedTower.totalCost}<br>
        Sell Value: $${Math.floor(selectedTower.totalCost * 0.6)}
    `;

    if (selectedTower.type === 'squirt') {
        statsHtml += `<br>Splash: ${typeDef.splashRadius}px`;
    }
    if (selectedTower.type === 'frost') {
        const lvlStats = typeDef.levels[selectedTower.level - 1];
        statsHtml += `<br>Slow: ${Math.round(lvlStats.slowFactor * 100)}% for ${(lvlStats.slowDuration / 60).toFixed(1)}s`;
    }
    if (selectedTower.type === 'swarm') {
        const lvlStats = typeDef.levels[selectedTower.level - 1];
        statsHtml += `<br>Targets: ${lvlStats.targets}`;
    }

    towerStats.innerHTML = statsHtml;

    if (selectedTower.level < 3) {
        const nextUpgradeCost = typeDef.levels[selectedTower.level].upgradeCost;
        upgradeButton.textContent = `Upgrade ($${nextUpgradeCost})`;
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
        enemy.update();
        enemy.draw();
    }

    for (let tower of towers) {
        tower.update();
        tower.draw();
    }

    for (let projectile of projectiles) {
        projectile.update();
        projectile.draw();
    }

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

    // Update upgrade button state
    if (selectedTower) {
        const typeDef = TOWER_TYPES[selectedTower.type];
        if (selectedTower.level >= 3) {
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

    if (!gameStarted) {
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
        selectedTowerType = btn.dataset.type;
        towerTypeButtons.forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
    });
});

// Place or select tower on canvas click
canvas.addEventListener('click', (e) => {
    if (gameOver) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);

    if (gridY === 0 || gridY === ROWS - 1 || gridX === 0 || gridX === COLS - 1) return;
    if ((gridX === topOpening && gridY === 0) || (gridX === 0 && gridY === leftOpening) ||
        (gridX === bottomOpening && gridY === ROWS - 1) || (gridX === COLS - 1 && gridY === rightOpening)) return;

    for (let tower of towers) {
        if (tower.gridX === gridX && tower.gridY === gridY) {
            selectedTower = tower;
            updateTowerPanel();
            e.stopPropagation();
            return;
        }
    }

    const placeCost = TOWER_TYPES[selectedTowerType].cost;
    if (money >= placeCost && grid[gridY][gridX] === 0 && canPlaceTower(gridX, gridY)) {
        towers.push(new Tower(x, y, selectedTowerType));
        money -= placeCost;
        enemies.forEach(e => {
            const currentGridX = Math.floor(e.x / GRID_SIZE);
            const currentGridY = Math.floor(e.y / GRID_SIZE);
            e.path = aStar({ x: currentGridX, y: currentGridY }, e.goal);
        });
        selectedTower = null;
        towerPanel.style.display = 'none';
    }
});

// Mouse tracking for hover effect
canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);
    if (gridX >= 1 && gridX < COLS - 1 && gridY >= 1 && gridY < ROWS - 1) {
        hoverCell = { x: gridX, y: gridY };
    } else {
        hoverCell = null;
    }
});

canvas.addEventListener('mouseleave', () => {
    hoverCell = null;
});

upgradeButton.addEventListener('click', (e) => {
    if (selectedTower) {
        selectedTower.upgrade();
        e.stopPropagation();
    }
});

sellButton.addEventListener('click', (e) => {
    if (selectedTower) {
        selectedTower.sell();
        e.stopPropagation();
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
        towerPanel.style.display = 'none';
    }
});

// Start game loop
gameLoop();

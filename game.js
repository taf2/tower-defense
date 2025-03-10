// Get canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game constants
const GRID_SIZE = 40;
const COLS = Math.floor(canvas.width / GRID_SIZE); // 20 columns
const ROWS = Math.floor(canvas.height / GRID_SIZE); // 15 rows

// Game state
let enemies = [];
let towers = [];
let money = 1000;
let score = 0;
let baseHealth = 20;
let gameOver = false;
let level = 1; // Start at level 1
let waveActive = false;

// Grid for pathfinding (0 = open, 1 = blocked)
let grid = Array(ROWS).fill().map(() => Array(COLS).fill(0));

// Define openings and set borders
const topOpening = Math.floor(COLS / 2);
const leftOpening = Math.floor(ROWS / 2);
const bottomOpening = Math.floor(COLS / 2);
const rightOpening = Math.floor(ROWS / 2);
// Top border (solid except opening)
for (let x = 0; x < COLS; x++) {
    if (x !== topOpening) grid[0][x] = 1;
}
// Left border (solid except opening)
for (let y = 0; y < ROWS; y++) {
    if (y !== leftOpening) grid[y][0] = 1;
}
// Bottom border (solid except opening)
for (let x = 0; x < COLS; x++) {
    if (x !== bottomOpening) grid[ROWS - 1][x] = 1;
}
// Right border (solid except opening)
for (let y = 0; y < ROWS; y++) {
    if (y !== rightOpening) grid[y][COLS - 1] = 1;
}

// Entry/exit points
const openings = {
    top: { x: topOpening, y: 0, goal: { x: bottomOpening, y: ROWS - 1 } },
    left: { x: 0, y: leftOpening, goal: { x: COLS - 1, y: rightOpening } }
};

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
    console.log(`No path found from (${start.x},${start.y}) to (${goal.x},${goal.y})`);
    return [];
}

// Enemy class
class Enemy {
    constructor(isBoss = false) {
        this.spawnDirection = Math.random() < 0.5 ? 'top' : 'left';
        this.start = openings[this.spawnDirection];
        this.goal = openings[this.spawnDirection].goal;
        this.x = this.start.x * GRID_SIZE + GRID_SIZE / 2;
        this.y = this.start.y * GRID_SIZE + GRID_SIZE / 2;
        this.speed = 1 + Math.floor(level / 5) * 0.2; // Speed increases every 5 levels
        this.isBoss = isBoss;
        this.maxHealth = isBoss ? 500 + level * 50 : 50 + level * 5; // Bosses have much more health
        this.health = this.maxHealth;
        this.size = isBoss ? 40 : 20; // Bosses are larger
        this.leakDamage = isBoss ? 5 : 1; // Bosses deal more damage if they escape
        this.path = aStar(this.start, this.goal);
        if (this.path.length === 0) console.log(`Enemy spawned with no path: ${this.spawnDirection}`);
    }

    update() {
        if (this.path.length === 0) {
            if (Math.abs(this.x - this.goal.x * GRID_SIZE - GRID_SIZE / 2) < this.speed &&
                Math.abs(this.y - this.goal.y * GRID_SIZE - GRID_SIZE / 2) < this.speed) {
                baseHealth -= this.leakDamage;
                enemies = enemies.filter(e => e !== this);
                if (baseHealth <= 0) gameOver = true;
            }
            return;
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
        }
    }

    draw() {
        ctx.fillStyle = this.isBoss ? 'purple' : 'red'; // Bosses are purple
        ctx.fillRect(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);

        const healthBarWidth = this.size;
        const healthBarHeight = 5;
        const healthBarX = this.x - this.size / 2;
        const healthBarY = this.y - this.size / 2 - 10;
        ctx.fillStyle = 'gray';
        ctx.fillRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

        const healthPercentage = this.health / this.maxHealth;
        ctx.fillStyle = 'green';
        ctx.fillRect(healthBarX, healthBarY, healthBarWidth * healthPercentage, healthBarHeight);

        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.strokeRect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);
    }
}

// Tower class
class Tower {
    constructor(x, y) {
        this.gridX = Math.floor(x / GRID_SIZE);
        this.gridY = Math.floor(y / GRID_SIZE);
        this.x = this.gridX * GRID_SIZE + GRID_SIZE / 2;
        this.y = this.gridY * GRID_SIZE + GRID_SIZE / 2;
        this.range = 100;
        this.damage = 10;
        this.fireRate = 60;
        this.cooldown = 0;
        this.level = 1;
        grid[this.gridY][this.gridX] = 1;
    }

    upgrade() {
        if (money >= 50 && this.level < 3) {
            this.level++;
            this.damage += 10;
            this.range += 20;
            money -= 50;
        }
    }

    update() {
        if (this.cooldown > 0) this.cooldown--;

        if (this.cooldown === 0) {
            for (let enemy of enemies) {
                const dx = enemy.x - this.x;
                const dy = enemy.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= this.range) {
                    enemy.health -= this.damage;
                    this.cooldown = this.fireRate;
                    if (enemy.health <= 0) {
                        enemies = enemies.filter(e => e !== enemy);
                        money += 5;
                        score += 10;
                    }
                    break;
                }
            }
        }
    }

    draw() {
        ctx.fillStyle = `hsl(${120 - this.level * 40}, 100%, 50%)`;
        ctx.fillRect(this.x - GRID_SIZE / 2, this.y - GRID_SIZE / 2, GRID_SIZE, GRID_SIZE);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.2)';
        ctx.stroke();
    }
}

// Wave spawning function
function spawnWave() {
    if (gameOver || waveActive) return;
    waveActive = true;

    if (level % 10 === 0) {
        // Boss level
        enemies.push(new Enemy(true)); // Single boss
    } else {
        // Normal wave: spawn 5 enemies
        for (let i = 0; i < 5; i++) {
            setTimeout(() => enemies.push(new Enemy()), i * 500); // Staggered spawn
        }
    }
}

// Game loop
function gameLoop() {
    if (gameOver) {
        ctx.fillStyle = 'black';
        ctx.font = '40px Arial';
        ctx.fillText('Game Over!', canvas.width / 2 - 100, canvas.height / 2);
        return;
    }

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw borders
    ctx.fillStyle = 'darkgray';
    for (let y = 0; y < ROWS; y++) {
        for (let x = 0; x < COLS; x++) {
            if (grid[y][x] === 1) {
                ctx.fillRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
            }
        }
    }

    // Draw playable grid
    ctx.strokeStyle = 'lightgray';
    ctx.lineWidth = 1;
    for (let y = 1; y < ROWS - 1; y++) {
        for (let x = 1; x < COLS - 1; x++) {
            ctx.strokeRect(x * GRID_SIZE, y * GRID_SIZE, GRID_SIZE, GRID_SIZE);
        }
    }

    // Highlight openings
    ctx.fillStyle = 'yellow';
    ctx.fillRect(topOpening * GRID_SIZE, 0, GRID_SIZE, GRID_SIZE);
    ctx.fillRect(0, leftOpening * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    ctx.fillRect(bottomOpening * GRID_SIZE, (ROWS - 1) * GRID_SIZE, GRID_SIZE, GRID_SIZE);
    ctx.fillRect((COLS - 1) * GRID_SIZE, rightOpening * GRID_SIZE, GRID_SIZE, GRID_SIZE);

    for (let enemy of enemies) {
        enemy.update();
        enemy.draw();
    }

    for (let tower of towers) {
        tower.update();
        tower.draw();
    }

    // Check if wave is cleared
    if (waveActive && enemies.length === 0 && level < 100) {
        level++;
        waveActive = false;
        setTimeout(spawnWave, 2000); // 2-second break between waves
    } else if (level === 100 && enemies.length === 0) {
        ctx.fillStyle = 'black';
        ctx.font = '40px Arial';
        ctx.fillText('You Win!', canvas.width / 2 - 80, canvas.height / 2);
        gameOver = true;
    }

    // HUD
    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.fillText(`Level: ${level}  Health: ${baseHealth}  Money: $${money}  Score: ${score}`, 10, 30);

    requestAnimationFrame(gameLoop);
}

// Place or upgrade tower on click
canvas.addEventListener('click', (e) => {
    if (gameOver) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const gridX = Math.floor(x / GRID_SIZE);
    const gridY = Math.floor(y / GRID_SIZE);

    // Prevent placing towers on borders or openings
    if (gridY === 0 || gridY === ROWS - 1 || gridX === 0 || gridX === COLS - 1) return;
    if ((gridX === topOpening && gridY === 0) || (gridX === 0 && gridY === leftOpening) ||
        (gridX === bottomOpening && gridY === ROWS - 1) || (gridX === COLS - 1 && gridY === rightOpening)) return;

    // Check if clicking an existing tower to upgrade
    for (let tower of towers) {
        if (tower.gridX === gridX && tower.gridY === gridY) {
            tower.upgrade();
            enemies.forEach(e => {
                const currentGridX = Math.floor(e.x / GRID_SIZE);
                const currentGridY = Math.floor(e.y / GRID_SIZE);
                e.path = aStar({ x: currentGridX, y: currentGridY }, e.goal);
                if (e.path.length === 0) console.log(`Path blocked for enemy from ${e.spawnDirection} at (${currentGridX}, ${currentGridY})`);
            });
            return;
        }
    }

    // Place new tower if cell is empty and affordable
    if (money >= 50 && grid[gridY][gridX] === 0) {
        towers.push(new Tower(x, y));
        money -= 50;
        enemies.forEach(e => {
            const currentGridX = Math.floor(e.x / GRID_SIZE);
            const currentGridY = Math.floor(e.y / GRID_SIZE);
            e.path = aStar({ x: currentGridX, y: currentGridY }, e.goal);
            if (e.path.length === 0) console.log(`Path blocked for enemy from ${e.spawnDirection} at (${currentGridX}, ${currentGridY})`);
        });
    }
});

// Start game with first wave
spawnWave();
gameLoop();

// Get canvas and context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Game state
let enemies = [];
let towers = [];
let money = 100;
let score = 0;

// Path waypoints (simple horizontal path with turns)
const path = [
    { x: 0, y: 300 },
    { x: 200, y: 300 },
    { x: 200, y: 100 },
    { x: 400, y: 100 },
    { x: 400, y: 400 },
    { x: 600, y: 400 },
    { x: 600, y: 200 },
    { x: 800, y: 200 }
];

// Enemy class
class Enemy {
    constructor() {
        this.x = path[0].x;
        this.y = path[0].y;
        this.speed = 1;
        this.maxHealth = 50;
        this.health = this.maxHealth;
        this.targetIndex = 1;
        this.size = 20;
    }

    update() {
        const target = path[this.targetIndex];
        const dx = target.x - this.x;
        const dy = target.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance < this.speed) {
            this.x = target.x;
            this.y = target.y;
            this.targetIndex++;
            if (this.targetIndex >= path.length) {
                enemies = enemies.filter(e => e !== this);
                money -= 10;
                return;
            }
        } else {
            this.x += (dx / distance) * this.speed;
            this.y += (dy / distance) * this.speed;
        }
    }

    draw() {
        ctx.fillStyle = 'red';
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
        this.x = x;
        this.y = y;
        this.range = 100;
        this.fireRate = 60;
        this.cooldown = 0;
    }

    update() {
        if (this.cooldown > 0) this.cooldown--;

        if (this.cooldown === 0) {
            for (let enemy of enemies) {
                const dx = enemy.x - this.x;
                const dy = enemy.y - this.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                if (distance <= this.range) {
                    enemy.health -= 10;
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
        ctx.fillStyle = 'blue';
        ctx.fillRect(this.x - 15, this.y - 15, 30, 30);
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.range, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(0, 0, 255, 0.2)';
        ctx.stroke();
    }
}

// Game loop
function gameLoop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
        ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.strokeStyle = 'gray';
    ctx.lineWidth = 20;
    ctx.stroke();

    for (let enemy of enemies) {
        enemy.update();
        enemy.draw();
    }

    for (let tower of towers) {
        tower.update();
        tower.draw();
    }

    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.fillText(`Money: $${money}  Score: ${score}`, 10, 30);

    requestAnimationFrame(gameLoop);
}

// Spawn enemies periodically
setInterval(() => {
    if (money >= 0) enemies.push(new Enemy());
}, 2000);

// Place tower on click
canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (money >= 50) {
        towers.push(new Tower(x, y));
        money -= 50;
    }
});

// Start game
gameLoop();

// Browser-side test suite for Desktop Tower Defense.
//
// Loaded after game.js in a page whose DOM matches index.html (the runner in
// tests/run-tests.js generates that page automatically). game.js is a classic
// script, so its top-level functions and `let` bindings are reachable here.
//
// Run with:  node tests/run-tests.js

(function () {
    'use strict';

    var results = [];

    function rec(name, pass, extra) {
        results.push((pass ? 'PASS' : 'FAIL') + ': ' + name + (extra ? ' (' + extra + ')' : ''));
    }

    function approx(a, b, eps) {
        return Math.abs(a - b) <= (eps || 1e-9);
    }

    // Deterministic tests: stop the rAF loop so nothing mutates state under us.
    var rafCount = 0;
    window.requestAnimationFrame = function () { rafCount++; return 1; };

    // ---- 1. Game over must not kill the loop (Reset depends on it) ----
    gameOver = true;
    gameLoop(performance.now());
    rec('gameLoop reschedules while gameOver', rafCount === 1, 'rafCount=' + rafCount);
    gameOver = false;

    // ---- 2. Spawns are queued in game time and drain via updateSpawnQueue ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    spawnWave();
    rec('spawnWave queues enemies',
        spawnQueue.length > 0 && pendingSpawns > 0,
        'queue=' + spawnQueue.length + ' pending=' + pendingSpawns);
    frameDelta = 1;
    updateSpawnQueue();
    rec('spawn queue emits enemies', enemies.length >= 1, 'enemies=' + enemies.length);
    for (var i = 0; i < 200; i++) { frameDelta = 1; updateSpawnQueue(); }
    rec('spawn queue drains fully',
        spawnQueue.length === 0 && pendingSpawns === 0,
        'queue=' + spawnQueue.length);

    // ---- 3. Reset cancels queued spawns (no stale enemies into a new game) ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    spawnWave();
    var queued = spawnQueue.length;
    resetGame();
    rec('reset clears spawn queue',
        spawnQueue.length === 0 && pendingSpawns === 0 && enemies.length === 0,
        'cleared ' + queued + ' queued');

    // ---- 4. Early-send bonus is for time REMAINING, with a spam guard ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    nextWaveButton.disabled = false;
    level = 5;
    WAVE_DELAY = 20;
    waveTimer = 15;
    lastWaveSpawnTs = performance.now() - 2000;
    money = 0;
    nextWaveButton.click();
    rec('early bonus = floor(remaining time)', money === 15, 'money=' + money);
    money = 0;
    nextWaveButton.click();
    rec('immediate re-send pays no bonus', money === 0, 'money=' + money);

    // ---- 5. Delta time scales movement / cooldowns / upgrades ----
    resetGame();
    gameStarted = true;
    gameOver = false;

    var e1 = new Enemy('normal', false, 1.0);
    frameDelta = 1;
    var ax = e1.x, ay = e1.y;
    e1.update();
    var d60 = Math.hypot(e1.x - ax, e1.y - ay);

    var e2 = new Enemy('normal', false, 1.0);
    frameDelta = 0.5;
    var bx = e2.x, by = e2.y;
    e2.update();
    var d120 = Math.hypot(e2.x - bx, e2.y - by);
    rec('enemy speed scales with frameDelta', approx(d120, d60 / 2),
        'd60=' + d60.toFixed(4) + ' d120=' + d120.toFixed(4));

    resetGame();
    gameStarted = true;
    gameOver = false;
    var tw = new Tower(2 * GRID_SIZE, 2 * GRID_SIZE, 'pellet');
    tw.cooldown = 10;
    frameDelta = 0.5;
    tw.update();
    rec('tower cooldown scales with frameDelta', approx(tw.cooldown, 9.5),
        'cooldown=' + tw.cooldown);

    resetGame();
    gameStarted = true;
    gameOver = false;
    var tw2 = new Tower(2 * GRID_SIZE, 2 * GRID_SIZE, 'pellet');
    tw2.upgradeTimer = 10;
    tw2.upgradeTotal = 10;
    frameDelta = 0.5;
    tw2.update();
    rec('upgrade timer scales with frameDelta', approx(tw2.upgradeTimer, 9.5),
        'upgradeTimer=' + tw2.upgradeTimer);

    // ---- 6. Repathing must not target the cell the enemy already occupies ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    var er = new Enemy('normal', false, 1.0);
    var c0 = er.path[0];
    er.x = c0.x * GRID_SIZE + GRID_SIZE / 2 + 6;
    er.y = c0.y * GRID_SIZE + GRID_SIZE / 2 + 6;
    var ccx = Math.floor(er.x / GRID_SIZE);
    var ccy = Math.floor(er.y / GRID_SIZE);
    repathEnemyFromCurrentCell(er);
    var tgt = er.path[er.pathIndex];
    rec('repath skips the occupied cell', !(tgt.x === ccx && tgt.y === ccy),
        'index=' + er.pathIndex + ' target=' + tgt.x + ',' + tgt.y);

    // ---- 7. Spawn path starts in the enemy's actual cell (no phantom border cell) ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    var es = new Enemy('normal', false, 1.0);
    rec('spawn path starts in spawn cell',
        Math.floor(es.x / GRID_SIZE) === es.path[0].x &&
        Math.floor(es.y / GRID_SIZE) === es.path[0].y,
        'cell=' + Math.floor(es.x / GRID_SIZE) + ',' + Math.floor(es.y / GRID_SIZE));

    // ---- 7b. Frost is an area slow (works on fast creeps at any level) ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    var frostTower = new Tower(2 * GRID_SIZE, 2 * GRID_SIZE, 'frost');
    var fastCreep = new Enemy('fast', false, 1.0);
    fastCreep.x = frostTower.x + 30;
    fastCreep.y = frostTower.y;
    enemies.push(fastCreep);
    frostTower.update();
    rec('frost aura slows a fast creep',
        fastCreep.slowTimer > 0 && fastCreep.slowFactor > 0,
        'slowTimer=' + fastCreep.slowTimer + ' factor=' + fastCreep.slowFactor);
    fastCreep.update();
    rec('slowed fast creep moves slower',
        fastCreep.speed < fastCreep.baseSpeed,
        'speed=' + fastCreep.speed.toFixed(2) + ' base=' + fastCreep.baseSpeed.toFixed(2));

    // At level 40 a fast creep moves at 5 px/frame - the old projectile-based
    // frost could never catch it. The aura must still slow it.
    resetGame();
    gameStarted = true;
    gameOver = false;
    level = 40;
    var frostTower2 = new Tower(2 * GRID_SIZE, 2 * GRID_SIZE, 'frost');
    var fastCreep2 = new Enemy('fast', false, 1.0);
    fastCreep2.x = frostTower2.x + 30;
    fastCreep2.y = frostTower2.y;
    enemies.push(fastCreep2);
    frostTower2.update();
    fastCreep2.update();
    rec('frost slows a level-40 fast creep',
        fastCreep2.slowTimer > 0 && fastCreep2.speed < fastCreep2.baseSpeed,
        'speed=' + fastCreep2.speed.toFixed(2) + ' base=' + fastCreep2.baseSpeed.toFixed(2));

    // Slow-immune creeps are unaffected by the frost aura.
    resetGame();
    gameStarted = true;
    gameOver = false;
    var frostTower3 = new Tower(2 * GRID_SIZE, 2 * GRID_SIZE, 'frost');
    var immuneCreep = new Enemy('immune', false, 1.0);
    immuneCreep.x = frostTower3.x + 30;
    immuneCreep.y = frostTower3.y;
    enemies.push(immuneCreep);
    frostTower3.update();
    rec('frost aura ignores slow-immune creeps', immuneCreep.slowTimer === 0,
        'slowTimer=' + immuneCreep.slowTimer);

    // ---- 8. Wave schedule ----
    var waveChecks = [
        [10, 'boss'], [100, 'boss'], [6, 'group'], [11, 'flying'],
        [13, 'spawn'], [14, 'dark'], [21, 'normal'], [22, 'group']
    ];
    var waveOk = waveChecks.every(function (pair) {
        return getWaveType(pair[0]) === pair[1];
    });
    rec('getWaveType schedule', waveOk);

    // ---- 9. Wave counts ----
    rec('getWaveCount', getWaveCount('group', 10) === 14 && getWaveCount('normal', 10) === 6,
        'group=' + getWaveCount('group', 10) + ' normal=' + getWaveCount('normal', 10));

    // ---- 10. Placement guards ----
    resetGame();
    rec('canPlaceTower allows open interior', canPlaceTower(5, 5) === true);
    rec('canPlaceTower rejects border', canPlaceTower(0, 0) === false);

    // ---- 10b. Every projectile tower must outrun the fastest creep ----
    // (Levelled creep speed tops out at 2.5x the base multiplier; a projectile
    // at or below that can never catch a fast creep, which is how Frost and Dart
    // silently stopped working at higher waves.)
    var maxCreepSpeed = 0;
    Object.keys(ENEMY_TYPES).forEach(function (type) {
        var s = 2.5 * ENEMY_TYPES[type].speedMult;
        if (s > maxCreepSpeed) maxCreepSpeed = s;
    });
    var tooSlow = [];
    Object.keys(TOWER_TYPES).forEach(function (type) {
        var def = TOWER_TYPES[type];
        if (def.melee || def.slowAura) return; // no projectile to fire
        if (def.projectileSpeed <= maxCreepSpeed) {
            tooSlow.push(type + '=' + def.projectileSpeed);
        }
    });
    rec('all projectile towers outrun the fastest creep',
        tooSlow.length === 0,
        'maxCreep=' + maxCreepSpeed + ' tooSlow=' + tooSlow.join(','));

    // ---- 11. No enemies leak into a reset game ----
    resetGame();
    gameStarted = true;
    gameOver = false;
    spawnWave();
    resetGame();
    frameDelta = 1;
    for (var j = 0; j < 20; j++) {
        if (gameStarted) updateSpawnQueue();
    }
    rec('no stale enemies after reset', enemies.length === 0, 'enemies=' + enemies.length);

    // ---- flush results ----
    var pre = document.createElement('pre');
    pre.id = 'testResults';
    pre.textContent = results.join('\n');
    document.body.appendChild(pre);
}());
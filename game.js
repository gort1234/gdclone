// ============================================================
// GEOMETRY DASH REPLICA - Core Game Engine
// ============================================================

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

function resizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resizeCanvas();
window.addEventListener('resize', resizeCanvas);

// ---------------- CONFIG ----------------
const GROUND_Y_OFFSET = 120;       // distance from bottom of screen to ground top
const GRAVITY = 2200;              // px/s^2
const JUMP_VELOCITY = -780;        // px/s
const PLAYER_SIZE = 42;
const SCROLL_SPEED = 420;          // px/s, world scroll speed
const BLOCK = 60;                  // grid unit for level layout

// ---------------- LEVEL DATA ----------------
// Level is built from a list of objects with x position (in px, world space)
// types: 'spike', 'block', 'spikeTriple', 'platform', 'gapBlockHigh'
// All generated procedurally below for a ~25s level at SCROLL_SPEED.

function buildLevel() {
  const items = [];
  let x = 900; // starting clear space

  function spike(px) { items.push({ type: 'spike', x: px, w: BLOCK, h: BLOCK }); }
  function spikes(px, count) {
    for (let i = 0; i < count; i++) spike(px + i * BLOCK);
  }
  function block(px, py_units, w_units = 1, h_units = 1) {
    items.push({ type: 'block', x: px, yUnits: py_units, w: w_units * BLOCK, h: h_units * BLOCK });
  }
  function platform(px, yUnits, wUnits) {
    items.push({ type: 'block', x: px, yUnits: yUnits, w: wUnits * BLOCK, h: BLOCK });
  }

  // --- Section 1: intro, single spikes with gaps ---
  spike(x); x += 360;
  spike(x); x += 300;
  spikes(x, 2); x += 420;

  // --- Section 2: low block + spike combo (jump onto block then over spike) ---
  block(x, 1, 1, 1); x += 60;
  spike(x); x += 340;

  // --- Section 3: triple spike, needs full jump ---
  spikes(x, 3); x += 460;

  // --- Section 4: elevated platform sequence ---
  platform(x, 1, 2); x += 120;
  spike(x + 120); // spike right after platform drop
  x += 300;

  // --- Section 5: staircase of blocks rising ---
  block(x, 1, 1, 1); x += 70;
  block(x, 2, 1, 2); x += 70;
  block(x, 1, 1, 1); x += 220;

  // --- Section 6: double spike then gap jump between platforms ---
  spikes(x, 2); x += 320;
  platform(x, 1, 2); x += 240;
  platform(x, 1, 2); x += 100;

  // --- Section 7: tight single-spike timing section (rhythm) ---
  spike(x); x += 260;
  spike(x); x += 260;
  spike(x); x += 260;
  spike(x); x += 320;

  // --- Section 8: block stack pillar to jump over ---
  block(x, 1, 1, 1);
  block(x, 2, 1, 1); x += 60;
  spike(x); x += 360;

  // --- Section 9: triple spike on elevated block run ---
  platform(x, 1, 5);
  spike(x + 180);
  spike(x + 240);
  x += 5 * BLOCK + 140;

  // --- Section 10: final big combo - block, gap, triple spike, block jump ---
  block(x, 1, 1, 1); x += 70;
  spikes(x, 1); x += 340;
  block(x, 1, 1, 1); x += 60;
  block(x, 1, 1, 1); x += 60;
  spikes(x, 2); x += 380;

  // --- Final stretch then end marker ---
  spike(x); x += 300;
  block(x, 1, 1, 1); x += 60;
  spike(x); x += 400;

  const endX = x + 200;
  items.push({ type: 'end', x: endX, w: 10, h: 10 });

  return { items, length: endX };
}

let level = buildLevel();
const LEVEL_LENGTH = level.length;

// ---------------- GAME STATE ----------------
const state = {
  running: false,
  dead: false,
  won: false,
  attempts: 1,
  worldX: 0,          // how far player has scrolled (progress)
  cameraX: 0,
  player: {
    x: 0,             // world x position (fixed offset, camera moves instead conceptually -> we track worldX as scroll)
    y: 0,
    vy: 0,
    rotation: 0,
    onGround: true,
    holding: false,
  },
  trail: [],
  particles: [],
  lastTime: 0,
};

function groundTopScreenY() {
  return canvas.height - GROUND_Y_OFFSET;
}

function resetState() {
  state.dead = false;
  state.won = false;
  state.worldX = 0;
  state.player.y = groundTopScreenY() - PLAYER_SIZE;
  state.player.vy = 0;
  state.player.rotation = 0;
  state.player.onGround = true;
  state.trail = [];
  state.particles = [];
}

resetState();

// ---------------- INPUT ----------------
function tryJump() {
  if (!state.running || state.dead || state.won) return;
  state.player.holding = true;
  if (state.player.onGround) {
    state.player.vy = JUMP_VELOCITY;
    state.player.onGround = false;
    spawnJumpParticles();
  }
}
function releaseJump() {
  state.player.holding = false;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') {
    e.preventDefault();
    if (!state.running) startGame();
    else tryJump();
  }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space' || e.code === 'ArrowUp') releaseJump();
});
canvas.addEventListener('mousedown', () => {
  if (!state.running) startGame();
  else tryJump();
});
canvas.addEventListener('mouseup', releaseJump);
canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (!state.running) startGame();
  else tryJump();
}, { passive: false });
canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  releaseJump();
}, { passive: false });

// ---------------- UI ELEMENTS ----------------
const startScreen = document.getElementById('startScreen');
const deathScreen = document.getElementById('deathScreen');
const winScreen = document.getElementById('winScreen');
const startBtn = document.getElementById('startBtn');
const retryBtn = document.getElementById('retryBtn');
const winRetryBtn = document.getElementById('winRetryBtn');
const percentText = document.getElementById('percentText');
const attemptText = document.getElementById('attemptText');
const progressBarFill = document.getElementById('progressBarFill');
const deathPercent = document.querySelector('.deathPercent');

startBtn.addEventListener('click', startGame);
retryBtn.addEventListener('click', startGame);
winRetryBtn.addEventListener('click', startGame);

function startGame() {
  if (state.running && !state.dead && !state.won) return;
  if (state.dead || state.won) {
    state.attempts++;
  }
  attemptText.textContent = 'Attempt ' + state.attempts;
  resetState();
  state.running = true;
  startScreen.classList.add('hidden');
  deathScreen.classList.add('hidden');
  winScreen.classList.add('hidden');
}

// ---------------- PARTICLES ----------------
function spawnJumpParticles() {
  const px = playerScreenX();
  const py = state.player.y + PLAYER_SIZE;
  for (let i = 0; i < 10; i++) {
    state.particles.push({
      x: px + PLAYER_SIZE / 2,
      y: py,
      vx: (Math.random() - 0.5) * 220,
      vy: -Math.random() * 180,
      life: 0.5,
      maxLife: 0.5,
      color: '#00f7ff',
      size: 4 + Math.random() * 3,
    });
  }
}

function spawnDeathParticles() {
  const px = playerScreenX() + PLAYER_SIZE / 2;
  const py = state.player.y + PLAYER_SIZE / 2;
  for (let i = 0; i < 36; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 120 + Math.random() * 320;
    state.particles.push({
      x: px,
      y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.8 + Math.random() * 0.4,
      maxLife: 0.8 + Math.random() * 0.4,
      color: Math.random() > 0.5 ? '#ff3b3b' : '#ffae00',
      size: 3 + Math.random() * 5,
    });
  }
}

function updateParticles(dt) {
  for (let i = state.particles.length - 1; i >= 0; i--) {
    const p = state.particles[i];
    p.life -= dt;
    if (p.life <= 0) { state.particles.splice(i, 1); continue; }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
  }
}

function drawParticles() {
  for (const p of state.particles) {
    const alpha = Math.max(p.life / p.maxLife, 0);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.shadowColor = p.color;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

// ---------------- PLAYER SCREEN POSITION ----------------
const PLAYER_SCREEN_X_RATIO = 0.28;
function playerScreenX() {
  return canvas.width * PLAYER_SCREEN_X_RATIO;
}

// ---------------- COLLISION HELPERS ----------------
function aabbIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// triangle (spike) collision approximated with a smaller hitbox triangle check
function spikeCollision(px, py, pw, ph, sx, sy, sw, sh) {
  // sx, sy = top-left of spike bounding box, base at bottom
  // Use a slightly inset triangle for fairness
  const baseY = sy + sh;
  const apexX = sx + sw / 2;
  const apexY = sy + sh * 0.12;
  const leftX = sx + sw * 0.12;
  const rightX = sx + sw * 0.88;

  // quick AABB reject first
  if (!aabbIntersect(px, py, pw, ph, sx, sy, sw, sh)) return false;

  // check player's bounding circle-ish corners against triangle using point-in-triangle for box corners
  const corners = [
    [px, py], [px + pw, py], [px, py + ph], [px + pw, py + ph],
    [px + pw / 2, py + ph / 2]
  ];

  function sign(x1, y1, x2, y2, x3, y3) {
    return (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  }
  function pointInTriangle(px2, py2) {
    const d1 = sign(px2, py2, apexX, apexY, leftX, baseY);
    const d2 = sign(px2, py2, leftX, baseY, rightX, baseY);
    const d3 = sign(px2, py2, rightX, baseY, apexX, apexY);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }
  for (const [cx, cy] of corners) {
    if (pointInTriangle(cx, cy)) return true;
  }
  return false;
}

// ---------------- GAME LOOP ----------------
function update(dt) {
  if (!state.running || state.dead || state.won) return;

  // scroll world
  state.worldX += SCROLL_SPEED * dt;

  const groundY = groundTopScreenY();
  const p = state.player;

  // physics
  p.vy += GRAVITY * dt;
  p.y += p.vy * dt;

  // ground collision
  const floorY = groundY - PLAYER_SIZE;
  if (p.y >= floorY) {
    p.y = floorY;
    p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  // player's world-space hitbox: left edge tracks worldX (fixed screen x, world scrolls under it)
  const realPlayerX = state.worldX;
  const prevPlayerY = p.y - p.vy * dt; // y before this frame's vertical movement

  let landedOnBlock = false;
  for (const item of level.items) {
    if (item.type === 'block') {
      const bx = item.x;
      const bw = item.w;
      const by = groundY - item.yUnits * BLOCK - item.h;
      const bh = item.h;

      const pxw = realPlayerX;
      const pyw = p.y;
      const pw = PLAYER_SIZE;
      const ph = PLAYER_SIZE;

      if (aabbIntersect(pxw, pyw, pw, ph, bx, by, bw, bh)) {
        // landing on top: was above the block last frame and moving down
        if (prevPlayerY + ph <= by + 1 && p.vy >= 0) {
          p.y = by - PLAYER_SIZE;
          p.vy = 0;
          p.onGround = true;
          landedOnBlock = true;
        } else {
          // hit the side or underside -> death
          killPlayer();
          return;
        }
      }
    } else if (item.type === 'spike') {
      const sx = item.x;
      const sw = item.w;
      const sh = item.h;
      const sy = groundY - sh;
      const pxw = realPlayerX;
      const pyw = p.y;
      if (spikeCollision(pxw, pyw, PLAYER_SIZE, PLAYER_SIZE, sx, sy, sw, sh)) {
        killPlayer();
        return;
      }
    } else if (item.type === 'end') {
      if (realPlayerX + PLAYER_SIZE >= item.x) {
        winGame();
        return;
      }
    }
  }

  if (!landedOnBlock && p.y >= floorY) {
    p.y = floorY;
    p.onGround = true;
  }

  // rotation while airborne
  if (!p.onGround) {
    p.rotation += dt * 8.5; // radians/sec, GD-like tumble
  } else {
    // snap rotation to nearest 90deg smoothly
    const target = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2);
    p.rotation += (target - p.rotation) * Math.min(1, dt * 18);
  }

  // trail
  state.trail.push({ x: playerScreenX() + PLAYER_SIZE / 2, y: p.y + PLAYER_SIZE / 2, life: 0.35 });
  for (let i = state.trail.length - 1; i >= 0; i--) {
    state.trail[i].life -= dt;
    if (state.trail[i].life <= 0) state.trail.splice(i, 1);
  }

  updateParticles(dt);
  updateHUD();
}

function killPlayer() {
  if (state.dead) return;
  state.dead = true;
  state.running = false;
  spawnDeathParticles();
  const pct = Math.min(100, Math.floor((state.worldX / LEVEL_LENGTH) * 100));
  deathPercent.textContent = pct + '%';
  setTimeout(() => {
    deathScreen.classList.remove('hidden');
  }, 500);
}

function winGame() {
  if (state.won) return;
  state.won = true;
  state.running = false;
  progressBarFill.style.width = '100%';
  percentText.textContent = '100%';
  setTimeout(() => {
    winScreen.classList.remove('hidden');
  }, 300);
}

function updateHUD() {
  const pct = Math.min(100, Math.floor((state.worldX / LEVEL_LENGTH) * 100));
  percentText.textContent = pct + '%';
  progressBarFill.style.width = pct + '%';
}

// ---------------- RENDER ----------------
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#1c1c44');
  grad.addColorStop(0.55, '#11112c');
  grad.addColorStop(1, '#07071a');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // parallax grid lines
  ctx.strokeStyle = 'rgba(0, 247, 255, 0.06)';
  ctx.lineWidth = 1;
  const gridOffset = (state.worldX * 0.3) % 80;
  for (let gx = -gridOffset; gx < w; gx += 80) {
    ctx.beginPath();
    ctx.moveTo(gx, 0);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }

  // distant glowing circles (parallax)
  for (let i = 0; i < 6; i++) {
    const baseX = (i * 400 - (state.worldX * 0.15) % 2400);
    const cx = ((baseX % (w + 400)) + (w + 400)) % (w + 400) - 200;
    const cy = 80 + (i % 3) * 90;
    ctx.beginPath();
    const rg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 60);
    rg.addColorStop(0, 'rgba(255,45,212,0.15)');
    rg.addColorStop(1, 'rgba(255,45,212,0)');
    ctx.fillStyle = rg;
    ctx.arc(cx, cy, 60, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGround() {
  const w = canvas.width, h = canvas.height;
  const groundY = groundTopScreenY();

  // ground body
  const grad = ctx.createLinearGradient(0, groundY, 0, h);
  grad.addColorStop(0, '#15152f');
  grad.addColorStop(1, '#05050f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, groundY, w, h - groundY);

  // glowing top line
  ctx.strokeStyle = '#00f7ff';
  ctx.lineWidth = 3;
  ctx.shadowColor = '#00f7ff';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ground tile pattern
  ctx.strokeStyle = 'rgba(0,247,255,0.15)';
  ctx.lineWidth = 1;
  const tileOffset = state.worldX % 40;
  for (let gx = -tileOffset; gx < w; gx += 40) {
    ctx.beginPath();
    ctx.moveTo(gx, groundY + 6);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
}

function worldToScreenX(worldX) {
  return worldX - state.worldX + playerScreenX();
}

function drawLevel() {
  const groundY = groundTopScreenY();
  const w = canvas.width;

  for (const item of level.items) {
    const screenX = worldToScreenX(item.x);
    if (screenX < -200 || screenX > w + 200) continue;

    if (item.type === 'spike') {
      drawSpike(screenX, groundY, item.w, item.h);
    } else if (item.type === 'block') {
      const topY = groundY - item.yUnits * BLOCK - item.h;
      drawBlock(screenX, topY, item.w, item.h);
    } else if (item.type === 'end') {
      drawEndMarker(screenX, groundY);
    }
  }
}

function drawSpike(screenX, groundY, sw, sh) {
  const baseY = groundY;
  const topY = groundY - sh;
  ctx.save();
  ctx.shadowColor = '#ff2dd4';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#1a0d22';
  ctx.strokeStyle = '#ff2dd4';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(screenX + sw * 0.5, topY + sh * 0.12);
  ctx.lineTo(screenX + sw * 0.88, baseY);
  ctx.lineTo(screenX + sw * 0.12, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawBlock(screenX, topY, bw, bh) {
  ctx.save();
  ctx.shadowColor = '#00f7ff';
  ctx.shadowBlur = 10;
  ctx.fillStyle = '#0d1b33';
  ctx.strokeStyle = '#00c8ff';
  ctx.lineWidth = 3;
  ctx.fillRect(screenX, topY, bw, bh);
  ctx.strokeRect(screenX + 1.5, topY + 1.5, bw - 3, bh - 3);
  // inner accent line
  ctx.strokeStyle = 'rgba(0,200,255,0.4)';
  ctx.lineWidth = 1;
  ctx.strokeRect(screenX + 8, topY + 8, bw - 16, bh - 16);
  ctx.restore();
}

function drawEndMarker(screenX, groundY) {
  ctx.save();
  ctx.shadowColor = '#4aff7a';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#4aff7a';
  ctx.fillRect(screenX, groundY - 300, 6, 300);
  ctx.restore();
}

function drawTrail() {
  for (const t of state.trail) {
    const alpha = Math.max(t.life / 0.35, 0) * 0.5;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ff2dd4';
    ctx.shadowColor = '#ff2dd4';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(t.x, t.y, PLAYER_SIZE * 0.28, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (state.dead) return;
  const p = state.player;
  const sx = playerScreenX();
  const cx = sx + PLAYER_SIZE / 2;
  const cy = p.y + PLAYER_SIZE / 2;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  ctx.shadowColor = '#ffae00';
  ctx.shadowBlur = 18;

  const half = PLAYER_SIZE / 2;
  const grad = ctx.createLinearGradient(-half, -half, half, half);
  grad.addColorStop(0, '#00f7ff');
  grad.addColorStop(1, '#ff2dd4');
  ctx.fillStyle = grad;
  ctx.fillRect(-half, -half, PLAYER_SIZE, PLAYER_SIZE);

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.strokeRect(-half + 2, -half + 2, PLAYER_SIZE - 4, PLAYER_SIZE - 4);

  // face dot (eye)
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#0a0a14';
  ctx.beginPath();
  ctx.arc(half * 0.15, -half * 0.1, half * 0.28, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(half * 0.22, -half * 0.18, half * 0.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render() {
  drawBackground();
  drawGround();
  drawLevel();
  drawTrail();
  drawPlayer();
  drawParticles();
}

// ---------------- MAIN LOOP ----------------
function loop(timestamp) {
  if (!state.lastTime) state.lastTime = timestamp;
  let dt = (timestamp - state.lastTime) / 1000;
  state.lastTime = timestamp;
  dt = Math.min(dt, 1 / 30); // clamp for stability

  update(dt);
  render();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);

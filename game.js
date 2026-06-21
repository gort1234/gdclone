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
const SCROLL_SPEED = 420;          // px/s, world scroll speed (player's constant rightward speed)
const BLOCK = 60;                  // grid unit for level layout

// Physics-derived jump envelope (used to keep every obstacle placement fair):
// Full jump (ground to ground): ~298px horizontal, apex height ~138px (~2.3 blocks)
const JUMP_FULL_DISTANCE = (2 * Math.abs(JUMP_VELOCITY) / GRAVITY) * SCROLL_SPEED; // ~298
const JUMP_MAX_HEIGHT = (JUMP_VELOCITY * JUMP_VELOCITY) / (2 * GRAVITY);           // ~138

// ---------------- SHIP MODE CONFIG ----------------
const SHIP_GRAVITY = 1400;         // px/s^2, gentler fall than cube
const SHIP_THRUST = -1400;         // px/s^2, upward acceleration while holding
const SHIP_MAX_VY = 480;           // px/s, terminal velocity clamp (up and down)
const SHIP_SIZE = 38;

// ---------------- LEVEL DATA ----------------
// Level built from a flat list of obstacles placed at world-space x.
// Every gap and platform height below is kept well inside the jump envelope
// (full jump ~298px / ~5 blocks, max height ~138px / ~2 blocks) so every
// jump is guaranteed possible at constant scroll speed.

function buildLevel() {
  const items = [];
  let x = 700; // starting clear runway so the player can see the cube before action starts

  function spike(px, yUnits = 0) { items.push({ type: 'spike', x: px, w: BLOCK, h: BLOCK * 0.9, yUnits }); }
  function spikeRow(px, count, gap = BLOCK) {
    for (let i = 0; i < count; i++) spike(px + i * gap);
  }
  // block sits with its bottom at yUnits*BLOCK above the ground, height in BLOCK units
  function block(px, yUnits, wUnits = 1, hUnits = 1) {
    items.push({ type: 'block', x: px, yUnits, w: wUnits * BLOCK, h: hUnits * BLOCK });
  }
  function shipPortal(px) {
    items.push({ type: 'shipPortal', x: px, w: BLOCK * 0.7, h: BLOCK * 3 });
  }
  function cubePortal(px) {
    items.push({ type: 'cubePortal', x: px, w: BLOCK * 0.7, h: BLOCK * 3 });
  }

  // --- Intro: flat ground, single well-spaced spikes (teach the jump) ---
  spike(x); x += 260;
  spike(x); x += 260;
  spike(x); x += 230;

  // --- Double spike, needs a full committed jump ---
  spikeRow(x, 2); x += 280;

  // --- Low block step-up: jump onto a 1-block platform, then continue ---
  block(x, 1, 2, 1); x += 2 * BLOCK + 140;

  // --- Single spike right after, simple rhythm ---
  spike(x); x += 250;

  // --- Triple spike: longest gap of the early section, still under full jump distance ---
  spikeRow(x, 3); x += 290;

  // --- Short breather ---
  x += 80;

  // --- Raised platform with a spike directly after the landing (clear runway after) ---
  block(x, 1, 3, 1); x += 3 * BLOCK + 60;
  spike(x); x += 260;

  // --- Two single spikes in a row, evenly spaced ---
  spike(x); x += 240;
  spike(x); x += 280;

  // --- Step staircase: 1 block high, then a short gap, then back down ---
  block(x, 1, 1, 1); x += BLOCK + 60;
  block(x, 1, 1, 1); x += BLOCK + 60;
  x += 60;

  // --- Double spike on flat ground ---
  spikeRow(x, 2); x += 290;

  // --- Mid-level breather / runway ---
  x += 120;

  // --- SHIP PORTAL: switch to ship mode for an open-sky flying section ---
  shipPortal(x); x += 140;

  // --- Ship section: fly through a gap between a low ground block and a floating spike above it ---
  block(x, 0, 2, 1);
  spike(x + 360, 2);
  x += 520;

  // --- Ship section: weave between staggered platforms ---
  block(x, 2, 2, 1); x += 280;
  block(x, 0, 2, 1); x += 280;

  // --- CUBE PORTAL: return to cube mode before resuming ground gameplay ---
  cubePortal(x); x += 160;

  // --- Elevated platform run with one spike on top (plenty of room to react) ---
  block(x, 1, 4, 1);
  spike(x + BLOCK * 2);
  x += 4 * BLOCK + 80;

  // --- Triple spike timing section, evenly spaced for rhythm ---
  spike(x); x += 230;
  spike(x); x += 230;
  spike(x); x += 280;

  // --- Short platform hop: small gap between two short platforms ---
  block(x, 1, 2, 1); x += 2 * BLOCK + 130;
  block(x, 1, 2, 1); x += 2 * BLOCK + 60;

  // --- Single spike, then double spike, increasing tension toward the end ---
  spike(x); x += 250;
  spikeRow(x, 2); x += 290;

  // --- Final platform + spike combo before the finish runway ---
  block(x, 1, 2, 1); x += 2 * BLOCK + 70;
  spike(x); x += 260;
  spike(x); x += 260;

  // --- Finish runway, clear ground ---
  x += 260;

  const endX = x + 100;
  items.push({ type: 'end', x: endX, w: 10, h: 10 });

  return { items, length: endX };
}

let level = buildLevel();
const LEVEL_LENGTH = level.length;

// ---------------- GAME STATE ----------------
const CAMERA_SCREEN_X_RATIO = 0.28; // player sits at this fraction of screen width

const state = {
  running: false,
  dead: false,
  won: false,
  attempts: 1,
  mode: 'cube',       // 'cube' or 'ship'
  cameraX: 0,         // camera's world-space x (left edge offset used for rendering)
  player: {
    x: 0,             // true world x position - the cube actually moves through the level
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

function cameraScreenX() {
  return canvas.width * CAMERA_SCREEN_X_RATIO;
}

function resetState() {
  state.dead = false;
  state.won = false;
  state.mode = 'cube';
  state.player.x = 0;
  state.player.y = groundTopScreenY() - PLAYER_SIZE;
  state.player.vy = 0;
  state.player.rotation = 0;
  state.player.onGround = true;
  state.player.holding = false;
  state.cameraX = state.player.x - cameraScreenX();
  state.trail = [];
  state.particles = [];
}

resetState();

// ---------------- MODE SWITCHING (PORTALS) ----------------
function enterShipMode() {
  state.mode = 'ship';
  state.player.onGround = false;
}
function enterCubeMode() {
  state.mode = 'cube';
  state.player.rotation = 0;
}

// ---------------- INPUT ----------------
function tryJump() {
  if (!state.running || state.dead || state.won) return;
  state.player.holding = true;
  if (state.mode === 'cube' && state.player.onGround) {
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
  const px = worldToScreenX(state.player.x);
  const py = state.player.y + PLAYER_SIZE;
  for (let i = 0; i < 6; i++) {
    state.particles.push({
      x: px + PLAYER_SIZE / 2,
      y: py,
      vx: (Math.random() - 0.5) * 140,
      vy: -Math.random() * 120,
      life: 0.35,
      maxLife: 0.35,
      color: '#ffffff',
      size: 3 + Math.random() * 2,
    });
  }
}

function spawnDeathParticles() {
  const px = worldToScreenX(state.player.x) + PLAYER_SIZE / 2;
  const py = state.player.y + PLAYER_SIZE / 2;
  for (let i = 0; i < 16; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 100 + Math.random() * 220;
    state.particles.push({
      x: px,
      y: py,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.5 + Math.random() * 0.3,
      maxLife: 0.5 + Math.random() * 0.3,
      color: '#5ad1ff',
      size: 3 + Math.random() * 3,
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

// ---------------- WORLD/SCREEN CONVERSION ----------------
function worldToScreenX(worldX) {
  return worldX - state.cameraX;
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

  const groundY = groundTopScreenY();
  const p = state.player;

  // the cube/ship physically advances through the world at constant speed
  p.x += SCROLL_SPEED * dt;

  // camera follows the player, keeping it at a fixed screen-space position
  state.cameraX = p.x - cameraScreenX();

  const floorY = groundY - PLAYER_SIZE;

  if (state.mode === 'ship') {
    // Ship physics: hold = thrust upward, release = fall, velocity clamped both ways
    p.vy += (p.holding ? SHIP_THRUST : SHIP_GRAVITY) * dt;
    if (p.vy > SHIP_MAX_VY) p.vy = SHIP_MAX_VY;
    if (p.vy < -SHIP_MAX_VY) p.vy = -SHIP_MAX_VY;
    p.y += p.vy * dt;

    // ship still can't fall through the ground or fly above the ceiling
    if (p.y >= floorY) {
      p.y = floorY;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
    const ceilingY = 0;
    if (p.y < ceilingY) {
      p.y = ceilingY;
      p.vy = 0;
    }
  } else {
    // physics (cube mode, unchanged)
    p.vy += GRAVITY * dt;
    p.y += p.vy * dt;

    // ground collision
    if (p.y >= floorY) {
      p.y = floorY;
      p.vy = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
  }

  const prevPlayerY = p.y - p.vy * dt; // y before this frame's vertical movement

  let landedOnBlock = false;
  for (const item of level.items) {
    if (item.type === 'block') {
      const bx = item.x;
      const bw = item.w;
      const by = groundY - item.yUnits * BLOCK - item.h;
      const bh = item.h;

      if (aabbIntersect(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, bx, by, bw, bh)) {
        if (state.mode === 'ship') {
          // ship mode: any contact with a block is fatal (no landing-on-top mechanic)
          killPlayer();
          return;
        }
        // landing on top: was above the block last frame and moving down
        if (prevPlayerY + PLAYER_SIZE <= by + 1 && p.vy >= 0) {
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
      const sy = groundY - sh - (item.yUnits || 0) * BLOCK;
      if (spikeCollision(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, sx, sy, sw, sh)) {
        killPlayer();
        return;
      }
    } else if (item.type === 'shipPortal') {
      if (state.mode !== 'ship' && aabbIntersect(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, item.x, groundY - item.h, item.w, item.h)) {
        enterShipMode();
      }
    } else if (item.type === 'cubePortal') {
      if (state.mode !== 'cube' && aabbIntersect(p.x, p.y, PLAYER_SIZE, PLAYER_SIZE, item.x, groundY - item.h, item.w, item.h)) {
        enterCubeMode();
      }
    } else if (item.type === 'end') {
      if (p.x + PLAYER_SIZE >= item.x) {
        winGame();
        return;
      }
    }
  }

  if (state.mode !== 'ship' && !landedOnBlock && p.y >= floorY) {
    p.y = floorY;
    p.onGround = true;
  }

  // rotation while airborne
  if (state.mode === 'ship') {
    // ship tilts based on vertical velocity instead of tumbling
    const targetTilt = (p.vy / SHIP_MAX_VY) * 0.35;
    p.rotation += (targetTilt - p.rotation) * Math.min(1, dt * 10);
  } else if (!p.onGround) {
    p.rotation += dt * 8.5; // radians/sec, GD-like tumble
  } else {
    // snap rotation to nearest 90deg smoothly
    const target = Math.round(p.rotation / (Math.PI / 2)) * (Math.PI / 2);
    p.rotation += (target - p.rotation) * Math.min(1, dt * 18);
  }

  // trail
  state.trail.push({ x: worldToScreenX(p.x) + PLAYER_SIZE / 2, y: p.y + PLAYER_SIZE / 2, life: 0.35 });
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
  const pct = Math.min(100, Math.floor((state.player.x / LEVEL_LENGTH) * 100));
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
  const pct = Math.min(100, Math.floor((state.player.x / LEVEL_LENGTH) * 100));
  percentText.textContent = pct + '%';
  progressBarFill.style.width = pct + '%';
}

// ---------------- RENDER ----------------
function drawBackground() {
  const w = canvas.width, h = canvas.height;
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, '#3a6cc9');
  grad.addColorStop(1, '#1c3f87');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // simple parallax stripes, classic GD background style
  ctx.fillStyle = 'rgba(255,255,255,0.05)';
  const stripeOffset = (state.cameraX * 0.25) % 160;
  for (let gx = -stripeOffset; gx < w; gx += 160) {
    ctx.fillRect(gx, 0, 60, h);
  }
}

function drawGround() {
  const w = canvas.width, h = canvas.height;
  const groundY = groundTopScreenY();

  // ground body - flat classic dark fill
  ctx.fillStyle = '#16161d';
  ctx.fillRect(0, groundY, w, h - groundY);

  // top edge line
  ctx.strokeStyle = '#0a0a0e';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, groundY);
  ctx.lineTo(w, groundY);
  ctx.stroke();

  // ground tile pattern (simple vertical seams)
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 2;
  const tileOffset = state.cameraX % 60;
  for (let gx = -tileOffset; gx < w; gx += 60) {
    ctx.beginPath();
    ctx.moveTo(gx, groundY + 8);
    ctx.lineTo(gx, h);
    ctx.stroke();
  }
}

function drawLevel() {
  const groundY = groundTopScreenY();
  const w = canvas.width;

  for (const item of level.items) {
    const screenX = worldToScreenX(item.x);
    if (screenX < -200 || screenX > w + 200) continue;

    if (item.type === 'spike') {
      drawSpike(screenX, groundY - (item.yUnits || 0) * BLOCK, item.w, item.h);
    } else if (item.type === 'block') {
      const topY = groundY - item.yUnits * BLOCK - item.h;
      drawBlock(screenX, topY, item.w, item.h);
    } else if (item.type === 'shipPortal') {
      drawPortal(screenX, groundY, item.w, item.h, '#3fdb6a');
    } else if (item.type === 'cubePortal') {
      drawPortal(screenX, groundY, item.w, item.h, '#3f9bdb');
    } else if (item.type === 'end') {
      drawEndMarker(screenX, groundY);
    }
  }
}

function drawSpike(screenX, groundY, sw, sh) {
  const baseY = groundY;
  const topY = groundY - sh;
  ctx.save();
  ctx.fillStyle = '#dcdcdc';
  ctx.strokeStyle = '#8a8a8a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(screenX + sw * 0.5, topY);
  ctx.lineTo(screenX + sw * 0.92, baseY);
  ctx.lineTo(screenX + sw * 0.08, baseY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // simple highlight edge
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(screenX + sw * 0.5, topY);
  ctx.lineTo(screenX + sw * 0.08, baseY);
  ctx.stroke();
  ctx.restore();
}

function drawBlock(screenX, topY, bw, bh) {
  ctx.save();
  const grad = ctx.createLinearGradient(screenX, topY, screenX, topY + bh);
  grad.addColorStop(0, '#3f9bdb');
  grad.addColorStop(1, '#2a6db0');
  ctx.fillStyle = grad;
  ctx.fillRect(screenX, topY, bw, bh);

  ctx.strokeStyle = '#1c4a78';
  ctx.lineWidth = 3;
  ctx.strokeRect(screenX + 1.5, topY + 1.5, bw - 3, bh - 3);

  // simple inset square detail, classic GD block look
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(screenX + 6, topY + 6, bw - 12, bh - 12);
  ctx.restore();
}

function drawEndMarker(screenX, groundY) {
  ctx.save();
  ctx.fillStyle = '#3fdb6a';
  ctx.fillRect(screenX, groundY - 300, 6, 300);
  ctx.restore();
}

function drawPortal(screenX, groundY, pw, ph, color) {
  const topY = groundY - ph;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(screenX + pw / 2, topY + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.18;
  ctx.beginPath();
  ctx.ellipse(screenX + pw / 2, topY + ph / 2, pw / 2, ph / 2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawTrail() {
  for (const t of state.trail) {
    const alpha = Math.max(t.life / 0.35, 0) * 0.35;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = '#ffd24a';
    ctx.beginPath();
    ctx.arc(t.x, t.y, PLAYER_SIZE * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  if (state.dead) return;
  const p = state.player;
  const cx = worldToScreenX(p.x) + PLAYER_SIZE / 2;
  const cy = p.y + PLAYER_SIZE / 2;

  if (state.mode === 'ship') {
    drawShip(cx, cy, p.rotation);
    return;
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(p.rotation);

  const half = PLAYER_SIZE / 2;
  const grad = ctx.createLinearGradient(-half, -half, half, half);
  grad.addColorStop(0, '#ffd24a');
  grad.addColorStop(1, '#ff9d1f');
  ctx.fillStyle = grad;
  ctx.fillRect(-half, -half, PLAYER_SIZE, PLAYER_SIZE);

  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 3;
  ctx.strokeRect(-half + 1.5, -half + 1.5, PLAYER_SIZE - 3, PLAYER_SIZE - 3);

  // simple face: two square eyes, classic GD icon style
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-half * 0.45, -half * 0.35, half * 0.5, half * 0.5);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(-half * 0.35, -half * 0.25, half * 0.2, half * 0.2);

  ctx.restore();
}

function drawShip(cx, cy, rotation) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotation);

  const w = SHIP_SIZE * 1.3;
  const h = SHIP_SIZE * 0.8;

  // flat classic ship body (simple polygon, no glow/gradients beyond a flat fill)
  ctx.fillStyle = '#ffd24a';
  ctx.strokeStyle = '#7a4a00';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(-w / 2, 0);
  ctx.lineTo(-w * 0.2, -h / 2);
  ctx.lineTo(w / 2, -h * 0.18);
  ctx.lineTo(w / 2, h * 0.18);
  ctx.lineTo(-w * 0.2, h / 2);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // cockpit window
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-w * 0.05, -h * 0.18, w * 0.22, h * 0.36);

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

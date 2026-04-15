/**
 * Rio Galaxian — lógica do jogo: sapo, enxame de moscas, projéteis, colisão AABB,
 * estados (jogando, pausa, vitória, derrota) e entrada de teclado.
 */
(function () {
  'use strict';

  const W = 800;
  const H = 600;
  const MARGIN = 16;
  const FROG_W = 52;
  const FROG_H = 44;
  const FROG_Y = H - FROG_H - 24;
  const FROG_SPEED = 260;
  const FLY_W = 40;
  const FLY_H = 32;
  const COLS = 8;
  const ROWS = 4;
  const CELL_X = 52;
  const CELL_Y = 42;
  const FORM_START_X = 80;
  const FORM_START_Y = 72;
  const BLOCK_SPEED_START = 55;
  const STEP_DOWN = 18;
  const PLAYER_FIRE_COOLDOWN = 0.32;
  const PLAYER_BULLET_SPEED = 420;
  const ENEMY_BULLET_SPEED = 220;
  const ENEMY_FIRE_INTERVAL = 0.55;
  /** Base do enunciado: 1 vida (fim ao primeiro acerto). Aumente para 3 no modo “extras” com vidas. */
  const LIVES_START = 3;

  /** Rasante: uma mosca por vez; ao voltar à formação, agenda-se a próxima. */
  const MAX_DIVING_FLIES = 1;
  const RASANTE_INTERVAL_MIN = 2.2;
  const RASANTE_INTERVAL_MAX = 4.5;
  const DIVE_OUT_SPEED = 0.38;
  const DIVE_RETURN_SPEED = 0.42;
  /** Bônus de pontos ao pegar mosca em rasante. */
  const RASANTE_SCORE_BONUS = 15;

  /** @type {HTMLCanvasElement} */
  let canvas;
  /** @type {WebGLRenderingContext} */
  let gl;
  /** @type {ReturnType<typeof WebGLRiverGame.createSpriteRenderer>} */
  let renderer;
  /** @type {HTMLCanvasElement} */
  let hudCanvas;
  /** @type {CanvasRenderingContext2D} */
  let hudCtx;

  let texFrog;
  let texFly;
  let texBulletPlayer;
  let texBulletEnemy;
  /** @type {WebGLTexture} */
  let texWater;
  let waterSourceCanvas;

  let lastTime = 0;
  let enemyFireTimer = 0;

  const keys = Object.create(null);

  const State = {
    PLAYING: 'playing',
    PAUSED: 'paused',
    WON: 'won',
    LOST: 'lost',
  };

  let gameState = State.PLAYING;
  let restartPrompt = false;
  /** Estado gravado ao abrir o diálogo de reinício (voltar nele se cancelar). */
  let stateBeforeRestartPrompt = State.PLAYING;
  let score = 0;
  let lives = LIVES_START;

  let frogX = W / 2 - FROG_W / 2;

  /** @type {{ x: number, y: number, vx: number, vy: number, w: number, h: number }[]} */
  let playerBullets = [];
  /** @type {{ x: number, y: number, vx: number, vy: number, w: number, h: number }[]} */
  let enemyBullets = [];

  /** @type {{ col: number, row: number, alive: boolean }[]} */
  let flies = [];
  let formation = {
    x: FORM_START_X,
    y: FORM_START_Y,
    vx: BLOCK_SPEED_START,
  };

  let playerFireCooldown = 0;
  let waterAnimT = 0;
  let rasanteTimer = 0;
  let rasanteNextIn = 2.5;

  // --- Curva de Bézier (rasante) ---

  /**
   * Ponto B(t) na curva cúbica de Bézier, t ∈ [0, 1].
   * @param {{x:number,y:number}} p0 p1 p2 p3
   */
  function cubicBezierPoint(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const uu = u * u;
    const tt = t * t;
    const uuu = uu * u;
    const ttt = tt * t;
    return {
      x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
      y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
    };
  }

  function slotCenter(f) {
    return {
      x: formation.x + f.col * CELL_X + FLY_W / 2,
      y: formation.y + f.row * CELL_Y + FLY_H / 2,
    };
  }

  function centerToTopLeft(cx, cy) {
    return { x: cx - FLY_W / 2, y: cy - FLY_H / 2 };
  }

  /** Inicia rasante: ida em Bézier em direção ao sapo e saindo por baixo. */
  function startDive(f) {
    if (!f.alive || f.diving) return;
    const s = slotCenter(f);
    const frogCx = frogX + FROG_W / 2;
    const frogCy = FROG_Y + FROG_H * 0.5;
    const p0 = { x: s.x, y: s.y };
    const p1 = {
      x: s.x + (frogCx - s.x) * 0.5,
      y: s.y + Math.max(40, (H * 0.38 - s.y) * 0.75),
    };
    const p2 = {
      x: frogCx + (s.x - frogCx) * 0.15,
      y: Math.min(H - 50, s.y + (H - s.y) * 0.72),
    };
    const p3 = {
      x: frogCx * 0.55 + s.x * 0.45,
      y: H + FLY_H + 20,
    };
    f.diving = true;
    f.divePhase = 'out';
    f.diveT = 0;
    f.diveOut = { p0: p0, p1: p1, p2: p2, p3: p3 };
    f.diveReturn = null;
    const pt0 = cubicBezierPoint(p0, p1, p2, p3, 0);
    const tl = centerToTopLeft(pt0.x, pt0.y);
    f.diveX = tl.x;
    f.diveY = tl.y;
  }

  function scheduleNextRasante() {
    rasanteNextIn =
      RASANTE_INTERVAL_MIN + Math.random() * (RASANTE_INTERVAL_MAX - RASANTE_INTERVAL_MIN);
    rasanteTimer = 0;
  }

  function countDiving() {
    let n = 0;
    for (let i = 0; i < flies.length; i++) {
      if (flies[i].alive && flies[i].diving) n++;
    }
    return n;
  }

  function tryStartRasante(dt) {
    rasanteTimer += dt;
    if (rasanteTimer < rasanteNextIn) return;
    scheduleNextRasante();
    if (countDiving() >= MAX_DIVING_FLIES) return;
    const candidates = [];
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (f.alive && !f.diving) {
        candidates.push(f);
      }
    }
    if (candidates.length === 0) return;
    const pick = candidates[(Math.random() * candidates.length) | 0];
    startDive(pick);
  }

  /** Atualiza posição das moscas em rasante (Bézier ida → wrap → Bézier volta). */
  function updateDivingFlies(dt) {
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (!f.alive || !f.diving) continue;

      if (f.divePhase === 'out') {
        f.diveT += DIVE_OUT_SPEED * dt;
        if (f.diveT > 1) f.diveT = 1;
        const o = f.diveOut;
        const pt = cubicBezierPoint(o.p0, o.p1, o.p2, o.p3, f.diveT);
        let tl = centerToTopLeft(pt.x, pt.y);
        f.diveX = tl.x;
        f.diveY = tl.y;
        const pastBottom = tl.y + FLY_H >= H - 4;
        if (pastBottom || f.diveT >= 1) {
          const cx = Math.max(MARGIN + FLY_W / 2, Math.min(W - MARGIN - FLY_W / 2, pt.x));
          const retP0 = { x: cx, y: -FLY_H * 0.5 };
          const slot = slotCenter(f);
          const retP3 = { x: slot.x, y: slot.y };
          const retP1 = {
            x: retP0.x + (retP3.x - retP0.x) * 0.38,
            y: retP0.y + Math.max(120, (retP3.y - retP0.y) * 0.45),
          };
          const retP2 = {
            x: retP3.x - (retP3.x - retP0.x) * 0.22,
            y: retP3.y - (retP3.y - retP0.y) * 0.35,
          };
          f.divePhase = 'return';
          f.diveT = 0;
          f.diveReturn = { p0: retP0, p1: retP1, p2: retP2, p3: retP3 };
        }
      }

      if (f.divePhase === 'return' && f.diveReturn) {
        const slot = slotCenter(f);
        const r = f.diveReturn;
        r.p3 = slot;
        r.p1 = {
          x: r.p0.x + (r.p3.x - r.p0.x) * 0.38,
          y: r.p0.y + Math.max(100, (r.p3.y - r.p0.y) * 0.42),
        };
        r.p2 = {
          x: r.p3.x - (r.p3.x - r.p0.x) * 0.2,
          y: r.p3.y - (r.p3.y - r.p0.y) * 0.32,
        };
        f.diveT += DIVE_RETURN_SPEED * dt;
        if (f.diveT > 1) f.diveT = 1;
        const ptR = cubicBezierPoint(r.p0, r.p1, r.p2, r.p3, f.diveT);
        const tlR = centerToTopLeft(ptR.x, ptR.y);
        f.diveX = tlR.x;
        f.diveY = tlR.y;
        const dx = ptR.x - slot.x;
        const dy = ptR.y - slot.y;
        if (f.diveT >= 1 || dx * dx + dy * dy < 28 * 28) {
          endDiveClean(f);
          /* Próximo rasante só depois que esta mosca reassumiu o lugar na esquadra. */
          scheduleNextRasante();
        }
      }
    }
  }

  function endDiveClean(f) {
    f.diving = false;
    f.divePhase = null;
    f.diveOut = null;
    f.diveReturn = null;
    f.diveT = 0;
  }

  // --- Texturas procedurais (canvas → WebGL) ---

  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  function drawFrogTexture(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#5cb85c');
    g.addColorStop(1, '#2d6a2d');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.55, w * 0.42, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#8fd98f';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.52, w * 0.32, h * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.45, 4, 0, Math.PI * 2);
    ctx.arc(w * 0.65, h * 0.45, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c8f5c8';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.72, w * 0.12, h * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawFlyTexture(ctx, w, h) {
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.5, w * 0.35, h * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,180,200,0.65)';
    ctx.beginPath();
    ctx.ellipse(w * 0.2, h * 0.45, w * 0.22, h * 0.12, -0.4, 0, Math.PI * 2);
    ctx.ellipse(w * 0.8, h * 0.45, w * 0.22, h * 0.12, 0.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath();
    ctx.arc(w * 0.42, h * 0.48, 3, 0, Math.PI * 2);
    ctx.arc(w * 0.58, h * 0.48, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWaterTexture(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a4a6e');
    g.addColorStop(0.45, '#2a6a8e');
    g.addColorStop(1, '#0d3a52');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 14; i++) {
      const y = (i / 14) * h + Math.sin(t * 2 + i) * 6;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 8) {
        ctx.lineTo(x, y + Math.sin(x * 0.02 + t * 3 + i) * 4);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(40,90,60,0.35)';
    ctx.fillRect(0, h * 0.88, w, h * 0.12);
  }

  function drawBulletTexture(ctx, w, h, color) {
    const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function uploadWaterTexture() {
    const ctx = waterSourceCanvas.getContext('2d');
    drawWaterTexture(ctx, W, H, waterAnimT);
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, waterSourceCanvas);
  }

  function initTextures() {
    const cFrog = makeCanvas(64, 64);
    drawFrogTexture(cFrog.getContext('2d'), 64, 64);
    texFrog = renderer.createTextureFromSource(gl, cFrog);

    const cFly = makeCanvas(64, 64);
    drawFlyTexture(cFly.getContext('2d'), 64, 64);
    texFly = renderer.createTextureFromSource(gl, cFly);

    const cBp = makeCanvas(16, 24);
    drawBulletTexture(cBp.getContext('2d'), 16, 24, '#ffe066');
    texBulletPlayer = renderer.createTextureFromSource(gl, cBp);

    const cBe = makeCanvas(14, 18);
    drawBulletTexture(cBe.getContext('2d'), 14, 18, '#ff5555');
    texBulletEnemy = renderer.createTextureFromSource(gl, cBe);

    waterSourceCanvas = makeCanvas(W, H);
    texWater = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    uploadWaterTexture();
  }

  function resetFlies() {
    flies = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        flies.push({
          col,
          row,
          alive: true,
          diving: false,
          divePhase: null,
          diveT: 0,
          diveX: 0,
          diveY: 0,
          diveOut: null,
          diveReturn: null,
        });
      }
    }
  }

  function resetGame() {
    gameState = State.PLAYING;
    restartPrompt = false;
    score = 0;
    lives = LIVES_START;
    frogX = W / 2 - FROG_W / 2;
    playerBullets = [];
    enemyBullets = [];
    formation.x = FORM_START_X;
    formation.y = FORM_START_Y;
    formation.vx = BLOCK_SPEED_START;
    resetFlies();
    playerFireCooldown = 0;
    enemyFireTimer = 0;
    scheduleNextRasante();
  }

  function flyWorldPos(fly) {
    if (fly.diving) {
      return { x: fly.diveX, y: fly.diveY, w: FLY_W, h: FLY_H };
    }
    return {
      x: formation.x + fly.col * CELL_X,
      y: formation.y + fly.row * CELL_Y,
      w: FLY_W,
      h: FLY_H,
    };
  }

  function aliveFlies() {
    return flies.filter(function (f) {
      return f.alive;
    });
  }

  /** Moscas que ainda contam para o movimento em bloco (fora do rasante). */
  function formationFlies() {
    const out = [];
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (f.alive && !f.diving) {
        out.push(f);
      }
    }
    return out;
  }

  function formationBounds() {
    const alive = formationFlies();
    if (alive.length === 0) {
      return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < alive.length; i++) {
      const p = flyWorldPos(alive[i]);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y + p.h);
    }
    return { minX, maxX, minY, maxY };
  }

  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function countAliveFlies() {
    let n = 0;
    for (let i = 0; i < flies.length; i++) {
      if (flies[i].alive) n++;
    }
    return n;
  }

  function tryEnemyFire() {
    const alive = aliveFlies();
    if (alive.length === 0) return;
    const f = alive[(Math.random() * alive.length) | 0];
    const p = flyWorldPos(f);
    enemyBullets.push({
      x: p.x + p.w / 2 - 7,
      y: p.y + p.h,
      vx: 0,
      vy: ENEMY_BULLET_SPEED,
      w: 14,
      h: 18,
    });
  }

  function updateFormation(dt) {
    if (formationFlies().length === 0) {
      return;
    }
    const dx = formation.vx * dt;
    formation.x += dx;
    const b = formationBounds();
    const leftBound = MARGIN;
    const rightBound = W - MARGIN;
    if (b.minX < leftBound) {
      formation.x += leftBound - b.minX;
      formation.vx = Math.abs(formation.vx);
      formation.y += STEP_DOWN;
    } else if (b.maxX > rightBound) {
      formation.x -= b.maxX - rightBound;
      formation.vx = -Math.abs(formation.vx);
      formation.y += STEP_DOWN;
    }
  }

  /**
   * Game over só se uma mosca **na formação** alcança a margem do sapo.
   * Moscas em rasante atravessam a área baixa e reaparecem no topo — não contam aqui.
   */
  function checkFlyReachedBank() {
    const frogTop = FROG_Y;
    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (!f.alive || f.diving) {
        continue;
      }
      const p = flyWorldPos(f);
      if (p.y + p.h >= frogTop) {
        return true;
      }
    }
    return false;
  }

  function update(dt) {
    if (gameState !== State.PLAYING) return;

    if (keys['ArrowLeft']) {
      frogX -= FROG_SPEED * dt;
    }
    if (keys['ArrowRight']) {
      frogX += FROG_SPEED * dt;
    }
    frogX = Math.max(MARGIN, Math.min(W - FROG_W - MARGIN, frogX));

    if (keys[' '] && playerFireCooldown <= 0) {
      playerBullets.push({
        x: frogX + FROG_W / 2 - 8,
        y: FROG_Y - 20,
        vx: 0,
        vy: -PLAYER_BULLET_SPEED,
        w: 16,
        h: 24,
      });
      playerFireCooldown = PLAYER_FIRE_COOLDOWN;
    }
    if (playerFireCooldown > 0) {
      playerFireCooldown -= dt;
    }

    updateFormation(dt);
    updateDivingFlies(dt);
    tryStartRasante(dt);

    enemyFireTimer += dt;
    while (enemyFireTimer >= ENEMY_FIRE_INTERVAL) {
      enemyFireTimer -= ENEMY_FIRE_INTERVAL;
      tryEnemyFire();
    }

    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y + b.h < 0) {
        playerBullets.splice(i, 1);
        continue;
      }
      let hit = false;
      for (let j = 0; j < flies.length; j++) {
        const f = flies[j];
        if (!f.alive) continue;
        const p = flyWorldPos(f);
        if (aabb(b.x, b.y, b.w, b.h, p.x, p.y, p.w, p.h)) {
          const wasDiving = f.diving;
          f.alive = false;
          endDiveClean(f);
          hit = true;
          score += 10 + (ROWS - f.row) * 2;
          if (wasDiving) {
            score += RASANTE_SCORE_BONUS;
          }
          break;
        }
      }
      if (hit) {
        playerBullets.splice(i, 1);
      }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > H) {
        enemyBullets.splice(i, 1);
        continue;
      }
      if (aabb(b.x, b.y, b.w, b.h, frogX, FROG_Y, FROG_W, FROG_H)) {
        enemyBullets.splice(i, 1);
        lives -= 1;
        if (lives <= 0) {
          gameState = State.LOST;
        }
      }
    }

    if (checkFlyReachedBank()) {
      gameState = State.LOST;
    } else if (countAliveFlies() === 0) {
      gameState = State.WON;
    }
  }

  function renderScene() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.05, 0.08, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    uploadWaterTexture();
    renderer.drawSprite(texWater, 0, 0, W, H, 1, 1, 1, 1);

    for (let i = 0; i < flies.length; i++) {
      const f = flies[i];
      if (!f.alive) continue;
      const p = flyWorldPos(f);
      renderer.drawSprite(texFly, p.x, p.y, p.w, p.h, 1, 1, 1, 1);
    }

    for (let i = 0; i < playerBullets.length; i++) {
      const b = playerBullets[i];
      renderer.drawSprite(texBulletPlayer, b.x, b.y, b.w, b.h, 1, 1, 1, 1);
    }
    for (let i = 0; i < enemyBullets.length; i++) {
      const b = enemyBullets[i];
      renderer.drawSprite(texBulletEnemy, b.x, b.y, b.w, b.h, 1, 1, 1, 1);
    }

    renderer.drawSprite(texFrog, frogX, FROG_Y, FROG_W, FROG_H, 1, 1, 1, 1);
  }

  function renderHud() {
    hudCtx.clearRect(0, 0, W, H);
    hudCtx.fillStyle = 'rgba(0,0,0,0.45)';
    hudCtx.fillRect(8, 8, 220, 52);
    hudCtx.fillStyle = '#e8f8ff';
    hudCtx.font = 'bold 16px Segoe UI, sans-serif';
    hudCtx.textAlign = 'left';
    hudCtx.fillText('Pontos: ' + score, 18, 32);
    hudCtx.fillText('Vidas: ' + lives, 18, 52);

    if (restartPrompt) {
      hudCtx.fillStyle = 'rgba(0,0,0,0.75)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.fillStyle = '#fff';
      hudCtx.font = 'bold 22px Segoe UI, sans-serif';
      hudCtx.textAlign = 'center';
      hudCtx.fillText('Reiniciar o jogo?', W / 2, H / 2 - 24);
      hudCtx.font = '16px Segoe UI, sans-serif';
      hudCtx.fillText('S ou Enter = sim   |   N ou Esc = não', W / 2, H / 2 + 12);
    } else if (gameState === State.PAUSED) {
      hudCtx.fillStyle = 'rgba(0,0,0,0.65)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.fillStyle = '#fff';
      hudCtx.font = 'bold 26px Segoe UI, sans-serif';
      hudCtx.textAlign = 'center';
      hudCtx.fillText('PAUSADO', W / 2, H / 2 - 10);
      hudCtx.font = '16px Segoe UI, sans-serif';
      hudCtx.fillText('ESC para continuar', W / 2, H / 2 + 22);
    } else if (gameState === State.WON) {
      hudCtx.fillStyle = 'rgba(0,40,20,0.75)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.fillStyle = '#c8ffc8';
      hudCtx.font = 'bold 28px Segoe UI, sans-serif';
      hudCtx.textAlign = 'center';
      hudCtx.fillText('Todas as moscas foram pegas!', W / 2, H / 2 - 8);
      hudCtx.font = '16px Segoe UI, sans-serif';
      hudCtx.fillText('R para reiniciar (com confirmação)', W / 2, H / 2 + 28);
    } else if (gameState === State.LOST) {
      hudCtx.fillStyle = 'rgba(40,0,0,0.75)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.fillStyle = '#ffc8c8';
      hudCtx.font = 'bold 28px Segoe UI, sans-serif';
      hudCtx.textAlign = 'center';
      hudCtx.fillText('Fim de jogo', W / 2, H / 2 - 8);
      hudCtx.font = '16px Segoe UI, sans-serif';
      hudCtx.fillText('R para reiniciar (com confirmação)', W / 2, H / 2 + 28);
    }
  }

  function frame(time) {
    const ms = time * 0.001;
    const dt = lastTime ? Math.min(ms - lastTime, 0.05) : 0;
    lastTime = ms;

    if (gameState === State.PLAYING) {
      update(dt);
    }
    waterAnimT += dt;

    renderScene();
    renderHud();
    requestAnimationFrame(frame);
  }

  function onKeyDown(e) {
    keys[e.key] = true;

    if (restartPrompt) {
      if (e.key === 's' || e.key === 'S' || e.key === 'Enter') {
        restartPrompt = false;
        resetGame();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
        restartPrompt = false;
        gameState = stateBeforeRestartPrompt;
      }
      if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
      }
      return;
    }

    if (e.key === 'Escape') {
      if (gameState === State.PLAYING) {
        gameState = State.PAUSED;
      } else if (gameState === State.PAUSED) {
        gameState = State.PLAYING;
      }
      e.preventDefault();
    }

    if (e.key === 'r' || e.key === 'R') {
      stateBeforeRestartPrompt = gameState;
      restartPrompt = true;
      e.preventDefault();
    }

    if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
    }
  }

  function onKeyUp(e) {
    keys[e.key] = false;
  }

  function init() {
    canvas = document.getElementById('gameCanvas');
    hudCanvas = document.getElementById('hudCanvas');
    if (!canvas || !hudCanvas) {
      console.error('Canvas não encontrado');
      return;
    }
    gl = canvas.getContext('webgl');
    if (!gl) {
      alert('Seu navegador não suporta WebGL.');
      return;
    }
    hudCtx = hudCanvas.getContext('2d');

    renderer = WebGLRiverGame.createSpriteRenderer(gl);
    initTextures();
    resetGame();

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

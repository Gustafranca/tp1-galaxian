/**
  Rio Galaxian
    - Releitura do clássico Galaxian, com uma rã tentando capturar um enxame de moscas.
    Criado por Gustavi França

    Principais diferenciais:
    -  Efeitos visuais e sonoros.
    - Modo de "disparo" diferente porém mantém a dificuldade. E é bem comico.
    - As moscas tem texturas e valore diferentes.
    
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
  const PLAYER_FIRE_COOLDOWN = 0.6;
  const PLAYER_BULLET_SPEED = 320;
  const ENEMY_BULLET_SPEED = 250;
  const ENEMY_FIRE_INTERVAL = 0.3;
  const LIVES_START = 3;

  /** Rasante: uma mosca por vez. */
  const MAX_DIVING_FLIES = 6;
  const RASANTE_INTERVAL_MIN = 0;
  const RASANTE_INTERVAL_MAX = 4.5;
  const DIVE_OUT_SPEED = 0.5;
  const DIVE_RETURN_SPEED = 0.42;
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

  let texFrog1, texFrog2;
  let texFly1, texFly2;
  let texBulletPlayer;
  let texBulletEnemy;
  /** @type {WebGLTexture} */
  let texWater;
  let waterSourceCanvas;

  let lastTime = 0;
  let enemyFireTimer = 0;
  const keys = Object.create(null);

  /** Estados da tela de jogo */
  const State = {
    START_SCREEN: 'start',
    PLAYING: 'playing',
    PAUSED: 'paused',
    WON: 'won',
    LOST: 'lost',
  };
  // configuracões iniciais do jogo
  let gameState = State.START_SCREEN;
  let restartPrompt = false;
  let stateBeforeRestartPrompt = State.PLAYING;
  let score = 0;
  let lives = LIVES_START;
  let highscore = parseInt(localStorage.getItem('rio_galaxian_highscore') || '0');
  let frogX = W / 2 - FROG_W / 2;

  // Atualiza o highscore se necessário
  function updateHighscore() {
    const key = 'rio_galaxian_highscore';
    let currentHigh = parseInt(localStorage.getItem(key) || '0');
    if (score > currentHigh) {
      localStorage.setItem(key, score.toString());
      highscore = score;
    }
  }

  /** @type {{ x: number, y: number, vx: number, vy: number, w: number, h: number, returning: boolean }[]} */
  let playerBullets = [];
  /** @type {{ x: number, y: number, vx: number, vy: number, w: number, h: number }[]} */
  let enemyBullets = [];
  /** @type {{ col: number, row: number, alive: boolean, type: any, diving: boolean, divePhase: string, diveT: number, diveX: number, diveY: number, diveOut: any, diveReturn: any }[]} */
  let flies = [];
  let formation = { x: FORM_START_X, y: FORM_START_Y, vx: BLOCK_SPEED_START };

  let playerFireCooldown = 0;
  let waterAnimT = 0;
  let rasanteTimer = 0;
  let rasanteNextIn = 2.5;

  // Procurei por sons que pareciam com os dos tiros dos jogos antigos, mario 64 ou pacman.
  // Vi que existia o Web Audio API, com a ajuda de AI cheguei nesse resultado
  let audioCtx;
  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  function playSound(freq, type, duration, vol) {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || 'sine';
    if (typeof freq === 'object') {
      osc.frequency.setValueAtTime(freq.start, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq.end, audioCtx.currentTime + duration);
    } else {
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    }
    gain.gain.setValueAtTime(vol || 0.1, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  }
  // Declarando os sons do jogo: Frequencia, tipo de onda, duração e volume
  const Snd = {
    FIRE: () => playSound({ start: 150, end: 400 }, 'square', 0.1, 0.05),
    HIT: () => playSound({ start: 200, end: 50 }, 'sawtooth', 0.15, 0.08),
    LOSE: () => playSound({ start: 300, end: 40 }, 'sine', 0.8, 0.1),
    WIN: () => {
      playSound(440, 'sine', 0.2, 0.1);
      setTimeout(() => playSound(659, 'sine', 0.4, 0.1), 150);
    },
  };

  // Implementacao da curva de bezier para os movimentos de mergulho das moscas
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
  
  // calcula a posicao de mergulho das moscas,
  // usando a posicao do sapo de referencia, para crair um movimento em direcao ao sapo
  function startDive(f) {
    if (!f.alive || f.diving) return;
    const s = slotCenter(f);
    const frogCx = frogX + FROG_W / 2;
    const p0 = { x: s.x, y: s.y };
    const p1 = {
      x: s.x + (frogCx - s.x) * 0.5,
      y: s.y + Math.max(40, (H * 0.38 - s.y) * 0.75),
    };

    const p2 = {
      x: frogCx + (s.x - frogCx) * 0.15,
      y: Math.min(H - 50, s.y + (H - s.y) * 0.72),
    };
    const p3 = { x: frogCx * 0.55 + s.x * 0.45, y: H + FLY_H + 20 };
    f.diving = true;
    f.divePhase = 'out';
    f.diveT = 0;
    f.diveOut = { p0, p1, p2, p3 };
    f.diveReturn = null;
    const pt0 = cubicBezierPoint(p0, p1, p2, p3, 0);
    const tl = centerToTopLeft(pt0.x, pt0.y);
    f.diveX = tl.x;
    f.diveY = tl.y;
  }
  function scheduleNextRasante() {
    rasanteNextIn = RASANTE_INTERVAL_MIN + Math.random() * (RASANTE_INTERVAL_MAX - RASANTE_INTERVAL_MIN);
    rasanteTimer = 0;
  }
  function countDiving() {
    return flies.filter(f => f.alive && f.diving).length;
  }
  function tryStartRasante(dt) {
    rasanteTimer += dt;
    if (rasanteTimer < rasanteNextIn) return;
    scheduleNextRasante();

    if (countDiving() >= MAX_DIVING_FLIES) return;
    const candidates = flies.filter(f => f.alive && !f.diving);
    if (candidates.length > 0) startDive(candidates[(Math.random() * candidates.length) | 0]);
  }
  function updateDivingFlies(dt) {
    for (let f of flies) {
      if (!f.alive || !f.diving) continue;
      if (f.divePhase === 'out') {
        f.diveT += DIVE_OUT_SPEED * dt;
        if (f.diveT > 1) f.diveT = 1;
        const pt = cubicBezierPoint(f.diveOut.p0, f.diveOut.p1, f.diveOut.p2, f.diveOut.p3, f.diveT);
        let tl = centerToTopLeft(pt.x, pt.y);
        f.diveX = tl.x;
        f.diveY = tl.y;
        if (tl.y + FLY_H >= H - 4 || f.diveT >= 1) {
          const cx = Math.max(MARGIN + FLY_W / 2, Math.min(W - MARGIN - FLY_W / 2, pt.x));
          const retP0 = { x: cx, y: -FLY_H * 0.5 };
          const slot = slotCenter(f);
          f.divePhase = 'return';
          f.diveT = 0;
          f.diveReturn = {
            p0: retP0,
            p1: { x: retP0.x + (slot.x - retP0.x) * 0.38, y: retP0.y + 120 },
            p2: { x: slot.x - (slot.x - retP0.x) * 0.22, y: slot.y - 40 },
            p3: slot,
          };
        }
      }
      if (f.divePhase === 'return') {
        const slot = slotCenter(f);
        f.diveReturn.p3 = slot;
        f.diveT += DIVE_RETURN_SPEED * dt;
        if (f.diveT > 1) f.diveT = 1;
        const ptR = cubicBezierPoint(
          f.diveReturn.p0,
          f.diveReturn.p1,
          f.diveReturn.p2,
          f.diveReturn.p3,
          f.diveT,
        );
        let tlR = centerToTopLeft(ptR.x, ptR.y);
        f.diveX = tlR.x;
        f.diveY = tlR.y;
        if (f.diveT >= 1 || Math.hypot(ptR.x - slot.x, ptR.y - slot.y) < 28) {
          endDiveClean(f);
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

  // --- Texturas ---
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }
  function drawFrogTexture(ctx, w, h, blinking) {
    ctx.clearRect(0, 0, w, h);
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
    ctx.fillStyle = blinking ? '#2d6a2d' : '#111';
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.45, blinking ? 2 : 4, 0, Math.PI * 2);
    ctx.arc(w * 0.65, h * 0.45, blinking ? 2 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
  function drawFlyTexture(ctx, w, h, wingState) {
    const wingSwing = wingState * 0.3;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#4a4a4a';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.5, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(180,180,200,0.7)';
    ctx.beginPath();
    ctx.ellipse(w * 0.2, h * 0.45, w * 0.25, h * 0.12, -0.4 + wingSwing, 0, Math.PI * 2);
    ctx.ellipse(w * 0.8, h * 0.45, w * 0.25, h * 0.12, 0.4 - wingSwing, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#eee';
    ctx.beginPath();
    ctx.arc(w * 0.4, h * 0.4, 4, 0, Math.PI * 2);
    ctx.arc(w * 0.6, h * 0.4, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(w * 0.4, h * 0.4, 2, 0, Math.PI * 2);
    ctx.arc(w * 0.6, h * 0.4, 2, 0, Math.PI * 2);
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
  function drawBulletTexture(ctx, w, h, color, isRect) {
    if (isRect) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, w, h);
    } else {
      const g = ctx.createRadialGradient(w / 2, h / 2, 1, w / 2, h / 2, w / 2);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  }
  function uploadWaterTexture() {
    const ctx = waterSourceCanvas.getContext('2d');
    drawWaterTexture(ctx, W, H, waterAnimT);
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, waterSourceCanvas);
  }
  function initTextures() {
    const c = makeCanvas(64, 64);
    drawFrogTexture(c.getContext('2d'), 64, 64, false);
    texFrog1 = renderer.createTextureFromSource(gl, c);
    drawFrogTexture(c.getContext('2d'), 64, 64, true);
    texFrog2 = renderer.createTextureFromSource(gl, c);

    drawFlyTexture(c.getContext('2d'), 64, 64, -1);
    texFly1 = renderer.createTextureFromSource(gl, c);
    drawFlyTexture(c.getContext('2d'), 64, 64, 1);
    texFly2 = renderer.createTextureFromSource(gl, c);

    const cb = makeCanvas(16, 16);
    drawBulletTexture(cb.getContext('2d'), 16, 16, '#ffffff', true);
    texBulletPlayer = renderer.createTextureFromSource(gl, cb);

    const ce = makeCanvas(14, 18);
    drawBulletTexture(ce.getContext('2d'), 14, 18, '#ff5555', false);
    texBulletEnemy = renderer.createTextureFromSource(gl, ce);

    waterSourceCanvas = makeCanvas(W, H);
    texWater = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    uploadWaterTexture();
  }

  // --- Partículas e Inimigos ---
  let particles = [];
  const FlyType = {
    NORMAL: { color: [1, 1, 1, 1], score: 10, size: 1.0 },
    BIG: { color: [0.7, 1, 0.7, 1], score: 30, size: 1.3 },
    FAST: { color: [1, 0.7, 0.7, 1], score: 20, size: 0.8 },
  };
  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 12; i++) {
      particles.push({
        x,
        y,
        vx: (Math.random() - 0.5) * 200,
        vy: (Math.random() - 0.5) * 200,
        life: 0.6 + Math.random() * 0.4,
        color: color || [1, 1, 1, 1],
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }
  function resetFlies() {
    flies = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        let type = FlyType.NORMAL;
        if (row === 0) type = FlyType.BIG;
        else if (row === ROWS - 1) type = FlyType.FAST;
        flies.push({
          col,
          row,
          type,
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
  function resetGame(initialState) {
    gameState = initialState || State.PLAYING;
    restartPrompt = false;
    score = 0;
    lives = LIVES_START;
    frogX = W / 2 - FROG_W / 2;
    playerBullets = [];
    enemyBullets = [];
    particles = [];
    formation.x = FORM_START_X;
    formation.y = FORM_START_Y;
    formation.vx = BLOCK_SPEED_START;
    resetFlies();
    playerFireCooldown = 0;
    enemyFireTimer = 0;
    scheduleNextRasante();
  }

  function flyWorldPos(fly) {
    if (fly.diving) return { x: fly.diveX, y: fly.diveY, w: FLY_W, h: FLY_H };
    let bx = formation.x + fly.col * CELL_X;
    let by = formation.y + fly.row * CELL_Y;
    return { x: bx, y: by, w: FLY_W, h: FLY_H };
  }
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function tryEnemyFire() {
    const alive = flies.filter(f => f.alive);
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
    const fAlive = flies.filter(f => f.alive && !f.diving);
    if (fAlive.length === 0) return;
    formation.x += formation.vx * dt;
    let minX = Infinity;
    let maxX = -Infinity;
    for (let f of fAlive) {
      const p = flyWorldPos(f);
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x + p.w);
    }
    if (minX < MARGIN) {
      formation.x += MARGIN - minX;
      formation.vx = Math.abs(formation.vx);
      formation.y += STEP_DOWN;
    } else if (maxX > W - MARGIN) {
      formation.x -= maxX - (W - MARGIN);
      formation.vx = -Math.abs(formation.vx);
      formation.y += STEP_DOWN;
    }
  }

  function update(dt) {
    if (gameState !== State.PLAYING) return;
    if (keys['ArrowLeft']) frogX -= FROG_SPEED * dt;
    if (keys['ArrowRight']) frogX += FROG_SPEED * dt;
    frogX = Math.max(MARGIN, Math.min(W - FROG_W - MARGIN, frogX));
    
    if (keys[' '] && playerFireCooldown <= 0) {
      Snd.FIRE();
      playerBullets.push({
        x: frogX + FROG_W / 2 - 6,
        y: FROG_Y,
        vy: -PLAYER_BULLET_SPEED * 1.5,
        w: 12,
        h: 12,
        returning: false,
      });
      playerFireCooldown = PLAYER_FIRE_COOLDOWN;
    }
    if (playerFireCooldown > 0) playerFireCooldown -= dt;
    updateFormation(dt);
    updateDivingFlies(dt);
    tryStartRasante(dt);
    updateParticles(dt);
    
    enemyFireTimer += dt;
    while (enemyFireTimer >= ENEMY_FIRE_INTERVAL) {
      enemyFireTimer -= ENEMY_FIRE_INTERVAL;
      tryEnemyFire();
    }

    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      b.x = frogX + FROG_W / 2 - b.w / 2;
      if (!b.returning) {
        b.y += b.vy * dt;
        if (b.y < 20) b.returning = true;
        for (let f of flies) {
          if (!f.alive) continue;
          const p = flyWorldPos(f);
          if (aabb(b.x, b.y, b.w, b.h, p.x, p.y, p.w, p.h)) {
            f.alive = false;
            endDiveClean(f);
            Snd.HIT();
            score += f.type.score + (ROWS - f.row) * 2;
            if (f.diving) score += RASANTE_SCORE_BONUS;
            spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, f.type.color);
            b.returning = true;
            break;
          }
        }
      } else {
        b.y -= b.vy * 2.0 * dt;
        if (b.y >= FROG_Y) playerBullets.splice(i, 1);
      }
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
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
          Snd.LOSE();
        } else {
          Snd.HIT();
        }
      }
    }

    for (let f of flies) {
      if (!f.alive || !f.diving) continue;
      const p = flyWorldPos(f);
      if (aabb(p.x, p.y, p.w, p.h, frogX, FROG_Y, FROG_W, FROG_H)) {
        f.alive = false;
        endDiveClean(f);
        spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, f.type.color);
        lives -= 1;
        if (lives <= 0) {
          gameState = State.LOST;
          updateHighscore();
          Snd.LOSE();
        } else {
          Snd.HIT();
        }
        break; 
      }
    }

    if (flies.some(f => f.alive && !f.diving && flyWorldPos(f).y + FLY_H >= FROG_Y)) {
      gameState = State.LOST;
      updateHighscore();
      Snd.LOSE();
    } else if (flies.length > 0 && !flies.some(f => f.alive)) {
      gameState = State.WON;
      updateHighscore();
      Snd.WIN();
    }
  }

  function renderScene() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.05, 0.08, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    uploadWaterTexture();
    renderer.drawSprite(texWater, 0, 0, W, H, 1, 1, 1, 1, waterAnimT);
    for (let p of particles) {
      renderer.drawSprite(
        texBulletPlayer,
        p.x - 4,
        p.y - 4,
        8,
        8,
        p.color[0],
        p.color[1],
        p.color[2],
        Math.min(1.0, p.life * 1.5),
        waterAnimT,
      );
    }
    const flyTex = Math.floor(waterAnimT * 10) % 2 === 0 ? texFly1 : texFly2;
    for (let f of flies) {
      if (!f.alive) continue;
      const p = flyWorldPos(f);
      const s = f.type.size;
      const c = f.type.color;
      renderer.drawSprite(
        flyTex,
        p.x - (p.w * (s - 1)) / 2,
        p.y - (p.h * (s - 1)) / 2,
        p.w * s,
        p.h * s,
        c[0],
        c[1],
        c[2],
        c[3],
        waterAnimT,
      );
    }
    for (let b of playerBullets) {
      renderer.drawSprite(texBulletPlayer, b.x, b.y, b.w, FROG_Y - b.y, 1, 0.4, 0.6, 1, waterAnimT);
    }
    for (let b of enemyBullets) {
      renderer.drawSprite(texBulletEnemy, b.x, b.y, b.w, b.h, 1, 1, 1, 1, waterAnimT);
    }
    renderer.drawSprite(
      Math.floor(waterAnimT * 2) % 10 === 0 ? texFrog2 : texFrog1,
      frogX,
      FROG_Y,
      FROG_W,
      FROG_H,
      1,
      1,
      1,
      1,
      waterAnimT,
    );
  }

  function renderHud() {
    hudCtx.clearRect(0, 0, W, H);
    hudCtx.fillStyle = 'rgba(0,0,0,0.45)';
    hudCtx.fillRect(8, 8, 240, 52);
    hudCtx.fillStyle = '#e8f8ff';
    hudCtx.font = 'bold 16px Segoe UI, sans-serif';
    hudCtx.textAlign = 'left';
    hudCtx.fillText('Pontos: ' + score, 18, 32);
    hudCtx.fillText('Vidas: ' + lives, 18, 52);
    hudCtx.textAlign = 'right';
    hudCtx.fillStyle = '#ffe066';
    hudCtx.fillText('Recorde: ' + highscore, 235, 32);

    if (gameState === State.START_SCREEN) {
      hudCtx.fillStyle = 'rgba(0,0,0,0.7)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.textAlign = 'center';
      hudCtx.textBaseline = 'middle';
      hudCtx.fillStyle = '#5cb85c';
      hudCtx.font = 'bold 64px Segoe UI, sans-serif';
      hudCtx.fillText('RIO GALAXIAN', W / 2, H / 2 - 40);
      hudCtx.fillStyle = '#fff';
      hudCtx.font = '20px Segoe UI, sans-serif';
      hudCtx.fillText('Pressione ESPAÇO para capturar moscas', W / 2, H / 2 + 40);
      hudCtx.font = '14px Segoe UI, sans-serif';
      hudCtx.fillStyle = '#aaa';
      hudCtx.fillText('Setas para mover | ESC para pausar', W / 2, H / 2 + 100);
      hudCtx.fillStyle = '#ff5555';
      hudCtx.fillText('Pressione M para voltar ao menu', W / 2, H / 2 + 125);
    } else if (restartPrompt || gameState === State.PAUSED || gameState === State.WON || gameState === State.LOST) {
      const boxW = 440;
      const boxH = 160;
      const bx = (W - boxW) / 2;
      const by = (H - boxH) / 2;
      hudCtx.fillStyle = 'rgba(0,0,0,0.6)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.save();
      hudCtx.shadowColor = 'rgba(0,0,0,0.5)';
      hudCtx.shadowBlur = 15;
      hudCtx.fillStyle = '#222';
      hudCtx.strokeStyle = '#5cb85c';
      hudCtx.lineWidth = 3;
      hudCtx.beginPath();
      hudCtx.rect(bx, by, boxW, boxH);
      hudCtx.fill();
      hudCtx.stroke();
      hudCtx.restore();
      hudCtx.textAlign = 'center';
      hudCtx.textBaseline = 'middle';

      if (restartPrompt) {
        hudCtx.fillStyle = '#fff';
        hudCtx.font = 'bold 24px Segoe UI, sans-serif';
        hudCtx.fillText('REINICIAR O JOGO?', W / 2, by + 50);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#ccc';
        hudCtx.fillText('S ou Enter para Sim', W / 2, by + 90);
        hudCtx.fillText('N ou Esc para Não', W / 2, by + 120);
      } else if (gameState === State.PAUSED) {
        hudCtx.fillStyle = '#5cb85c';
        hudCtx.font = 'bold 32px Segoe UI, sans-serif';
        hudCtx.fillText('PAUSADO', W / 2, by + 55);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('Pressione ESC para continuar', W / 2, by + 90);
        hudCtx.fillText('Pressione R para reiniciar', W / 2, by + 115);
        hudCtx.fillText('Pressione M para voltar ao menu', W / 2, by + 140);
      } else if (gameState === State.WON) {
        hudCtx.fillStyle = '#5cb85c';
        hudCtx.font = 'bold 28px Segoe UI, sans-serif';
        hudCtx.fillText('VITÓRIA!', W / 2, by + 45);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('Todas as moscas capturadas.', W / 2, by + 85);
        hudCtx.fillStyle = '#aaa';
        hudCtx.fillText('Pressione R para reiniciar', W / 2, by + 120);
        hudCtx.fillText('Pressione M para voltar ao menu', W / 2, by + 140);
      } else if (gameState === State.LOST) {
        hudCtx.fillStyle = '#ff5555';
        hudCtx.font = 'bold 28px Segoe UI, sans-serif';
        hudCtx.fillText('FIM DE JOGO', W / 2, by + 45);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('O enxame venceu...', W / 2, by + 85);
        hudCtx.fillStyle = '#aaa';
        hudCtx.fillText('Pressione R para reiniciar', W / 2, by + 120);
        hudCtx.fillText('Pressione M para voltar ao menu', W / 2, by + 140);
      }
    }
  }

  function frame(time) {
    const ms = time * 0.001;
    const dt = lastTime ? Math.min(ms - lastTime, 0.05) : 0;
    lastTime = ms;
    if (gameState === State.PLAYING) update(dt);
    waterAnimT += dt;
    renderScene();
    renderHud();
    requestAnimationFrame(frame);
  }
  function onKeyDown(e) {
    keys[e.key] = true;
    if (gameState === State.START_SCREEN) {
      if (e.key === ' ') {
        initAudio();
        gameState = State.PLAYING;
        e.preventDefault();
      } else if (e.key === 'm' || e.key === 'M') {
        window.location.href = '../index.html';
        e.preventDefault();
      }
      return;
    }
    if (restartPrompt) {
      if (e.key === 's' || e.key === 'S' || e.key === 'Enter') {
        restartPrompt = false;
        resetGame();
      } else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') {
        restartPrompt = false;
        gameState = stateBeforeRestartPrompt;
      }
      e.preventDefault();
      return;
    }
    if (gameState === State.WON || gameState === State.LOST || gameState === State.PAUSED) {
      if (e.key === 'Enter') {
        resetGame(State.PLAYING);
        e.preventDefault();
      } else if (e.key === 'm' || e.key === 'M') {
        window.location.href = '../index.html';
        e.preventDefault();
      } else if (e.key === 'r' || e.key === 'R') {
        stateBeforeRestartPrompt = gameState;
        restartPrompt = true;
        e.preventDefault();
      }
      return;
    }
    if (e.key === 'Escape') {
      if (gameState === State.PLAYING) gameState = State.PAUSED;
      else if (gameState === State.PAUSED) gameState = State.PLAYING;
      e.preventDefault();
    }
    if (e.key === 'r' || e.key === 'R') {
      stateBeforeRestartPrompt = gameState;
      restartPrompt = true;
      e.preventDefault();
    }
    if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
  }
  function onKeyUp(e) {
    keys[e.key] = false;
  }
  function init() {
    canvas = document.getElementById('gameCanvas');
    hudCanvas = document.getElementById('hudCanvas');
    if (!canvas || !hudCanvas) return;
    gl = canvas.getContext('webgl');
    if (!gl) return;
    hudCtx = hudCanvas.getContext('2d');
    renderer = WebGLRiverGame.createSpriteRenderer(gl);
    initTextures();
    resetGame(State.START_SCREEN);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    requestAnimationFrame(frame);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();

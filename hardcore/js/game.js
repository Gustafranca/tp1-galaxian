/** 
  Rio Galaxian — MODO HARDCORE
    - Releitura agressiva e caótica do clássico Galaxian.
    Criado por Gustavo França
*/
(function () {
  'use strict';

  // Constantes definindo dimensões da tela, margens, tamanhos de sprites, velocidades e configurações do jogo
  const W = 800;
  const H = 600; 
  const MARGIN = 16;
  const FROG_W = 52;
  const FROG_H = 44;
  const FROG_Y = H - FROG_H - 24;
  const FROG_SPEED = 300;
  const FLY_W = 32
  const FLY_H = 24;
  const COLS = 8;
  const ROWS = 4;
  const PLAYER_FIRE_COOLDOWN = 0.45;
  const PLAYER_BULLET_SPEED = 350;
  const ENEMY_BULLET_SPEED = 250;
  const ENEMY_FIRE_INTERVAL = 0.3;
  const LIVES_START = 6;

  // Constantes para o rasante
  const MAX_DIVING_FLIES = 6; // Máximo de moscas mergulhando simultaneamente
  const DIVE_OUT_SPEED = 0.55; // Velocidade de saída do mergulho
  const DIVE_RETURN_SPEED = 0.45; // Velocidade de retorno do mergulho
  const RASANTE_SCORE_BONUS = 30; // Bônus de pontuação por acertar mosca mergulhando

  // Variáveis globais para canvas, contexto WebGL, renderizador e texturas
  /** @type {HTMLCanvasElement} */
  let canvas;
  /** @type {WebGLRenderingContext} */
  let gl;
  /** @type {ReturnType<typeof WebGLRiverGame.createSpriteRenderer>} */
  let renderer;
  /** @type {HTMLCanvasElement} */
  let hudCanvas; // Canvas para HUD (interface)
  /** @type {CanvasRenderingContext2D} */
  let hudCtx; // Contexto 2D para desenhar HUD

  // Texturas para sapo, mosca, tiros e água
  let texFrog1, texFrog2; // texFrog2 é a textura do com olhos fechados
  let texFly1, texFly2;
  let texBulletPlayer;
  let texBulletEnemy;
  /** @type {WebGLTexture} */
  let texWater;
  let waterSourceCanvas;

  // Variaveis de tempo e estado do jogo
  let lastTime = 0;
  let enemyFireTimer = 0; // Timer para tiros dos inimigos
  const keys = Object.create(null);

  // Estados do jogo (telas)
  const State = {
    START_SCREEN: 'start',
    PLAYING: 'playing',
    PAUSED: 'paused',
    WON: 'won',
    LOST: 'lost',
  };
  
  // Estado atual do jogo e variáveis relacionadas
  let gameState = State.START_SCREEN;
  let restartPrompt = false;
  let stateBeforeRestartPrompt = State.PLAYING;
  let score = 0;
  let lives = LIVES_START;
  let highscore = parseInt(localStorage.getItem('rio_galaxian_highscore_hard') || '0');
  let frogX = W / 2 - FROG_W / 2;

  // Função para atualizar o recorde
  function updateHighscore() {
    const key = 'rio_galaxian_highscore_hard';
    let currentHigh = parseInt(localStorage.getItem(key) || '0');
    if (score > currentHigh) {
      localStorage.setItem(key, score.toString());
      highscore = score;
    }
  }

  //balas, moscas e partículas
  let playerBullets = [];
  let enemyBullets = [];
  let flies = [];

  // Cooldown para tiros do jogador e animação da água
  let playerFireCooldown = 0;
  let waterAnimT = 0;

  // Inicialização do contexto de áudio
  let audioCtx;
  function initAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  // Função para tocar sons usando osciladores
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

  // Objeto com sons pré-definidos
  const Snd = {
    FIRE: () => playSound({ start: 250, end: 600 }, 'square', 0.08, 0.05), // Som de tiro
    HIT: () => playSound({ start: 300, end: 20 }, 'sawtooth', 0.12, 0.08), // Som de acerto
    LOSE: () => playSound({ start: 500, end: 10 }, 'sine', 1.2, 0.12), // Som de derrota
    WIN: () => { // Som de vitória
      playSound(523.25, 'sine', 0.2, 0.1);
      setTimeout(() => playSound(783.99, 'sine', 0.4, 0.1), 150);
    },
  };

  // Função para calcular ponto em curva de Bézier cúbica (código retirado da internet)
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

  // Converte coordenadas de centro para canto superior esquerdo
  function centerToTopLeft(cx, cy) {
    return { x: cx - FLY_W / 2, y: cy - FLY_H / 2 };
  }
  
  // Inicia o mergulhode uma mosca, calculando trajetória curva
  function startDive(f) {
    if (!f.alive || f.diving) return;
    
    const p0 = { x: f.x + FLY_W/2, y: f.y + FLY_H/2 }; // Ponto inicial
    const frogCx = frogX + FROG_W / 2; // Centro do sapo
    
    // Pontos de controle para a curva de Bézier
    const p1 = { 
      x: p0.x + (frogCx - p0.x) * 0.3, 
      y: p0.y + 150 
    };
    
    const swoopOffset = (Math.random() - 0.5) * 400; // Desvio lateral
    const p2 = { 
      x: frogCx + swoopOffset, 
      y: FROG_Y - 50 
    };
    
    const p3 = { 
      x: p2.x + (p2.x - p1.x) * 0.4, 
      y: H + 120 
    };

    f.diving = true;
    f.divePhase = 'out'; // Fase de saída
    f.diveT = 0; // Parâmetro de interpolação
    f.diveOut = { p0, p1, p2, p3 };
    f.diveReturn = null;
  }

  // Conta quantas moscas estão mergulhando (problema pois todas as moscas estao no mesmo estado)
  function countDiving() {
    return flies.filter(f => f.alive && f.diving).length;
  }

  // sempre instanciando a possibilidade de mergulho
  function tryStartRasante(dt) {
    const maxDiving = MAX_DIVING_FLIES;
    if (countDiving() >= maxDiving) return;
    
    const candidates = flies.filter(f => f.alive && !f.diving);
    if (candidates.length > 0) {
      if (Math.random() < 0.04) { // Chance de iniciar mergulho
        startDive(candidates[(Math.random() * candidates.length) | 0]);
      }
    }
  }

  // Atualiza posições das moscas mergulhando ao longo da curva
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

        if (f.diveT >= 1) {
          f.divePhase = 'return'; // Muda para fase de retorno
          f.diveT = 0;
          const retP0 = { x: Math.random() * W, y: -60 };
          const retP3 = { x: f.originX, y: f.originY };
          f.diveReturn = {
            p0: retP0,
            p1: { x: retP0.x, y: 40 },
            p2: { x: retP3.x, y: retP3.y - 40 },
            p3: retP3
          };
        }
      } else if (f.divePhase === 'return') {
        f.diveT += DIVE_RETURN_SPEED * dt;
        if (f.diveT > 1) f.diveT = 1;
        const ptR = cubicBezierPoint(f.diveReturn.p0, f.diveReturn.p1, f.diveReturn.p2, f.diveReturn.p3, f.diveT);
        let tlR = centerToTopLeft(ptR.x, ptR.y);
        f.diveX = tlR.x;
        f.diveY = tlR.y;
        if (f.diveT >= 1) {
          f.diving = false;
          f.divePhase = null;
        }
      }
    }
  }

  // Desenha textura do sapo (elipse com olhos)
  function drawFrogTexture(ctx, w, h, blinking) {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#7a2a2a');
    g.addColorStop(1, '#ff3333');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.55, w * 0.42, h * 0.38, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = blinking ? '#550000' : '#111';
    ctx.beginPath();
    ctx.arc(w * 0.35, h * 0.45, blinking ? 2 : 4, 0, Math.PI * 2);
    ctx.arc(w * 0.65, h * 0.45, blinking ? 2 : 4, 0, Math.PI * 2);
    ctx.fill();
  }

  // Desenha textura da mosca (corpo com asas (que também sao elipses))
  function drawFlyTexture(ctx, w, h, wingState) {
    const wingSwing = wingState * 0.3;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#ff1111';
    ctx.beginPath();
    ctx.ellipse(w * 0.5, h * 0.5, w * 0.3, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,150,150,0.8)';
    ctx.beginPath();
    ctx.ellipse(w * 0.2, h * 0.45, w * 0.25, h * 0.12, -0.4 + wingSwing, 0, Math.PI * 2);
    ctx.ellipse(w * 0.8, h * 0.45, w * 0.25, h * 0.12, 0.4 - wingSwing, 0, Math.PI * 2);
    ctx.fill();
  }

  // Desenha textura da água animada com ondas
  function drawWaterTexture(ctx, w, h, t) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#1a0505');
    g.addColorStop(0.5, '#441111');
    g.addColorStop(1, '#1a0505');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(255,0,0,0.15)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 15; i++) {
      const y = (i / 15) * h + Math.sin(t * 4 + i) * 8;
      ctx.beginPath();
      for (let x = 0; x <= w; x += 10) {
        ctx.lineTo(x, y + Math.sin(x * 0.04 + t * 5 + i) * 6);
      }
      ctx.stroke();
    }
  }

  // Desenha textura de bala (retângulo ou círculo)
  function drawBulletTexture(ctx, w, h, color, isRect) {
    ctx.fillStyle = color;
    if (isRect) ctx.fillRect(0, 0, w, h);
    else {
      ctx.beginPath();
      ctx.arc(w/2, h/2, w/2, 0, Math.PI*2);
      ctx.fill();
    }
  }

  // Atualiza a textura da água no WebGL
  function uploadWaterTexture() {
    const ctx = waterSourceCanvas.getContext('2d');
    drawWaterTexture(ctx, W, H, waterAnimT);
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, waterSourceCanvas);
  }

  // Inicializa todas as texturas
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
    drawBulletTexture(cb.getContext('2d'), 16, 16, '#ffcc00', true);
    texBulletPlayer = renderer.createTextureFromSource(gl, cb);
    const ce = makeCanvas(14, 18);
    drawBulletTexture(ce.getContext('2d'), 14, 18, '#ff0000', false);
    texBulletEnemy = renderer.createTextureFromSource(gl, cb);
    waterSourceCanvas = makeCanvas(W, H);
    texWater = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texWater);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    uploadWaterTexture();
  }

  // Cria um canvas auxiliar
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  // Sistema de partículas para explosões
  let particles = [];
  function spawnExplosion(x, y, color) {
    for (let i = 0; i < 15; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 400,
        vy: (Math.random() - 0.5) * 400,
        life: 0.4 + Math.random() * 0.4,
        color: color || [1, 0, 0, 1],
      });
    }
  }

  // Atualiza partículas (movimento e vida)
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  // Reinicia as moscas para posições iniciais
  function resetFlies() {
    flies = [];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        const ox = 100 + col * 80;
        const oy = 60 + row * 50;
        flies.push({
          originX: ox,
          originY: oy,
          x: ox,
          y: oy,
          alive: true,
          diving: false,
          divePhase: null,
          diveT: 0,
          diveX: 0,
          diveY: 0,
          offsetT: Math.random() * Math.PI * 2, // Offset para movimento ondulado
        });
      }
    }
  }

  // Reinicia o jogo para um estado inicial
  function resetGame(initialState) {
    gameState = initialState || State.PLAYING;
    restartPrompt = false;
    score = 0;
    lives = LIVES_START;
    frogX = W / 2 - FROG_W / 2;
    playerBullets = [];
    enemyBullets = [];
    particles = [];
    resetFlies();
    playerFireCooldown = 0;
    enemyFireTimer = 0;
  }

  // Calcula posição mundial da mosca (considerando mergulho ou movimento normal)
  function flyWorldPos(fly) {
    if (fly.diving) return { x: fly.diveX, y: fly.diveY, w: FLY_W, h: FLY_H };
    const px = fly.originX + Math.sin(waterAnimT * 3 + fly.offsetT) * 40;
    const py = fly.originY + Math.cos(waterAnimT * 2 + fly.offsetT) * 20;
    fly.x = px;
    fly.y = py;
    return { x: px, y: py, w: FLY_W, h: FLY_H };
  }

  // Verifica colisão AABB (axis-aligned bounding box)
  function aabb(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // Tenta fazer um inimigo atirar
  function tryEnemyFire() {
    const alive = flies.filter(f => f.alive);
    if (alive.length === 0) return;
    const f = alive[(Math.random() * alive.length) | 0];
    const p = flyWorldPos(f);
    enemyBullets.push({
      x: p.x + p.w / 2 - 7,
      y: p.y + p.h,
      vx: (Math.random() - 0.5) * 100, // Movimento lateral aleatório
      vy: ENEMY_BULLET_SPEED,
      w: 12, h: 16,
    });
  }

  // Função principal de atualização do jogo
  function update(dt) {
    if (gameState !== State.PLAYING) return;
    // Movimento do sapo
    if (keys['ArrowLeft']) frogX -= FROG_SPEED * dt;
    if (keys['ArrowRight']) frogX += FROG_SPEED * dt;
    frogX = Math.max(MARGIN, Math.min(W - FROG_W - MARGIN, frogX));
    
    // Tiro do jogador
    if (keys[' '] && playerFireCooldown <= 0) {
      Snd.FIRE();
      playerBullets.push({
        x: frogX + FROG_W / 2 - 6,
        y: FROG_Y,
        vy: -PLAYER_BULLET_SPEED,
        w: 12, h: 12,
        returning: false, // Bala vai e volta
      });
      playerFireCooldown = PLAYER_FIRE_COOLDOWN;
    }
    if (playerFireCooldown > 0) playerFireCooldown -= dt;

    // Atualizações de mergulho, partículas e tiros inimigos
    updateDivingFlies(dt);
    tryStartRasante(dt);
    updateParticles(dt);
    
    enemyFireTimer += dt;
    while (enemyFireTimer >= ENEMY_FIRE_INTERVAL) {
      enemyFireTimer -= ENEMY_FIRE_INTERVAL;
      tryEnemyFire();
    }

    // Atualização de balas do jogador (movimento, colisão, retorno)
    for (let i = playerBullets.length - 1; i >= 0; i--) {
      const b = playerBullets[i];
      b.x = frogX + FROG_W / 2 - b.w / 2; // Segue o sapo
      if (!b.returning) {
        b.y += b.vy * dt;
        if (b.y < 20) b.returning = true;
        for (let f of flies) {
          if (!f.alive) continue;
          const p = flyWorldPos(f);
          if (aabb(b.x, b.y, b.w, b.h, p.x, p.y, p.w, p.h)) {
            f.alive = false;
            f.diving = false;
            Snd.HIT();
            score += 50 + (f.diving ? RASANTE_SCORE_BONUS : 0);
            spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, [1, 0.2, 0.2, 1]);
            b.returning = true;
            break;
          }
        }
      } else {
        b.y -= b.vy * 2.0 * dt;
        if (b.y >= FROG_Y) playerBullets.splice(i, 1);
      }
    }

    // Atualização de balas inimigas (movimento e colisão com sapo)
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += (b.vx || 0) * dt;
      b.y += b.vy * dt;
      if (b.y > H || b.x < 0 || b.x > W) {
        enemyBullets.splice(i, 1);
        continue;
      }
      if (aabb(b.x, b.y, b.w, b.h, frogX, FROG_Y, FROG_W, FROG_H)) {
        enemyBullets.splice(i, 1);
        lives -= 1;
        if (lives <= 0) { gameState = State.LOST; updateHighscore(); Snd.LOSE(); }
        else Snd.HIT();
      }
    }

    // Colisão de moscas mergulhando com sapo
    for (let f of flies) {
      if (!f.alive || !f.diving) continue;
      const p = flyWorldPos(f);
      if (aabb(p.x, p.y, p.w, p.h, frogX, FROG_Y, FROG_W, FROG_H)) {
        f.alive = false;
        f.diving = false;
        spawnExplosion(p.x + p.w / 2, p.y + p.h / 2, [1, 0, 0, 1]);
        lives -= 1;
        if (lives <= 0) { gameState = State.LOST; updateHighscore(); Snd.LOSE(); }
        else Snd.HIT();
      }
    }

    // Verifica vitória (todas moscas mortas)
    if (flies.length > 0 && !flies.some(f => f.alive)) {
      gameState = State.WON;
      updateHighscore();
      Snd.WIN();
    }
  }

  // Renderiza a cena principal usando WebGL
  function renderScene() {
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.clearColor(0.02, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    uploadWaterTexture();
    renderer.drawSprite(texWater, 0, 0, W, H, 1, 1, 1, 1, waterAnimT);
    for (let p of particles) {
      renderer.drawSprite(texBulletPlayer, p.x-4, p.y-4, 8, 8, p.color[0], p.color[1], p.color[2], Math.min(1.0, p.life*2), waterAnimT);
    }
    const flyTex = Math.floor(waterAnimT * 15) % 2 === 0 ? texFly1 : texFly2;
    for (let f of flies) {
      if (!f.alive) continue;
      const p = flyWorldPos(f);
      renderer.drawSprite(flyTex, p.x, p.y, p.w, p.h, 1, 1, 1, 1, waterAnimT);
    }
    for (let b of playerBullets) {
      renderer.drawSprite(texBulletPlayer, b.x, b.y, b.w, FROG_Y - b.y, 1, 0.6, 0, 1, waterAnimT);
    }
    for (let b of enemyBullets) {
      renderer.drawSprite(texBulletEnemy, b.x, b.y, b.w, b.h, 1, 1, 1, 1, waterAnimT);
    }
    renderer.drawSprite(Math.floor(waterAnimT * 4) % 10 === 0 ? texFrog2 : texFrog1, frogX, FROG_Y, FROG_W, FROG_H, 1, 1, 1, 1, waterAnimT);
  }

  // Renderiza a interface usando Canvas 2D
  function renderHud() {
    hudCtx.clearRect(0, 0, W, H);
    hudCtx.fillStyle = 'rgba(50,0,0,0.6)';
    hudCtx.fillRect(8, 8, 240, 52);
    hudCtx.fillStyle = '#ffcccc';
    hudCtx.font = 'bold 16px Segoe UI, sans-serif';
    hudCtx.textAlign = 'left';
    hudCtx.fillText('PONTOS: ' + score, 18, 32);
    hudCtx.fillText('VIDAS: ' + lives, 18, 52);
    hudCtx.textAlign = 'right';
    hudCtx.fillStyle = '#ff5555';
    hudCtx.fillText('RECORD HARD: ' + highscore, 235, 32);

    // Renderiza telas de estado (inicial, pausa, vitória, derrota, prompt de reinício)
    // estilizado de forma difenrente nesse modo hardcore
    if (gameState === State.START_SCREEN) {
      hudCtx.fillStyle = 'rgba(20,0,0,0.85)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.textAlign = 'center';
      hudCtx.fillStyle = '#ff3333';
      hudCtx.font = 'bold 64px Segoe UI, sans-serif';
      hudCtx.fillText('HARDCORE RIO', W / 2, H / 2 - 40);
      hudCtx.fillStyle = '#fff';
      hudCtx.font = '22px Segoe UI, sans-serif';
      hudCtx.fillText('Pressione ESPAÇO para sobreviver', W / 2, H / 2 + 40);
      hudCtx.fillStyle = '#888';
      hudCtx.font = '14px Segoe UI, sans-serif';
      hudCtx.fillText('Pressione M para voltar ao menu', W / 2, H / 2 + 120);
    } else if (restartPrompt || gameState === State.PAUSED || gameState === State.WON || gameState === State.LOST) {
      const boxW = 440;
      const boxH = 180;
      const bx = (W - boxW) / 2;
      const by = (H - boxH) / 2;
      hudCtx.fillStyle = 'rgba(0,0,0,0.75)';
      hudCtx.fillRect(0, 0, W, H);
      hudCtx.fillStyle = '#200';
      hudCtx.strokeStyle = '#ff3333';
      hudCtx.lineWidth = 3;
      hudCtx.beginPath();
      hudCtx.rect(bx, by, boxW, boxH);
      hudCtx.fill();
      hudCtx.stroke();
      hudCtx.textAlign = 'center';
      hudCtx.textBaseline = 'middle';
      if (restartPrompt) {
        hudCtx.fillStyle = '#fff';
        hudCtx.font = 'bold 24px Segoe UI, sans-serif';
        hudCtx.fillText('REINICIAR MASSACRE?', W / 2, by + 50);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#ccc';
        hudCtx.fillText('S ou Enter para Sim', W / 2, by + 100);
        hudCtx.fillText('N ou Esc para Não', W / 2, by + 130);
      } else if (gameState === State.PAUSED) {
        hudCtx.fillStyle = '#ff3333';
        hudCtx.font = 'bold 32px Segoe UI, sans-serif';
        hudCtx.fillText('PAUSADO', W / 2, by + 50);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('ESC para continuar', W / 2, by + 90);
        hudCtx.fillText('R para reiniciar', W / 2, by + 120);
        hudCtx.fillText('M para o menu', W / 2, by + 150);
      } else if (gameState === State.WON) {
        hudCtx.fillStyle = '#ffaa00';
        hudCtx.font = 'bold 28px Segoe UI, sans-serif';
        hudCtx.fillText('SOBREVIVEU!', W / 2, by + 45);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('Moscas dizimadas.', W / 2, by + 85);
        hudCtx.fillStyle = '#aaa';
        hudCtx.fillText('R para reiniciar | M para o menu', W / 2, by + 130);
      } else if (gameState === State.LOST) {
        hudCtx.fillStyle = '#ff0000';
        hudCtx.font = 'bold 28px Segoe UI, sans-serif';
        hudCtx.fillText('ESTÁ MORTO', W / 2, by + 45);
        hudCtx.font = '18px Segoe UI, sans-serif';
        hudCtx.fillStyle = '#fff';
        hudCtx.fillText('O pântano te consumiu.', W / 2, by + 85);
        hudCtx.fillStyle = '#aaa';
        hudCtx.fillText('R para reiniciar | M para o menu', W / 2, by + 130);
      }
    }
  }

  // Loop principal de renderização e atualização
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

  // Indicador de evento para teclas pressionadas
  function onKeyDown(e) {
    keys[e.key] = true;
    if (gameState === State.START_SCREEN) {
      if (e.key === ' ') { initAudio(); gameState = State.PLAYING; e.preventDefault(); }
      else if (e.key === 'm' || e.key === 'M') { window.location.href = '../index.html'; e.preventDefault(); }
      return;
    }
    if (restartPrompt) {
      if (e.key === 's' || e.key === 'S' || e.key === 'Enter') { restartPrompt = false; resetGame(); }
      else if (e.key === 'n' || e.key === 'N' || e.key === 'Escape') { restartPrompt = false; gameState = stateBeforeRestartPrompt; }
      e.preventDefault(); return;
    }
    if (gameState === State.WON || gameState === State.LOST || gameState === State.PAUSED) {
      if (e.key === 'Enter') { resetGame(State.PLAYING); e.preventDefault(); }
      else if (e.key === 'm' || e.key === 'M') { window.location.href = '../index.html'; e.preventDefault(); }
      else if (e.key === 'r' || e.key === 'R') { stateBeforeRestartPrompt = gameState; restartPrompt = true; e.preventDefault(); }
      return;
    }
    if (e.key === 'Escape') {
      if (gameState === State.PLAYING) gameState = State.PAUSED;
      else if (gameState === State.PAUSED) gameState = State.PLAYING;
      e.preventDefault();
    }
    if (e.key === 'r' || e.key === 'R') { stateBeforeRestartPrompt = gameState; restartPrompt = true; e.preventDefault(); }
    if (e.key === ' ' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
  }

  // Manipulador de tecla solta
  function onKeyUp(e) { keys[e.key] = false; }

  // Inicialização do jogo
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

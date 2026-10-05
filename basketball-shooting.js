/* ============================================================
   Basketball Shooting · Side View
   Independent game logic for MBW Tools
   Usage: BasketballShooting.init('canvasId')
   - Dynamic logical width (DW) matches container aspect ratio
   - Fills the screen in fullscreen with no letterboxing and no crop
============================================================ */
(function(global) {
'use strict';

var BasketballShooting = {};

BasketballShooting.init = function(canvasId) {
  var canvas = document.getElementById(canvasId);
  if (!canvas) { console.error('BasketballShooting: canvas not found:', canvasId); return; }
  var ctx = canvas.getContext('2d');

  /* ============================================================
     Constants
  ============================================================ */
  // Logical height is fixed. Logical width is dynamic (matches container).
  var DH = 640;
  var DW = 900;                 // will be recalculated in resize()
  var GROUND_Y = 560;           // fixed logical ground line
  var GRAV = 0.42;
  var BALL_R = 20;
  var MAX_PULL = 160;
  var MAX_SPEED = 26;

  var scale = 1, offX = 0, offY = 0, dpr = 1;

  /* ============================================================
     Resize — dynamic DW so the canvas fills the container exactly
  ============================================================ */
  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = canvas.clientWidth;
    var h = canvas.clientHeight;
    if (w <= 0 || h <= 0) return;

    canvas.width  = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);

    // Logical width follows the container aspect ratio.
    // DH stays fixed, so the whole scene always fits with no crop.
    DW = DH * (w / h);

    // Now scale to fill exactly (since aspect ratios match, this is exact)
    scale = w / DW;
    offX = 0;
    offY = 0;

    // Keep player / hoop anchored proportionally after DW changes
    player.x = DW * 0.20;
    hoop.tx = DW * (0.70 + Math.random() * 0.15);
    hoop.x = hoop.x * (DW / lastDW) || DW * 0.78;
    ball.x = getReleasePos().x;
    ball.y = getReleasePos().y;
  }

  var lastDW = DW;
  function rememberDW() { lastDW = DW; }

  window.addEventListener('resize', function() {
    rememberDW();
    resize();
  });
  window.addEventListener('orientationchange', function() {
    setTimeout(function() { rememberDW(); resize(); }, 120);
  });

  /* ============================================================
     Audio
  ============================================================ */
  var actx = null;
  function initAudio() {
    if (actx) return;
    try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e){}
  }
  function tone(freq, dur, type, vol, slideTo) {
    if (!actx) return;
    var t = actx.currentTime;
    var o = actx.createOscillator();
    var g = actx.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol || 0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(actx.destination);
    o.start(t); o.stop(t + dur + 0.03);
  }
  var sfxShoot  = function() { tone(300, 0.10, 'sine', 0.05, 620); };
  var sfxRim    = function() { tone(200, 0.09, 'triangle', 0.07, 130); };
  var sfxBoard  = function() { tone(150, 0.11, 'triangle', 0.08, 95); };
  var sfxGround = function() { tone(90,  0.10, 'sine', 0.06, 55); };
  function sfxScore() {
    tone(660, 0.10, 'sine', 0.075);
    setTimeout(function() { tone(880, 0.14, 'sine', 0.065); }, 65);
    setTimeout(function() { tone(1180, 0.20, 'sine', 0.05); }, 140);
  }
  function sfxSwish() {
    tone(540, 0.07, 'sine', 0.055, 900);
    setTimeout(function() { tone(1080, 0.16, 'sine', 0.065); }, 55);
    setTimeout(function() { tone(1450, 0.22, 'sine', 0.045); }, 130);
  }

  /* ============================================================
     Game State
  ============================================================ */
  var player = {
    x: DW * 0.20,
    footY: GROUND_Y,
    crouch: 0,
    armRaise: 0,
    jump: 0,
    shootAnim: 0,
    shooting: false
  };

  var ball = {
    x: 0, y: 0,
    vx: 0, vy: 0,
    r: BALL_R,
    rot: 0, rotV: 0,
    flying: false,
    touchedRim: false,
    touchedBoard: false
  };

  var hoop = {
    x: DW * 0.78, y: 275,
    tx: DW * 0.78, ty: 275,
    rimRx: 34, rimRy: 8,
    rimThickness: 5,
    wave: 0,
    boardW: 14,
    boardH: 130
  };

  var score = 0, streak = 0, bestStreak = 0;
  var shots = 0, made = 0;
  var dragging = false;
  var dragStart = { x: 0, y: 0 };
  var dragCur   = { x: 0, y: 0 };
  var endTimer = -1;
  var scored = false;
  var time = 0;
  var hintAlpha = 1;
  var wind = 0;
  var particles = [];
  var floatTexts = [];
  var stars = [];

  function buildStars() {
    stars.length = 0;
    var count = Math.round(DW / 13);
    for (var i = 0; i < count; i++) {
      stars.push({
        x: Math.random() * DW,
        y: Math.random() * (GROUND_Y - 80),
        r: Math.random() < 0.85 ? 1.2 : 2.2,
        a: 0.15 + Math.random() * 0.55,
        ph: Math.random() * Math.PI * 2
      });
    }
  }

  /* ============================================================
     Utils
  ============================================================ */
  function roundRect(x, y, w, h, r) {
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
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function easeInOut(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ============================================================
     Player Pose
  ============================================================ */
  function getPlayerPose() {
    var baseY = player.footY - player.jump;
    var crouchOffset = player.crouch * 26;
    return {
      footY: baseY,
      kneeY: baseY - 30 + crouchOffset * 0.6,
      hipY: baseY - 56 + crouchOffset,
      shoulderY: baseY - 92 + crouchOffset,
      headY: baseY - 118 + crouchOffset,
      crouchOffset: crouchOffset
    };
  }

  function getReleasePos() {
    var pose = getPlayerPose();
    var raise = player.armRaise;
    var shoot = player.shootAnim;
    var liftT = clamp(raise * 0.85 + shoot * 0.5, 0, 1);
    var handX = lerp(player.x + 14, player.x + 34, liftT);
    var handY = lerp(pose.shoulderY - 4, pose.headY - 46, liftT);
    return { x: handX, y: handY };
  }

  /* ============================================================
     Collision
  ============================================================ */
  function collidePoint(px, py, pr) {
    var dx = ball.x - px, dy = ball.y - py;
    var d = Math.hypot(dx, dy);
    var minD = ball.r + pr;
    if (d < minD && d > 0.001) {
      var nx = dx / d, ny = dy / d;
      ball.x = px + nx * minD;
      ball.y = py + ny * minD;
      var vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        var e = 0.58;
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        ball.vx *= 0.97; ball.vy *= 0.97;
        ball.rotV = ball.vx * 0.045;
        return true;
      }
    }
    return false;
  }

  function collideRect(rx, ry, rw, rh) {
    var cx = clamp(ball.x, rx, rx + rw);
    var cy = clamp(ball.y, ry, ry + rh);
    var dx = ball.x - cx, dy = ball.y - cy;
    var d = Math.hypot(dx, dy);
    if (d < ball.r) {
      if (d < 0.001) { dx = 0; dy = ball.vy > 0 ? -1 : 1; d = 1; }
      var nx = dx / d, ny = dy / d;
      ball.x = cx + nx * ball.r;
      ball.y = cy + ny * ball.r;
      var vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        var e = 0.55;
        ball.vx -= (1 + e) * vn * nx;
        ball.vy -= (1 + e) * vn * ny;
        ball.vx *= 0.97; ball.vy *= 0.97;
        ball.rotV = ball.vx * 0.045;
        return true;
      }
    }
    return false;
  }

  /* ============================================================
     Effects
  ============================================================ */
  function spawnParticles(x, y, n, colors) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = 1 + Math.random() * 5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp - 1.5,
        life: 40 + Math.random() * 30,
        maxLife: 70,
        size: 1.5 + Math.random() * 3.2,
        color: colors[(Math.random() * colors.length) | 0]
      });
    }
  }
  function spawnFloat(x, y, text, color, size) {
    floatTexts.push({ x: x, y: y, text: text, color: color, size: size || 26, life: 70, maxLife: 70 });
  }

  /* ============================================================
     Shoot / Reset
  ============================================================ */
  function shoot() {
    var dx = dragStart.x - dragCur.x;
    var dy = dragStart.y - dragCur.y;
    var len = Math.hypot(dx, dy);
    if (len < 14) return;
    if (len > MAX_PULL) {
      var k = MAX_PULL / len;
      dx *= k; dy *= k; len = MAX_PULL;
    }
    var kk = MAX_SPEED / MAX_PULL;
    ball.vx = dx * kk;
    ball.vy = dy * kk;

    if (Math.hypot(ball.vx, ball.vy) < 3.5) return;

    ball.flying = true;
    ball.touchedRim = false;
    ball.touchedBoard = false;
    ball.rotV = ball.vx * 0.035;
    scored = false;
    endTimer = -1;
    shots++;
    hintAlpha = 0;
    sfxShoot();

    player.shooting = true;
    player.shootAnim = 0;
  }

  function resetBall() {
    hoop.tx = DW * (0.62 + Math.random() * 0.18);
    hoop.ty = 250 + Math.random() * 70;
    wind = (Math.random() - 0.5) * 0.018;

    player.shooting = false;
    player.shootAnim = 0;
    player.jump = 0;
    player.crouch = 0;
    player.armRaise = 0;

    var rel = getReleasePos();
    ball.x = rel.x;
    ball.y = rel.y;
    ball.vx = 0; ball.vy = 0;
    ball.rot = 0; ball.rotV = 0;
    ball.flying = false;
    ball.touchedRim = false;
    ball.touchedBoard = false;
    scored = false;
    endTimer = -1;
  }

  /* ============================================================
     Score
  ============================================================ */
  function doScore() {
    scored = true;
    made++;
    streak++;
    if (streak > bestStreak) bestStreak = streak;

    var isSwish = !ball.touchedRim && !ball.touchedBoard;
    var pts = 2;
    if (isSwish) pts += 1;
    if (streak >= 2) pts += Math.min(streak - 1, 3);

    score += pts;
    hoop.wave = 1.5;
    endTimer = 70;

    var cx = hoop.x, cy = hoop.y - 20;

    if (isSwish) {
      spawnFloat(cx, cy - 70, 'SWISH! +' + pts, '#7CFFB2', 30);
      spawnParticles(cx, cy, 26, ['#7CFFB2', '#B6FFDA', '#FFFFFF', '#5BE8A0']);
      sfxSwish();
    } else {
      spawnFloat(cx, cy - 70, '+' + pts, '#FFD166', 30);
      spawnParticles(cx, cy, 18, ['#FFD166', '#FFB347', '#FFF3C4']);
      sfxScore();
    }
    if (streak >= 3) spawnFloat(cx, cy - 118, 'Streak x' + streak, '#FF8FA3', 22);
  }

  /* ============================================================
     Update
  ============================================================ */
  function update() {
    time++;

    hoop.x += (hoop.tx - hoop.x) * 0.022;
    hoop.y += (hoop.ty - hoop.y) * 0.022;

    if (hoop.wave > 0.001) hoop.wave *= 0.93;
    else hoop.wave = 0;

    /* ---------- Player animation ---------- */
    if (player.shooting) {
      player.shootAnim += 0.075;
      if (player.shootAnim > 1) player.shootAnim = 1;

      var t = player.shootAnim;
      player.jump = Math.sin(t * Math.PI) * 46;
      if (t < 0.4) {
        player.armRaise = easeOut(t / 0.4);
      } else {
        var downT = (t - 0.4) / 0.6;
        player.armRaise = lerp(1, 0, easeInOut(downT));
      }
      player.crouch = Math.max(0, 1 - t * 3.5);

      if (player.shootAnim >= 1) {
        player.shooting = false;
        player.armRaise = 0;
        player.jump = 0;
      }
    } else if (!ball.flying) {
      if (dragging) {
        var dx = dragStart.x - dragCur.x;
        var dy = dragStart.y - dragCur.y;
        var len = Math.hypot(dx, dy);
        var power = clamp(len / MAX_PULL, 0, 1);
        player.crouch = lerp(player.crouch, power, 0.22);
        player.armRaise = lerp(player.armRaise, power * 0.85, 0.22);
        player.jump = lerp(player.jump, 0, 0.3);
      } else {
        player.crouch = lerp(player.crouch, 0, 0.15);
        player.armRaise = lerp(player.armRaise, 0, 0.15);
        player.jump = lerp(player.jump, 0, 0.2);
      }
      player.shootAnim = 0;
    }

    if (ball.flying && !player.shooting) {
      player.crouch = lerp(player.crouch, 0, 0.1);
      player.jump = lerp(player.jump, 0, 0.15);
      if (player.armRaise > 0) player.armRaise = lerp(player.armRaise, 0, 0.12);
    }

    /* ---------- Ball follows hand ---------- */
    if (!ball.flying && !player.shooting) {
      var rel = getReleasePos();
      ball.x = rel.x;
      ball.y = rel.y;
      ball.rot += 0.004;
    }

    /* ---------- Physics ---------- */
    if (ball.flying) {
      var prevY = ball.y;
      ball.vy += GRAV;
      ball.vx += wind;
      ball.x += ball.vx;
      ball.y += ball.vy;
      ball.rot += ball.rotV;

      var rimLx = hoop.x - hoop.rimRx;
      var rimRx = hoop.x + hoop.rimRx;

      if (!scored && ball.vy > 0 && prevY < hoop.y && ball.y >= hoop.y) {
        if (ball.x > rimLx + 4 && ball.x < rimRx - 4) {
          doScore();
        }
      }

      if (collidePoint(rimLx, hoop.y, hoop.rimThickness / 2)) { ball.touchedRim = true; sfxRim(); }
      if (collidePoint(rimRx, hoop.y, hoop.rimThickness / 2)) { ball.touchedRim = true; sfxRim(); }

      var boardX = hoop.x + hoop.rimRx + 2;
      var boardY = hoop.y - hoop.boardH + 20;
      if (collideRect(boardX, boardY, hoop.boardW, hoop.boardH)) {
        ball.touchedBoard = true;
        sfxBoard();
        spawnParticles(ball.x, ball.y, 5, ['#FFFFFF', '#CFE6FF']);
      }

      if (ball.y + ball.r > GROUND_Y) {
        var impact = Math.abs(ball.vy);
        ball.y = GROUND_Y - ball.r;
        if (ball.vy > 0) {
          ball.vy *= -0.55;
          if (impact > 3.5) sfxGround();
        }
        ball.vx *= 0.985;
        ball.rotV = ball.vx * 0.05;
        if (Math.abs(ball.vy) < 1.4) ball.vy = 0;

        if (endTimer < 0 && Math.abs(ball.vx) < 0.45 && Math.abs(ball.vy) < 0.6) {
          endTimer = 26;
        }
      }

      if (ball.x - ball.r < 0) { ball.x = ball.r; ball.vx *= -0.6; }
      if (ball.x + ball.r > DW) { ball.x = DW - ball.r; ball.vx *= -0.6; }
      if (ball.y < -200 || ball.x < -200 || ball.x > DW + 200) {
        if (endTimer < 0) endTimer = 1;
      }
    }

    if (endTimer > 0) {
      endTimer--;
      if (endTimer === 0) { endTimer = -1; resetBall(); }
    }

    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.vy += 0.16;
      p.vx *= 0.985; p.vy *= 0.985;
      p.x += p.vx; p.y += p.vy;
      p.life--;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (var j = floatTexts.length - 1; j >= 0; j--) {
      var f = floatTexts[j];
      f.y -= 0.85; f.life--;
      if (f.life <= 0) floatTexts.splice(j, 1);
    }

    if (shots > 0) hintAlpha = Math.max(0, hintAlpha - 0.02);
  }

  /* ============================================================
     Draw: Background
  ============================================================ */
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
    g.addColorStop(0,    '#120e22');
    g.addColorStop(0.42, '#261c40');
    g.addColorStop(0.75, '#452a4d');
    g.addColorStop(1,    '#6e3d55');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, DW, GROUND_Y);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var tw = 0.55 + 0.45 * Math.sin(time * 0.022 + s.ph);
      ctx.globalAlpha = s.a * tw;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(s.x, s.y, s.r, s.r);
    }
    ctx.globalAlpha = 1;

    var gg = ctx.createRadialGradient(hoop.x, hoop.y - 30, 10, hoop.x, hoop.y - 30, 320);
    gg.addColorStop(0, 'rgba(255,170,90,0.16)');
    gg.addColorStop(1, 'rgba(255,170,90,0)');
    ctx.fillStyle = gg;
    ctx.fillRect(hoop.x - 320, hoop.y - 350, 640, 640);

    var hg = ctx.createLinearGradient(0, GROUND_Y - 90, 0, GROUND_Y);
    hg.addColorStop(0, 'rgba(255,140,80,0)');
    hg.addColorStop(1, 'rgba(255,150,90,0.10)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, GROUND_Y - 90, DW, 90);
  }

  /* ============================================================
     Draw: Floor
  ============================================================ */
  function drawFloor() {
    var g = ctx.createLinearGradient(0, GROUND_Y, 0, DH);
    g.addColorStop(0,    '#6b452e');
    g.addColorStop(0.28, '#553526');
    g.addColorStop(1,    '#241512');
    ctx.fillStyle = g;
    ctx.fillRect(0, GROUND_Y, DW, DH - GROUND_Y);

    ctx.strokeStyle = 'rgba(0,0,0,0.14)';
    ctx.lineWidth = 1;
    var cols = Math.ceil(DW / 62) + 1;
    for (var i = 0; i < cols; i++) {
      var x = i * 62 + 18;
      ctx.beginPath();
      ctx.moveTo(x, GROUND_Y);
      ctx.lineTo(x + 40, DH);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(255,205,155,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y + 1);
    ctx.lineTo(DW, GROUND_Y + 1);
    ctx.stroke();

    var rg = ctx.createLinearGradient(0, GROUND_Y, 0, GROUND_Y + 100);
    rg.addColorStop(0, 'rgba(255,180,120,0.13)');
    rg.addColorStop(1, 'rgba(255,180,120,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, GROUND_Y, DW, 100);
  }

  /* ============================================================
     Draw: Hoop Back
  ============================================================ */
  function drawHoopBack() {
    var boardX = hoop.x + hoop.rimRx + 2;
    var boardY = hoop.y - hoop.boardH + 20;
    var boardBot = boardY + hoop.boardH;

    ctx.strokeStyle = 'rgba(180,195,220,0.35)';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(boardX + hoop.boardW / 2, boardBot - 6);
    ctx.lineTo(boardX + hoop.boardW / 2, GROUND_Y);
    ctx.stroke();

    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(boardX + hoop.boardW / 2, GROUND_Y);
    ctx.lineTo(boardX + hoop.boardW / 2 + 44, GROUND_Y);
    ctx.stroke();

    ctx.save();
    ctx.fillStyle = 'rgba(225,238,255,0.13)';
    ctx.strokeStyle = 'rgba(232,244,255,0.78)';
    ctx.lineWidth = 3;
    roundRect(boardX, boardY, hoop.boardW, hoop.boardH, 4);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255,255,255,0.42)';
    ctx.lineWidth = 2;
    roundRect(boardX - 1, hoop.y - 55, 6, 70, 3);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = '#ff6b1a';
    ctx.lineWidth = hoop.rimThickness;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,120,40,0.55)';
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.rimRx, hoop.rimRy, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
     Draw: Net
  ============================================================ */
  function drawNet() {
    var cx = hoop.x, cy = hoop.y;
    var rx = hoop.rimRx, ry = hoop.rimRy;
    var netH = 52;
    var N = 12;
    var w = hoop.wave;

    ctx.save();
    ctx.strokeStyle = 'rgba(238,246,255,0.55)';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';

    function topPt(i) {
      var a = Math.PI * 2 * i / N;
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    }
    function botPt(i) {
      var a = Math.PI * 2 * i / N;
      var k = 0.38;
      var wob = Math.sin(i * 1.9 + time * 0.28) * w * 8;
      return [cx + rx * k * Math.cos(a) + wob, cy + netH + ry * 0.45 * Math.sin(a)];
    }

    for (var i = 0; i < N; i++) {
      var t0 = topPt(i), b0 = botPt(i);
      var x0 = t0[0], y0 = t0[1], x1 = b0[0], y1 = b0[1];
      var mx = (x0 + x1) * 0.5 + (x1 - x0) * 0.22;
      var my = (y0 + y1) * 0.5;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(mx, my, x1, y1);
      ctx.stroke();
    }

    for (var r = 1; r <= 4; r++) {
      var t = r / 5;
      var k = 1 - t * 0.58;
      var yy = cy + netH * t + Math.sin(time * 0.25) * w * 2;
      ctx.globalAlpha = 0.62 - t * 0.18;
      ctx.beginPath();
      ctx.ellipse(cx, yy, rx * k, ry * k, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /* ============================================================
     Draw: Hoop Front
  ============================================================ */
  function drawHoopFront() {
    ctx.save();
    ctx.strokeStyle = '#ff7a2b';
    ctx.lineWidth = hoop.rimThickness;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(255,130,50,0.7)';
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, hoop.rimRx, hoop.rimRy, 0, 0, Math.PI);
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = 'rgba(255,210,150,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y + 1.5, hoop.rimRx - 2, hoop.rimRy - 2, 0, 0.15, Math.PI - 0.15);
    ctx.stroke();
    ctx.restore();
  }

  /* ============================================================
     Draw: Player
  ============================================================ */
  function drawPlayer() {
    var pose = getPlayerPose();
    var baseY = pose.footY;
    var kneeY = pose.kneeY;
    var hipY = pose.hipY;
    var shoulderY = pose.shoulderY;
    var headY = pose.headY;

    var raise = player.armRaise;
    var bend = player.crouch;

    var shadowScale = clamp(1 - player.jump / 100, 0.4, 1);
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(player.x + 6, GROUND_Y + 4, 42 * shadowScale, 8 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;

    var skinLight = '#f5d0a8';
    var skinDark  = '#d9a97c';
    var skinShade = '#c08f66';
    var jerseyLight = '#4a7fb5';
    var jerseyMain  = '#3a6ea5';
    var jerseyDark  = '#2a5280';
    var shortsMain  = '#2b3a55';
    var shortsDark  = '#1e2a3f';
    var shoeLight   = '#f0f0f8';
    var shoeDark    = '#b8b8c8';
    var hairColor   = '#2a1f1a';

    var kneeBend = bend * 16;
    var footSpread = bend * 6;

    ctx.strokeStyle = shortsDark;
    ctx.lineWidth = 15;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x - 9, hipY);
    ctx.lineTo(player.x - 17 - footSpread, kneeY + kneeBend * 0.3);
    ctx.lineTo(player.x - 19 - footSpread, baseY - 6);
    ctx.stroke();

    ctx.strokeStyle = shortsMain;
    ctx.lineWidth = 15;
    ctx.beginPath();
    ctx.moveTo(player.x + 7, hipY);
    ctx.lineTo(player.x + 15 + footSpread, kneeY + kneeBend * 0.3);
    ctx.lineTo(player.x + 19 + footSpread, baseY - 6);
    ctx.stroke();

    ctx.fillStyle = shoeLight;
    ctx.strokeStyle = shoeDark;
    ctx.lineWidth = 2;
    roundRect(player.x - 31 - footSpread, baseY - 10, 26, 12, 5);
    ctx.fill(); ctx.stroke();
    roundRect(player.x + 7 + footSpread, baseY - 10, 28, 12, 5);
    ctx.fill(); ctx.stroke();

    ctx.fillStyle = 'rgba(60,60,80,0.5)';
    roundRect(player.x - 31 - footSpread, baseY - 1, 26, 3, 1);
    ctx.fill();
    roundRect(player.x + 7 + footSpread, baseY - 1, 28, 3, 1);
    ctx.fill();

    var shortsGrad = ctx.createLinearGradient(player.x - 18, 0, player.x + 18, 0);
    shortsGrad.addColorStop(0, shortsDark);
    shortsGrad.addColorStop(1, shortsMain);
    ctx.fillStyle = shortsGrad;
    ctx.beginPath();
    ctx.moveTo(player.x - 17, hipY - 8);
    ctx.lineTo(player.x + 17, hipY - 8);
    ctx.lineTo(player.x + 19, hipY + 14);
    ctx.lineTo(player.x - 19, hipY + 14);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(player.x + 17, hipY - 8);
    ctx.lineTo(player.x + 19, hipY + 14);
    ctx.stroke();

    var torsoGrad = ctx.createLinearGradient(player.x - 20, 0, player.x + 20, 0);
    torsoGrad.addColorStop(0, jerseyDark);
    torsoGrad.addColorStop(0.5, jerseyMain);
    torsoGrad.addColorStop(1, jerseyLight);
    ctx.fillStyle = torsoGrad;

    ctx.beginPath();
    ctx.moveTo(player.x - 17, shoulderY);
    ctx.quadraticCurveTo(player.x - 19, (shoulderY + hipY) / 2, player.x - 17, hipY - 4);
    ctx.lineTo(player.x + 17, hipY - 4);
    ctx.quadraticCurveTo(player.x + 19, (shoulderY + hipY) / 2, player.x + 19, shoulderY);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.22)';
    ctx.beginPath();
    ctx.moveTo(player.x - 8, shoulderY);
    ctx.lineTo(player.x - 4, shoulderY);
    ctx.lineTo(player.x - 4, hipY - 4);
    ctx.lineTo(player.x - 8, hipY - 4);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('23', player.x + 4, (shoulderY + hipY) / 2 + 2);

    var headR = 17;

    ctx.strokeStyle = skinShade;
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x + 1, shoulderY - 2);
    ctx.lineTo(player.x + 3, headY + headR - 6);
    ctx.stroke();

    ctx.fillStyle = skinLight;
    ctx.beginPath();
    ctx.arc(player.x + 3, headY, headR, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hairColor;
    ctx.beginPath();
    ctx.arc(player.x + 3, headY - 3, headR + 0.5, Math.PI * 0.65, Math.PI * 2.15);
    ctx.fill();

    ctx.beginPath();
    ctx.arc(player.x - 6, headY + 2, 5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#1a1a2a';
    ctx.beginPath();
    ctx.arc(player.x + 12, headY + 1, 2.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = '#2a1f1a';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(player.x + 8, headY - 4);
    ctx.lineTo(player.x + 15, headY - 3);
    ctx.stroke();

    ctx.fillStyle = skinDark;
    ctx.beginPath();
    ctx.arc(player.x - 5, headY + 2, 4, 0, Math.PI * 2);
    ctx.fill();

    var rel = getReleasePos();
    var handX = rel.x;
    var handY = rel.y;
    var elbowX = (player.x + handX) / 2 - 4;
    var elbowY = (shoulderY + handY) / 2 + 6;

    ctx.strokeStyle = skinShade;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(player.x - 12, shoulderY + 4);
    ctx.quadraticCurveTo(elbowX - 8, elbowY, handX - 5, handY + 3);
    ctx.stroke();

    ctx.strokeStyle = skinLight;
    ctx.lineWidth = 11;
    ctx.beginPath();
    ctx.moveTo(player.x + 12, shoulderY + 4);
    ctx.quadraticCurveTo(elbowX + 4, elbowY, handX + 5, handY);
    ctx.stroke();

    ctx.fillStyle = skinLight;
    ctx.beginPath();
    ctx.arc(handX - 5, handY + 4, 6.5, 0, Math.PI * 2);
    ctx.arc(handX + 5, handY + 1, 7, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = skinDark;
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(handX + 5, handY - 4);
    ctx.lineTo(handX + 9, handY - 7);
    ctx.moveTo(handX + 7, handY - 1);
    ctx.lineTo(handX + 12, handY - 3);
    ctx.stroke();
  }

  /* ============================================================
     Draw: Ball
  ============================================================ */
  function drawBall() {
    var r = ball.r;

    var h = clamp(1 - (GROUND_Y - ball.y) / 420, 0.08, 1);
    ctx.save();
    ctx.globalAlpha = 0.32 * h;
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.ellipse(ball.x, GROUND_Y + 3, r * (0.55 + h * 0.5), 6 * h, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(ball.x, ball.y);
    ctx.rotate(ball.rot);

    var g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r * 1.05);
    g.addColorStop(0,    '#ffb066');
    g.addColorStop(0.45, '#f0801f');
    g.addColorStop(0.82, '#d95f0c');
    g.addColorStop(1,    '#a83f06');
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = 'rgba(45,22,8,0.85)';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';

    ctx.beginPath(); ctx.moveTo(-r, 0); ctx.lineTo(r, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(0, r); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.52, r * 0.98, 0, 0, Math.PI * 2); ctx.stroke();

    ctx.beginPath();
    ctx.ellipse(-r * 0.36, -r * 0.40, r * 0.30, r * 0.20, -0.7, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,210,0.35)';
    ctx.fill();

    ctx.restore();
  }

  /* ============================================================
     Draw: Aim
  ============================================================ */
  function drawAim() {
    if (!dragging || ball.flying) return;

    var dx = dragCur.x - dragStart.x;
    var dy = dragCur.y - dragStart.y;
    var len = Math.hypot(dx, dy);
    if (len < 6) return;

    var power = clamp(len / MAX_PULL, 0, 1);
    var ux = -dx / len;
    var uy = -dy / len;

    var arrowLen = 50 + power * 120;
    var ax = ball.x + ux * arrowLen;
    var ay = ball.y + uy * arrowLen;

    var col;
    if (power < 0.5) {
      var t = power / 0.5;
      col = 'rgb(' + Math.round(90 + 165 * t) + ',' + Math.round(230 - 30 * t) + ',' + Math.round(200 - 140 * t) + ')';
    } else {
      var t2 = (power - 0.5) / 0.5;
      col = 'rgb(' + Math.round(255) + ',' + Math.round(200 - 130 * t2) + ',' + Math.round(60 - 40 * t2) + ')';
    }

    ctx.save();

    ctx.setLineDash([6, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(ball.x, ball.y);
    ctx.lineTo(dragCur.x, dragCur.y);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.strokeStyle = col;
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.beginPath();
    ctx.moveTo(ball.x + ux * 26, ball.y + uy * 26);
    ctx.lineTo(ax, ay);
    ctx.stroke();

    var ha = Math.atan2(uy, ux);
    var hs = 13;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(ha - 0.42) * hs, ay - Math.sin(ha - 0.42) * hs);
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax - Math.cos(ha + 0.42) * hs, ay - Math.sin(ha + 0.42) * hs);
    ctx.stroke();

    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * power);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 0.85;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(ball.x, ball.y, 34, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 3.5;
    ctx.globalAlpha = 1;
    ctx.stroke();

    ctx.restore();
  }

  /* ============================================================
     Draw: Particles & Float Texts
  ============================================================ */
  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var a = p.life / p.maxLife;
      ctx.globalAlpha = a * 0.95;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function drawFloatTexts() {
    for (var i = 0; i < floatTexts.length; i++) {
      var f = floatTexts[i];
      var a = clamp(f.life / (f.maxLife * 0.55), 0, 1);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.font = '800 ' + f.size + 'px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(10,8,20,0.85)';
      ctx.strokeText(f.text, f.x, f.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
      ctx.restore();
    }
  }

  /* ============================================================
     Draw: UI
  ============================================================ */
  function drawUI() {
    ctx.save();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillText('SCORE', 34, 30);

    ctx.font = '800 46px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#FFD166';
    ctx.shadowColor = 'rgba(255,200,90,0.5)';
    ctx.shadowBlur = 18;
    ctx.fillText(String(score), 32, 50);
    ctx.shadowBlur = 0;

    ctx.textAlign = 'right';
    ctx.font = '600 14px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fillText('ACCURACY', DW - 34, 30);

    var acc = shots > 0 ? Math.round(made / shots * 100) + '%' : '—';
    ctx.font = '800 26px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillText(acc, DW - 32, 50);

    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.fillText('Shots ' + shots, DW - 32, 84);

    ctx.font = '500 13px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.34)';
    ctx.fillText('Made ' + made, DW - 32, 108);

    if (streak >= 2) {
      ctx.textAlign = 'center';
      ctx.font = '800 20px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,143,163,0.95)';
      ctx.shadowColor = 'rgba(255,110,140,0.6)';
      ctx.shadowBlur = 14;
      ctx.fillText('🔥 Streak ' + streak, DW / 2, 32);
      ctx.shadowBlur = 0;
    }

    if (Math.abs(wind) > 0.001) {
      ctx.textAlign = 'center';
      ctx.font = '600 12px system-ui, -apple-system, "Segoe UI", sans-serif';
      var dir = wind > 0 ? '→' : '←';
      ctx.fillStyle = 'rgba(160,210,255,0.55)';
      ctx.fillText('Wind ' + dir + ' ' + Math.abs(wind * 1000).toFixed(0), DW / 2, 78);
    }

    if (hintAlpha > 0.01) {
      ctx.globalAlpha = hintAlpha;
      ctx.textAlign = 'center';
      ctx.font = '600 17px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('Drag toward lower-left to charge · Release to shoot', DW / 2, DH - 46);
      ctx.font = '500 13px system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.30)';
      ctx.fillText('Longer drag = more power · Swish for bonus points', DW / 2, DH - 22);
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  /* ============================================================
     Render
  ============================================================ */
  function render() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0a14';
    ctx.fillRect(0, 0, canvas.width / dpr, canvas.height / dpr);

    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, DW, DH);
    ctx.clip();

    drawBackground();
    drawFloor();

    drawHoopBack();
    drawNet();
    drawPlayer();
    drawBall();
    drawHoopFront();

    drawAim();
    drawParticles();
    drawFloatTexts();
    drawUI();

    ctx.restore();
  }

  /* ============================================================
     Main Loop
  ============================================================ */
  var lastTime = performance.now();
  var acc = 0;
  var STEP = 1000 / 60;
  var rafId = null;

  function loop(now) {
    var delta = now - lastTime;
    lastTime = now;
    if (delta > 220) delta = 220;

    acc += delta;
    var guard = 0;
    while (acc >= STEP && guard < 6) {
      update();
      acc -= STEP;
      guard++;
    }
    if (guard >= 6) acc = 0;

    render();
    rafId = requestAnimationFrame(loop);
  }

  /* ============================================================
     Input
  ============================================================ */
  function toLogical(e) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left - offX) / scale,
      y: (e.clientY - rect.top  - offY) / scale
    };
  }

  canvas.addEventListener('pointerdown', function(e) {
    e.preventDefault();
    initAudio();
    if (actx && actx.state === 'suspended') actx.resume();

    if (ball.flying) return;

    var p = toLogical(e);
    dragging = true;
    dragStart = p;
    dragCur = p;
    try { canvas.setPointerCapture(e.pointerId); } catch(err){}
  }, { passive: false });

  canvas.addEventListener('pointermove', function(e) {
    if (!dragging) return;
    e.preventDefault();
    dragCur = toLogical(e);
  }, { passive: false });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    shoot();
  }
  canvas.addEventListener('pointerup', endDrag);
  canvas.addEventListener('pointercancel', function() { dragging = false; });
  canvas.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  /* ============================================================
     Start
  ============================================================ */
  resize();
  buildStars();
  resetBall();
  hoop.tx = hoop.x;
  hoop.ty = hoop.y;
  rafId = requestAnimationFrame(loop);

  BasketballShooting.destroy = function() {
    if (rafId) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resize);
  };
};

global.BasketballShooting = BasketballShooting;

})(window);
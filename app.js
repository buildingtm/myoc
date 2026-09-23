// app.js: draw six pieces, then play chess with them.
(function () {
  'use strict';

  const { WHITE, BLACK, P, N, B, R, Q, CAP, VAL, from, to, promo, flags, sqName } = Chess;
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];

  const NAMES = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
  const HINTS = [
    'Eight of these per side.',
    'The one that jumps.',
    'Diagonals only.',
    'Straight lines only.',
    'The strong one.',
    'Keep him alive.',
  ];
  const STORE = 'chess-by-hand-v1';
  const SIZE = 400;   // drawing box, in its own units
  const INK = 12;     // pen width
  const HALO = 36;    // width used to fill outlines and to knock the piece out of the board
  const SPR = 160;    // sprite size in px
  const MARGIN = 20;

  const IDLE = {
    draw: '',
    play: '',
  };
  let pane = 'draw';
  const say = (t) => { $('#msg').textContent = t || IDLE[pane]; };

  // ---- saved drawings + settings -----------------------------------------

  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { /* private window etc. */ }
  const validList = (l) => Array.isArray(l) && l.length > 0 && l.every((s) =>
    Array.isArray(s) && s.length > 0 && s.every((p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)));

  const strokes = Array.from({ length: 6 }, (_, i) => (saved.strokes && validList(saved.strokes[i]) ? saved.strokes[i] : null));
  let mode = saved.mode === 'human' ? 'human' : 'cpu';
  let human = saved.human === 1 ? BLACK : WHITE;
  const persist = () => {
    try { localStorage.setItem(STORE, JSON.stringify({ strokes, mode, human })); } catch (e) { /* ignore */ }
  };

  // ---- drawing box ---------------------------------------------------------

  const pad = $('#pad');
  const pg = pad.getContext('2d');
  let cur = 0;         // which piece is up
  let live = [];       // strokes on the pad
  let drawing = null;  // stroke in progress
  const art = [];      // art[i] = { w, b } sprite data urls

  function ink(g, list, width, color) {
    g.lineWidth = width;
    g.lineCap = g.lineJoin = 'round';
    g.strokeStyle = g.fillStyle = color;
    for (const pts of list) {
      if (pts.length === 1) {
        g.beginPath(); g.arc(pts[0][0], pts[0][1], width / 2, 0, Math.PI * 2); g.fill();
        continue;
      }
      g.beginPath();
      g.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length - 1; i++) {
        g.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2);
      }
      g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      g.stroke();
    }
  }

  function paintPad() {
    pg.setTransform(pad.width / SIZE, 0, 0, pad.height / SIZE, 0, 0);
    pg.fillStyle = '#fff';
    pg.fillRect(0, 0, SIZE, SIZE);
    ink(pg, drawing ? live.concat([drawing]) : live, INK, '#000');
  }

  function point(e) {
    const r = pad.getBoundingClientRect();
    const c = (v) => Math.min(SIZE, Math.max(0, v));
    return [+c((e.clientX - r.left) * SIZE / r.width).toFixed(1), +c((e.clientY - r.top) * SIZE / r.height).toFixed(1)];
  }

  pad.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    pad.setPointerCapture(e.pointerId);
    drawing = [point(e)];
    say('');
    paintPad();
  });
  pad.addEventListener('pointermove', (e) => {
    if (!drawing) return;
    const p = point(e), l = drawing[drawing.length - 1];
    if (Math.hypot(p[0] - l[0], p[1] - l[1]) < 1.5) return;
    drawing.push(p);
    paintPad();
  });
  const lift = () => {
    if (!drawing) return;
    live.push(drawing);
    drawing = null;
    paintPad();
    commit();
  };
  pad.addEventListener('pointerup', lift);
  pad.addEventListener('pointercancel', lift);

  // ---- from strokes to a piece ------------------------------------------------
  // White piece: white fill, black line. Black piece: the same drawing inverted.
  // Enclosed outlines are filled by flooding from the outside and taking what is left.

  function sprite(list, black) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of list) for (const [x, y] of s) {
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    const k = SPR / (SIZE + 2 * MARGIN);
    const tx = SPR / 2 - k * (x0 + x1) / 2, ty = SPR / 2 - k * (y0 + y1) / 2;   // centre the drawing
    const c = document.createElement('canvas');
    c.width = c.height = SPR;
    const g = c.getContext('2d', { willReadFrequently: true });

    g.setTransform(k, 0, 0, k, tx, ty);
    ink(g, list, HALO, '#000');
    const im = g.getImageData(0, 0, SPR, SPR), d = im.data, n = SPR * SPR;
    const outside = new Uint8Array(n), stack = new Int32Array(n);
    let sp = 0;
    const seed = (i) => { if (!outside[i] && d[i * 4 + 3] < 128) { outside[i] = 1; stack[sp++] = i; } };
    for (let i = 0; i < SPR; i++) { seed(i); seed(n - 1 - i); seed(i * SPR); seed(i * SPR + SPR - 1); }
    while (sp) {
      const i = stack[--sp], x = i % SPR;
      if (x > 0) seed(i - 1);
      if (x < SPR - 1) seed(i + 1);
      if (i >= SPR) seed(i - SPR);
      if (i < n - SPR) seed(i + SPR);
    }
    const v = black ? 0 : 255;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (!outside[i] && d[o + 3] < 128) { d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255; }   // enclosed: fill
      else d[o + 3] = 0;
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.putImageData(im, 0, 0);

    g.setTransform(k, 0, 0, k, tx, ty);
    ink(g, list, HALO, black ? '#000' : '#fff');
    ink(g, list, INK, black ? '#fff' : '#000');
    return c.toDataURL();
  }

  const makeArt = (i) => { art[i] = strokes[i] ? { w: sprite(strokes[i], false), b: sprite(strokes[i], true) } : null; };
  const sprites = {};   // piece code -> data url
  let version = 0;      // bumps when the sprites are rebuilt so the board knows to reload them
  function buildSprites() {
    version++;
    for (let i = 0; i < 6; i++) { sprites[i + 1] = art[i].w; sprites[(i + 1) | 8] = art[i].b; }
  }

  // ---- draw screen ----------------------------------------------------------------

  function commit() {
    strokes[cur] = live.length ? live.slice() : null;
    makeArt(cur);
    persist();
    renderShelf();
  }

  function renderShelf() {
    $('#shelf').innerHTML = NAMES.map((n, i) => {
      const thumb = (src) => `<span class="thumb${src ? ' on' : ''}">${src ? `<img alt="" src="${src}">` : ''}</span>`;
      return `<li><button type="button" data-i="${i}"${i === cur ? ' aria-current="true"' : ''}>` +
        `<span class="n">${n}</span>${thumb(art[i] && art[i].w)}${thumb(art[i] && art[i].b)}</button></li>`;
    }).join('');
  }

  function renderAsk() {
    $('#step').textContent = `Piece ${cur + 1} of 6`;
    $('#prompt').textContent = `Draw a ${NAMES[cur]}.`;
    $('#hint').textContent = HINTS[cur];
    $('#next').textContent = cur < 5 ? 'Next »' : 'Play »';
  }

  function goto(i) {
    cur = i;
    live = strokes[i] ? strokes[i].slice() : [];
    drawing = null;
    paintPad();
    renderShelf();
    renderAsk();
  }

  const missing = () => NAMES.filter((n, i) => !strokes[i]);

  $('#shelf').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) { say(''); goto(+b.dataset.i); }
  });
  $('#undo-stroke').addEventListener('click', () => { if (live.length) { live.pop(); paintPad(); commit(); } });
  $('#clear').addEventListener('click', () => { if (live.length) { live = []; paintPad(); commit(); } });
  $('#next').addEventListener('click', () => {
    if (!live.length) { say(`Draw a ${NAMES[cur]} first. The box is empty.`); return; }
    if (cur < 5) { say(''); goto(cur + 1); return; }
    const m = missing();
    if (m.length) { say(`Not yet. Still missing: ${m.join(', ')}.`); goto(NAMES.indexOf(m[0])); return; }
    show('play');
  });

  // ---- screens ------------------------------------------------------------------------

  let started = false;
  function show(which) {
    if (which === 'play') {
      const m = missing();
      if (m.length) { say(`Draw all six pieces first. Still missing: ${m.join(', ')}.`); return; }
      buildSprites();
      if (!started) { started = true; newGame(); } else paint();
    }
    pane = which;
    $('#draw').hidden = which !== 'draw';
    $('#play').hidden = which !== 'play';
    $('#nav-draw').setAttribute('aria-current', which === 'draw' ? 'page' : 'false');
    $('#nav-play').setAttribute('aria-current', which === 'play' ? 'page' : 'false');
    say('');
  }
  $('#nav-draw').addEventListener('click', () => { say(''); show('draw'); });
  $('#nav-play').addEventListener('click', () => show('play'));

  // ---- the game ----------------------------------------------------------------------------

  const chess = new Chess();
  let flip = mode === 'cpu' && human === BLACK;
  let log = [];        // { m, san, cap }
  let keys = [];       // position keys, for threefold repetition
  let legal = [];
  let sel = null;      // selected square
  let pending = null;  // promotion choices waiting for an answer
  let busy = false;    // computer is thinking
  let resigned = null; // colour that resigned
  let over = null;     // end-of-game sentence, or null
  const els = [];      // square -> button
  const order = [];    // buttons in screen order

  function buildBoard() {
    const sqs = $('#squares');
    sqs.textContent = '';
    order.length = 0;
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const sq = (flip ? row : 7 - row) * 16 + (flip ? 7 - col : col);
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.sq = sq;
        b.tabIndex = -1;
        b.appendChild(document.createElement('img')).alt = '';
        sqs.appendChild(b);
        els[sq] = b;
        order.push(b);
      }
    }
    order[0].tabIndex = 0;
    const span = (t) => `<span>${t}</span>`;
    const rows = [1, 2, 3, 4, 5, 6, 7, 8], cols = [...'abcdefgh'];
    $('#ranks').innerHTML = (flip ? rows : rows.slice().reverse()).map(span).join('');
    $('#files').innerHTML = (flip ? cols.slice().reverse() : cols).map(span).join('');
  }

  function newGame() {
    chess.load(Chess.START);
    log = [];
    keys = [chess.key()];
    sel = null; pending = null; resigned = null;
    buildBoard();
    refresh();
    maybeComputer();
  }

  function status() {
    const other = chess.turn ? 'White' : 'Black';
    if (resigned !== null) return `${resigned ? 'Black' : 'White'} resigns. ${resigned ? 'White' : 'Black'} wins.`;
    if (!legal.length) return chess.inCheck() ? `Checkmate. ${other} wins.` : 'Stalemate. Draw.';
    if (chess.insufficient()) return 'Draw. Neither side has enough pieces to mate.';
    if (chess.half >= 100) return 'Draw. Fifty moves without a capture or a pawn move.';
    const k = keys[keys.length - 1];
    if (keys.filter((x) => x === k).length >= 3) return 'Draw. The same position came up three times.';
    return null;
  }

  function refresh() {
    legal = chess.moves();
    over = status();
    paint();
  }

  function paint() { paintBoard(); paintPanel(); }

  function paintBoard() {
    const last = log.length ? log[log.length - 1].m : -1;
    const targets = new Map();
    if (sel !== null) for (const m of legal) if (from(m) === sel) targets.set(to(m), !!(flags(m) & CAP));
    const chkSq = chess.inCheck() ? chess.k[chess.turn] : -1;
    for (let sq = 0; sq < 128; sq++) {
      if (sq & 0x88) { sq += 7; continue; }
      const el = els[sq], p = chess.b[sq], img = el.firstChild;
      let cls = 'sq' + (((sq & 7) + (sq >> 4)) % 2 ? '' : ' dark');
      if (last >= 0 && (sq === from(last) || sq === to(last))) cls += ' last';
      if (sq === chkSq) cls += ' chk';
      if (sq === sel) cls += ' sel';
      if (targets.has(sq)) cls += targets.get(sq) ? ' cap' : ' tgt';
      if (p && p >> 3 === chess.turn && myTurn()) cls += ' mine';
      el.className = cls;
      if (p) {
        if (img.dataset.p !== String(p) || img.dataset.v !== String(version)) {
          img.src = sprites[p]; img.dataset.p = p; img.dataset.v = version;
        }
        img.hidden = false;
      } else { img.hidden = true; img.dataset.p = ''; }
      el.setAttribute('aria-label', sqName(sq) + (p ? `, ${p >> 3 ? 'black' : 'white'} ${NAMES[(p & 7) - 1]}` : ''));
    }
  }

  function paintPanel() {
    const side = chess.turn ? 'Black' : 'White';
    $('#state').textContent = over || (busy ? `${side} is thinking…` : `${side} to move.${chess.inCheck() ? ' Check.' : ''}`);

    const pr = $('#promo');
    pr.hidden = !pending;
    if (pending) {
      pr.innerHTML = '<span class="lead">Promote to:</span>' +
        [Q, R, B, N].map((t) => `<button type="button" data-promo="${t}"><img alt="" src="${sprites[t | (chess.turn << 3)]}"><span>${NAMES[t - 1]}</span></button>`).join('') +
        '<button type="button" data-promo="0">cancel</button>';
    }

    $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.mode === mode));
    $$('[data-side]').forEach((b) => b.setAttribute('aria-pressed', +b.dataset.side === human));
    $('#side-row').hidden = mode !== 'cpu';
    $$('[data-mode], [data-side], #new, #flip').forEach((b) => { b.disabled = busy; });
    $('#undo').disabled = busy || !log.length;
    $('#resign').disabled = busy || !!over;
    $('#copy').disabled = !log.length;

    const took = [[], []];   // took[c]: pieces colour c has captured
    for (const e of log) if (e.cap) took[(e.cap >> 3) ^ 1].push(e.cap);
    const worth = (a) => a.reduce((s, p) => s + VAL[p & 7], 0);
    const lead = (worth(took[0]) - worth(took[1])) / 100;
    [WHITE, BLACK].forEach((c) => {
      const ahead = c ? -lead : lead;
      $(c ? '#took-b' : '#took-w').innerHTML = `<span class="who">${c ? 'Black' : 'White'} took</span>` +
        took[c].sort((a, b) => VAL[b & 7] - VAL[a & 7]).map((p) => `<img alt="" src="${sprites[p]}">`).join('') +
        (ahead > 0 ? `<span class="plus">+${ahead}</span>` : '');
    });

    let rows = '';
    for (let i = 0; i < log.length; i += 2) {
      rows += `<tr><td>${i / 2 + 1}.</td><td>${log[i].san}</td><td>${log[i + 1] ? log[i + 1].san : ''}</td></tr>`;
    }
    const mv = $('#moves');
    mv.innerHTML = `<table>${rows}</table>`;
    mv.scrollTop = mv.scrollHeight;
  }

  const myTurn = () => !busy && !over && (mode === 'human' || chess.turn === human);

  function play(m) {
    const san = chess.san(m);
    chess.make(m);
    log.push({ m, san, cap: chess.stack[chess.stack.length - 1].cap });
    keys.push(chess.key());
    sel = null; pending = null;
    refresh();
    maybeComputer();
  }

  function maybeComputer() {
    if (mode !== 'cpu' || over || chess.turn === human) return;
    busy = true;
    paint();
    setTimeout(() => {    // let "thinking" reach the screen first
      const m = chess.best(900, 5);
      busy = false;
      if (m === null) refresh(); else play(m);
    }, 50);
  }

  function click(sq) {
    if (!myTurn()) return;
    if (pending) { pending = null; paint(); return; }
    if (sel !== null && sq !== sel) {
      const opts = legal.filter((m) => from(m) === sel && to(m) === sq);
      if (opts.length === 1) { play(opts[0]); return; }
      if (opts.length > 1) { pending = opts; paint(); return; }   // promotion
    }
    const p = chess.b[sq];
    sel = p && p >> 3 === chess.turn && sq !== sel ? sq : null;
    paint();
  }

  let noClick = false;   // set for a tick after a drop, so its click doesn't also count
  $('#squares').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && !noClick) click(+b.dataset.sq);
  });

  // Dragging: press one of your pieces, pull it off its square, let go on a dot.
  // A press that never moves far is left to the click handler above.
  let drag = null;   // { id, sq, x, y, ghost, half, targets, over } while a piece is held

  const squareAt = (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const b = el && el.closest('#squares button');
    return b ? +b.dataset.sq : -1;
  };
  const carry = (e) => {
    drag.ghost.style.transform = `translate(${e.clientX - drag.half}px, ${e.clientY - drag.half}px)`;
  };

  $('#squares').addEventListener('pointerdown', (e) => {
    if (e.button > 0 || drag || pending || !myTurn()) return;
    const b = e.target.closest('button');
    if (!b) return;
    const sq = +b.dataset.sq, p = chess.b[sq];
    if (p && p >> 3 === chess.turn) drag = { id: e.pointerId, sq, x: e.clientX, y: e.clientY, ghost: null };
  });

  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
      sel = drag.sq;
      paint();   // shows the dots
      drag.targets = new Set(legal.filter((m) => from(m) === sel).map((m) => to(m)));
      drag.ghost = new Image();
      drag.ghost.className = 'ghost';
      drag.ghost.alt = '';
      drag.ghost.src = sprites[chess.b[sel]];
      document.body.appendChild(drag.ghost);
      drag.half = els[sel].offsetWidth / 2;
      els[sel].firstChild.style.opacity = 0.3;
      document.body.classList.add('holding');
    }
    carry(e);
    const sq = squareAt(e), over = drag.targets.has(sq) ? els[sq] : null;
    if (over !== drag.over) {
      if (drag.over) drag.over.classList.remove('over');
      if (over) over.classList.add('over');
      drag.over = over;
    }
  });

  const drop = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    els[d.sq].firstChild.style.opacity = '';
    document.body.classList.remove('holding');
    noClick = true;
    setTimeout(() => { noClick = false; });
    const sq = e.type === 'pointerup' ? squareAt(e) : -1;
    if (d.targets.has(sq)) click(sq); else paint();   // a miss puts the piece back and leaves it selected
  };
  window.addEventListener('pointerup', drop);
  window.addEventListener('pointercancel', drop);
  $('#squares').addEventListener('keydown', (e) => {   // arrow keys move between squares
    const i = order.indexOf(document.activeElement);
    const d = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -8, ArrowDown: 8 }[e.key];
    if (i < 0 || !d) return;
    const j = i + d;
    if (j < 0 || j > 63 || (Math.abs(d) === 1 && j >> 3 !== i >> 3)) return;
    e.preventDefault();
    order.forEach((b, k) => { b.tabIndex = k === j ? 0 : -1; });
    order[j].focus();
  });

  $('#promo').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !pending) return;
    const t = +b.dataset.promo;
    if (!t) { pending = null; paint(); return; }
    play(pending.find((m) => promo(m) === t));
  });

  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    if (busy || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    if (mode === 'cpu') flip = human === BLACK;
    persist(); buildBoard(); paint(); maybeComputer();
  }));
  $$('[data-side]').forEach((b) => b.addEventListener('click', () => {
    if (busy || +b.dataset.side === human) return;
    human = +b.dataset.side;
    flip = human === BLACK;
    persist(); buildBoard(); paint(); maybeComputer();
  }));

  $('#new').addEventListener('click', () => {
    if (busy) return;
    if (log.length && !over && !window.confirm('Start a new game? This one is not finished.')) return;
    newGame();
  });
  $('#flip').addEventListener('click', () => { flip = !flip; buildBoard(); paint(); });
  $('#resign').addEventListener('click', () => {
    if (busy || over) return;
    resigned = mode === 'cpu' ? human : chess.turn;
    sel = null; pending = null;
    refresh();
  });
  $('#undo').addEventListener('click', () => {
    if (busy || !log.length) return;
    sel = null; pending = null;
    if (resigned !== null) { resigned = null; refresh(); return; }   // take the resignation back
    let n = mode === 'cpu' && chess.turn === human && log.length > 1 ? 2 : 1;   // your move and the reply
    while (n--) { chess.undo(); log.pop(); keys.pop(); }
    refresh();
    maybeComputer();
  });
  $('#copy').addEventListener('click', () => {
    const text = log.map((e, i) => (i % 2 ? '' : `${i / 2 + 1}. `) + e.san).join(' ');
    const fallback = () => window.prompt('Copy the moves:', text);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => say('Moves copied.'), fallback);
    } else fallback();
  });

  // ---- start ------------------------------------------------------------------------------------

  for (let i = 0; i < 6; i++) makeArt(i);
  cur = Math.max(0, strokes.findIndex((s) => !s));
  goto(cur);
  show(missing().length ? 'draw' : 'play');
})();

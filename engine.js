// engine.js: chess rules plus a small search. No dependencies.
// 0x88 board: square = rank * 16 + file, a1 = 0, h8 = 119.
// Piece = type | colour << 3.  Types: 1 P, 2 N, 3 B, 4 R, 5 Q, 6 K.  Colours: 0 white, 1 black.
(function (root) {
  'use strict';

  const WHITE = 0, BLACK = 1;
  const P = 1, N = 2, B = 3, R = 4, Q = 5, K = 6;
  const LETTERS = ' PNBRQK';
  const CAP = 1, EP = 2, DBL = 4, KS = 8, QS = 16;   // move flags
  const START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  const KNIGHT = [-33, -31, -18, -14, 14, 18, 31, 33];
  const KING = [-17, -16, -15, -1, 1, 15, 16, 17];
  const DIAG = [-17, -15, 15, 17];
  const ORTH = [-16, -1, 1, 16];

  // Castling rights that survive a move touching each square.
  const MASK = new Array(128).fill(15);
  MASK[0] = 13; MASK[7] = 14; MASK[4] = 12;
  MASK[112] = 7; MASK[119] = 11; MASK[116] = 3;

  // A move is one int: from | to << 7 | promo << 14 | flags << 17.
  const mk = (f, t, pr, fl) => f | (t << 7) | (pr << 14) | (fl << 17);
  const from = (m) => m & 127;
  const to = (m) => (m >> 7) & 127;
  const promo = (m) => (m >> 14) & 7;
  const flags = (m) => m >> 17;
  const sqName = (s) => 'abcdefgh'[s & 7] + ((s >> 4) + 1);
  const sqFrom = (n) => (n.charCodeAt(0) - 97) + (n.charCodeAt(1) - 49) * 16;

  class Chess {
    constructor(fen) { this.load(fen || START); }

    load(fen) {
      const [pos, turn, castle, ep, half, full] = fen.trim().split(/\s+/);
      this.b = new Array(128).fill(0);
      this.k = [0, 0];
      let r = 7, f = 0;
      for (const ch of pos) {
        if (ch === '/') { r--; f = 0; }
        else if (ch >= '1' && ch <= '8') f += +ch;
        else {
          const t = LETTERS.indexOf(ch.toUpperCase());
          const c = ch === ch.toUpperCase() ? WHITE : BLACK;
          this.b[r * 16 + f] = t | (c << 3);
          if (t === K) this.k[c] = r * 16 + f;
          f++;
        }
      }
      this.turn = turn === 'b' ? BLACK : WHITE;
      this.castle = 0;
      for (const ch of castle || '-') this.castle |= { K: 1, Q: 2, k: 4, q: 8 }[ch] || 0;
      this.ep = ep && ep !== '-' ? sqFrom(ep) : -1;
      this.half = +half || 0;
      this.full = +full || 1;
      this.stack = [];
    }

    fen() {
      let s = '';
      for (let r = 7; r >= 0; r--) {
        let e = 0;
        for (let f = 0; f < 8; f++) {
          const p = this.b[r * 16 + f];
          if (!p) { e++; continue; }
          if (e) { s += e; e = 0; }
          const ch = LETTERS[p & 7];
          s += p >> 3 ? ch.toLowerCase() : ch;
        }
        if (e) s += e;
        if (r) s += '/';
      }
      const c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') +
                (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '') || '-';
      return `${s} ${this.turn ? 'b' : 'w'} ${c} ${this.ep < 0 ? '-' : sqName(this.ep)} ${this.half} ${this.full}`;
    }

    // Identity of a position for repetition: en passant only counts if it can actually be played.
    key() {
      const f = this.fen().split(' ');
      const ep = this.ep >= 0 && this.moves().some((m) => flags(m) & EP) ? f[3] : '-';
      return `${f[0]} ${f[1]} ${f[2]} ${ep}`;
    }

    attacked(sq, by) {
      const b = this.b, c = by << 3;
      for (const d of by === WHITE ? [-15, -17] : [15, 17]) {
        const s = sq + d;
        if (!(s & 0x88) && b[s] === (P | c)) return true;
      }
      for (const d of KNIGHT) { const s = sq + d; if (!(s & 0x88) && b[s] === (N | c)) return true; }
      for (const d of KING) { const s = sq + d; if (!(s & 0x88) && b[s] === (K | c)) return true; }
      for (const d of DIAG) {
        for (let s = sq + d; !(s & 0x88); s += d) {
          const p = b[s];
          if (p) { if (p === (B | c) || p === (Q | c)) return true; break; }
        }
      }
      for (const d of ORTH) {
        for (let s = sq + d; !(s & 0x88); s += d) {
          const p = b[s];
          if (p) { if (p === (R | c) || p === (Q | c)) return true; break; }
        }
      }
      return false;
    }

    inCheck() { return this.attacked(this.k[this.turn], this.turn ^ 1); }

    // Pseudo-legal moves (may leave the king in check).
    pseudo(noisyOnly) {
      const out = [], b = this.b, us = this.turn, them = us ^ 1;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p || p >> 3 !== us) continue;
        const t = p & 7;
        if (t === P) {
          const dir = us ? -16 : 16, start = us ? 6 : 1, last = us ? 0 : 7;
          const s1 = sq + dir;
          if (!b[s1]) {
            if (s1 >> 4 === last) for (const pr of [Q, R, B, N]) out.push(mk(sq, s1, pr, 0));
            else if (!noisyOnly) {
              out.push(mk(sq, s1, 0, 0));
              if (sq >> 4 === start && !b[s1 + dir]) out.push(mk(sq, s1 + dir, 0, DBL));
            }
          }
          for (const d of [dir - 1, dir + 1]) {
            const s = sq + d;
            if (s & 0x88) continue;
            const q = b[s];
            if (q && q >> 3 === them) {
              if (s >> 4 === last) for (const pr of [Q, R, B, N]) out.push(mk(sq, s, pr, CAP));
              else out.push(mk(sq, s, 0, CAP));
            } else if (s === this.ep) out.push(mk(sq, s, 0, CAP | EP));
          }
        } else if (t === N || t === K) {
          for (const d of t === N ? KNIGHT : KING) {
            const s = sq + d;
            if (s & 0x88) continue;
            const q = b[s];
            if (!q) { if (!noisyOnly) out.push(mk(sq, s, 0, 0)); }
            else if (q >> 3 === them) out.push(mk(sq, s, 0, CAP));
          }
          if (t === K && !noisyOnly) {
            const home = us ? 112 : 0;
            if (sq === home + 4) {
              if (this.castle & (us ? 4 : 1) && b[home + 7] === (R | (us << 3)) &&
                  !b[home + 5] && !b[home + 6] &&
                  !this.attacked(home + 4, them) && !this.attacked(home + 5, them) && !this.attacked(home + 6, them))
                out.push(mk(sq, home + 6, 0, KS));
              if (this.castle & (us ? 8 : 2) && b[home] === (R | (us << 3)) &&
                  !b[home + 1] && !b[home + 2] && !b[home + 3] &&
                  !this.attacked(home + 4, them) && !this.attacked(home + 3, them) && !this.attacked(home + 2, them))
                out.push(mk(sq, home + 2, 0, QS));
            }
          }
        } else {
          for (const d of t === B ? DIAG : t === R ? ORTH : KING) {
            for (let s = sq + d; !(s & 0x88); s += d) {
              const q = b[s];
              if (!q) { if (!noisyOnly) out.push(mk(sq, s, 0, 0)); }
              else { if (q >> 3 === them) out.push(mk(sq, s, 0, CAP)); break; }
            }
          }
        }
      }
      return out;
    }

    // Legal moves. With noisyOnly: captures and promotions only.
    moves(noisyOnly) {
      const out = [], us = this.turn;
      for (const m of this.pseudo(noisyOnly)) {
        this.make(m);
        if (!this.attacked(this.k[us], us ^ 1)) out.push(m);
        this.undo();
      }
      return out;
    }

    make(m) {
      const b = this.b, f = from(m), t = to(m), pr = promo(m), fl = flags(m);
      const p = b[f], us = p >> 3;
      const rec = { m, cap: b[t], castle: this.castle, ep: this.ep, half: this.half };
      if (fl & EP) { const cs = t + (us ? 16 : -16); rec.cap = b[cs]; b[cs] = 0; }
      b[t] = pr ? pr | (us << 3) : p;
      b[f] = 0;
      if (fl & KS) { b[t - 1] = b[t + 1]; b[t + 1] = 0; }
      else if (fl & QS) { b[t + 1] = b[t - 2]; b[t - 2] = 0; }
      if ((p & 7) === K) this.k[us] = t;
      this.castle &= MASK[f] & MASK[t];
      this.ep = fl & DBL ? (f + t) >> 1 : -1;
      this.half = (p & 7) === P || rec.cap ? 0 : this.half + 1;
      if (us) this.full++;
      this.turn ^= 1;
      this.stack.push(rec);
    }

    undo() {
      const rec = this.stack.pop(), m = rec.m;
      const b = this.b, f = from(m), t = to(m), pr = promo(m), fl = flags(m);
      this.turn ^= 1;
      const us = this.turn;
      if (us) this.full--;
      const p = pr ? P | (us << 3) : b[t];
      b[f] = p;
      b[t] = 0;
      if (fl & EP) b[t + (us ? 16 : -16)] = rec.cap;
      else b[t] = rec.cap;
      if (fl & KS) { b[t + 1] = b[t - 1]; b[t - 1] = 0; }
      else if (fl & QS) { b[t - 2] = b[t + 1]; b[t + 1] = 0; }
      if ((p & 7) === K) this.k[us] = f;
      this.castle = rec.castle; this.ep = rec.ep; this.half = rec.half;
    }

    // Standard algebraic notation for a legal move in the current position.
    san(m) {
      const f = from(m), t = to(m), pr = promo(m), fl = flags(m), ty = this.b[f] & 7;
      let s;
      if (fl & KS) s = 'O-O';
      else if (fl & QS) s = 'O-O-O';
      else {
        s = '';
        if (ty === P) { if (fl & CAP) s = 'abcdefgh'[f & 7]; }
        else {
          s = LETTERS[ty];
          const others = this.moves().filter((o) => o !== m && to(o) === t && from(o) !== f && (this.b[from(o)] & 7) === ty);
          if (others.length) {
            if (!others.some((o) => (from(o) & 7) === (f & 7))) s += 'abcdefgh'[f & 7];
            else if (!others.some((o) => from(o) >> 4 === f >> 4)) s += (f >> 4) + 1;
            else s += sqName(f);
          }
        }
        if (fl & CAP) s += 'x';
        s += sqName(t);
        if (pr) s += '=' + LETTERS[pr];
      }
      this.make(m);
      if (this.inCheck()) s += this.moves().length ? '+' : '#';
      this.undo();
      return s;
    }

    // K vs K, K+minor vs K, or only same-coloured bishops: nobody can mate.
    insufficient() {
      const minors = [];
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const t = this.b[sq] & 7;
        if (t === P || t === R || t === Q) return false;
        if (t === N || t === B) minors.push({ t, shade: ((sq & 7) + (sq >> 4)) & 1 });
      }
      if (minors.length <= 1) return true;
      return minors.every((x) => x.t === B && x.shade === minors[0].shade);
    }

    perft(d) {
      if (!d) return 1;
      let n = 0;
      for (const m of this.moves()) {
        if (d === 1) { n++; continue; }
        this.make(m); n += this.perft(d - 1); this.undo();
      }
      return n;
    }

    // ---- search -------------------------------------------------------

    evaluate() {
      const b = this.b;
      let score = 0, queens = 0;
      for (let sq = 0; sq < 128; sq++) {
        if (sq & 0x88) { sq += 7; continue; }
        const p = b[sq];
        if (!p) continue;
        const t = p & 7, c = p >> 3;
        if (t === Q) queens++;
        if (t === K) continue;
        const i = c ? (sq >> 4) * 8 + (sq & 7) : (7 - (sq >> 4)) * 8 + (sq & 7);
        const v = VAL[t] + PST[t][i];
        score += c ? -v : v;
      }
      const table = queens ? PST[K] : KING_END;
      score += table[(7 - (this.k[0] >> 4)) * 8 + (this.k[0] & 7)];
      score -= table[(this.k[1] >> 4) * 8 + (this.k[1] & 7)];
      score += Math.random() * 6 - 3;   // a little variety between games
      return this.turn ? -score : score;
    }

    order(moves) {
      const b = this.b;
      return moves
        .map((m) => {
          let s = 0;
          if (flags(m) & CAP) s += 10 * VAL[flags(m) & EP ? P : b[to(m)] & 7] - VAL[b[from(m)] & 7] / 10 + 1000;
          if (promo(m)) s += VAL[promo(m)];
          return [s, m];
        })
        .sort((x, y) => y[0] - x[0])
        .map((x) => x[1]);
    }

    // Iterative-deepening alpha-beta with quiescence. Returns a move (int) or null.
    best(ms = 900, maxDepth = 5) {
      const root = this.moves();
      if (!root.length) return null;
      if (root.length === 1) return root[0];
      const deadline = Date.now() + ms, MATE = 100000, INF = 1e9;
      let nodes = 0, stop = false;

      const qs = (alpha, beta, ply) => {
        if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
        if (stop) return 0;
        const stand = this.evaluate();
        if (stand >= beta) return beta;
        if (stand > alpha) alpha = stand;
        if (ply > 8) return alpha;
        for (const m of this.order(this.moves(true))) {
          this.make(m);
          const v = -qs(-beta, -alpha, ply + 1);
          this.undo();
          if (stop) return 0;
          if (v >= beta) return beta;
          if (v > alpha) alpha = v;
        }
        return alpha;
      };

      const ab = (depth, alpha, beta, ply) => {
        if ((++nodes & 2047) === 0 && Date.now() > deadline) stop = true;
        if (stop) return 0;
        if (this.half >= 100) return 0;
        const chk = this.inCheck();
        if (chk && ply < 6) depth++;
        if (depth <= 0) return qs(alpha, beta, 0);
        const list = this.order(this.moves());
        if (!list.length) return chk ? -MATE + ply : 0;
        for (const m of list) {
          this.make(m);
          const v = -ab(depth - 1, -beta, -alpha, ply + 1);
          this.undo();
          if (stop) return 0;
          if (v >= beta) return beta;
          if (v > alpha) alpha = v;
        }
        return alpha;
      };

      let ordered = this.order(root.slice().sort(() => Math.random() - 0.5));
      let best = ordered[0];
      for (let depth = 1; depth <= maxDepth; depth++) {
        let alpha = -INF, iterBest = null;
        const scored = [];
        for (const m of ordered) {
          this.make(m);
          const v = -ab(depth - 1, -INF, -alpha, 1);
          this.undo();
          if (stop) break;
          scored.push([v, m]);
          if (v > alpha) { alpha = v; iterBest = m; }
        }
        if (stop) break;                 // half-finished iteration: keep the last full one
        best = iterBest;
        if (alpha > MATE - 100) break;   // found a forced mate
        scored.sort((x, y) => y[0] - x[0]);
        ordered = scored.map((x) => x[1]);
      }
      return best;
    }
  }

  // Simplified evaluation tables (white's point of view, rank 8 at the top).
  const VAL = [0, 100, 320, 330, 500, 900, 0];
  const PST = [null,
    [ 0,  0,  0,  0,  0,  0,  0,  0,
     50, 50, 50, 50, 50, 50, 50, 50,
     10, 10, 20, 30, 30, 20, 10, 10,
      5,  5, 10, 25, 25, 10,  5,  5,
      0,  0,  0, 20, 20,  0,  0,  0,
      5, -5,-10,  0,  0,-10, -5,  5,
      5, 10, 10,-20,-20, 10, 10,  5,
      0,  0,  0,  0,  0,  0,  0,  0],
    [-50,-40,-30,-30,-30,-30,-40,-50,
     -40,-20,  0,  0,  0,  0,-20,-40,
     -30,  0, 10, 15, 15, 10,  0,-30,
     -30,  5, 15, 20, 20, 15,  5,-30,
     -30,  0, 15, 20, 20, 15,  0,-30,
     -30,  5, 10, 15, 15, 10,  5,-30,
     -40,-20,  0,  5,  5,  0,-20,-40,
     -50,-40,-30,-30,-30,-30,-40,-50],
    [-20,-10,-10,-10,-10,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5, 10, 10,  5,  0,-10,
     -10,  5,  5, 10, 10,  5,  5,-10,
     -10,  0, 10, 10, 10, 10,  0,-10,
     -10, 10, 10, 10, 10, 10, 10,-10,
     -10,  5,  0,  0,  0,  0,  5,-10,
     -20,-10,-10,-10,-10,-10,-10,-20],
    [  0,  0,  0,  0,  0,  0,  0,  0,
       5, 10, 10, 10, 10, 10, 10,  5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
      -5,  0,  0,  0,  0,  0,  0, -5,
       0,  0,  0,  5,  5,  0,  0,  0],
    [-20,-10,-10, -5, -5,-10,-10,-20,
     -10,  0,  0,  0,  0,  0,  0,-10,
     -10,  0,  5,  5,  5,  5,  0,-10,
      -5,  0,  5,  5,  5,  5,  0, -5,
       0,  0,  5,  5,  5,  5,  0, -5,
     -10,  5,  5,  5,  5,  5,  0,-10,
     -10,  0,  5,  0,  0,  0,  0,-10,
     -20,-10,-10, -5, -5,-10,-10,-20],
    [-30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -30,-40,-40,-50,-50,-40,-40,-30,
     -20,-30,-30,-40,-40,-30,-30,-20,
     -10,-20,-20,-20,-20,-20,-20,-10,
      20, 20,  0,  0,  0,  0, 20, 20,
      20, 30, 10,  0,  0, 10, 30, 20],
  ];
  const KING_END =
    [-50,-40,-30,-20,-20,-30,-40,-50,
     -30,-20,-10,  0,  0,-10,-20,-30,
     -30,-10, 20, 30, 30, 20,-10,-30,
     -30,-10, 30, 40, 40, 30,-10,-30,
     -30,-10, 30, 40, 40, 30,-10,-30,
     -30,-10, 20, 30, 30, 20,-10,-30,
     -30,-30,  0,  0,  0,  0,-30,-30,
     -50,-30,-30,-30,-30,-30,-30,-50];

  Chess.WHITE = WHITE; Chess.BLACK = BLACK;
  Chess.P = P; Chess.N = N; Chess.B = B; Chess.R = R; Chess.Q = Q; Chess.K = K;
  Chess.CAP = CAP; Chess.EP = EP; Chess.KS = KS; Chess.QS = QS;
  Chess.from = from; Chess.to = to; Chess.promo = promo; Chess.flags = flags;
  Chess.sqName = sqName; Chess.VAL = VAL; Chess.START = START;

  if (typeof module !== 'undefined' && module.exports) module.exports = Chess;
  else root.Chess = Chess;
})(this);

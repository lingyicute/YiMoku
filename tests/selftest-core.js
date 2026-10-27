/* YiMoku — 引擎自检断言体（开发专用，零依赖）
 * 本文件不是模块：tests/selftest.js 会把它拼到从 index.html 抽出的主脚本尾部，
 * 在 Node 作用域里调用 selfTest()。产品 HTML 不再携带这些断言代码。
 */
function selfTest() {
  const fail = m => { console.error('FAIL:', m); process.exit(1); };
  const assert = (c, m) => { if (!c) fail(m); };

  /* 胜负检测 */
  let b = makeBoard();
  for (let k = 0; k < 5; k++) b[idx(k, 7)] = BLACK;
  assert(winLine(b, 2, 7) && winLine(b, 2, 7).length >= 5, '五连检测（横）');
  b = makeBoard();
  for (let k = 0; k < 5; k++) b[idx(3, k)] = WHITE;
  assert(winLine(b, 3, 1), '五连检测（竖）');
  b = makeBoard();
  for (let k = 0; k < 5; k++) b[idx(4 + k, 4 + k)] = BLACK;
  assert(winLine(b, 6, 6), '五连检测（斜）');
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(k, 7)] = BLACK;
  assert(winLine(b, 2, 7) === null, '四连不应判胜');

  /* 棋型评估 */
  b = makeBoard();
  b[idx(2, 7)] = b[idx(3, 7)] = b[idx(4, 7)] = BLACK;
  assert(pointTier(b, 5, 7, BLACK) === T.OFOUR, '两端全开成四 → OFOUR');
  b = makeBoard();
  b[idx(3, 7)] = b[idx(4, 7)] = BLACK;
  assert(pointTier(b, 5, 7, BLACK) === T.OTHREE, '活三 → OTHREE');
  assert(pointTier(b, 7, 7, BLACK) === T.TWO, '远离棋群 → TWO');
  b = makeBoard();
  b[idx(0, 7)] = WHITE;
  b[idx(1, 7)] = b[idx(2, 7)] = b[idx(3, 7)] = BLACK;
  assert(pointTier(b, 4, 7, BLACK) === T.FOUR, '单端封死成四 → FOUR');
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(k, 7)] = BLACK;
  assert(pointTier(b, 4, 7, BLACK) === T.FIVE, '补成五 → FIVE');
  b = makeBoard();
  b[idx(6, 7)] = b[idx(7, 7)] = b[idx(8, 7)] = BLACK;
  b[idx(10, 7)] = BLACK;
  assert(pointTier(b, 9, 7, BLACK) >= T.FOUR, '跳四补缺 → 至少 FOUR');

  /* VCF 次序：直接胜着优先；否则双威胁先于普通冲四，降低节点预算耗在弱分支的风险。 */
  b = makeBoard();
  b[idx(0, 10)] = WHITE;
  b[idx(1, 10)] = b[idx(2, 10)] = b[idx(3, 10)] = BLACK; // x=4 可成单端四
  b[idx(4, 7)] = b[idx(5, 7)] = b[idx(6, 7)] = BLACK;
  b[idx(7, 4)] = b[idx(7, 5)] = b[idx(7, 6)] = BLACK;   // (7,7) 可成双向冲四
  const vc = vcfCandidates(b, BLACK);
  assert(vc.length > 1 && vc[0].tier === T.OFOUR, 'VCF 应先探索双威胁着');
  assert(vc.every((c, k) => !k || vc[k - 1].tier >= c.tier), 'VCF 冲四候选按威胁等级降序');
  assert(vc.some(c => c.i === idx(4, 10) && c.tier === T.FOUR), 'VCF 次序测试包含普通冲四对照着');
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(k, 7)] = BLACK;
  const vcWin = vcfCandidates(b, BLACK);
  assert(vcWin.length === 1 && vcWin[0].tier === T.FIVE, 'VCF 直接成五应压过所有冲四候选');

  /* 各难度必胜 / 必挡 */
  for (const diff of ['easy', 'medium', 'hard', 'expert']) {
    b = makeBoard();
    for (let k = 0; k < 4; k++) b[idx(k, 7)] = BLACK;
    let mv = chooseAiMove(b, diff, BLACK);
    assert(mv && mv.i === idx(4, 7), diff + '：应补成五（实际 ' + (mv && coord(mv.x, mv.y)) + '）');
    if (diff !== 'easy') {
      b = makeBoard();
      for (let k = 0; k < 4; k++) b[idx(k, 7)] = WHITE;
      mv = chooseAiMove(b, diff, BLACK);
      assert(mv && mv.i === idx(4, 7), diff + '：应挡住对方五连');
    }
  }

  /* 困难/专家：不撞墙、能搜索 */
  b = makeBoard();
  b[idx(7, 7)] = BLACK; b[idx(7, 8)] = WHITE;
  for (const diff of ['hard', 'expert']) {
    const t0 = Date.now();
    let mv = chooseAiMove(b, diff, BLACK);
    const dt = Date.now() - t0;
    assert(mv && b[mv.i] === EMPTY, diff + ' 返回合法落点');
    console.log('  ' + diff + ' 首手耗时 ' + dt + 'ms → ' + coord(mv.x, mv.y));
    assert(dt < 3000, diff + ' 决策超时');
  }

  /* 中等 AI 对局完整模拟（至分出胜负或和棋） */
  b = makeBoard();
  let moves = 0, winner = 0;
  while (moves < 225) {
    const p = moves % 2 === 0 ? BLACK : WHITE;
    const mv = chooseAiMove(b, 'medium', p);
    if (!mv || b[mv.i]) fail('中等对局出现非法落子');
    b[mv.i] = p; moves++;
    if (winLine(b, mv.x, mv.y)) { winner = p; break; }
  }
  assert(winner !== 0 || moves === 225, '中等对局应正常结束');
  console.log('  中等模拟对局：' + moves + ' 手，' + (winner ? (winner === BLACK ? '黑胜' : '白胜') : '和棋'));

  /* 困难 vs 中等 前 24 手对局模拟（性能抽样） */
  b = makeBoard(); moves = 0;
  const ta = Date.now();
  while (moves < 24) {
    const p = moves % 2 === 0 ? BLACK : WHITE;
    const mv = chooseAiMove(b, moves % 2 === 0 ? 'hard' : 'medium', p);
    b[mv.i] = p; moves++;
    if (winLine(b, mv.x, mv.y)) break;
  }
  console.log('  困难×中等 24 手抽样：' + (Date.now() - ta) + 'ms');

  /* ---- 地平线补丁：威胁计数 / 叶子终局判定 ---- */
  b = makeBoard();
  for (let k = 1; k <= 4; k++) b[idx(k, 7)] = BLACK;   // 黑 x=1..4 四连
  b[idx(6, 7)] = BLACK;                               // 间一格再续一子
  // 连五点：x=0（窗口0-4）、x=5（窗口1-5 与 2-6 各命中一次，须去重）
  assert(fiveThreatCount(b, BLACK) === 2, '连五点去重后应为 2（x=0 与 x=5）');
  assert(fiveThreatCount(b, WHITE) === 0, '白方无连五点');
  // 条件2：轮白走、黑持两个连五点 -> 白必败
  assert(evalLeaf(b, BLACK, WHITE, 3) === WIN_V - 4, 'cond2：ai=黑、白走子 → 胜 WIN_V-(ply+1)');
  assert(evalLeaf(b, WHITE, WHITE, 3) === -(WIN_V - 4), 'cond2：ai=白、白走子 → 负 -(WIN_V-(ply+1))');
  // 条件1：轮白走且白自己有连五点 -> 白下一手即胜
  b = makeBoard();
  for (let k = 1; k <= 4; k++) b[idx(k, 8)] = WHITE;
  assert(fiveThreatCount(b, WHITE) === 2, '白四连 → 2 个连五点');
  assert(evalLeaf(b, BLACK, WHITE, 2) === -(WIN_V - 2), 'cond1：ai=黑、白走子 → 负 -(WIN_V-ply)');
  assert(evalLeaf(b, WHITE, WHITE, 2) === WIN_V - 2, 'cond1：ai=白、白走子 → 胜 WIN_V-ply');

  /* ↗ 方向的每个五格窗口都必须出现在 LINES 中，包括右下半区。 */
  for (let y = 4; y < N; y++) for (let x = 0; x + 4 < N; x++) {
    const start = idx(x, y);
    assert(LINES.some(line => {
      const pos = line.indexOf(start);
      return pos >= 0 && pos + 4 < line.length &&
        [1, 2, 3, 4].every(k => line[pos + k] === idx(x + k, y - k));
    }), '↗ 五格窗口遗漏：' + coord(x, y));
  }
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(5 + k, 13 - k)] = BLACK;
  assert(fiveThreatCount(b, BLACK) === 2, '右下半区 ↗ 活四应有两个连五点');
  assert(evalLeaf(b, BLACK, WHITE, 3) === WIN_V - 4, '右下半区 ↗ 活四：轮白走应判黑必胜');
  assert(evalBoard(b, BLACK) >= 2 * FSCR[4], '右下半区 ↗ 活四应计入静态评估');

  // 无威胁时回落静态评估
  b = makeBoard();
  b[idx(7, 7)] = BLACK; b[idx(9, 9)] = WHITE;
  assert(evalLeaf(b, BLACK, WHITE, 4) === evalBoard(b, BLACK), '无威胁回落 evalBoard');

  /* ---- 单点冲四：叶节点应先模拟唯一强制挡点，而非把开放四当作静态损失 ---- */
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(k, 7)] = WHITE;  // 左边界封闭，唯一白胜点为 x=4
  b[idx(9, 9)] = BLACK;
  const beforeBlock = Uint8Array.from(b);
  assert(fiveThreatCount(b, WHITE, 2) === 1, '单点冲四测试局面应恰有一个白胜点');
  const forcedBlock = Uint8Array.from(b);
  forcedBlock[idx(4, 7)] = BLACK;
  const qValue = evalLeaf(b, BLACK, BLACK, 3);
  assert(qValue === evalBoard(forcedBlock, BLACK),
    '单点冲四叶子应等价于模拟唯一挡点后的静态评估（实际 ' + qValue + '）');
  assert(beforeBlock.every((v, i) => b[i] === v), '叶子战术延伸不得污染原棋盘');

  // 补丁不破坏必胜/必挡（chooseAiMove 前置检查仍最高优先）
  b = makeBoard();
  for (let k = 0; k < 4; k++) b[idx(k, 7)] = BLACK;
  const mvP = chooseAiMove(b, 'expert', BLACK);
  assert(mvP && mvP.i === idx(4, 7), '补丁后专家难度仍立即补五');

  /* ---- ㉖ 送杀闸门回归：攻方已有连五点（轮到攻方）时，VCF/VCT 必须判「下一手即胜」，
     不得因防方同时有连五点而早退返回 null（旧版在此漏判）。 ---- */
  b = makeBoard();
  for (let x = 0; x < 4; x++) b[idx(x, 7)] = BLACK;     // 黑五点 (4,7)
  for (let x = 10; x < 14; x++) b[idx(x, 0)] = WHITE;   // 白也有五点
  { const r = vcfRoot(b, BLACK, 7, now(), 1e9); assert(r && r.len === 1 && r.i === idx(4, 7), 'VCF 回归：攻方已有五点应直接判胜'); }
  { const r = vctRoot(b, BLACK, 6, now(), 1e9); assert(r && r.len === 1, 'VCT 回归：攻方已有五点应直接判胜'); }

  /* ---- ㉘ 送杀闸门 VCT 视野 4：对手 4+ 手连续威胁链不得放行（len=3 时代盲区回归）----
     局面（黑先，双方各 6 子）：黑 J8 后白有可证明的 ≥4 手 VCT 强制胜
     （vctRoot(白,4) 与 abSearch d9 双路复核），旧闸门（len 3）会放行 J8。
     要求：vctRoot(白,4) 能证明该杀；且专家决策不得把 J8 当最优手落下。 ---- */
  b = makeBoard();
  for (const [bx, by] of [[3, 3], [6, 3], [3, 5], [5, 5], [2, 6], [3, 7]]) b[idx(bx, by)] = BLACK;
  for (const [wx, wy] of [[5, 4], [6, 4], [6, 5], [0, 6], [6, 6], [7, 6]]) b[idx(wx, wy)] = WHITE;
  {
    b[idx(8, 7)] = BLACK;
    const tG = now();
    const kG = vcfRoot(b, WHITE, 14, tG, 1e9) || vctRoot(b, WHITE, 4, tG, 1e9);
    b[idx(8, 7)] = EMPTY;
    assert(kG, '㉘：黑 J8 后白应存在可证明 VCT 杀（vctRoot(白,4) 视野内）');
    const mvG = chooseAiMove(b, 'expert', BLACK);
    assert(mvG && mvG.i !== idx(8, 7), '㉘：专家应改道，不得落下送 VCT 杀的 J8（实际 ' + (mvG && coord(mvG.x, mvG.y)) + '）');
  }

  /* ---- TW[0]：被包围空点评分不得为 NaN（层级 0 已定义） ---- */
  assert(TW[0] === 0, 'TW[0] 应为 0');
  b = makeBoard();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    if (dx || dy) b[idx(5 + dx, 7 + dy)] = BLACK;   // 中心空点被黑子团团围住
  }
  const scEnc = scoreCell(b, 5, 7, WHITE);
  assert(scEnc.m === 0 && Number.isFinite(scEnc.s), '被包围空点评分应有限，实际 ' + scEnc.s);

  /* ---- 双活三识别 / 双威胁系数 / 叶子准胜负 ---- */
  b = makeBoard();
  b[idx(7,7)] = b[idx(9,7)] = b[idx(8,5)] = b[idx(8,6)] = BLACK;
  const px = pointTierEx(b, 8, 7, BLACK);
  assert(px.t === T.OTHREE && px.hi === 2, '双活三着法：层级 OTHREE 且 2 个方向达标，实际 ' + px.t + '/' + px.hi);
  assert(pointTier(b, 8, 7, BLACK) === T.OTHREE, 'pointTier 兼容接口返回值不变');
  b[idx(8,7)] = BLACK;
  assert(openThreeCount(b, BLACK, 8) === 2, '(8,7) 落子后黑有两个活三');
  assert(openThreeCount(b, WHITE, 8) === 0, '白无活三');
  assert(evalLeaf(b, BLACK, WHITE, 3) === WIN_V / 4 - 4, '双活三叶子：ai=黑、白走子 → 黑准胜 WIN_V/4-(ply+1)');
  assert(evalLeaf(b, WHITE, WHITE, 3) === -(WIN_V / 4 - 4), '双活三叶子：ai=白、白走子 → 白准负');

  /* ---- cond3 门控：对方已持连五点时，我方双活三不得判「准胜」 ----
     白在 y=12 有冲四（恰 1 个连五点 x=4）；黑保持上图的双活三。
     轮黑走：黑 1 手挡不了自己成五，白下一手即连五——「双活三 3 手成五」
     慢于对方 1 手成五，准胜判定不成立，必须回落到静态评估。
     （旧实现会在此返回 ±WIN_V/4 级分值，属符号级误判。） */
  b = makeBoard();
  b[idx(7,7)] = b[idx(9,7)] = b[idx(8,5)] = b[idx(8,6)] = BLACK; b[idx(8,7)] = BLACK;
  for (let k = 0; k < 4; k++) b[idx(k, 12)] = WHITE;
  assert(fiveThreatCount(b, WHITE) === 1, 'cond3 门控：白冲四应恰有 1 个连五点');
  assert(fiveThreatCount(b, BLACK) === 0 && openThreeCount(b, BLACK, 2) >= 2,
    'cond3 门控：黑无连五点且持双活三');
  const vG1 = evalLeaf(b, WHITE, BLACK, 3);
  assert(Math.abs(vG1) < WIN_V / 8, 'cond3 门控：ai=白、黑走子 → 不得判黑准胜（实际 ' + vG1 + '）');
  const vG2 = evalLeaf(b, BLACK, BLACK, 3);
  assert(Math.abs(vG2) < WIN_V / 8, 'cond3 门控：ai=黑、黑走子 → 不得判黑准胜（实际 ' + vG2 + '）');

  /* ---- ⑨ 跳三计入活三：_XX_X_ / _X_XX_ 与 _XXX_ 同等逼迫 ---- */
  b = makeBoard();
  b[idx(3,7)] = b[idx(4,7)] = b[idx(6,7)] = BLACK;      // _XX_X_（两端空）
  assert(openThreeCount(b, BLACK, 8) === 1, '跳三 _XX_X_ 应计为活三');
  /* ㉑ 单个（跳）活三即准胜：轮走方三→活四→五可证明，对方无连五点时必败 */
  assert(evalLeaf(b, BLACK, BLACK, 2) === WIN_V / 4 - 2, '单个跳三应判准胜 WIN_V/4-ply');
  b = makeBoard();
  b[idx(3,7)] = b[idx(4,7)] = b[idx(5,7)] = BLACK;      // 黑连活三 _XXX_（两端及外端均空）
  b[idx(8,2)] = b[idx(9,2)] = b[idx(10,2)] = WHITE;      // 白横向活三
  b[idx(12,5)] = b[idx(12,6)] = b[idx(12,7)] = WHITE;    // 白纵向活三
  assert(openThreeCount(b, WHITE, 8) === 2, '优先级测试：白应持双活三');
  assert(fiveThreatCount(b, WHITE) === 0 && fiveThreatCount(b, BLACK) === 0, '优先级测试：双方均无连五点');
  assert(evalLeaf(b, BLACK, BLACK, 2) === WIN_V / 4 - 2, '轮走方单活三优先于对方双活三（3 ply 快过 4+ ply）');
  assert(evalLeaf(b, WHITE, BLACK, 2) === -(WIN_V / 4 - 2), '单活三准胜符号：ai=白、黑走子应为负');
  b = makeBoard();
  b[idx(3,7)] = b[idx(4,7)] = b[idx(6,7)] = BLACK;      // 黑单跳三 _XX_X_，白空盘
  assert(evalLeaf(b, BLACK, WHITE, 3) === evalBoard(b, BLACK), '单活三在对方走子时不触发准胜（需轮到己走）');
  b = makeBoard();
  b[idx(3,7)] = b[idx(5,7)] = b[idx(6,7)] = BLACK;      // _X_XX_
  assert(openThreeCount(b, BLACK, 8) === 1, '跳三 _X_XX_ 应计为活三');
  b = makeBoard();
  b[idx(2,7)] = WHITE;                                    // 堵死一端 → 不是活三
  b[idx(3,7)] = b[idx(4,7)] = b[idx(6,7)] = BLACK;
  assert(openThreeCount(b, BLACK, 8) === 0, '一端被堵的跳三不计活三');
  b = makeBoard();
  b[idx(3,7)] = b[idx(4,7)] = b[idx(6,7)] = BLACK;      // 双跳三（横 _XX_X_ + 竖 _XX_X_）
  b[idx(8,5)] = b[idx(8,6)] = b[idx(8,8)] = BLACK;
  assert(openThreeCount(b, BLACK, 8) >= 2, '双跳三应识别为双活三');
  assert(evalLeaf(b, BLACK, WHITE, 3) === WIN_V / 4 - 4, '双跳三叶子：ai=黑、白走子 → 黑准胜 WIN_V/4-(ply+1)');

  /* ---- ⑪ 活三必须能补成活四：O.XXX.O 两端之外被堵死的不算活三 ---- */
  b = makeBoard();
  b[idx(1, 7)] = WHITE; b[idx(7, 7)] = WHITE;            // 堵在两端之外
  b[idx(3, 7)] = b[idx(4, 7)] = b[idx(5, 7)] = BLACK;   // (2,7) 与 (6,7) 均为空
  assert(openThreeCount(b, BLACK, 8) === 0, 'O.XXX.O 两端之外被堵死，不能成活四，不计为活三');

  /* ---- 固定深度 + 超大预算的着法快照（不是这些着法最优的证明）---- */
  /* 半径 2 覆盖修复后，d5 的 #5 L8→H7、#7 L7→F8；其余快照不变。
     PVS 的正确性另由 tests/ai-search-integrity.js 在固定候选策略下与全窗搜索对拍。 */
  const goldens = [
    { seq: [[7,7],[8,8],[7,8]], d: 5, mv: 'H10' },
    { seq: [[7,7],[8,8],[7,8]], d: 6, mv: 'G10' },
    { seq: [[7,7],[8,7],[7,8],[6,7],[9,6],[8,8],[10,7],[6,8],[7,9],[9,8],[5,7],[11,8]], d: 5, mv: 'H7' },
    { seq: [[7,7],[8,7],[7,8],[6,7],[9,6],[8,8],[10,7],[6,8],[7,9],[9,8],[5,7],[11,8]], d: 6, mv: 'H7' },
    { seq: [[3,3],[5,5],[7,7],[9,6],[11,9],[6,10],[12,13],[4,10],[6,4],[8,5],[9,8],[11,7]], d: 5, mv: 'H7' },
    { seq: [[3,3],[5,5],[7,7],[9,6],[11,9],[6,10],[12,13],[4,10],[6,4],[8,5],[9,8],[11,7]], d: 6, mv: 'H5' },
    { seq: [[7,7],[7,8],[8,7],[8,8],[6,7],[9,7],[7,6],[7,9],[5,5],[10,10],[6,6],[9,9]], d: 5, mv: 'F8' },
    { seq: [[7,7],[7,8],[8,7],[8,8],[6,7],[9,7],[7,6],[7,9],[5,5],[10,10],[6,6],[9,9]], d: 6, mv: 'L7' },
  ];
  for (const g of goldens) {
    b = makeBoard();
    let gp = BLACK;
    for (const [gx, gy] of g.seq) { b[idx(gx, gy)] = gp; gp = other(gp); }
    const ai = gp;
    const gcl = candidateList(b);
    const gsc = [];
    for (const gi of gcl) gsc.push(scoreCell(b, gi % N, (gi / N) | 0, ai));
    gsc.sort((a, c) => c.s - a.s);
    HIST.fill(0);
    const gmv = searchBest(b, ai, gsc.slice(0, 12), g.d, 1e12);
    assert(gmv && coord(gmv.x, gmv.y) === g.mv,
      'PVS 黄金着法：d' + g.d + ' 应为 ' + g.mv + '（实际 ' + (gmv ? coord(gmv.x, gmv.y) : 'null') + '）');
  }

  /* ---- ⑫ 冲四活三 & 双跳活三启发评分 + ⑬ 叶节点冲四活三准胜判定 ---- */
  b = makeBoard();
  b[idx(0, 3)] = WHITE;
  b[idx(1, 3)] = b[idx(2, 3)] = b[idx(3, 3)] = BLACK;   // (4,3) 横向单冲四
  b[idx(4, 4)] = b[idx(4, 5)] = BLACK;                  // (4,3) 纵向同时成活三 → 冲四活三
  b[idx(7, 14)] = WHITE;
  b[idx(7, 13)] = b[idx(7, 12)] = b[idx(7, 11)] = BLACK;// (7,10) 靠近中心的单纯死四
  const p43 = pointTierEx(b, 4, 3, BLACK);
  assert(p43.t === T.FOUR && p43.hi >= 2, '冲四活三：pointTierEx 应保留 hi>=2（实际 ' + p43.t + '/' + p43.hi + '）');
  assert(scoreCell(b, 4, 3, BLACK).s > scoreCell(b, 7, 10, BLACK).s * 3,
    '冲四活三评分应显著高于靠近中心的普通单冲四');
  b[idx(4, 3)] = BLACK;                                 // 落子形成冲四活三，轮白走
  assert(evalLeaf(b, BLACK, WHITE, 3) === WIN_V / 4 - 4,
    '冲四活三叶子：白强制挡四后黑握活三且先手 → 黑准胜 WIN_V/4-(ply+1)');

  b = makeBoard();
  b[idx(6, 9)] = b[idx(7, 9)] = BLACK;                  // (9,9) 横向跳活三 _XX_X_
  b[idx(9, 6)] = b[idx(9, 7)] = BLACK;                  // (9,9) 纵向跳活三 _XX_X_
  const pjj = pointTierEx(b, 9, 9, BLACK);
  assert(pjj.t === T.BROKEN && pjj.hi === 2, '双跳活三：hi 应为 2 以触发 5 倍双威胁加权');
  assert(scoreCell(b, 9, 9, BLACK).s > TW[T.OTHREE] * 3, '双跳活三评分应高于单一活三');

  /* ---- ⑭ vcfStep 直接成五（两端封死） + ⑰ guardAgainstVcf 防废四绕过 ---- */
  b = makeBoard();
  b[idx(0, 7)] = b[idx(1, 7)] = b[idx(2, 7)] = b[idx(3, 7)] = BLACK;
  b[idx(5, 7)] = WHITE;                                 // x=4 补成五，但两端 (x=-1, x=5) 均封死
  vcfBudget = 100; vcfT0 = now(); vcfDeadline = 1e9;
  assert(vcfStep(b, BLACK, 3) === 1, 'vcfStep：两端封死的直接连五点仍应返回 1 手胜');

  b = makeBoard();
  /* White has an edge double-four threat at P8. Black may defend directly,
     or first play a forcing F6/G7 exchange and then defend. The old assertion
     rejected this exchange by accidentally letting white move twice. */
  b[idx(11, 7)] = b[idx(12, 7)] = b[idx(13, 7)] = WHITE;
  b[idx(14, 5)] = b[idx(14, 6)] = b[idx(14, 8)] = WHITE;  // 白在 P8 有双四 VCF 杀点
  b[idx(1, 1)] = WHITE;
  b[idx(2, 2)] = b[idx(3, 3)] = b[idx(4, 4)] = BLACK;     // 黑在 (5,5) 有无关单冲四（废四）
  b[idx(8, 2)] = b[idx(9, 3)] = BLACK;
  const badPick = scoreCell(b, 7, 11, BLACK);
  const spiteFour = scoreCell(b, 5, 5, BLACK);
  const trueBlock = scoreCell(b, 14, 7, BLACK);
  const gPick = guardAgainstVcf(b, BLACK, badPick, [badPick, spiteFour, trueBlock], now(), 800);
  /* The old test required P8 by incorrectly giving white a second turn after
     blocking F6. Black may instead play F6, white G7, then black P8.
     A guard is allowed to retain this unrefuted counter-four; it is not a
     certificate of safety. The quiet losing move must still be rejected. */
  assert(gPick && (gPick.i === spiteFour.i || gPick.i === trueBlock.i) && gPick.guarded,
    'guardAgainstVcf：应拒绝已证实送杀的安静手，但不得把未证伪的冲四强行判负');

  /* ---- ㉒ 死端跳眠三降格为 T.THREE + ㉓ VCT 防废四绕过 + ㉔ 增量评估逐位等价 ---- */
  b = makeBoard();
  b[idx(8, 6)] = BLACK;
  b[idx(7, 6)] = b[idx(6, 6)] = WHITE;                  // (4,6) 形成 _W_WWB，右端被黑堵死，实为跳眠三
  const pJumpSleep = pointTierEx(b, 4, 6, WHITE);
  assert(pJumpSleep.t === T.THREE && pJumpSleep.hi === 0,
    '死端跳眠三 _W_WWB 应评为 T.THREE 而非 T.BROKEN（实际 ' + pJumpSleep.t + '）');
  b[idx(8, 8)] = b[idx(9, 8)] = BLACK;
  assert(pointTierEx(b, 11, 8, BLACK).t === T.BROKEN && pointTierEx(b, 11, 8, BLACK).hi === 1,
    '两端皆空的跳活三 _BB_B_ 仍应保持 T.BROKEN 且 hi===1');

  b = makeBoard();
  b[idx(5, 7)] = b[idx(6, 7)] = b[idx(7, 5)] = b[idx(7, 6)] = BLACK; // 黑在 (7,7) 有双活三 VCT
  b[idx(0, 0)] = BLACK;
  b[idx(1, 0)] = b[idx(2, 0)] = b[idx(3, 0)] = WHITE;   // 白在 (4,0) 有无关单冲四（废四）
  const vtSpite = vctRoot(b, BLACK, 3, now(), 500);
  assert(vtSpite && vtSpite.i === idx(7, 7), 'vctRoot：不得被防方无关废四盲化，应找出 H8 双活三必胜');

  b = makeBoard();
  b[idx(5, 7)] = b[idx(6, 7)] = b[idx(7, 5)] = b[idx(7, 6)] = BLACK;
  b[idx(2, 4)] = BLACK;
  b[idx(4, 4)] = b[idx(5, 4)] = b[idx(6, 4)] = WHITE;   // 白在 (3,4) 反冲四迫使黑挡 (7,4)，顺手反先解掉黑纵活三
  const vtRefute = vctRoot(b, BLACK, 3, now(), 500);
  assert(vtRefute === null, 'vctRoot：防方有效反冲四解杀时不得误报必胜');

  /* ---- ㉕ 送杀闸门补齐 VCT：三起手强制杀也必须被拦截 ---- */
  b = makeBoard();
  b[idx(5, 7)] = b[idx(6, 7)] = b[idx(7, 5)] = b[idx(7, 6)] = BLACK; // 黑 (7,7) 双活三 VCT 杀（复用 ㉓ 局面）
  assert(vcfRoot(b, BLACK, 7, now(), 500) === null,
    '㉕ 前提：该局面无 VCF 杀——仅查 VCF 的旧闸门对它全盲');
  const vgKill = vctRoot(b, BLACK, 3, now(), 500);
  assert(vgKill && vgKill.i === idx(7, 7) && vgKill.len === 3,
    '㉕ vctRoot 应证明黑 (7,7) 双活三 3 手强制胜（实际 ' + (vgKill ? vgKill.len : 'null') + '）');
  const vgQuiet = scoreCell(b, 2, 2, WHITE);              // 白安静手：不解杀
  const vgBlock = scoreCell(b, 7, 7, WHITE);              // 白占杀点：真正解杀
  b[idx(2, 2)] = WHITE;
  assert(oppHasVcfAfter(b, WHITE, BLACK, 500, false) === true,
    '㉕ 安静手落下后 oppHasVcfAfter 应报 true（VCT 杀同样算「送杀」）');
  b[idx(2, 2)] = EMPTY; b[idx(7, 7)] = WHITE;
  /* ㉛ 视野 4 → 8 后本条断言的语义变了：独立验证器（不复用本引擎搜索代码）证明
     白占 (7,7) 只挡掉了 3 手杀 —— 黑随后仍有 6 手 VCT 强制胜（白该局面已无处可逃），
     因此闸门报 true 是「视野变深后的正确判断」，不是误报。
     原语义（≤4 手）用显式调用保留为锚点。 */
  assert(vctRoot(b, BLACK, 4, now(), 500) === null,
    '㉛ 白占 (7,7) 后黑确无 ≤4 手 VCT 杀（原断言的适用范围）');
  assert(vctRoot(b, BLACK, 6, now(), 500) !== null,
    '㉛ 但黑有 6 手 VCT 杀：更深的闸门必须报「仍被送杀」');
  assert(oppHasVcfAfter(b, WHITE, BLACK, 500, false) === true,
    '㉛ 视野 8 下 oppHasVcfAfter 应报 true（黑 6 手杀成立，非误报）');
  b[idx(7, 7)] = EMPTY;
  const vgPick = guardAgainstVcf(b, WHITE, vgQuiet, [vgQuiet, vgBlock], now(), 500);
  /* ㉛ 同一局面在视野 8 下两个候选都被判「仍被送杀」（黑 6 手杀对 (2,2) 与 (7,7) 都成立），
     闸门按设计在无解杀手时原样返回 pick，绝不伪造一个解杀点。 */
  assert(vgPick && vgPick.i === idx(2, 2) && !vgPick.guarded,
    '㉛ guardAgainstVcf：无真正解杀手时应原样返回 pick（实际 ' + JSON.stringify(vgPick) + '）');

  /* ---- ㉗ 假活三 O_XXX_O 与死空间修正 + pick 自身为废四拦截 + 4 手 VCT + 增量线表一致性 ---- */
  b = makeBoard();
  b[idx(4, 7)] = b[idx(10, 7)] = WHITE;
  b[idx(6, 7)] = b[idx(7, 7)] = BLACK;                  // (8,7) 形成 W_BBB_W，两端外侧皆被白封死，实为眠三
  const pFalseO3 = pointTierEx(b, 8, 7, BLACK);
  assert(pFalseO3.t === T.THREE && pFalseO3.hi === 0,
    '㉗ 假活三 W_BBB_W 应降为 T.THREE 且 hi===0（实际 ' + pFalseO3.t + '/' + pFalseO3.hi + '）');
  b = makeBoard();
  b[idx(3, 7)] = b[idx(8, 7)] = WHITE;
  b[idx(5, 7)] = b[idx(6, 7)] = BLACK;                  // (7,7) 处于长仅 4 格的死走廊 W_BB[7,7]W，绝无可能成五
  const pDead4 = pointTierEx(b, 7, 7, BLACK);
  assert(pDead4.t < T.THREE && pDead4.mid === 0,
    '㉗ 长度 <5 的死空间 W_BB_W 不得误判为眠三 T.THREE（实际 ' + pDead4.t + '/' + pDead4.mid + '）');

  /* A forcing move is not proved losing merely because the opponent could
     win if allowed to move again after their forced block. */
  b = makeBoard();
  b[idx(11, 7)] = b[idx(12, 7)] = b[idx(13, 7)] = WHITE;
  b[idx(14, 5)] = b[idx(14, 6)] = b[idx(14, 8)] = WHITE;
  b[idx(1, 1)] = WHITE;
  b[idx(2, 2)] = b[idx(3, 3)] = b[idx(4, 4)] = BLACK;
  b[idx(8, 2)] = b[idx(9, 3)] = BLACK;
  const gPickSpite = guardAgainstVcf(b, BLACK, scoreCell(b, 5, 5, BLACK), [scoreCell(b, 5, 5, BLACK), scoreCell(b, 14, 7, BLACK)], now(), 800);
  assert(gPickSpite && gPickSpite.i === idx(5, 5) && !gPickSpite.guarded,
    'guardAgainstVcf：挡四后轮黑，不得让白连走两手来证伪 F6');

  b = makeBoard();
  b[idx(3, 5)] = WHITE;
  b[idx(4, 5)] = b[idx(5, 5)] = b[idx(6, 5)] = BLACK;   // 第 1 步 (7,5) 冲四逼白挡 (8,5)，并为第 7 列垫子
  b[idx(7, 6)] = BLACK;
  b[idx(8, 7)] = b[idx(9, 7)] = BLACK;                  // 第 2 步占 (7,7) 同时形成纵+横双活三，合计 4 手 VCT
  b[idx(5, 4)] = b[idx(9, 8)] = WHITE;                  // 封死副对角线干扰
  assert(vctRoot(b, BLACK, 3, now(), 500) === null, '㉗ 4 手 VCT 在 maxLen=3 下不应提前命中');
  const vt4 = vctRoot(b, BLACK, 4, now(), 500);
  assert(vt4 && vt4.i === idx(7, 5) && vt4.len === 4,
    '㉗ 4 手 VCT（冲四垫子 → 双活三 → 活四 → 五）应命中 H6（实际 ' + JSON.stringify(vt4) + '）');

  /* ㉛ VCT 长度回归：黑 (5,5) 有 5 手强制胜 —— 四手上限的典型盲区
     （来源：随机中盘普查 seed=174 ply=10；已用独立验证器确认该杀成立）。 */
  b = makeBoard();
  for (const [x, y, p] of [[7, 7, BLACK], [8, 6, BLACK], [6, 5, BLACK], [6, 8, BLACK], [6, 6, BLACK],
                           [8, 7, WHITE], [9, 5, WHITE], [6, 3, WHITE], [4, 10, WHITE], [6, 7, WHITE]]) b[idx(x, y)] = p;
  assert(vctRoot(b, BLACK, 4, now(), 300) === null,
    '㉛ maxLen=4 抓不到该 5 手杀（旧设定的盲区）');
  const vt5 = vctRoot(b, BLACK, 5, now(), 300);
  assert(vt5 && vt5.len === 5 && vt5.i === idx(5, 5),
    '㉛ maxLen>=5 应证明黑 (5,5) 的 5 手强制胜（实际 ' + JSON.stringify(vt5) + '）');

  console.log('SELFTEST PASS');
}

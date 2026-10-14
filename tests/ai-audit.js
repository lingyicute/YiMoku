#!/usr/bin/env node
/* Correctness audit. Zero dependencies; deterministic clocks and independent
 * board oracle. ENGINE_HTML can point at a pre-patch index.html to reproduce
 * the failures. This suite is not an Elo/strength benchmark. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(process.env.ENGINE_HTML || path.join(__dirname, '..', 'index.html'), 'utf8');
const main = html.match(/<script id="main">([\s\S]*?)<\/script>/)[1];
const src = main.slice(0, main.indexOf('/* ---------- 入口 ---------- */'));
function engine(clock = () => 0) {
  return new Function('performance', src + `
    return { makeBoard, idx, WIN_V, T, vcfRoot, vctRoot, oppHasVcfAfter,
      evalBoard, evalLeaf, chooseAiMove,
      point(b, i, p) {
        pointTierEx(b, i % N, (i / N) | 0, p);
        return { t: P_RES.t, threats: Array.from(THR_BUF.slice(0, THR_N)).sort((a,b) => a-b) };
      },
      fastLeaf(b, ai, side) {
        initIncTable(b); incActive = true;
        try { return evalLeaf(b, ai, side, 0); }
        finally { incActive = false; }
      },
      search(b, ai, side, ply) {
        return abSearch(b, ai, side, 0, -WIN_V, WIN_V, ply, now(), 1e9, EXT_LIMIT);
      },
      vctEntry(b, name, budget, depth = 0) {
        vctNodes = VCT_CAP; vctT0 = 0; vctDeadline = budget;
        if (name === 'try') return vctTry(b, BLACK, idx(7,7), 3, depth);
        if (name === 'forced') return vctStepForced(b, BLACK, idx(7,7), 3, depth);
        return vctStep(b, BLACK, 3, depth);
      },
      frameProbe(b) {
        VCT_DEF_STACK.fill(-777);
        vctNodes = VCT_CAP; vctT0 = 0; vctDeadline = 1e9;
        vctTry(b, BLACK, idx(7,7), 3, 8);
        return Array.from(VCT_DEF_STACK.slice(7*64, 8*64));
      },
      smallDefenceBuffer(b) { return vctDefences(b, BLACK, new Int32Array(1), 4); }
    };`)({ now: clock });
}
// Independent rules oracle: no pointTier, leaf evaluation or engine threat code.
const at = (x,y) => y*15+x;
function five(b,i) {
  const p=b[i], x=i%15, y=(i/15)|0;
  if (!p) return false;
  for (const [dx,dy] of [[1,0],[0,1],[1,1],[1,-1]]) {
    let n=1;
    for (const sign of [-1,1]) for (let k=1;k<15;k++) {
      const xx=x+dx*k*sign, yy=y+dy*k*sign;
      if(xx<0||yy<0||xx>=15||yy>=15||b[at(xx,yy)]!==p) break;
      n++;
    }
    if(n>=5) return true;
  }
  return false;
}
function wins(b,p) {
  const out=[];
  for(let i=0;i<225;i++) if(!b[i]) {
    b[i]=p; if(five(b,i)) out.push(i); b[i]=0;
  }
  return out;
}
let passed=0,failed=0;
function test(name,fn) {
  try { fn(); passed++; }
  catch(e) { failed++; console.error('FAIL '+name+': '+e.message); }
}
const sym=[];
for(let flip=0;flip<2;flip++) for(let rot=0;rot<4;rot++) sym.push((x,y)=>{
  if(flip) x=14-x;
  for(let k=0;k<rot;k++) [x,y]=[14-y,x];
  return [x,y];
});
function board(stones, transform=(x,y)=>[x,y], swap=false) {
  const b=new Uint8Array(225);
  for(const [x,y,p] of stones) { const [xx,yy]=transform(x,y); b[at(xx,yy)]=swap?3-p:p; }
  return b;
}
// Legal white-to-move position after black D1: black has 10, white has 9.
// Only white E1 avoids immediate loss. Then black H8 makes two closed fours
// and wins; white's unrelated L13/M13/N13 three is one tempo too slow.
const winningFour=[[0,0,1],[1,0,1],[2,0,1],[3,0,1],
  [4,7,1],[5,7,1],[6,7,1],[7,4,1],[7,5,1],[7,6,1],
  [3,7,2],[7,3,2],[10,12,2],[11,12,2],[12,12,2],
  [0,14,2],[3,14,2],[6,14,2],[9,14,2]];
const chain=[[4,5,1],[5,5,1],[6,5,1],[7,6,1],[7,8,1],
  [3,5,2],[0,0,2],[3,0,2],[6,0,2],[9,0,2]];
const fork=[[5,7,1],[6,7,1],[7,5,1],[7,6,1]];
for(let n=0;n<sym.length;n++) for(const swap of [false,true]) {
  const transform=sym[n], p=swap?2:1, opp=3-p;
  const cell=(x,y)=>at(...transform(x,y));
  test('winning counter-four / symmetry='+n+' swap='+swap,()=>{
    const e=engine(), b=board(winningFour,transform,swap), before=b.slice();
    assert.deepEqual(wins(b,p),[cell(4,0)]);
    assert.equal(wins(b,opp).length,0);
    b[cell(4,0)]=opp; b[cell(7,7)]=p;
    assert.equal(wins(b,p).length,2);
    assert.equal(wins(b,opp).length,0);
    // Quantify ALL opponent replies, not a beam or just presumed blocks.
    for(let i=0;i<225;i++) if(!b[i]) {
      b[i]=opp;
      assert.equal(five(b,i),false);
      assert(wins(b,p).length>0);
      b[i]=0;
    }
    b.set(before);
    assert.equal(e.oppHasVcfAfter(b,p,opp,1e6,true),false,
      'guard must not reject a proved winning move');
    assert.deepEqual(b,before);
  });
  test('VCF attacker move count / symmetry='+n+' swap='+swap,()=>{
    const e=engine(), b=board(chain,transform,swap), before=b.slice();
    assert.equal(e.vcfRoot(b,p,2,0,1e6),null);
    const result=e.vcfRoot(b,p,3,0,1e6);
    assert(result); assert.equal(result.len,3);
    assert.equal(result.i,cell(7,5));
    assert.deepEqual(b,before, 'VCF must undo every trial move');
    // Explicit three-attack proof: H6, white J6, H8 (open four), five.
    b[cell(7,5)]=p;
    assert.deepEqual(wins(b,p),[cell(8,5)]);
    b[cell(8,5)]=opp; b[cell(7,7)]=p;
    assert(wins(b,p).length>=2); assert.equal(wins(b,opp).length,0);
    b.set(before);
    assert.deepEqual(b,before);
  });
}
test('guard: opponent immediate five outranks our double-four',()=>{
  const e=engine(), b=board([[5,7,1],[6,7,1],[7,7,1],[8,7,1],
    [0,0,2],[1,0,2],[2,0,2],[3,0,2]]), before=b.slice();
  assert.equal(e.oppHasVcfAfter(b,1,2,0,true),true);
  assert.deepEqual(b,before);
});
for(const ai of [1,2]) for(const firstSide of [1,2]) test('TT side key ai='+ai+' first='+firstSide,()=>{
  const e=engine(), b=board([[5,7,1],[6,7,1],[7,7,1]]), before=b.slice();
  for(const side of [firstSide,3-firstSide,firstSide]) for(const ply of [0,5]) {
    const expected=engine().evalLeaf(b,ai,side,ply);
    assert.equal(e.search(b,ai,side,ply),expected);
  }
  assert.deepEqual(b,before);
});
test('VCT zero remaining budget',()=>{
  const e=engine(()=>100), b=board(fork), before=b.slice();
  assert.equal(e.vctRoot(b,1,8,0,0),null);
  assert.deepEqual(b,before);
});
for(const name of ['try','step','forced']) test('VCT expired '+name+' entry',()=>{
  const e=engine(()=>100), b=board(fork), before=b.slice();
  assert.equal(e.vctEntry(b,name,0),0);
  assert.deepEqual(b,before);
});
test('VCT immediate five still wins with zero budget and maxLen=1',()=>{
  const e=engine(()=>100), b=board([[0,0,1],[1,0,1],[2,0,1],[3,0,1]]);
  assert.deepEqual(e.vctRoot(b,1,1,0,0),{i:4,len:1});
});
for(const cutoff of [1,2,4,8,16,32,64,128]) test('VCT cancellation restores board cutoff='+cutoff,()=>{
  let tick=0;
  const e=engine(()=>++tick), b=board(fork), before=b.slice();
  e.vctRoot(b,1,8,0,cutoff);
  assert.deepEqual(b,before);
});
test('VCT frame eight cannot overwrite frame seven',()=>{
  const e=engine(), b=board(fork), before=b.slice();
  assert(e.frameProbe(b).every(x=>x===-777));
  assert.deepEqual(b,before);
});
test('VCT hard stack limit returns unknown without writing board',()=>{
  const e=engine(), b=board(fork), before=b.slice();
  assert.equal(e.vctEntry(b,'try',1e6,32),0);
  assert.deepEqual(b,before);
});
test('VCT defence buffer overflow must not masquerade as a complete set',()=>{
  const e=engine(), b=board(fork.concat([[7,7,1]]));
  assert(e.smallDefenceBuffer(b)>14);
});
for (const diff of ['easy','medium','hard','expert']) test('single centre candidate skips search: '+diff,()=>{
  const e=engine(()=>{ throw Error('a forced choice must not start timed search'); });
  const b=new Uint8Array(225), before=b.slice();
  assert.equal(e.chooseAiMove(b,diff,1).i,112);
  assert.deepEqual(b,before);
});
// Legal random positions; reject game-ending moves rather than evaluating
// already finished boards. Verify fast/slow leaves and tactical point metadata.
let seed=0x73a19d4;
function rnd(n) { seed^=seed<<13; seed^=seed>>>17; seed^=seed<<5; return (seed>>>0)%n; }
const e=engine();
for(let t=0;t<120;t++) test('independent threats + incremental leaves board='+t,()=>{
  const b=new Uint8Array(225); let p=1;
  for(let j=0;j<12+t%25;j++) {
    let placed=false;
    for(let attempt=0;attempt<100;attempt++) {
      const i=at(3+rnd(9),3+rnd(9)); if(b[i]) continue;
      b[i]=p; if(five(b,i)) { b[i]=0; continue; }
      placed=true; break;
    }
    if(!placed) break;
    p=3-p;
  }
  const before=b.slice();
  for(const side of [1,2]) {
    for(const ai of [1,2]) assert.equal(e.fastLeaf(b,ai,side),e.evalLeaf(b,ai,side,0));
    if(wins(b,side).length) continue;
    for(let j=0;j<16;j++) {
      const i=rnd(225); if(b[i]) continue;
      const meta=e.point(b,i,side);
      b[i]=side;
      assert.equal(meta.t===e.T.FIVE,five(b,i));
      if(meta.t!==e.T.FIVE) assert.deepEqual(meta.threats,wins(b,side));
      b[i]=0;
    }
  }
  assert.deepEqual(b,before);
});
console.log('AI audit: '+passed+' passed, '+failed+' failed');
if(failed) process.exitCode=1;

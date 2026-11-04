// 物理引擎单元测试：验证移动、二段跳、攀墙、反墙跳
// 运行：node test/physics.test.mjs
import { Player, parseLevel, Input, FIXED_DT, TILE } from '../public/js/game.js';

let pass = 0;
let fail = 0;

function check(name, cond, detail = '') {
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}   ${detail}`);
  }
}

function makeLevel(rows) {
  return parseLevel({ grid: rows });
}

function step(p, lv, input, frames) {
  for (let i = 0; i < frames; i++) p.step(FIXED_DT, lv, input);
}

/* ---------------- 1. 跑动 ---------------- */
console.log('\n[1] 左右移动');
{
  const lv = makeLevel([
    '....................',
    '....................',
    '....................',
    '..S.................',
    '####################',
    '####################',
  ]);
  const p = new Player(lv.spawn.x, lv.spawn.y);
  const input = new Input();

  // 先落地
  step(p, lv, input, 5);
  check('出生后能落到地面', p.onGround === true);

  const x0 = p.x;
  input.right = true;
  step(p, lv, input, 30);
  check('按右键向右移动', p.x > x0 + 20, `位移 ${(p.x - x0).toFixed(1)}`);
  check('速度接近设定值 RUN=265', Math.abs(p.vx - 265) < 12, `vx=${p.vx.toFixed(1)}`);

  input.right = false;
  input.left = true;
  const x1 = p.x;
  step(p, lv, input, 40);
  check('按左键能反向移动', p.x < x1, `位移 ${(p.x - x1).toFixed(1)}`);
}

/* ---------------- 2. 跳跃与二段跳 ---------------- */
console.log('\n[2] 跳跃 / 二段跳');
{
  const lv = makeLevel([
    '....................',
    '....................',
    '....................',
    '....................',
    '..S.................',
    '####################',
    '####################',
  ]);
  const p = new Player(lv.spawn.x, lv.spawn.y);
  const input = new Input();
  step(p, lv, input, 5);
  check('初始在地面', p.onGround === true);
  check('初始跳跃次数 = 2（二段跳上限）', p.jumps === 2, `jumps=${p.jumps}`);

  // 第一跳
  input.pressJump();
  p.step(FIXED_DT, lv, input);
  check('起跳后竖直速度为负（向上）', p.vy < -400, `vy=${p.vy.toFixed(1)}`);
  input.releaseJump();

  step(p, lv, input, 12);
  const jumpsAfterFirst = p.jumps;
  check('第一跳后剩 1 次跳跃', jumpsAfterFirst === 1, `jumps=${jumpsAfterFirst}`);

  // 二段跳
  const vyBefore = p.vy;
  const yBefore = p.y;
  input.pressJump();
  p.step(FIXED_DT, lv, input);
  check('二段跳重新获得向上速度', p.vy < vyBefore - 100, `vy ${vyBefore.toFixed(0)} → ${p.vy.toFixed(0)}`);
  check('二段跳后剩余跳跃为 0', p.jumps === 0, `jumps=${p.jumps}`);
  input.releaseJump();

  // 第三次按跳应该无效
  const vyAfter = p.vy;
  step(p, lv, input, 4);
  input.pressJump();
  const vyBeforeThird = p.vy;
  p.step(FIXED_DT, lv, input);
  check('第三次按跳无效（不能无限跳）', p.vy > vyBeforeThird, `vy=${p.vy.toFixed(1)}`);
  input.releaseJump();
}

/* ---------------- 3. 攀墙 ---------------- */
console.log('\n[3] 攀墙');
{
  // 右侧有一堵 3 格高的墙（第 5 列）
  const lv = makeLevel([
    '....................',
    '....................',
    '....................',
    '.....|..............'.replace('|', '#'),
    '.....#..............',
    '.....#..............',
    '..S..#..............',
    '####################',
    '####################',
  ].map((r) => r.replace(/\|/g, '#')));

  const p = new Player(0, 0);
  // 手动放到墙左侧、离地悬空
  p.x = 5 * TILE - p.w - 1;   // 右边缘紧贴第 5 列左面
  p.y = 4 * TILE;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;

  const input = new Input();
  input.right = true;         // 朝墙方向按住

  const y0 = p.y;
  const stamina0 = p.climbStamina;
  step(p, lv, input, 10);

  check('检测到右侧墙壁', p.wall === 1, `wall=${p.wall}`);
  check('进入攀爬状态', p.climbing === true);
  check('攀爬时向上移动', p.y < y0, `y ${y0.toFixed(1)} → ${p.y.toFixed(1)}`);
  check('攀爬消耗体力', p.climbStamina < stamina0, `体力 ${stamina0.toFixed(2)} → ${p.climbStamina.toFixed(2)}`);

  // 体力耗尽后转为下滑
  step(p, lv, input, 90);
  check('体力耗尽后不再上升（转为下滑）', p.climbing === false, `climbing=${p.climbing}, stamina=${p.climbStamina.toFixed(2)}`);
  check('下滑速度受限', p.vy <= 155, `vy=${p.vy.toFixed(1)}`);
}

/* ---------------- 4. 反墙跳 ---------------- */
console.log('\n[4] 反墙跳');
{
  const lv = makeLevel([
    '....................',
    '....................',
    '....................',
    '.....#..............',
    '.....#..............',
    '.....#..............',
    '..S..#..............',
    '####################',
    '####################',
  ]);

  const p = new Player(0, 0);
  p.x = 5 * TILE - p.w - 1;
  p.y = 4 * TILE;
  p.vx = 0;
  p.vy = 0;
  p.onGround = false;

  const input = new Input();
  input.right = true;   // 贴住墙
  step(p, lv, input, 3);
  check('贴墙状态下检测到墙', p.wall !== 0, `wall=${p.wall}`);

  input.pressJump();
  p.step(FIXED_DT, lv, input);
  check('反墙跳把角色弹向左（远离墙）', p.vx < -200, `vx=${p.vx.toFixed(1)}`);
  check('反墙跳给出向上速度', p.vy < -400, `vy=${p.vy.toFixed(1)}`);
  check('反墙跳后刷新二段跳', p.jumps === 1, `jumps=${p.jumps}`);
  input.releaseJump();
}

/* ---------------- 5. 冰面 ---------------- */
console.log('\n[5] 冰面打滑');
{
  const lv = makeLevel([
    '....................',
    '....................',
    '....................',
    '..S.................',
    '~~~~~~~~~~~~~~~~~~~~',
    '####################',
  ]);
  const p = new Player(lv.spawn.x, lv.spawn.y);
  const input = new Input();
  step(p, lv, input, 5);
  input.right = true;
  step(p, lv, input, 20);
  input.right = false;
  const vxOnIce = p.vx;
  step(p, lv, input, 6);
  check('冰面上松手后仍保持较高速度（打滑）', p.vx > vxOnIce * 0.5, `vx ${vxOnIce.toFixed(0)} → ${p.vx.toFixed(0)}`);
}

/* ---------------- 6. 固定步长 ---------------- */
console.log('\n[6] 帧率设置');
check('固定步长为 17ms', Math.abs(FIXED_DT - 0.017) < 1e-9, `FIXED_DT=${FIXED_DT}`);

console.log(`\n结果：${pass} 通过，${fail} 失败\n`);
process.exit(fail === 0 ? 0 : 1);

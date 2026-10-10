import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

const LEM = 'chess_char_6_01_a';
const dummy = (key, hp = 1e7) => enemyRec({ key, hp, speed: 0 });
const DEFS = {
  enemies: {
    enemy_1: dummy('enemy_1'),
    enemy_2: dummy('enemy_2'),
    enemy_3: dummy('enemy_3'),
  },
};

test('Lemuen S3 lock speed scales with ASPD and consumes ammo fast', () => {
  const h100 = makeBattle({
    defs: DEFS, seed: 7, timeLimit: 200,
    units: [{ chessId: LEM, row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [{ key: 'enemy_1', pos: [10, 5] }],
    hooks: ['ammoUsed'],
  });
  const u100 = h100.unit(LEM);
  assert.ok(h100.runUntil(() => u100.skill.active, 5), 'S3 cast at 100 ASPD');
  const tStart100 = h100.b.time;
  assert.ok(h100.runUntil(() => !u100.skill.active, 5), 'S3 finished at 100 ASPD');
  const dur100 = h100.b.time - tStart100;

  // At 100 ASPD, 5 ammo with 0.1s base interval: first lock immediate (0.0s), 4 more locks take 4 * 0.1s = 0.4s
  assert.ok(dur100 <= 0.55, `duration at 100 ASPD should be <= 0.55s, was ${dur100}s`);

  // Test at 200 ASPD
  const h200 = makeBattle({
    defs: DEFS, seed: 7, timeLimit: 200,
    units: [{ chessId: LEM, row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [{ key: 'enemy_1', pos: [10, 5] }],
    hooks: ['ammoUsed'],
    setup(b) {
      b.on('deploy', ({ unit }) => {
        if (unit.defId === LEM) b.addBuff(unit, { key: 'test:aspd', mods: { aspd: 100 } });
      });
    },
  });
  const u200 = h200.unit(LEM);
  assert.ok(h200.runUntil(() => u200.skill.active, 5), 'S3 cast at 200 ASPD');
  const tStart200 = h200.b.time;
  assert.ok(h200.runUntil(() => !u200.skill.active, 5), 'S3 finished at 200 ASPD');
  const dur200 = h200.b.time - tStart200;

  // At 200 ASPD (total 200), interval is 0.1 * 100 / 200 = 0.05s. 4 intervals = 0.20s
  assert.ok(dur200 < dur100, `higher ASPD should lock faster: dur200 (${dur200}) < dur100 (${dur100})`);
  assert.ok(dur200 <= 0.35, `duration at 200 ASPD should be <= 0.35s, was ${dur200}s`);
});

test('Lemuen S3 with >100 ammo batch-locks and fires all shells without 33-cap truncation', () => {
  let shellsCount = 0;
  const h = makeBattle({
    defs: DEFS, seed: 7, timeLimit: 200,
    units: [{ chessId: LEM, row: 10, col: 3, carryState: { sp: 99 } }],
    enemies: [
      { key: 'enemy_1', pos: [10, 5] },
      { key: 'enemy_2', pos: [10, 6] },
      { key: 'enemy_3', pos: [9, 5] },
    ],
    hooks: ['ammoUsed'],
    setup(b) {
      b.on('skillStart', ({ unit, skill }) => {
        if (unit.defId === LEM) {
          skill.ammoMax = 120;
          skill.ammoLeft = 120;
        }
      });
      b.on('damaged', (c) => {
        if (c.dmg?.tags?.includes('bombard')) shellsCount++;
      });
    },
  });
  const u = h.unit(LEM);
  assert.ok(h.runUntil(() => u.skill.active, 5), 'S3 active');
  const tStart = h.b.time;
  assert.ok(h.runUntil(() => !u.skill.active, 15), 'S3 finishes 120 ammo rapidly');
  const lockTime = h.b.time - tStart;
  // 120 ammo: >100 batch (2/tick) takes 1s, remaining 100 takes 10s => ~11s (down from 60s originally!)
  assert.ok(lockTime <= 12, `120 ammo should finish quickly with batching, took ${lockTime}s`);

  // Wait for bombardment
  h.run(12);
  const fxShells = h.eventsOf('fx').filter((e) => e[1] === 'bombardShell');
  assert.equal(fxShells.length, 120, 'all 120 shells were fired (not truncated to 33)');
  checkInvariants(h.b);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { loadScripts } from '../../shared/plugins/scriptLoad.js';

// Load lemuen-tuned plugin script for S3 ASPD tuning tests
const dirs = {
  publicDir: path.resolve('public'),
  dataDir: path.resolve('data'),
  packsDir: path.resolve('packs'),
  pluginsDir: path.resolve('plugins'),
};
const rawReg = createPluginRegistry(dirs, { scriptHost: '127.0.0.1', scriptMode: 'trusted' });
const reg = { ...rawReg, plugin: (k) => { const p = rawReg.plugin(k); return p ? { ...p, status: 'loaded', disabled: null } : null; } };
const set = buildContentSet({ registry: reg, ids: ['lemuen-tuned'] });
if (set.scripts && set.scripts.length) {
  await loadScripts(set.scripts, { hashInput: set.index });
}

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

  // At 100 ASPD, 5 ammo with 0.5s base interval: first lock immediate (0.0s), 4 more locks take 4 * 0.5s = 2.0s
  assert.ok(dur100 <= 2.15 && dur100 >= 1.9, `duration at 100 ASPD should be ~2.0s, was ${dur100}s`);

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

  // At 200 ASPD (total 200), interval is 0.5 * 100 / 200 = 0.25s. 4 intervals = 1.0s
  assert.ok(dur200 < dur100, `higher ASPD should lock faster: dur200 (${dur200}) < dur100 (${dur100})`);
  assert.ok(dur200 <= 1.15 && dur200 >= 0.9, `duration at 200 ASPD should be ~1.0s, was ${dur200}s`);
});

test('Lemuen S3 with >100 ammo locks one-by-one by interval and bombards with 33-cap truncation', () => {
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
  assert.ok(h.runUntil(() => !u.skill.active, 70), 'S3 finishes 120 ammo one by one');
  const lockTime = h.b.time - tStart;
  // 120 ammo locks one-by-one without batching: 1st lock at 0s, 119 intervals * 0.5s = 59.5s
  assert.ok(lockTime >= 59 && lockTime <= 61, `120 ammo locked one-by-one took ${lockTime}s`);

  // Wait for bombardment (33 shells * 0.3s = 9.6s + 0.3s flight = 9.9s)
  h.run(12);
  const fxShells = h.eventsOf('fx').filter((e) => e[1] === 'bombardShell');
  assert.equal(fxShells.length, 33, 'at most 33 shells were fired (capped at 33)');
  assert.ok(shellsCount > 0, 'bombardment dealt damage');
  checkInvariants(h.b);
});

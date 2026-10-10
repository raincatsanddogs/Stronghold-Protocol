import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as sim from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { getData } from '../../server/data.js';
import {
  battleCatalog, defaultBattleConfig, createBattleScenario,
  fillSp, addAmmo, healOperator, spawnExtraEnemy, clearEnemies,
} from '../../public/dev/battle-scenario.js';
import { checkInvariants } from '../helpers/battleHarness.js';

const raw = getData(), ds = new DataSource(raw);

test('battleCatalog includes DIY units like Clementia when includeDiy: true', () => {
  const cat = battleCatalog(raw, { includeDiy: true });
  const clemntA = cat.operators.find((op) => op.id === 'diy:char_4231_clemnt:a');
  const clemntB = cat.operators.find((op) => op.id === 'diy:char_4231_clemnt:b');
  assert.ok(clemntA, 'Clementia normal form is available in catalog');
  assert.ok(clemntB, 'Clementia elite form is available in catalog');
  assert.equal(clemntA.record.name, '克莱门莎');
});

test('createBattleScenario initializes Clementia DIY operator with real skills', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw, { chessId: 'chess_char_1_02_a' }),
    chessId: 'diy:char_4231_clemnt:b',
    skillIndex: 1, // S2 风暴潮
    row: 9, col: 8,
  });
  assert.equal(scene.operator.name, '克莱门莎');
  assert.equal(scene.operator.skill.name, '风暴潮');
  assert.equal(scene.operator.alive, true);
  checkInvariants(scene.battle);
});

test('createBattleScenario applies custom ASPD, ATK, Full SP, and God Mode', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw, { chessId: 'chess_char_6_01_a' }),
    extraAspd: 120,
    extraAtkPct: 50,
    fullSp: true,
    godMode: true,
    extraAmmo: 30,
  });
  const op = scene.operator;
  assert.ok(op.s.aspd >= 220, `aspd should include extra 120, was ${op.s.aspd}`);
  assert.ok(op.findBuff('dev:godmode')?.flags?.invulnerable, 'godmode invulnerable flag active');
  assert.equal(op.skill.sp, op.skill.spCost, 'fullSp starts skill charged');
  assert.equal(op.skill.ammoLeft, op.skill.ammoMax, 'extra ammo applied');
});

test('createBattleScenario activates bonds like Laterano and Abyssal even for non-native operators', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw, { chessId: 'diy:char_4231_clemnt:b' }),
    chessId: 'diy:char_4231_clemnt:b',
    bondId: 'lateranoShip',
    bondCount: 6,
    bondLayers: 50,
  });
  const p = scene.battle.getPlayer('dev');
  assert.ok(p.bonds.lateranoShip, 'laterano bond configured');
  assert.equal(p.bonds.lateranoShip.active, true);
  assert.equal(p.bonds.lateranoShip.layers, 50);
  assert.ok(scene.operator.def?.bonds?.includes('lateranoShip'), 'operator dynamically acquired bond membership');
});

test('extra ammo is preserved and scaled by Laterano bond across skill activations', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw, { chessId: 'chess_char_6_01_a' }),
    chessId: 'chess_char_6_01_a',
    skillIndex: 2,
    extraAmmo: 50,
    bondId: 'lateranoShip',
    bondCount: 6,
    bondLayers: 50,
    fullSp: true,
  });
  const op = scene.operator;
  assert.equal(op.skill.ammo, 55, 'base 5 + 50 extra ammo configured');
  assert.equal(op.skill.ammoLeft, 55, 'initial ammoLeft reflects extra ammo');
  // Activate skill: Laterano bond multiplier scales ammo
  op.skill.activate();
  assert.equal(op.skill.active, true, 'skill activated');
  assert.equal(op.skill.ammoLeft, 99, 'ammoLeft scaled to 99 by Laterano bond');
});

test('createBattleScenario supports multiple enemies and dummy mode', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw),
    enemyCount: 3,
    dummyMode: true,
    enemyPacifist: true,
  });
  // Advance 2 seconds to let all 3 enemies spawn
  for (let i = 0; i < 60; i++) scene.battle.step();
  const enemies = scene.battle.aliveEnemies();
  assert.ok(enemies.length >= 3, `should have at least 3 enemies, found ${enemies.length}`);
  assert.ok(enemies.every((e) => e.findBuff('dev:pacifist')?.flags?.disarm), 'enemies disarmed by pacifist mode');
});

test('interactive runtime helpers: fillSp, addAmmo, healOperator, spawnExtraEnemy, clearEnemies', () => {
  const scene = createBattleScenario(sim, ds, raw, {
    ...defaultBattleConfig(raw, { chessId: 'chess_char_6_01_a' }),
  });
  const op = scene.operator;
  // Test fillSp
  assert.ok(fillSp(scene), 'fillSp returns true');
  assert.equal(op.skill.sp, op.skill.spCost, 'SP is full');

  // Activate skill and test addAmmo
  for (let i = 0; i < 30; i++) scene.battle.step();
  const ammoBefore = op.skill.ammoLeft;
  assert.ok(addAmmo(scene, 50), 'addAmmo returns true');
  assert.equal(op.skill.ammoLeft, ammoBefore + 50, 'ammo increased by 50');

  // Test healOperator
  op.hp = 10;
  assert.ok(healOperator(scene), 'healOperator returns true');
  assert.equal(op.hp, op.s.maxHp, 'hp restored to max');

  // Test spawnExtraEnemy
  const beforeCount = scene.battle.aliveEnemies().length;
  const extra = spawnExtraEnemy(scene);
  assert.ok(extra, 'extra enemy spawned');
  assert.equal(scene.battle.aliveEnemies().length, beforeCount + 1);

  // Test clearEnemies
  const cleared = clearEnemies(scene);
  assert.ok(cleared >= 1, 'cleared normal enemies');
  assert.equal(scene.battle.aliveEnemies().length, 0, 'no normal enemies left');
});

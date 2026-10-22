import { kit, math } from 'sp:sdk@1';

// 蕾缪安 (char_4193_lemuen) kit 调优：S3 基准锁定间隔 0.5s（受攻速动态加成），全弹轰炸上限 33 发
const LEMUEN_SHELL_INTERVAL = 0.3;
const LEMUEN_SHELL_WINDOW = 10;
const LEMUEN_SHELL_FLIGHT = 0.3;

function ensureWanted(battle) {
  const S = battle.mem || (battle.mem = {});
  if (S.wanted) return S.wanted;
  const W = (S.wanted = { lemuens: new Set(), sources: new Map(), refreshRanges: new Set() });
  const live = (u) => u && u.alive && u.deployed;
  const activeLem = () => [...W.lemuens].filter(live);
  const reconcile = () => {
    for (const e of battle.enemies) {
      const marked = [...W.sources.values()].some((s) => s.marks.has(e));
      if (marked && e.alive && !e.findBuff('lemuen:wanted')) {
        battle.addBuff(e, { key: 'lemuen:wanted', visible: true });
        battle.fx('wanted', { x: e.x, y: e.y, id: e.id });
      } else if (!marked && e.findBuff('lemuen:wanted')) {
        battle.removeBuff(e, 'lemuen:wanted');
      }
    }
    for (const refresh of W.refreshRanges) refresh();
  };

  battle.on('death', ({ unit }) => {
    if (!W.lemuens.has(unit)) return;
    W.sources.delete(unit);
    reconcile();
  });

  battle.every(0.25, () => {
    const lems = activeLem();
    for (const u of W.sources.keys()) if (!lems.includes(u)) W.sources.delete(u);
    const lat = battle.allyUnits.filter((a) => live(a) && a.kind === 'op' && (a.bonds?.includes('lateranoShip') || a.profile?.bonds?.includes('lateranoShip')));
    for (const u of lems) {
      let state = W.sources.get(u);
      if (!state) W.sources.set(u, (state = { time: new WeakMap(), marks: new Set() }));
      for (const e of state.marks) if (!e.alive) state.marks.delete(e);
      for (const e of battle.enemies) {
        if (!e.alive || state.marks.has(e) || !(e.def?.isElite || e.isElite || e.tier >= 2 || e.isBoss)) continue;
        if (e.hidden || !lat.some((a) => a.rangeKeySet && a.rangeKeySet.has(`${Math.round(e.y)},${Math.round(e.x)}`))) {
          state.time.delete(e);
          continue;
        }
        if (!state.time.has(e) && (e.hidden || e.s?.flags?.untargetable)) continue;
        const t = (state.time.get(e) ?? 0) + 0.25;
        state.time.set(e, t);
        if (t >= u.mem.wantedInterval - 1e-9) state.marks.add(e);
      }
    }
    reconcile();
  });

  battle.on('hit', (ctx) => {
    const s = ctx.source, t = ctx.target;
    if (!s || !t || s.side !== 'ally' || t.side !== 'enemy' || !(s.bonds?.includes('lateranoShip') || s.profile?.bonds?.includes('lateranoShip'))) return;
    if (!ctx.dmg.isAttack && !ctx.dmg.isSkill) return;
    if (!t.findBuff('lemuen:wanted')) return;
    const lems = activeLem();
    if (lems.length) ctx.dmg.mul *= Math.max(...lems.map((u) => u.mem.wantedScale));
  });

  return W;
}

function rotateOffsetDir(oy, ox, dir) {
  if (dir === 'UP') return [-ox, oy];
  if (dir === 'DOWN') return [ox, -oy];
  if (dir === 'LEFT') return [-oy, -ox];
  return [oy, ox];
}

export default function setup(sp) {
  sp.kits.register('chess_char_6_01_a', (bb, chess, def) => {
    const t0 = kit.talentBb(def, 0) || {}, t1 = kit.talentBb(def, 1) || {}, tb = kit.traitBb(def) || def?.traitBb || {};
    const baseAim = Math.max(0.05, kit.num(bb['attack@aim_interval'], 0.5));
    const calcAimInterval = (unit) => Math.max(0.033, (baseAim * 100) / Math.max(20, unit.s.aspd));
    const d1 = kit.num(bb['attack@dist_1'], 0.8);
    const d2 = kit.num(bb['attack@dist_2'], kit.num(bb['attack@projectile_range'], 1.5));
    const s1 = kit.num(bb['attack@proj_atk_scale_1'], 1), s2 = kit.num(bb['attack@proj_atk_scale_2'], 1);

    const pickLock = (battle, unit, locks) => {
      let cands = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
      if (!cands.length && typeof battle.allyTargetsInKeys === 'function') cands = battle.allyTargetsInKeys(unit.rangeKeys, unit);
      if (!cands.length) return null;
      cands.sort((a, b) => (a.s?.def ?? 0) - (b.s?.def ?? 0) || a.hp - b.hp);
      const cnt = (e) => locks.reduce((n, L) => n + (L.e === e ? 1 : 0), 0);
      let best = null;
      for (const e of cands) if (!best || cnt(e) < cnt(best)) best = e;
      return best;
    };

    const spread = Math.max(0, kit.num(bb['attack@emit_offset'], 0.2));
    const markOf = (L) => {
      const e = L.e;
      if (!L.gone && e && (!e.alive || !e.hidden)) {
        L.x = e.x;
        L.y = e.y;
        if (!e.alive) L.gone = true;
      }
      return L;
    };

    const blast = (battle, unit, atk, x, y) => {
      battle.fx('bombard', { x, y, id: unit.id, r: d2 });
      if (typeof battle.foesInColliderRadius === 'function') {
        for (const e of battle.foesInColliderRadius(x, y, d2)) {
          if (e.s?.flags?.untargetable) continue;
          const d = math.hypot(e.x - x, e.y - y);
          battle.dealDamage(unit, e, { amount: atk * (d <= d1 + 1e-9 ? s1 : s2), type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'bombard'] });
        }
      }
      if (typeof battle.allyTargetsInRadius === 'function') {
        for (const a of battle.allyTargetsInRadius(x, y, d2, unit)) {
          battle.dealDamage(unit, a, { amount: atk * s2, type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'bombard'] });
        }
      }
    };

    const bombard = (battle, unit, locks) => {
      const atk = unit.s.atk;
      const seq = unit.deploySeq;
      const n = Math.min(locks.length, Math.floor(LEMUEN_SHELL_WINDOW / LEMUEN_SHELL_INTERVAL + 1e-9));
      const fire = (i) => {
        if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;
        const L = markOf(locks[i]);
        const randX = battle.rng ? battle.rng.range(-spread, spread) : 0;
        const randY = battle.rng ? battle.rng.range(-spread, spread) : 0;
        const [oy, ox] = rotateOffsetDir(randY, randX, unit.dir);
        const x = L.x + ox, y = L.y + oy;
        battle.fx('bombardShell', { x, y, id: unit.id, r: d2, t: LEMUEN_SHELL_FLIGHT, i });
        battle.after(LEMUEN_SHELL_FLIGHT, () => blast(battle, unit, atk, x, y), { owner: unit });
        if (i + 1 < n) battle.after(LEMUEN_SHELL_INTERVAL, () => fire(i + 1), { owner: unit });
      };
      if (n > 0) fire(0);
    };

    const aimS = {
      main: kit.num(bb['attack@main_atk_scale'], 1),
      ex: kit.num(bb['attack@ex_atk_scale'], 0),
      fin: kit.num(bb['attack@fin_atk_scale'], 1),
      iv: Math.max(0.05, kit.num(bb['attack@interval'], 0.25)),
      steps: Math.floor(kit.num(bb['attack@trig_cnt'], 10)),
      dur: kit.num(bb['attack@aim_duration'], 2.5),
    };
    const endAim = (battle, unit) => {
      unit.mem.lemAim = null;
      battle.removeBuff(unit, 'lemuen:aim');
    };

    const skills = {
      skchr_lemuen_1: {
        kind: 'ammo',
        ammo: Math.max(1, Math.floor(kit.num(bb['attack@trigger_time'], 5))),
        attack: { atkScale: kit.num(bb['attack@atk_scale'], 1) },
        targeting: { maxTargets: 2 },
      },
      skchr_lemuen_2: {
        kind: 'ammo',
        ammo: Math.max(1, Math.floor(kit.num(bb['attack@trigger_time'], 6))),
        mods: { aspd: kit.num(bb.attack_speed, 0), atkPct: kit.num(bb.atk, 0) },
        onStart({ battle, unit }) { endAim(battle, unit); },
        onTick({ battle, unit, skill, dt }) {
          const m = unit.mem;
          let A = m.lemAim;
          if (A && (!A.e.alive || A.e.hidden || !A.e.findBuff('lemuen:wanted'))) {
            endAim(battle, unit);
            A = null;
          }
          if (!unit.canAct) return;
          if (!A) {
            const cands = battle.enemies.filter((e) => e.alive && !e.hidden && !e.s?.flags?.untargetable && e.findBuff('lemuen:wanted'));
            if (!cands.length || skill.ammoLeft <= 0) return;
            cands.sort((a, b) => (a.s?.def ?? 0) - (b.s?.def ?? 0) || a.hp - b.hp);
            A = m.lemAim = { e: cands[0], t: 0 };
            battle.addBuff(unit, { key: 'lemuen:aim', flags: { disarm: true } });
            skill.ammoLeft--;
            battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
            battle.fx('lock', { x: A.e.x, y: A.e.y, id: A.e.id, src: unit.id });
          }
          A.t += dt;
          const scale = Math.min(aimS.fin, aimS.main + aimS.ex * Math.min(aimS.steps, Math.floor((A.t + 1e-9) / aimS.iv)));
          const e = A.e;
          if (A.t + 1e-9 < aimS.dur && !(unit.s.atk * scale > e.hp + (e.s?.def ?? 0))) return;
          endAim(battle, unit);
          battle.fx('crit', { x: e.x, y: e.y, id: e.id, src: unit.id });
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', canDodge: false, isSkill: true, tags: ['skill', 'snipe'] });
          if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
        },
        onEnd({ battle, unit }) { endAim(battle, unit); },
      },
    };

    return {
      skills,
      skill: {
        kind: 'ammo',
        ammo: Math.max(1, Math.floor(kit.num(bb['attack@trigger_time'], 5))),
        attack: { noAttack: true },
        allyTargets: true,
        onStart({ unit }) {
          unit.mem.lemLocks = [];
          unit.mem.lemAcc = calcAimInterval(unit);
        },
        onTick({ battle, unit, skill, dt }) {
          const m = unit.mem;
          if (!m.lemLocks) return;
          for (const L of m.lemLocks) markOf(L);
          if (!unit.canAct) return;
          m.lemAcc += dt;
          const aimInterval = calcAimInterval(unit);
          if (m.lemAcc + 1e-9 < aimInterval) return;
          const e = pickLock(battle, unit, m.lemLocks);
          if (!e) {
            m.lemAcc = aimInterval;
            return;
          }
          m.lemAcc = Math.max(0, m.lemAcc - aimInterval);
          m.lemLocks.push({ e, x: e.x, y: e.y });
          battle.fx('lock', { x: e.x, y: e.y, id: e.id, src: unit.id, hold: 1 });
          skill.ammoLeft--;
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
          if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
        },
        onEnd({ battle, unit, reason }) {
          const locks = unit.mem.lemLocks || [];
          unit.mem.lemLocks = null;
          if (reason !== 'death' && unit.alive) bombard(battle, unit, locks);
        },
      },
      trait: kit.num(tb.sp, 0) > 0 ? {
        afterHit(battle, unit, target) {
          if (target && target.alive && unit.skill && !unit.skill.active) {
            unit.skill.gainSp(kit.num(tb.sp, 0), 'trait');
          }
        },
      } : null,
      talents: [
        {
          install(battle, unit) {
            unit.mem.wantedInterval = kit.num(t0.interval, 8);
            unit.mem.wantedScale = kit.num(t0.damage_scale, 1);
            const wanted = ensureWanted(battle);
            wanted.lemuens.add(unit);
            const wantedKeys = () => {
              const keys = [];
              for (const e of battle.enemies) {
                if (e.alive && !e.hidden && e.findBuff('lemuen:wanted')) {
                  keys.push(`${Math.round(e.y)},${Math.round(e.x)}`);
                }
              }
              return keys;
            };
            unit.skill?.addTriggerRange?.(() => [{ keys: wantedKeys(), profile: unit.profile }], { attackOnly: true });
            let sig = null;
            const refresh = () => {
              const keys = unit.alive && unit.deployed ? wantedKeys() : [];
              const s = keys.join(',');
              if (s === sig) return;
              sig = s;
              battle.setExtraRange?.(unit, keys);
            };
            wanted.refreshRanges.add(refresh);
            battle.on('tick', refresh, { owner: unit });
            battle.on('deploy', ({ unit: u }) => {
              if (u === unit) {
                sig = null;
                refresh();
              }
            }, { owner: unit });
          },
        },
        {
          install(battle, unit) {
            const iv = kit.num(t1.interval, 20),
              atk = kit.num(t1.atk, 0),
              add = Math.floor(kit.num(t1.add_count, 0)),
              exAdd = Math.floor(kit.num(t1.ex_add_count, 0));
            const ready = () => unit.alive && unit.deployed && battle.time - unit.deployedAt >= iv - 1e-6;
            battle.on('deploy', ({ unit: u }) => {
              if (u !== unit) return;
              const seq = unit.deploySeq;
              battle.after(iv, () => {
                if (!unit.alive || !unit.deployed || unit.deploySeq !== seq) return;
                if (atk) battle.addBuff(unit, { key: 'lemuen:extradition', mods: { atkPct: atk } });
                battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'extradition' });
              }, { owner: unit });
            }, { owner: unit });
            battle.on('skillStart', ({ unit: u, skill }) => {
              if (!ready() || !skill || skill.kind !== 'ammo') return;
              if (u === unit) {
                if (add > 0) skill.addAmmo(add);
              } else if (exAdd > 0 && u.side === 'ally' && u.kind === 'op' && (u.bonds?.includes('lateranoShip') || u.profile?.bonds?.includes('lateranoShip'))) {
                skill.addAmmo(exAdd);
              }
            }, { owner: unit });
          },
        },
      ],
    };
  });
}

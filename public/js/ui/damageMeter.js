// Real-time Battle Damage Meter (DESIGN §14, floating HUD meter during combat and settle).
// Aggregates operator & summon damage, kills, healing, and DPS in real-time.
// Supports [本轮 / ROUND] and [全场 / TOTAL] tabs and folding/expanding.

import { useState, useEffect, useMemo, useRef } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel } from './components.js';
import { useGameData, UnitThumb } from './gameComponents.js';
import { fmtNum, diyRecordFor, cardStandIn, standInForText } from './gameLogic.js';
import { battleRunner } from '../battle/runner.js';
import { data } from '../data.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * Merge accumulated total stats with live round stats for real-time full-match damage view.
 * @param {Array} totalStats priv?.stats?.unitDamage || []
 * @param {Array} roundStats battleRunner.liveDamageStats()
 */
function mergeTotalWithLive(totalStats = [], roundStats = []) {
  const map = new Map();

  for (const item of totalStats || []) {
    if (!item) continue;
    const key = `${item.kind || 'op'}:${item.baseId || item.id}`;
    map.set(key, { ...item });
  }

  for (const item of roundStats || []) {
    if (!item) continue;
    const key = `${item.kind || 'op'}:${item.baseId || item.id}`;
    const existing = map.get(key);
    if (existing) {
      existing.dmg = (existing.dmg || 0) + (item.dmg || 0);
      existing.kills = (existing.kills || 0) + (item.kills || 0);
      existing.heal = (existing.heal || 0) + (item.heal || 0);
      existing.taken = (existing.taken || 0) + (item.taken || 0);
      if (item.golden) {
        existing.golden = true;
        existing.id = item.id;
      }
      if (item.tier != null) existing.tier = item.tier;
      if (item.ownerName && !existing.ownerName) existing.ownerName = item.ownerName;
    } else {
      map.set(key, { ...item });
    }
  }

  return [...map.values()]
    .filter((u) => u.kind === 'op' || (u.dmg || 0) > 0 || (u.heal || 0) > 0 || (u.taken || 0) > 0)
    .sort((a, b) => (b.dmg || 0) - (a.dmg || 0) || (b.kills || 0) - (a.kills || 0) || String(a.name).localeCompare(String(b.name)));
}

/**
 * @param {{ pub: any, priv: any, myId: string, watching?: string|null, combat?: boolean }} props
 */
export function DamageMeter({ pub, priv, myId, watching = null, combat = true }) {
  const gd = useGameData();
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState('round'); // 'round' | 'total'
  const [tick, setTick] = useState(0);

  // Poll live stats while battle is simulating (every 250ms)
  useEffect(() => {
    if (!combat) return;
    const timer = setInterval(() => {
      setTick((t) => (t + 1) % 1000000);
    }, 250);
    return () => clearInterval(timer);
  }, [combat]);

  // Round stats from runner: updates continuously on every tick during battle
  const roundStats = useMemo(() => {
    if (!battleRunner) return [];
    return battleRunner.liveDamageStats(watching || null, null);
  }, [tick, watching, combat]);

  // Total stats combining server accumulator + current live round
  const totalStats = useMemo(() => {
    const base = priv?.stats?.unitDamage || [];
    if (!combat) return base;
    return mergeTotalWithLive(base, roundStats);
  }, [priv?.stats?.unitDamage, roundStats, combat]);

  const list = tab === 'round' ? roundStats : totalStats;
  const maxDmg = useMemo(() => Math.max(1, ...list.map((u) => u.dmg || 0)), [list]);
  const sumDmg = useMemo(() => list.reduce((acc, u) => acc + (u.dmg || 0), 0), [list]);
  const topDamager = list[0] || null;

  if (collapsed) {
    return html`
      <button type="button" class="dmg-meter-pill" onClick=${() => setCollapsed(false)} title=${t('展开伤害统计')}>
        <${Icon} name="chart" class="dmg-meter-pill__icon" />
        <span class="dmg-meter-pill__title">${t('伤害统计')}</span>
        ${topDamager && topDamager.dmg > 0 ? html`
          <span class="dmg-meter-pill__top">
            <span class="dmg-meter-pill__top-name">${topDamager.name}</span>
            <b class="num">${fmtNum(topDamager.dmg)}</b>
          </span>
        ` : null}
        <${Icon} name="chevronLeft" class="dmg-meter-pill__arrow" />
      </button>
    `;
  }

  return html`
    <section class="dmg-meter" aria-label=${t('实时伤害统计')}>
      <header class="dmg-meter__head">
        <div class="dmg-meter__title">
          <${Icon} name="chart" class="dmg-meter__head-icon" />
          <div class="dmg-meter__title-text">
            <span>${t('实时伤害')}</span>
            <${MicroLabel}>DPS METER</${MicroLabel}>
          </div>
        </div>
        <div class="dmg-meter__tabs">
          <button type="button" class=${cx('dmg-meter__tab', tab === 'round' && 'is-active')}
            onClick=${() => setTab('round')}>${t('本轮')}</button>
          <button type="button" class=${cx('dmg-meter__tab', tab === 'total' && 'is-active')}
            onClick=${() => setTab('total')}>${t('全场')}</button>
        </div>
        <button type="button" class="dmg-meter__fold" onClick=${() => setCollapsed(true)} title=${t('收起')} aria-label=${t('收起')}>
          <${Icon} name="chevronRight" />
        </button>
      </header>

      <div class="dmg-meter__body">
        ${list.length === 0 ? html`
          <div class="dmg-meter__empty">${t('暂无作战伤害')}</div>
        ` : list.map((u, i) => {
          const chess = u.kind === 'token' ? null : gd.chess(u.id || u.baseId);
          const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
          const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
          const pct = Math.max(0, Math.min(100, ((u.dmg || 0) / maxDmg) * 100));
          const rank = i + 1;

          return html`
            <div key=${`${u.kind}:${u.id || u.baseId}`} class=${cx('dmg-meter__row', rank <= 3 && `is-top-${rank}`)}>
              <div class="dmg-meter__rank num">${rank}</div>
              <div class="dmg-meter__avatar">
                <${UnitThumb} kind=${u.kind === 'token' ? 'token' : 'chess'} id=${u.id || u.baseId}
                  golden=${!!u.golden} tier=${u.tier} size="xs" rec=${dr || si} />
              </div>
              <div class="dmg-meter__info">
                <div class="dmg-meter__info-top">
                  <span class="dmg-meter__name" title=${u.name}>${u.name}</span>
                  ${u.kind === 'token' ? html`
                    <span class="dmg-meter__summon-tag" title=${t('召唤物')}>
                      ${t('召唤')} · ${u.ownerName || t('干员')}
                    </span>
                  ` : null}
                  <div class="dmg-meter__values">
                    <b class="num dmg-meter__num">${fmtNum(u.dmg || 0)}</b>
                    ${tab === 'round' && u.dps != null ? html`
                      <span class="dmg-meter__dps num">${fmtNum(u.dps)}/s</span>
                    ` : null}
                  </div>
                </div>
                <div class="dmg-meter__bar-track">
                  <div class="dmg-meter__bar-fill" style="width: ${pct.toFixed(1)}%"></div>
                </div>
              </div>
            </div>
          `;
        })}
      </div>

      <footer class="dmg-meter__foot">
        <span class="dmg-meter__foot-label">${t('合计伤害')}</span>
        <b class="num dmg-meter__foot-total">${fmtNum(sumDmg)}</b>
      </footer>
    </section>
  `;
}

import { describe, expect, it } from 'vitest'
import { Vector3 } from 'three'
import {
  applyDamage, canFire, createHealth, createWeapon, fire, type HitTarget, hullFraction,
  isDead, type Projectile, PROJECTILE_SPEED, repairHull, resolveHits, spawnProjectile, stepProjectiles,
  stepWeapon,
} from './combat'

describe('health', () => {
  it('damage reduces hull and clamps at zero', () => {
    const h = createHealth(100)
    applyDamage(h, 30)
    expect(h.hull).toBe(70)
    applyDamage(h, 999)
    expect(h.hull).toBe(0)
    expect(isDead(h)).toBe(true)
  })

  it('non-positive damage is ignored', () => {
    const h = createHealth(50)
    applyDamage(h, 0)
    applyDamage(h, -10)
    expect(h.hull).toBe(50)
  })

  it('hullFraction reports 0..1', () => {
    const h = createHealth(80)
    expect(hullFraction(h)).toBe(1)
    applyDamage(h, 40)
    expect(hullFraction(h)).toBe(0.5)
  })

  it('repairs hull without exceeding max health', () => {
    const h = createHealth(100)
    applyDamage(h, 35)
    repairHull(h, 20)
    expect(h.hull).toBe(85)
    repairHull(h, 100)
    expect(h.hull).toBe(100)
  })
})

describe('projectiles', () => {
  it('spawn travels along the given direction at speed', () => {
    const p = spawnProjectile(new Vector3(), new Vector3(0, 0, -1), 'player')
    expect(p.velocity.z).toBeCloseTo(-PROJECTILE_SPEED, 5)
    expect(p.faction).toBe('player')
  })

  it('adds inherited ship velocity to spawned projectiles', () => {
    const p = spawnProjectile(
      new Vector3(),
      new Vector3(0, 0, -1),
      'player',
      PROJECTILE_SPEED,
      12,
      new Vector3(0, 0, -160),
    )

    expect(p.velocity.z).toBeCloseTo(-PROJECTILE_SPEED - 160, 5)
  })

  it('removes inherited velocity that would push a projectile backward from its aim direction', () => {
    const p = spawnProjectile(
      new Vector3(),
      new Vector3(0, 0, -1),
      'player',
      PROJECTILE_SPEED,
      12,
      new Vector3(25, 0, 1000),
    )

    expect(p.velocity.x).toBeCloseTo(25, 5)
    expect(p.velocity.z).toBeCloseTo(-PROJECTILE_SPEED, 5)
  })

  it('a zero direction falls back to forward (-Z), never NaN', () => {
    const p = spawnProjectile(new Vector3(), new Vector3(0, 0, 0), 'player')
    expect(Number.isNaN(p.velocity.length())).toBe(false)
    expect(p.velocity.z).toBeCloseTo(-PROJECTILE_SPEED, 5)
  })

  it('step moves projectiles and expires them', () => {
    const list: Projectile[] = [spawnProjectile(new Vector3(), new Vector3(0, 0, -1), 'player')]
    stepProjectiles(list, 0.1)
    expect(list[0].position.z).toBeCloseTo(-PROJECTILE_SPEED * 0.1, 4)
    stepProjectiles(list, 10) // outlive PROJECTILE_LIFE
    expect(list.length).toBe(0)
  })
})

describe('resolveHits', () => {
  function target(faction: 'player' | 'pirate' | 'peer', pos = new Vector3()): HitTarget {
    return { position: pos, radius: 10, health: createHealth(100), faction }
  }

  it('damages an enemy target and consumes the projectile', () => {
    const proj = [spawnProjectile(new Vector3(0, 0, 0), new Vector3(0, 0, -1), 'player')]
    const t = target('pirate')
    const hits = resolveHits(proj, [t])
    expect(hits.length).toBe(1)
    expect(t.health.hull).toBe(88) // 100 - PROJECTILE_DAMAGE(12)
    expect(proj.length).toBe(0)
  })

  it('never hits same-faction targets', () => {
    const proj = [spawnProjectile(new Vector3(), new Vector3(0, 0, -1), 'player')]
    const friendly = target('player')
    const hits = resolveHits(proj, [friendly])
    expect(hits.length).toBe(0)
    expect(friendly.health.hull).toBe(100)
    expect(proj.length).toBe(1)
  })

  it('lets player shots hit peer targets for PvP', () => {
    const proj = [spawnProjectile(new Vector3(), new Vector3(0, 0, -1), 'player')]
    const peer = target('peer')
    const hits = resolveHits(proj, [peer])
    expect(hits.length).toBe(1)
    expect(hits[0].target.faction).toBe('peer')
  })

  it('misses targets outside the radius', () => {
    const proj = [spawnProjectile(new Vector3(100, 0, 0), new Vector3(0, 0, -1), 'player')]
    const t = target('pirate', new Vector3(0, 0, 0))
    expect(resolveHits(proj, [t]).length).toBe(0)
    expect(proj.length).toBe(1)
  })

  it('detects hits along the projectile path between frames', () => {
    const proj = [spawnProjectile(new Vector3(0, 0, 12), new Vector3(0, 0, -1), 'player', 1000)]
    stepProjectiles(proj, 0.03)
    const t = target('peer', new Vector3(0, 0, 0))

    const hits = resolveHits(proj, [t])

    expect(hits.length).toBe(1)
    expect(t.health.hull).toBe(88)
  })

  it('ignores already-dead targets', () => {
    const proj = [spawnProjectile(new Vector3(), new Vector3(0, 0, -1), 'player')]
    const t = target('pirate')
    t.health.hull = 0
    expect(resolveHits(proj, [t]).length).toBe(0)
    expect(proj.length).toBe(1)
  })
})

describe('weapon cooldown', () => {
  it('gates fire rate', () => {
    const w = createWeapon(0.5)
    expect(canFire(w)).toBe(true)
    fire(w)
    expect(canFire(w)).toBe(false)
    stepWeapon(w, 0.3)
    expect(canFire(w)).toBe(false)
    stepWeapon(w, 0.3)
    expect(canFire(w)).toBe(true)
  })
})

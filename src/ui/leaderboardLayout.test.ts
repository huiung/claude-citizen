import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'

function cssBlockFor(selector: string): string {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] ?? ''
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(style)?.[1] ?? ''
}

describe('landing leaderboard layout CSS', () => {
  it('keeps landing pager arrow buttons compact inside the launch overlay', () => {
    const block = cssBlockFor('#overlay .lb-prev, #overlay .lb-next')

    expect(block).toContain('padding: 0')
    expect(block).toContain('letter-spacing: 0')
    expect(block).toContain('background: rgba(0, 18, 8, .55)')
    expect(block).toContain('font: 700 13px "Share Tech Mono"')
  })

  it('renders Career and PvP tabs for both launch and HUD leaderboards', () => {
    expect(html).toContain('id="lb-mode-career-landing"')
    expect(html).toContain('id="lb-mode-pvp-landing"')
    expect(html).toContain('id="lb-mode-career-hud"')
    expect(html).toContain('id="lb-mode-pvp-hud"')
  })

  it('renders PvP season panels for both launch and HUD leaderboards', () => {
    expect(html).toContain('id="lb-season-landing"')
    expect(html).toContain('id="lb-season-hud"')
    expect(cssBlockFor('.lb-season')).toContain('font-size: 10px')
  })

  it('keeps leaderboard and wallet visible in mobile companion mode', () => {
    expect(html).toContain('.is-mobile .foot, .is-mobile #pilot-code { display: none; }')
    expect(html).not.toContain('.is-mobile #leaderboard-landing, .is-mobile #pilot-code')
    expect(html).not.toContain('.is-mobile #wallet-box { display: none; }')
    expect(html).toContain('Mobile Civilian Mode')
  })

  it('exposes mobile civilian flight controls without hiding launch', () => {
    expect(html).toContain('id="mobile-controls"')
    expect(html).toContain('id="mobile-thrust"')
    expect(html).toContain('id="mobile-mine"')
    expect(html).not.toContain('.is-mobile #nickname, .is-mobile #launch')
  })
})

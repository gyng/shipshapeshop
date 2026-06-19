import { useState } from 'react'
import { Button, Panel, Numeral, Tooltip, Meter, Chip, Badge, RarityDot, Icon, COLOR, RADIUS } from './index'

// Dev gallery for the atom library. Mount via `?ui` in main.tsx. Not shipped in the normal app flow.
const RARITY = { Common: '#9aa6c2', Rare: '#5fe0c6', Epic: '#b985ff', Ssr: '#ffb86b', Ur: '#ff5d8f', Relic: '#ffd76b' }

function Row({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <h4 style={{ color: COLOR.textDim, textTransform: 'uppercase', letterSpacing: 0.6, fontSize: 11, margin: '0 0 8px' }}>{title}</h4>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>{children}</div>
    </div>
  )
}

export function Showcase() {
  const [n, setN] = useState(1234)
  return (
    <div style={{ minHeight: '100vh', background: COLOR.bgBase, color: COLOR.text, padding: 28, maxWidth: 880, margin: '0 auto' }}>
      <h2 style={{ marginTop: 0 }}>Shape Gacha — UI library</h2>
      <Row title="Buttons">
        <Button variant="primary">Pull · 100 ✦</Button>
        <Button variant="secondary">Pull ×10</Button>
        <Button variant="gold">Summon ★</Button>
        <Button variant="cap">Auto-arrange</Button>
        <Button variant="cap" size="sm">Small</Button>
        <Button variant="danger" size="sm">Reset</Button>
        <Button variant="cap" disabled>Maxed ✓</Button>
      </Row>
      <Row title="Panels">
        <Panel variant="recessed" style={{ width: 150 }}>Recessed</Panel>
        <Panel variant="raised" style={{ width: 150 }}>Raised</Panel>
        <Panel variant="well" style={{ width: 150 }}>Well</Panel>
      </Row>
      <Row title="Numeral (tap to bump)">
        <span style={{ fontSize: 28, fontWeight: 800, color: COLOR.gold }}>
          <Numeral value={n} />
        </span>
        <Button variant="cap" size="sm" onClick={() => setN((v) => v + Math.round(Math.random() * 5000))}>+ random</Button>
      </Row>
      <Row title="Meters">
        <Meter value={0.3} color={COLOR.amber} style={{ width: 160 }} label="Pity" />
        <Meter value={0.7} color={COLOR.pink} style={{ width: 160 }} label="Resonance" />
      </Row>
      <Row title="Chips / Badges / Dots">
        {Object.entries(RARITY).map(([k, c]) => (
          <Chip key={k} dot={c}>{k}</Chip>
        ))}
        <Badge color={COLOR.pink}>NEW</Badge>
        <Badge color={COLOR.gold}>★5</Badge>
        {Object.values(RARITY).map((c, i) => (
          <RarityDot key={i} color={c} size={12} />
        ))}
      </Row>
      <Row title="Tooltip (hover / tap)">
        <Tooltip
          content={
            <div>
              <strong style={{ color: COLOR.gold }}>Flux</strong>
              <div style={{ marginTop: 4 }}>The idle currency. Earned every hour, even away.</div>
            </div>
          }
        >
          <span style={{ borderBottom: `1px dotted ${COLOR.textDim}`, cursor: 'help' }}>
            <Icon size={14} style={{ verticalAlign: 'middle' }}>
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v.01M11 12h1v4h1" />
            </Icon>{' '}
            hover me
          </span>
        </Tooltip>
      </Row>
      <p style={{ color: COLOR.textFaint, fontSize: 12 }}>radius scale: {Object.keys(RADIUS).join(' · ')}</p>
    </div>
  )
}

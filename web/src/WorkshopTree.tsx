import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import type { UpgradeDef, View } from './game/store'

// Renders the Workshop upgrades as an actual tech-tree DAG: nodes laid out in columns by prereq depth,
// with curved connective lines drawn from each prereq to the node it unlocks. The lines are colour-coded by
// the child's BRANCH (production / orrery / logistics) so the tree reads as grouped branches even though the
// columns are depth-ordered. Card visuals are delegated to `renderNode` (the same renderer the flat/sectioned
// view uses) — this component owns ONLY the layout + edges, so there's a single source of truth for a card.

// Branch colours — keep in sync with the section grouping in App.tsx (Production / Orrery / Logistics).
const BRANCH: Record<string, { ids: number[]; color: string }> = {
  production: { ids: [0, 1, 2, 13, 14, 16], color: 'var(--c-accent-teal)' },
  orrery: { ids: [9, 10, 11, 12, 15, 19], color: 'var(--c-accent-gold)' },
  logistics: { ids: [3, 4, 5, 6, 7, 8, 17, 18], color: '#b388ff' },
}
function branchColor(id: number): string {
  for (const b of Object.values(BRANCH)) if (b.ids.includes(id)) return b.color
  return 'var(--c-border-raised)'
}

interface Edge { x1: number; y1: number; x2: number; y2: number; color: string; from: number; to: number }

export function WorkshopTree({
  upgradeDefs,
  view,
  renderNode,
}: {
  upgradeDefs: UpgradeDef[]
  view: View
  renderNode: (i: number) => ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const nodeRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const [edges, setEdges] = useState<Edge[]>([])
  const [hover, setHover] = useState<number | null>(null) // hovered node → highlight its lineage
  // transient reaction to a purchase: the bought node pops + its outgoing edges surge; a node a purchase just
  // UNLOCKED reveals. Cleared after the animation so it only fires on the change, not every render.
  const [leveled, setLeveled] = useState<Set<number>>(new Set())
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const prevRef = useRef<{ levels: number[]; unlocked: boolean[] } | null>(null)

  // a node is shown when it's unlocked, or it's a still-locked but non-secret teaser
  const visible = (i: number) => (view.upgrade_unlocked[i] ?? true) || !upgradeDefs[i]?.secret

  // depth = longest prereq chain to a root (memoised inline; the graph is tiny)
  const depthOf = (i: number, seen = new Set<number>()): number => {
    const req = upgradeDefs[i]?.requires
    if (!req || seen.has(i)) return 0
    seen.add(i)
    return 1 + depthOf(req[0], seen)
  }

  // group visible nodes into columns by depth
  const columns: number[][] = []
  upgradeDefs.forEach((_, i) => {
    if (!visible(i)) return
    const d = depthOf(i)
    ;(columns[d] ||= []).push(i)
  })

  // measure node rects after layout → curved edges from each prereq to its child. Re-runs on resize and
  // whenever the visible set / levels change (upgrade purchase can unlock a node and add a column).
  const levelsKey = view.upgrades.join(',') + '|' + view.upgrade_unlocked.join(',')
  useLayoutEffect(() => {
    const measure = () => {
      const cont = containerRef.current
      if (!cont) return
      const cb = cont.getBoundingClientRect()
      const next: Edge[] = []
      upgradeDefs.forEach((u, i) => {
        const req = u.requires
        if (!req || !visible(i) || !visible(req[0])) return
        const from = nodeRefs.current.get(req[0])
        const to = nodeRefs.current.get(i)
        if (!from || !to) return
        const fr = from.getBoundingClientRect()
        const tr = to.getBoundingClientRect()
        next.push({
          x1: fr.right - cb.left,
          y1: fr.top + fr.height / 2 - cb.top,
          x2: tr.left - cb.left,
          y2: tr.top + tr.height / 2 - cb.top,
          color: branchColor(i),
          from: req[0],
          to: i,
        })
      })
      setEdges(next)
    }
    measure()
    // Observe the container AND every card: a card's height changes independently of levels (the affordability
    // "need +N" hint appears/disappears as Flux accrues, lines wrap), and with `align-items:flex-start` that
    // doesn't resize the container — so observing only the container leaves the curved edges pointing at stale Y.
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    nodeRefs.current.forEach((el) => ro.observe(el))
    // Web-font metrics can settle after first paint and reflow every card; re-measure once they're ready.
    let cancelled = false
    document.fonts?.ready.then(() => {
      if (!cancelled) measure()
    })
    return () => {
      cancelled = true
      ro.disconnect()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelsKey])

  // detect purchases: a node whose level rose pops + surges its outgoing edges; a node a purchase just made
  // visible (unlocked) reveals. Compare to the previous snapshot; skip the first render (no baseline).
  useEffect(() => {
    const prev = prevRef.current
    const up = new Set<number>()
    const reveal = new Set<number>()
    if (prev) {
      view.upgrades.forEach((lvl, i) => {
        if (lvl > (prev.levels[i] ?? 0)) up.add(i)
      })
      view.upgrade_unlocked.forEach((u, i) => {
        if (u && !prev.unlocked[i]) reveal.add(i)
      })
    }
    prevRef.current = { levels: [...view.upgrades], unlocked: [...view.upgrade_unlocked] }
    if (up.size || reveal.size) {
      setLeveled(up)
      setRevealed(reveal)
      const t = setTimeout(() => {
        setLeveled(new Set())
        setRevealed(new Set())
      }, 800)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelsKey])

  return (
    <div ref={containerRef} style={{ position: 'relative', display: 'flex', gap: 36, overflowX: 'auto', paddingBottom: 8, alignItems: 'flex-start' }}>
      {/* edges painted BEHIND the cards (rendered first, lower z) — energy flows prereq→child via a marching
          dash; hovering a node lights up the lineage it touches and dims the rest. */}
      <svg aria-hidden="true" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', overflow: 'visible', zIndex: 0 }}>
        {edges.map((e, i) => {
          const mx = (e.x1 + e.x2) / 2
          const lit = hover != null && (e.from === hover || e.to === hover)
          const dimmed = hover != null && !lit
          const surging = leveled.has(e.from) // a freshly-bought node sends a surge down its branches
          return (
            <path
              key={i}
              className={surging ? 'wt-edge wt-edge-surge' : 'wt-edge'}
              d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
              fill="none"
              stroke={e.color}
              strokeWidth={surging ? 4 : lit ? 3 : 2}
              strokeOpacity={surging ? 1 : dimmed ? 0.12 : lit ? 0.95 : 0.5}
              style={{ transition: 'stroke-opacity 0.15s ease, stroke-width 0.15s ease' }}
            />
          )
        })}
      </svg>
      {columns.map((col, d) => (
        <div key={d} style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', gap: 18, minWidth: 232, flex: '0 0 232px' }}>
          {col.map((id, row) => (
            <div
              key={id}
              className="pop-in"
              ref={(el) => {
                if (el) nodeRefs.current.set(id, el)
                else nodeRefs.current.delete(id)
              }}
              onMouseEnter={() => setHover(id)}
              onMouseLeave={() => setHover((h) => (h === id ? null : h))}
              style={{ animationDelay: `${(d * 3 + row) * 28}ms`, animationFillMode: 'backwards', opacity: hover != null && hover !== id && !edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id)) ? 0.55 : 1, transition: 'opacity 0.15s ease' }}
            >
              {/* inner wrapper carries the purchase reaction so it never collides with the outer stagger pop-in */}
              <div className={leveled.has(id) ? 'wt-pop' : revealed.has(id) ? 'wt-reveal' : undefined}>{renderNode(id)}</div>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

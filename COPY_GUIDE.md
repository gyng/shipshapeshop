# COPY_GUIDE.md — Shape Gacha UI Microcopy

How we write player-facing UI text. Distilled from UX-writing practice (Nielsen Norman Group;
Podmajersky, *Strategic Writing for UX* — purposeful / concise / conversational / clear), game
onboarding/tutorial writing (show-don't-tell, diegetic voice), and voice-&-tone systems
(Mailchimp Voice & Tone; *Nicely Said*). Pairs with the edutainment rule in `AGENTS.md §6`.

> This is the **trivial/UI track**. The stylized character/codex voices are the **transcreation
> track** (`AGENTS.md §10`) and are authored per-locale, not bound by these rules.

## Voice

You are **the Atlas speaking to the Curator**: a warm, witty, jewel-calm companion who *confides,
never lectures*. Cozy and present-tense; gentle, encouraging, ASMR-quiet. The math is real, but it
arrives as a **reward, never a barrier**.

## The 25 rules

1. **DO** write one idea per string. If a hint teaches three mechanics, it's three hints (or two of them belong elsewhere).
2. **DON'T** chain mechanics with em-dashes or semicolons. Each `;` or `—` is a seam where two sentences got welded — cut to periods or separate UI.
3. **DO** lead with the verb the player does: "Tap a shape, then tap a cell." Never open with a genre label ("It's a spatial puzzle:").
4. **DON'T** pre-explain edge cases, undo, or the solver in a first-touch hint. Surface those on the element, when wanted.
5. **DO** teach by doing: if a glowing cell or a chime already shows it, delete the sentence. Reserve copy for what the UI can't show.
6. **DO** honor intuition-first: say what the player sees and feels ("shapes that belong together do better side by side") before any term.
7. **DON'T** put jargon in first-touch copy: no "kin," "synergy," "orthogonal," "genus," "Euler," "non-orientable," "dupe," "SSR+."
8. **DO** reveal the real term later, in the inspector/codex, as a delightful unlock ("…mathematicians call this a Klein bottle").
9. **DO** use the world's nouns everywhere: Flux (not currency/coins), Curator (not user/player), Atlas, the Manifold.
10. **DO** call shapes by nickname in the UI (Pip, Linky, Kleine); the full math name lives only on inspect.
11. **DON'T** break fiction to state a stat in a parenthetical ("(a tiny bond boost)"). Translate the mechanic into the feeling it makes ("it'll like you a little more").
12. **DO** front-load the payoff: "Boosts the four shapes it touches," not "When placed adjacent, a knot will…".
13. **DO** write empty states as: name the state, then point at the next verb. "Storage is empty. Pull a few and they'll show up here."
14. **DON'T** write dead or repeating system phrasing ("No shapes available. You have no shapes…"). One warm line that offers the way out.
15. **DO** keep hints glanceable — one line a thumb reads mid-tap (Doherty <400ms). If the player must stop and parse, it failed.
16. **DO** use active, positive, present-tense phrasing. Confirm and delight ("Nice pairing.") over instruct/warn.
17. **DON'T** use AI-tells or filler: "simply," "just," "in order to," "allows you to," "leverage," "utilize," "seamless," "robust," "fundamentally," "it's a … :".
18. **DO** let auto-solvers and shortcuts live on their own button/line as a relief offer, not narrated defensively up front.
19. **DO** vary rhythm — a short imperative, then a one-beat payoff. Avoid robotic parallel triads (X does A; Y does B; Z does C).
20. **DON'T** loss-frame, nag, or pressure (also an ethics rule). Calm, blame-free nudges only.
21. **DO** keep one name per concept (the cozy one). Never invent synonyms that drift from the world.
22. **DO** put exact numbers (+12%) in the inspector; the moment of feedback stays warm ("Production's up a little.").
23. **DO** write short, single-purpose strings — they localize cleanly into JA/ZH and survive ~30-40% expansion. Never ship English in the JA/ZH slots.
24. **DO** let personality stay subordinate to usefulness: clever copy that obscures the action is worse than plain.
25. **DON'T** front-load welcomes with every system. Introduce one action; defer budget/forge/lanes to the moment each is first reached.

## Bad → good (in-domain)

**Board hint** — `engine.boardHint`
- ❌ "It's a spatial puzzle: pick a shape from storage, then tap a cell to place it. Kin pairs that touch earn synergy; a knot lifts all 4 orthogonal neighbours; ★ dupes strengthen every effect. Tap a placed shape to pick it up (tap its own cell again to remove). Auto-arrange solves it for you."
- ✅ "Pick a shape, then tap a cell to set it down. Shapes that belong together do better side by side. (No mood to fiddle? Tap ✨ Auto-arrange.)"
- *One action + one plain-intuition payoff + the shortcut as a single offer. Knot/dupe/remove move to the inspector & contextual hints.*

**Pull hint** — `pull.hint`
- ❌ "Pulls cost idle-generated Flux. Pity guarantees an SSR+ by 30; every pull builds Resonance — at 40 you claim a wanted shape."
- ✅ "Pull with the Flux you earn while idle. A rare shape is guaranteed by pull 30. Every pull fills Resonance — reach 40 to claim any shape you want."
- *Each mechanic gets its own sentence; "SSR+" becomes "a rare shape"; Resonance becomes a clear earned goal.*

**Engine intro** — `engine.intro`
- ❌ "Deploy shapes onto the floor and they generate ✦ Flux every hour — even while you're away. Each shape takes floor space (round shapes are free; exotic many-holed ones cost more but pay far more)."
- ✅ "Place shapes here to earn ✦ Flux every hour, even while you're away. Bigger, stranger shapes take more room but pay more."

**Room / Bonds** — `room.desc`
- ❌ "Your shapes mill about between shifts. Tap one to chat and give it a little affection (a tiny bond boost)."
- ✅ "Your shapes hang out here between shifts. Tap one to chat and pet it — it'll like you a little more."

**Empty state** — `ledger.events`
- ❌ "Forge a shape, summon a relic, or recrystallize and it'll show up here this session."
- ✅ "Nothing logged yet. Forge, summon, or recrystallize, and the moment lands here."

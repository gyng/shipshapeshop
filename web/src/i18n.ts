import { create } from 'zustand'

// Lightweight i18n: externalised UI strings in EN / JA / ZH with a live switcher. JA is co-primary, ZH is
// Tier-1.5 (AGENTS.md §10). The deep character/codex transcreation is a separate content track; this
// covers the UI chrome so the trilingual plumbing is real and switchable. Nicknames stay as coined names.

export type Lang = 'en' | 'ja' | 'zh' | 'zh-Hant'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'ja', label: '日本語' },
  { id: 'zh', label: '简体' },
  { id: 'zh-Hant', label: '繁體' },
]

const LANG_KEY = 'shipshape-lang'

interface LangStore {
  lang: Lang
  setLang: (l: Lang) => void
  convReady: boolean // flips true once the Traditional (S→T) converter chunk has loaded
  _markConvReady: () => void
}
export const useLangStore = create<LangStore>((set) => ({
  lang: ((typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY)) as Lang) || 'en',
  convReady: false,
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    set({ lang })
  },
  _markConvReady: () => set({ convReady: true }),
}))

// Traditional Chinese is DERIVED from the Simplified bundle (AGENTS.md §10: zh-Hant as a derived bundle).
// OpenCC is lazy-loaded as its own chunk the first time 繁體 is selected, so it never weighs down initial load;
// until it resolves we show Simplified, then re-render.
let _s2t: ((s: string) => string) | null = null
let _loadingS2T = false
function ensureS2T() {
  if (_s2t || _loadingS2T) return
  _loadingS2T = true
  import('opencc-js')
    .then((m) => {
      _s2t = m.Converter({ from: 'cn', to: 'tw' })
      useLangStore.getState()._markConvReady()
    })
    .catch(() => {
      _loadingS2T = false
    })
}

type Dict = Record<string, { en: string; ja: string; zh: string }>

function resolve(key: string, lang: Lang): string {
  const e = STR[key]
  if (!e) return key
  if (lang === 'zh-Hant') {
    const base = e.zh ?? e.en
    if (_s2t) return _s2t(base)
    ensureS2T()
    return base // Simplified shown until the converter chunk loads, then a re-render swaps it
  }
  return e[lang as 'en' | 'ja' | 'zh'] ?? e.en ?? key
}
const STR: Dict = {
  'nav.pull': { en: 'Pull', ja: 'ガチャ', zh: '抽取' },
  'nav.gallery': { en: 'Gallery', ja: '図鑑', zh: '图鉴' },
  'nav.engine': { en: 'Engine', ja: '工房', zh: '引擎' },
  'nav.forge': { en: 'Forge', ja: '鍛冶', zh: '熔炉' },
  'nav.room': { en: 'Room', ja: 'ルーム', zh: '房间' },
  'nav.chatlas': { en: 'Chatlas', ja: 'チャトラス', zh: '图谱聊' },
  'nav.workshop': { en: 'Workshop', ja: 'ワークショップ', zh: '工坊' },
  'nav.shop': { en: 'Shop', ja: 'ショップ', zh: '商店' },
  'nav.ledger': { en: 'Ledger', ja: '台帳', zh: '账本' },

  'hud.flux': { en: 'Flux', ja: 'フラックス', zh: '流量' },
  'hud.shards': { en: 'shards', ja: '欠片', zh: '碎片' },
  'hud.collection': { en: 'Collection', ja: 'コレクション', zh: '收藏' },
  'hud.dim': { en: 'Dim', ja: '次元', zh: '维度' },

  'pull.one': { en: 'Pull · 100 ✦', ja: '抽く · 100 ✦', zh: '抽取 · 100 ✦' },
  'pull.ten': { en: 'Pull ×10 · 1000 ✦', ja: '10連 · 1000 ✦', zh: '十连 · 1000 ✦' },
  'pull.pity': { en: 'SSR+ pity', ja: 'SSR+ 天井', zh: 'SSR+ 保底' },
  'pull.resonance': { en: 'Resonance', ja: '共鳴', zh: '共鸣' },
  'pull.hint': {
    en: 'Pulls cost idle-generated Flux. Pity guarantees an SSR+ by 30; every pull builds Resonance — at 40 you claim a wanted shape.',
    ja: 'ガチャは放置で貯まるフラックスを消費します。30回で SSR+ 確定、毎回「共鳴」が貯まり、40 で好きな形を獲得できます。',
    zh: '抽取消耗挂机产出的流量。第 30 次必出 SSR+；每次抽取累积「共鸣」，满 40 可指定领取一个想要的形状。',
  },

  'welcome.title': { en: 'The Atlas', ja: 'アトラス', zh: '图志' },
  'welcome.begin': { en: 'Begin ✦', ja: 'はじめる ✦', zh: '开始 ✦' },
  'welcome.body': {
    en: '“If you’re reading this, you’re the new Curator. I left the lights off to save the floor. Pull the cord — let’s see who washes up.” — your predecessor’s notes',
    ja: 'これを読んでいるなら、君が新しい学芸員だ。床を守るため灯りは消しておいた。紐を引いて——誰が流れ着くか見てみよう。——前任者の手記より',
    zh: '若你正读到这里，你便是新任馆长。为护住地板，我把灯都熄了。拉一下绳子——看看会有谁漂上岸来。——前任者的笔记',
  },
  'welcome.note': {
    en: 'Pull shapes from the Manifold, learn what they truly are, and light the Atlas room by room. Idle Flux accrues even while you’re away. The summit looks up into the fourth dimension.',
    ja: '「多様体」から形を引き、その正体を知り、アトラスを一室ずつ灯していく。フラックスは離れていても貯まる。頂上は四次元を見上げている。',
    zh: '从「流形」中抽出形状，认识它们的本质，一间间点亮图志。流量在你离开时仍会累积。终点，仰望着第四维。',
  },

  'reveal.new': { en: '✦ New shape!', ja: '✦ 新しいかたち！', zh: '✦ 新形状！' },
  'reveal.continue': { en: 'Continue', ja: 'つづける', zh: '继续' },
  'reveal.discovery': { en: '✦ Discovery! Forged for the first time (+100 shards)', ja: '✦ 発見！ はじめての鍛冶（+100 欠片）', zh: '✦ 发现！首次熔炼成功（+100 碎片）' },
  'reveal.forged': { en: 'Forged.', ja: '鍛えた。', zh: '已熔炼。' },

  'offline.title': { en: 'Welcome back, Curator', ja: 'おかえりなさい、学芸員さん', zh: '欢迎回来，馆长' },
  'offline.collect': { en: 'Collect', ja: '受け取る', zh: '领取' },

  'engine.budget': { en: 'Euler Budget', ja: 'オイラー予算', zh: '欧拉预算' },
  'engine.auto': { en: 'Auto-arrange', ja: 'おまかせ配置', zh: '自动布置' },
  'engine.recrystallize': { en: 'Recrystallize ↑ (NG+)', ja: '再結晶 ↑ (NG+)', zh: '重结晶 ↑ (NG+)' },
  'engine.deploy': { en: 'Deploy', ja: '配置', zh: '部署' },
  'engine.deployed': { en: 'Deployed', ja: '配置中', zh: '已部署' },

  'forge.title': { en: 'The Forge', ja: '鍛冶場', zh: '熔炉' },
  'common.close': { en: 'Close', ja: '閉じる', zh: '关闭' },

  'nudge.deploy': {
    en: '📜 You’ve a shape in hand — open the Engine and Deploy it (or tap Auto-arrange) to start producing Flux.',
    ja: '📜 形が手に入った——「工房」で配置（または「おまかせ配置」）すると、フラックスが貯まり始める。',
    zh: '📜 你已拥有形状——进入「引擎」部署它（或点「自动布置」）即可开始产出流量。',
  },
  'nudge.forge': {
    en: '📜 Two of your shapes can be glued into a third — try the Forge.',
    ja: '📜 持っている形を二つ繋げて、別の形を生み出せる——「鍛冶」を試してみよう。',
    zh: '📜 你的两个形状可以熔合成第三个——去「熔炉」试试。',
  },
  'nudge.prestige': {
    en: '📜 The Atlas is full. Recrystallize (in the Engine) to ascend a dimension — your collection carries over.',
    ja: '📜 アトラスが満ちた。「工房」で再結晶すると次元を上れる——コレクションは引き継がれる。',
    zh: '📜 图志已满。在「引擎」中重结晶即可登上更高维度——收藏会保留。',
  },

  // First-run tour
  'tour.next': { en: 'Next ▸', ja: '次へ ▸', zh: '下一步 ▸' },
  'tour.skip': { en: 'Skip', ja: 'スキップ', zh: '跳过' },
  'tour.finish': { en: 'Let’s go ✦', ja: 'はじめよう ✦', zh: '开始吧 ✦' },
  'settings.replay': { en: '▶ Replay tutorial', ja: '▶ チュートリアルを再生', zh: '▶ 重看教程' },
  'tour.s0.title': { en: 'Pull shapes', ja: 'ガチャを引く', zh: '抽取形状' },
  'tour.s0.body': {
    en: 'Tap Pull to summon a shape with Flux. Odds are shown and pity is visible — keep pulling and a rare one is guaranteed. No tricks.',
    ja: '✦ で形を引ける。確率は明示、天井も見える——引き続ければレアは必ず出る。小細工なし。',
    zh: '用流量抽取形状。概率公开、保底可见——持续抽取必出稀有。绝无套路。',
  },
  'tour.s1.title': { en: 'Your collection', ja: 'コレクション', zh: '你的收藏' },
  'tour.s1.body': {
    en: 'Every shape you own lives here. Tap one to inspect it, raise its Bond, and hear it speak — each has a personality.',
    ja: '持っている形はすべてここに。タップして調べ、絆を育て、声を聞こう——みんな個性がある。',
    zh: '你拥有的形状都在这里。点击查看、培养羁绊、聆听它说话——每个都有个性。',
  },
  'tour.s2.title': { en: 'Deploy for Flux', ja: '配置で生産', zh: '部署产出' },
  'tour.s2.body': {
    en: 'You start with Pip the sphere. Deploy it here on the factory floor to produce Flux automatically — even while the game is closed. Then head to Pull for more shapes.',
    ja: 'まずは球の「ピップ」を所持。工場フロアに配置するとフラックスを自動生産——閉じていても貯まる。次は✦でもっと形を引こう。',
    zh: '你以球体「皮普」开局。把它部署到工厂车间即可自动产出流量——关闭游戏也在累积。然后去抽取更多形状。',
  },
  'tour.s3.title': { en: 'Workshop & beyond', ja: '工房とその先', zh: '工房与进阶' },
  'tour.s3.body': {
    en: 'Spend banked Flux on permanent upgrades that change how you play. Complete the core, then Recrystallize to ascend and earn Facets — a deeper prestige tree.',
    ja: 'フラックスを使い、遊び方を変える恒久強化を購入。コアを完成させたら再結晶で次元を上げ、Facets を獲得——より深い転生ツリーへ。',
    zh: '用储备的流量购买改变玩法的永久升级。完成核心后重结晶以飞升，并赚取 Facets——更深的转生树。',
  },
  'tour.s4.title': { en: 'Forge new shapes', ja: '鍛冶で生成', zh: '熔炉合成' },
  'tour.s4.body': {
    en: 'Glue two shapes together to discover a third — a Möbius strip plus a Möbius strip makes a Klein bottle!',
    ja: '二つの形を繋げて三つ目を発見——メビウスの帯＋メビウスの帯でクラインの壺！',
    zh: '将两个形状熔合发现第三个——莫比乌斯带＋莫比乌斯带＝克莱因瓶！',
  },
  'tour.s5.title': { en: 'Your goals — enjoy', ja: '目標、そして楽しむ', zh: '你的目标——尽情享受' },
  'tour.s5.body': {
    en: 'The Next Goals panel tracks what to chase. Play it calm and cozy or optimise the numbers — entirely your call. Have fun!',
    ja: '『次の目標』パネルが目指す先を示す。のんびり癒しでも、数字を最適化でも——あなた次第。楽しんで！',
    zh: '『下一目标』面板会指引方向。悠闲治愈，或钻研数字优化——全凭你。玩得开心！',
  },
  // Newer feature labels (trivial UI track). JA/ZH provided for the simple structural strings; richer copy
  // stays English-first until a translator does the transcreation pass (AGENTS.md §10).
  'pull.goals': { en: '🎯 Goals', ja: '🎯 目標', zh: '🎯 目标' },
  'pull.history': { en: '🕘 Pull history', ja: '🕘 ガチャ履歴', zh: '🕘 抽取记录' },
  'ledger.luck': { en: 'Luck & pity', ja: '運と天井', zh: '运气与保底' },
  'ledger.events': { en: 'Recent events', ja: '最近の出来事', zh: '近期事件' },
  'rank.label': { en: 'Curator Rank', ja: 'キュレーターランク', zh: '策展人等级' },
  'workshop.title': { en: '🔧 Workshop', ja: '🔧 ワークショップ', zh: '🔧 工坊' },
  'boot.lighting': { en: 'Lighting the Atlas…', ja: 'Lighting the Atlas…', zh: 'Lighting the Atlas…' },

  'nav.shortcutTitle': { en: 'Shortcut: ', ja: 'ショートカット: ', zh: '快捷键: ' },

  'hud.fluxTip': { en: 'Flux — generated by idling; spent on pulls and Shop scenes', ja: 'フラックス — 放置で生成され、ガチャやショップのシーンに使う', zh: '流量 — 挂机时产生，可用于抽取与商店场景' },
  'hud.rateTip': { en: 'Current production per hour', ja: '現在の毎時生産量', zh: '当前每小时产量' },
  'hud.perHour': { en: '/hr', ja: '/時', zh: '/小时' },
  'hud.shardsTip': { en: 'Shards — from duplicate pulls; spent in the Forge & Shop', ja: '欠片 — ダブったガチャから得られ、鍛冶とショップで使う', zh: '碎片 — 来自重复抽取，可在熔炉与商店中使用' },
  'hud.collectionTip': { en: 'Core shapes discovered (Relics are a bonus tier)', ja: '発見したコアの形（レリックはボーナス階層）', zh: '已发现的核心形状（遗物为额外层级）' },
  'hud.dimTip': { en: 'Viewport dimension — Recrystallize in the Engine to ascend (New Game+)', ja: 'ビューポート次元 — エンジンで再結晶して上昇（New Game+）', zh: '视口维度 — 在引擎中重结晶以飞升（New Game+）' },
  'hud.facetsTip': { en: 'Facets — prestige meta-currency; spend in the Engine', ja: 'Facets — 転生メタ通貨。エンジンで使う', zh: 'Facets — 转生元货币，可在引擎中使用' },
  'hud.muteAria': { en: 'toggle sound', ja: 'サウンド切り替え', zh: '切换声音' },
  'hud.dialogLogAria': { en: 'dialogue log', ja: '会話ログ', zh: '对话记录' },
  'hud.dialogLogTip': { en: 'Dialogue log — everything your shapes have said', ja: '会話ログ — あなたの形たちが話したことすべて', zh: '对话记录 — 你的形状们说过的一切' },
  'hud.settingsAria': { en: 'settings', ja: '設定', zh: '设置' },
  'hud.settingsTip': { en: 'Settings, scenes & credits', ja: '設定・シーン・クレジット', zh: '设置、场景与制作人员' },

  'common.toggleSound': { en: 'Toggle sound', ja: 'サウンド切り替え', zh: '切换声音' },
  'common.on': { en: 'ON', ja: 'ON', zh: '开' },
  'common.off': { en: 'OFF', ja: 'OFF', zh: '关' },
  'common.maxed': { en: 'Maxed ✓', ja: '最大 ✓', zh: '已满级 ✓' },
  'common.lvFraction': { en: 'Lv {lvl}/{max}', ja: 'Lv {lvl}/{max}', zh: '等级 {lvl}/{max}' },

  'objectives.heading': { en: '🎯 Next goals', ja: '🎯 次の目標', zh: '🎯 下一目标' },

  'banner.rateUp': { en: 'rate-up', ja: 'ピックアップ', zh: '概率提升' },
  'banner.fullPool': { en: 'full pool · pity-steered', ja: '全プール · 天井誘導', zh: '全卡池 · 保底导向' },

  'gacha.featured': { en: 'featured', ja: 'ピックアップ', zh: '限定' },
  'gacha.secretaryTag': { en: 'secretary', ja: '秘書', zh: '秘书' },
  'gacha.effectTooltip': { en: 'Tap for full details', ja: 'タップで詳細', zh: '点击查看详情' },
  'gacha.details': { en: 'details ▸', ja: '詳細 ▸', zh: '详情 ▸' },
  'gacha.talkTooltip': { en: 'Tap to chat', ja: 'タップで会話', zh: '点击聊天' },

  'pull.oneShortcut': { en: 'Shortcut: P or Space', ja: 'ショートカット: P または Space', zh: '快捷键：P 或 空格' },
  'pull.tenShortcut': { en: 'Shortcut: T', ja: 'ショートカット: T', zh: '快捷键：T' },
  'pull.autoTooltip': { en: 'Auto-pull (Workshop): spends spare Flux for you, no reveal', ja: 'オート抽選（工房）: 余ったフラックスを自動消費、演出なし', zh: '自动抽取（工坊）：自动消耗多余的流光，无演出' },
  'pull.autoLabel': { en: 'Auto-pull', ja: 'オート抽選', zh: '自动抽取' },
  'pull.history.empty': { en: 'No pulls yet — your gacha history will appear here.', ja: 'まだ抽選していません — 抽選履歴はここに表示されます。', zh: '还没有抽取记录 — 你的抽卡历史会显示在这里。' },
  'pull.history.new': { en: 'NEW', ja: 'NEW', zh: '新' },

  'ledger.events.empty': { en: 'Forge a shape, summon a relic, or recrystallize and it\'ll show up here this session.', ja: 'Forge a shape, summon a relic, or recrystallize and it\'ll show up here this session.', zh: 'Forge a shape, summon a relic, or recrystallize and it\'ll show up here this session.' },

  'room.title': { en: '🛋 The Atlas — your room', ja: '🛋 The Atlas — your room', zh: '🛋 The Atlas — your room' },
  'room.desc': { en: 'Your shapes mill about between shifts. Tap one to chat and give it a little affection (a tiny bond boost). Re-skin the room from the Shop.', ja: 'Your shapes mill about between shifts. Tap one to chat and give it a little affection (a tiny bond boost). Re-skin the room from the Shop.', zh: 'Your shapes mill about between shifts. Tap one to chat and give it a little affection (a tiny bond boost). Re-skin the room from the Shop.' },
  'room.moveIn': { en: 'Pull a few shapes and they\'ll move in here.', ja: 'いくつか抽選すると、ここに引っ越してきます。', zh: '抽几个形状，它们就会搬进来。' },
  'room.tapHint': { en: '💬 tap a shape to chat & pet · drag to look around', ja: '💬 形状をタップして会話＆なでなで · ドラッグで見回す', zh: '💬 点击形状聊天和抚摸 · 拖动环视四周' },

  'rank.toNext': { en: '{toNext} pts → {next}', ja: '{next} まであと {toNext} pts', zh: '距 {next} 还差 {toNext} 分' },
  'rank.apex': { en: 'Apex reached', ja: '最高ランク到達', zh: '已达巅峰' },

  'chatlas.title': { en: '💬 Chatlas', ja: '💬 Chatlas', zh: '💬 Chatlas' },
  'chatlas.desc': { en: 'The curators\' group chat — hot takes, shipping gossip, and 3am flux-watching from collectors across the Manifold. Procedurally generated, entirely in good fun.', ja: 'The curators\' group chat — hot takes, shipping gossip, and 3am flux-watching from collectors across the Manifold. Procedurally generated, entirely in good fun.', zh: 'The curators\' group chat — hot takes, shipping gossip, and 3am flux-watching from collectors across the Manifold. Procedurally generated, entirely in good fun.' },
  'chatlas.stickerTooltip': { en: 'Send this sticker', ja: 'このスタンプを送る', zh: '发送这个贴纸' },

  'gallery.searchPlaceholder': { en: '🔎 search owned shapes…', ja: '🔎 所持シェイプを検索…', zh: '🔎 搜索已拥有的形状…' },
  'gallery.toggleTooltip': { en: 'toggle {r}', ja: '{r} の表示切替', zh: '切换 {r}' },
  'gallery.unknownTile': { en: '???', ja: '???', zh: '???' },
  'gallery.starTooltip': { en: '★{level} · ×{copies} copies', ja: '★{level} · ×{copies} 個', zh: '★{level} · ×{copies} 个' },

  'rarity.relicsShort': { en: 'Relics', ja: 'レリック', zh: '遗物' },
  'rarity.referenceWing': { en: 'Reference Wing', ja: 'レファレンスウィング', zh: '典藏馆' },
  'rarity.common': { en: 'Common', ja: 'コモン', zh: '普通' },
  'rarity.rare': { en: 'Rare', ja: 'レア', zh: '稀有' },
  'rarity.epic': { en: 'Epic', ja: 'エピック', zh: '史诗' },
  'rarity.ssr': { en: 'SSR', ja: 'SSR', zh: 'SSR' },
  'rarity.ur': { en: 'UR', ja: 'UR', zh: 'UR' },

  'facets.heading': { en: '🌌 Facets — {n} banked · prestige perks (permanent)', ja: '🌌 Facets — {n} banked · prestige perks (permanent)', zh: '🌌 Facets — {n} banked · prestige perks (permanent)' },
  'facets.buy': { en: 'Buy · {cost} 🌌', ja: '購入 · {cost} 🌌', zh: '购买 · {cost} 🌌' },

  'workshop.upgradesHeading': { en: '🔧 Workshop — permanent upgrades', ja: '🔧 ワークショップ — 永続アップグレード', zh: '🔧 工坊 — 永久升级' },
  'workshop.requires': { en: '🔒 Requires {name}', ja: '🔒 必要: {name}', zh: '🔒 需要 {name}' },
  'workshop.requiresLevel': { en: ' Lv {level}', ja: ' Lv {level}', zh: ' 等级 {level}' },
  'workshop.buy': { en: 'Buy · ', ja: '購入 · ', zh: '购买 · ' },

  'production.shapeEffects.label': { en: '✦ Shape effects', ja: '✦ 形状効果', zh: '✦ 形状效果' },
  'production.shapeEffects.note': { en: 'handle-lanes ★ · overdrive · knot entangle', ja: 'handle-lanes ★ · overdrive · knot entangle', zh: 'handle-lanes ★ · overdrive · knot entangle' },
  'production.signature.label': { en: '◆ Signature shapes', ja: '◆ シグネチャー形状', zh: '◆ 标志形状' },
  'production.signature.note': { en: 'Sphere anchor / Hopf link', ja: 'Sphere anchor / Hopf link', zh: 'Sphere anchor / Hopf link' },
  'production.synergy.label': { en: '♥ Kin synergy', ja: '♥ 同族シナジー', zh: '♥ 同族协同' },
  'production.synergy.notePair': { en: '{count} adjacent pair{count===1?\'\':\'s\'}', ja: '隣接ペア {count} 組', zh: '{count} 对相邻' },
  'production.genusRes.label': { en: '🌀 Genus resonance', ja: '🌀 種数共鳴', zh: '🌀 亏格共鸣' },
  'production.ballast.label': { en: '⚓ Euler ballast', ja: '⚓ オイラーバラスト', zh: '⚓ 欧拉压舱' },
  'production.crossdim.label': { en: '🧩 Cross-dimension', ja: '🧩 次元横断', zh: '🧩 跨维度' },
  'production.bond.label': { en: '♥ Bonds', ja: '♥ 絆', zh: '♥ 羁绊' },
  'production.set.label': { en: '⬛ Platonic set', ja: '⬛ プラトンセット', zh: '⬛ 柏拉图套组' },
  'production.milestone.label': { en: '🏆 Milestones', ja: '🏆 マイルストーン', zh: '🏆 里程碑' },
  'production.facet.label': { en: '💎 Facets', ja: '💎 ファセット', zh: '💎 切面' },
  'production.prestige.label': { en: '🌌 Prestige', ja: '🌌 プレステージ', zh: '🌌 威望' },
  'production.activeHeading': { en: 'Active multipliers — {count}', ja: '有効な倍率 — {count}', zh: '生效倍率 — {count}' },

  'workshop.intro': { en: 'Spend banked ✦ Flux (and shards) on permanent, rule-changing upgrades. Complete the core and Recrystallize (in the Engine) to earn 🌌 Facets for a deeper prestige tree.', ja: 'Spend banked ✦ Flux (and shards) on permanent, rule-changing upgrades. Complete the core and Recrystallize (in the Engine) to earn 🌌 Facets for a deeper prestige tree.', zh: 'Spend banked ✦ Flux (and shards) on permanent, rule-changing upgrades. Complete the core and Recrystallize (in the Engine) to earn 🌌 Facets for a deeper prestige tree.' },

  'board.emptyCell': { en: 'empty cell', ja: '空きセル', zh: '空格' },

  'engine.title': { en: '⚙ Engine — your Flux factory', ja: '⚙ 工房 — フラックス工場', zh: '⚙ 引擎 — 你的流量工厂' },
  'engine.intro': { en: 'Deploy shapes onto the floor and they generate ✦ Flux every hour — even while you\'re away. Each shape takes floor space (round shapes are free; exotic many-holed ones cost more but pay far more).', ja: 'Deploy shapes onto the floor and they generate ✦ Flux every hour — even while you\'re away. Each shape takes floor space (round shapes are free; exotic many-holed ones cost more but pay far more).', zh: 'Deploy shapes onto the floor and they generate ✦ Flux every hour — even while you\'re away. Each shape takes floor space (round shapes are free; exotic many-holed ones cost more but pay far more).' },
  'engine.emptyFloor': { en: '🏭 Empty floor — tap a shape below (or Auto-arrange) to fill a slot ⭕', ja: '🏭 フロアが空です — 下の形をタップ（または自動配置）してスロットを埋めましょう ⭕', zh: '🏭 工厂空着 — 点击下方的形状（或自动布置）来填入一个槽位 ⭕' },
  'engine.tapToChat': { en: '💬 tap a deployed shape to chat', ja: '💬 配置した形をタップして会話', zh: '💬 点击已部署的形状来聊天' },
  'engine.fluxPerHour': { en: '✦ Flux / hour', ja: '✦ フラックス / 時', zh: '✦ 流量 / 小时' },
  'engine.kinSynergyStat': { en: '♥ kin synergy · {count} pair{count>1?\'s\':\'\'}', ja: '♥ 同族シナジー · {count} 組', zh: '♥ 同族协同 · {count} 对' },
  'engine.floorSpaceUsed': { en: 'Floor space used', ja: '使用フロアスペース', zh: '已用工厂空间' },
  'engine.autoArrange': { en: '✨ Auto-arrange', ja: '✨ 自動配置', zh: '✨ 自动布置' },
  'engine.recrystallizeBtn': { en: '↑ Recrystallize', ja: '↑ 再結晶', zh: '↑ 重结晶' },
  'engine.floorHeading': { en: 'The floor — a {w}×{h} grid · {count} placed', ja: 'フロア — {w}×{h} のグリッド · {count} 配置済み', zh: '工厂 — {w}×{h} 网格 · 已放置 {count}' },
  'engine.boardHint': { en: '💡 It\'s a spatial puzzle: pick a shape from storage, then tap a cell to place it. Kin pairs that touch earn synergy; a knot lifts all 4 orthogonal neighbours; ★ dupes strengthen every effect. Tap a placed shape to pick it up (tap its own cell again to remove). Auto-arrange solves it for you.', ja: '💡 It\'s a spatial puzzle: pick a shape from storage, then tap a cell to place it. Kin pairs that touch earn synergy; a knot lifts all 4 orthogonal neighbours; ★ dupes strengthen every effect. Tap a placed shape to pick it up (tap its own cell again to remove). Auto-arrange solves it for you.', zh: '💡 It\'s a spatial puzzle: pick a shape from storage, then tap a cell to place it. Kin pairs that touch earn synergy; a knot lifts all 4 orthogonal neighbours; ★ dupes strengthen every effect. Tap a placed shape to pick it up (tap its own cell again to remove). Auto-arrange solves it for you.' },
  'engine.placingHint': { en: ' · placing {nick} — tap a cell (or its cell to cancel/remove)', ja: ' · 配置中: {nick} — セルをタップ（自身のセルでキャンセル/除去）', zh: ' · 正在放置 {nick} — 点击格子（点其所在格可取消/移除）' },
  'engine.storageHeading': { en: 'In storage — {count}', ja: 'ストレージ — {count}', zh: '仓库 — {count}' },
  'engine.filterPlaceholder': { en: '🔎 filter…', ja: '🔎 絞り込み…', zh: '🔎 筛选…' },
  'engine.noFilterMatch': { en: 'No stored shapes match your filter.', ja: '絞り込みに一致する保管中の形はありません。', zh: '没有符合筛选条件的仓库形状。' },
  'engine.allDeployed': { en: 'Everything you own is deployed. Pull more shapes to expand the floor!', ja: '所有しているものはすべて配置済みです。もっと形をガチャしてフロアを広げましょう！', zh: '你拥有的形状已全部部署。多抽一些形状来扩展工厂吧！' },
  'engine.benchTapToPlace': { en: '✋ tap a cell to place', ja: '✋ セルをタップして配置', zh: '✋ 点击格子来放置' },
  'engine.benchFree': { en: 'free · tap to pick up', ja: '無料 · タップで持ち上げ', zh: '免费 · 点击拿起' },
  'engine.benchSpace': { en: 'space {cost} · tap to pick up', ja: 'スペース {cost} · タップで持ち上げ', zh: '空间 {cost} · 点击拿起' },
  'engine.benchNeedsSpace': { en: 'needs {cost} space', ja: 'スペース {cost} 必要', zh: '需要 {cost} 空间' },

  'reveal.drawingTen': { en: 'Drawing ten…', ja: '10連を引いています…', zh: '正在十连…' },
  'reveal.drawing': { en: 'Drawing…', ja: '引いています…', zh: '正在抽取…' },
  'reveal.tapToSkip': { en: ' · tap to skip', ja: ' · タップでスキップ', zh: ' · 点击跳过' },

  'inspect.vagueHint.tier.ur': { en: 'A legend of the deep Manifold.', ja: 'A legend of the deep Manifold.', zh: 'A legend of the deep Manifold.' },
  'inspect.vagueHint.tier.relic': { en: 'Not of the Manifold at all — an artifact of the rendering-folk.', ja: 'Not of the Manifold at all — an artifact of the rendering-folk.', zh: 'Not of the Manifold at all — an artifact of the rendering-folk.' },
  'inspect.vagueHint.tier.ssr': { en: 'One of the rarer forms, they say.', ja: 'One of the rarer forms, they say.', zh: 'One of the rarer forms, they say.' },
  'inspect.vagueHint.tier.epic': { en: 'An uncommon find.', ja: 'An uncommon find.', zh: 'An uncommon find.' },
  'inspect.vagueHint.tier.common': { en: 'A common enough shape, once it surfaces.', ja: 'A common enough shape, once it surfaces.', zh: 'A common enough shape, once it surfaces.' },
  'inspect.vagueHint.holes.g0': { en: 'Word is it has no way through — sealed, or solid.', ja: 'Word is it has no way through — sealed, or solid.', zh: 'Word is it has no way through — sealed, or solid.' },
  'inspect.vagueHint.holes.g1': { en: 'A single hole, the Ledger notes — one way to thread it.', ja: 'A single hole, the Ledger notes — one way to thread it.', zh: 'A single hole, the Ledger notes — one way to thread it.' },
  'inspect.vagueHint.holes.gFew': { en: 'A handful of holes, if the rumours hold.', ja: 'A handful of holes, if the rumours hold.', zh: 'A handful of holes, if the rumours hold.' },
  'inspect.vagueHint.holes.gMany': { en: 'Riddled with holes — more ways through than anyone has bothered to count.', ja: 'Riddled with holes — more ways through than anyone has bothered to count.', zh: 'Riddled with holes — more ways through than anyone has bothered to count.' },
  'inspect.pat.title': { en: 'Pat / rub for a tiny bond boost', ja: 'なでて絆を少し上げる', zh: '轻抚以略微提升羁绊' },
  'inspect.pat.orbit': { en: '↺ orbit', ja: '↺ 回転', zh: '↺ 旋转' },
  'inspect.pat.pat': { en: '✋ pat', ja: '✋ なでる', zh: '✋ 抚摸' },
  'inspect.talk.title': { en: 'Tap to chat', ja: 'タップして話す', zh: '点击聊天' },
  'inspect.bond.hint': { en: 'Bond {bond}/5 · inspect & keep deployed to raise', ja: '絆 {bond}/5 · 鑑賞して配置し続けると上昇', zh: '羁绊 {bond}/5 · 鉴赏并保持部署以提升' },
  'inspect.star.hint': { en: '★{st}/5 · pull duplicates to raise (boosts its effect)', ja: '★{st}/5 · 重複を引くと上昇（効果が強化される）', zh: '★{st}/5 · 抽到重复以提升（增强其效果）' },
  'inspect.bond.locked': { en: '🔒 Reach Bond 1 (inspect a few times) to hear them speak.', ja: '🔒 絆1に到達（数回鑑賞）すると声が聞けます。', zh: '🔒 达到羁绊1（鉴赏几次）即可听到它说话。' },
  'inspect.topology.holesLanes': { en: '{genus} hole{s} → {genus} production lane{s}. ', ja: '{genus}個の穴 → {genus}本の生産レーン。 ', zh: '{genus}个洞 → {genus}条生产线。 ' },
  'inspect.topology.noHoles': { en: 'No holes — free to deploy. ', ja: '穴なし — 自由に配置できます。 ', zh: '无洞 — 可自由部署。 ' },
  'inspect.topology.eulerCost': { en: 'Euler cost {cost}.', ja: 'オイラーコスト {cost}。', zh: '欧拉成本 {cost}。' },
  'inspect.topology.termReveal': { en: ' …it is {term}.', ja: ' …it is {term}.', zh: ' …it is {term}.' },
  'inspect.secretary.title': { en: 'Your secretary greets you on the Pull screen', ja: '秘書はプル画面であなたを出迎えます', zh: '你的秘书会在抽取页面迎接你' },
  'inspect.secretary.on': { en: '★ Secretary ✓', ja: '★ 秘書 ✓', zh: '★ 秘书 ✓' },
  'inspect.secretary.set': { en: '☆ Set as Secretary', ja: '☆ 秘書に設定', zh: '☆ 设为秘书' },
  'inspect.kinship.head': { en: '♥ Kinship', ja: '♥ 縁', zh: '♥ 羁绊' },
  'inspect.kinship.watchScene': { en: '▶ Watch scene', ja: '▶ シーンを見る', zh: '▶ 观看场景' },
  'inspect.undiscovered.title': { en: 'Undiscovered', ja: '未発見', zh: '未发现' },
  'inspect.undiscovered.sub': { en: 'still adrift in the Manifold', ja: 'still adrift in the Manifold', zh: 'still adrift in the Manifold' },
  'inspect.undiscovered.pullHint': { en: 'Pull to bring it ashore — the reveal is half the joy.', ja: 'Pull to bring it ashore — the reveal is half the joy.', zh: 'Pull to bring it ashore — the reveal is half the joy.' },

  'forge.titleFull': { en: '🔨 Forge — fuse shapes together', ja: '🔨 鍛冶 — 形を融合させる', zh: '🔨 锻造 — 将形状融合在一起' },
  'forge.desc': { en: 'Glue two shapes you own into a rarer third (a connected sum — real topology picks the result). Each forge costs ◈ 50; the first time you discover a recipe you earn +100 ◈. Shards come from duplicate pulls.', ja: 'Glue two shapes you own into a rarer third (a connected sum — real topology picks the result). Each forge costs ◈ 50; the first time you discover a recipe you earn +100 ◈. Shards come from duplicate pulls.', zh: 'Glue two shapes you own into a rarer third (a connected sum — real topology picks the result). Each forge costs ◈ 50; the first time you discover a recipe you earn +100 ◈. Shards come from duplicate pulls.' },
  'forge.shardBank': { en: '{shards} shards in the bank', ja: '残高に{shards}シャード', zh: '库存{shards}碎片' },
  'forge.referenceWing.title': { en: '★ Reference Wing', ja: '★ リファレンス棟', zh: '★ 参考展厅' },
  'forge.referenceWing.desc': { en: 'Summon a legendary CG model — Teapot, Bunny, Dragon… {owned}/{count} collected.', ja: 'Summon a legendary CG model — Teapot, Bunny, Dragon… {owned}/{count} collected.', zh: 'Summon a legendary CG model — Teapot, Bunny, Dragon… {owned}/{count} collected.' },
  'forge.summon.complete': { en: 'Complete ✓', ja: 'コンプリート ✓', zh: '已完成 ✓' },
  'forge.summon.cost': { en: 'Summon · {cost} ◈', ja: '召喚 · {cost} ◈', zh: '召唤 · {cost} ◈' },
  'forge.recipes.heading': { en: 'Recipes', ja: 'レシピ', zh: '配方' },
  'forge.recipe.forgeCost': { en: 'Forge · 50 ◈', ja: '鍛冶 · 50 ◈', zh: '锻造 · 50 ◈' },
  'forge.recipe.missingShape': { en: 'Missing a shape', ja: '形状が不足', zh: '缺少形状' },
  'forge.recipe.needShards': { en: 'Need 50 ◈', ja: '50 ◈ が必要', zh: '需要 50 ◈' },
  'forge.recipe.discovered': { en: '✓ discovered', ja: '✓ 発見済み', zh: '✓ 已发现' },

  'title.alt': { en: 'Ship Shape Shop', ja: 'Ship Shape Shop', zh: 'Ship Shape Shop' },
  'title.cycle': { en: 'Click for another title', ja: 'クリックで別のタイトルへ', zh: '点击切换其他标题' },

  'shop.title': { en: '🛍 Shop — scenes & environments', ja: '🛍 ショップ — シーン & 環境', zh: '🛍 商店 — 场景与环境' },
  'shop.desc': { en: 'Spend ✦ Flux on swappable scenes that re-light the whole game — the patron sink for late-game Flux. Owned scenes equip for free.', ja: 'Spend ✦ Flux on swappable scenes that re-light the whole game — the patron sink for late-game Flux. Owned scenes equip for free.', zh: 'Spend ✦ Flux on swappable scenes that re-light the whole game — the patron sink for late-game Flux. Owned scenes equip for free.' },
  'shop.fluxAvailable': { en: 'Flux available', ja: 'Flux 利用可能', zh: '可用 Flux' },
  'shop.equipped': { en: 'Equipped', ja: '装備中', zh: '已装备' },
  'shop.equip': { en: 'Equip', ja: '装備', zh: '装备' },
  'shop.buy': { en: 'Buy', ja: '購入', zh: '购买' },

  'ledger.fluxTrendEmpty': { en: 'Flux trend will appear as you play…', ja: 'プレイするにつれて Flux の推移が表示されます…', zh: '随着游戏进行，Flux 趋势将会显示…' },
  'ledger.title': { en: '📊 Ledger — your run in numbers', ja: '📊 台帳 — 数字で見るあなたのラン', zh: '📊 账本 — 用数字看你的旅程' },
  'ledger.desc': { en: 'Everything the Atlas has tallied. Flux over the last couple of minutes:', ja: 'Everything the Atlas has tallied. Flux over the last couple of minutes:', zh: 'Everything the Atlas has tallied. Flux over the last couple of minutes:' },
  'ledger.sectionEconomy': { en: 'Economy', ja: '経済', zh: '经济' },
  'ledger.statFluxNow': { en: 'Flux now', ja: '現在の Flux', zh: '当前 Flux' },
  'ledger.statFluxPerHr': { en: 'Flux / hr', ja: 'Flux / 時', zh: 'Flux / 小时' },
  'ledger.statLifetimeFlux': { en: 'Lifetime Flux', ja: '累計 Flux', zh: '累计 Flux' },
  'ledger.statShards': { en: 'Shards', ja: 'シャード', zh: '碎片' },
  'ledger.statLifetimeShards': { en: 'Lifetime shards', ja: '累計シャード', zh: '累计碎片' },
  'ledger.statTotalPulls': { en: 'Total pulls', ja: '総ガチャ回数', zh: '总抽取次数' },
  'ledger.statForges': { en: 'Forges', ja: '鍛造回数', zh: '锻造次数' },
  'ledger.statPlaytime': { en: 'Playtime', ja: 'プレイ時間', zh: '游戏时长' },
  'ledger.sectionCollection': { en: 'Collection & progress', ja: 'コレクション & 進捗', zh: '收藏与进度' },
  'ledger.statCoreShapes': { en: 'Core shapes', ja: 'コアシェイプ', zh: '核心形状' },
  'ledger.statDimension': { en: 'Dimension', ja: '次元', zh: '维度' },
  'ledger.statNewGamePlus': { en: 'New Game+', ja: '強くてニューゲーム', zh: '新游戏+' },
  'ledger.statPrestige': { en: 'Prestige', ja: 'プレステージ', zh: '声望' },
  'ledger.statFloorSpace': { en: 'Floor space', ja: 'フロアスペース', zh: '占地空间' },
  'ledger.statPlatonicSet': { en: 'Platonic set', ja: 'プラトン立体セット', zh: '柏拉图立体套组' },
  'ledger.statComplete': { en: '✓ complete', ja: '✓ 完成', zh: '✓ 完成' },
  'ledger.statScenes': { en: 'Scenes', ja: 'シーン', zh: '场景' },
  'ledger.statRecipes': { en: 'Recipes', ja: 'レシピ', zh: '配方' },
  'ledger.statBondsMaxed': { en: 'Bonds maxed', ja: '絆 MAX', zh: '羁绊满级' },
  'ledger.statKinSynergies': { en: 'Kin synergies', ja: '同族シナジー', zh: '同族协同' },
  'ledger.sectionPullsByRarity': { en: 'Pulls by rarity', ja: 'レアリティ別ガチャ', zh: '按稀有度统计抽取' },
  'ledger.statSsrPulls': { en: 'SSR+ pulls', ja: 'SSR+ 回数', zh: 'SSR+ 抽取数' },
  'ledger.statSsrRate': { en: 'SSR+ rate', ja: 'SSR+ 確率', zh: 'SSR+ 概率' },
  'ledger.statPityToSsr': { en: 'Pity to SSR+', ja: 'SSR+ までの天井', zh: '距 SSR+ 保底' },
  'ledger.statResonance': { en: 'Resonance', ja: '共鳴', zh: '共鸣' },
  'ledger.milestonesHeading': { en: 'Milestones', ja: 'マイルストーン', zh: '里程碑' },
  'ledger.milestonesProductionSuffix': { en: 'production', ja: '生産', zh: '产量' },

  'milestone.fallbackName': { en: 'Milestone', ja: 'マイルストーン', zh: '里程碑' },
  'milestone.toastBanner': { en: '★ MILESTONE', ja: '★ マイルストーン', zh: '★ 里程碑' },

  'attribution.referenceModels': { en: '3D reference models', ja: '3D 参照モデル', zh: '3D 参考模型' },
  'attribution.stanford': { en: 'Stanford Bunny · Dragon · Armadillo · Lucy — Stanford 3D Scanning Repository', ja: 'Stanford Bunny · Dragon · Armadillo · Lucy — Stanford 3D Scanning Repository', zh: 'Stanford Bunny · Dragon · Armadillo · Lucy — Stanford 3D Scanning Repository' },
  'attribution.princeton': { en: 'Cow · Horse — Princeton “Suggestive Contours” gallery', ja: 'Cow · Horse — Princeton “Suggestive Contours” gallery', zh: 'Cow · Horse — Princeton “Suggestive Contours” gallery' },
  'attribution.teapot': { en: 'Utah Teapot — Martin Newell, 1975 (procedural via three.js)', ja: 'Utah Teapot — Martin Newell, 1975 (procedural via three.js)', zh: 'Utah Teapot — Martin Newell, 1975 (procedural via three.js)' },
  'attribution.crane': { en: 'Spot & Császár torus — Keenan Crane (CC0)', ja: 'Spot & Császár torus — Keenan Crane (CC0)', zh: 'Spot & Császár torus — Keenan Crane (CC0)' },
  'attribution.benchy': { en: '3DBenchy — CreativeTools (CC BY-ND)', ja: '3DBenchy — CreativeTools (CC BY-ND)', zh: '3DBenchy — CreativeTools (CC BY-ND)' },
  'attribution.builtWith': { en: 'Built with', ja: '使用技術', zh: '技术栈' },
  'attribution.builtThree': { en: 'three.js · React Three Fiber · drei', ja: 'three.js · React Three Fiber · drei', zh: 'three.js · React Three Fiber · drei' },
  'attribution.builtRust': { en: 'Rust → WebAssembly (deterministic game core)', ja: 'Rust → WebAssembly (deterministic game core)', zh: 'Rust → WebAssembly (deterministic game core)' },
  'attribution.builtReact': { en: 'React · Zustand · Vite · TypeScript', ja: 'React · Zustand · Vite · TypeScript', zh: 'React · Zustand · Vite · TypeScript' },
  'attribution.licenceNote': { en: 'Shapes are mathematical objects; topology is public-domain mathematics. Verify each model\'s licence before commercial use.', ja: 'Shapes are mathematical objects; topology is public-domain mathematics. Verify each model\'s licence before commercial use.', zh: 'Shapes are mathematical objects; topology is public-domain mathematics. Verify each model\'s licence before commercial use.' },

  'settings.titleArtDesc': { en: 'The shop\'s cover art. Click the image (or use ◂ ▸) to cycle all {count} pieces — your pick is saved and shown on the welcome screen.', ja: 'The shop\'s cover art. Click the image (or use ◂ ▸) to cycle all {count} pieces — your pick is saved and shown on the welcome screen.', zh: 'The shop\'s cover art. Click the image (or use ◂ ▸) to cycle all {count} pieces — your pick is saved and shown on the welcome screen.' },
  'settings.titleArtAlt': { en: 'title art', ja: 'タイトルアート', zh: '标题图' },
  'settings.titleArtClickHint': { en: 'Click for another', ja: 'クリックで別の絵に', zh: '点击切换下一张' },
  'settings.prev': { en: '◂ Prev', ja: '◂ 前へ', zh: '◂ 上一张' },
  'settings.next': { en: 'Next ▸', ja: '次へ ▸', zh: '下一张 ▸' },
  'settings.dataDesc': { en: 'Progress saves automatically in this browser. Export a backup you can re-import here or on another device.', ja: '進行状況はこのブラウザに自動保存されます。バックアップを書き出して、ここや別の端末で再読み込みできます。', zh: '进度会自动保存在此浏览器中。导出备份后可在此处或其他设备重新导入。' },
  'settings.dataExportMsg': { en: 'Save exported. Keep the file somewhere safe.', ja: 'セーブを書き出しました。ファイルを安全な場所に保管してください。', zh: '存档已导出。请将文件妥善保存。' },
  'settings.dataImportConfirm': { en: 'Import this save? Your current progress will be replaced.', ja: 'このセーブをインポートしますか？現在の進行状況は置き換えられます。', zh: '导入此存档？当前进度将被替换。' },
  'settings.dataImportInvalid': { en: 'That file was not a valid Shape Gacha save.', ja: 'そのファイルは有効な Shape Gacha のセーブではありませんでした。', zh: '该文件不是有效的 Shape Gacha 存档。' },
  'settings.dataResetConfirm1': { en: 'Reset ALL progress? This erases your collection, Flux, bonds and prestige.', ja: 'すべての進行状況をリセットしますか？コレクション・Flux・絆・プレステージが消去されます。', zh: '重置所有进度？这将清除你的收藏、Flux、羁绊和声望。' },
  'settings.dataResetConfirm2': { en: 'Are you absolutely sure? There is no undo.', ja: '本当によろしいですか？元に戻せません。', zh: '你确定吗？此操作无法撤销。' },
  'settings.dataBackupLabel': { en: 'Backup', ja: 'バックアップ', zh: '备份' },
  'settings.dataExport': { en: '⬇ Export save', ja: '⬇ セーブを書き出す', zh: '⬇ 导出存档' },
  'settings.dataRestoreLabel': { en: 'Restore', ja: '復元', zh: '恢复' },
  'settings.dataImport': { en: '⬆ Import save…', ja: '⬆ セーブを読み込む…', zh: '⬆ 导入存档…' },
  'settings.dataDangerLabel': { en: 'Danger zone', ja: '危険ゾーン', zh: '危险区' },
  'settings.dataReset': { en: 'Reset progress…', ja: '進行状況をリセット…', zh: '重置进度…' },
  'settings.title': { en: '⚙ Settings', ja: '⚙ 設定', zh: '⚙ 设置' },
  'settings.tabGraphics': { en: 'Graphics', ja: 'グラフィック', zh: '画面' },
  'settings.tabGameplay': { en: 'Gameplay', ja: 'ゲームプレイ', zh: '玩法' },
  'settings.tabTitle': { en: 'Title', ja: 'タイトル', zh: '标题' },
  'settings.tabData': { en: 'Data', ja: 'データ', zh: '数据' },
  'settings.tabKeybinds': { en: 'Keybinds', ja: 'キー設定', zh: '按键' },
  'settings.tabAttribution': { en: 'Attribution', ja: 'クレジット', zh: '署名' },
  'settings.soundEffectsLabel': { en: 'Sound effects', ja: '効果音', zh: '音效' },
  'settings.toggleOff': { en: 'Off', ja: 'オフ', zh: '关' },
  'settings.toggleOn': { en: 'On', ja: 'オン', zh: '开' },
  'settings.graphicsQualityLabel': { en: 'Graphics quality', ja: 'グラフィック品質', zh: '画面质量' },
  'settings.qualityLow': { en: 'Low', ja: '低', zh: '低' },
  'settings.qualityMedium': { en: 'Medium', ja: '中', zh: '中' },
  'settings.qualityHigh': { en: 'High', ja: '高', zh: '高' },
  'settings.qualityHint': { en: 'Quality scales resolution, glass detail, raymarch steps, shadows & particle density — drop it for higher FPS on weaker devices. Backgrounds & scenes are buyable in the 🛍 Shop.', ja: 'Quality scales resolution, glass detail, raymarch steps, shadows & particle density — drop it for higher FPS on weaker devices. Backgrounds & scenes are buyable in the 🛍 Shop.', zh: 'Quality scales resolution, glass detail, raymarch steps, shadows & particle density — drop it for higher FPS on weaker devices. Backgrounds & scenes are buyable in the 🛍 Shop.' },
  'settings.gameplayLoopDesc': { en: 'The loop: pull shapes → deploy them in the Engine to make Flux → forge rarer shapes → recrystallize to ascend a dimension (New Game+). Edutainment (the real maths) lives in each owned shape\'s Codex — discovery-first, and it never gates the fun.', ja: 'The loop: pull shapes → deploy them in the Engine to make Flux → forge rarer shapes → recrystallize to ascend a dimension (New Game+). Edutainment (the real maths) lives in each owned shape\'s Codex — discovery-first, and it never gates the fun.', zh: 'The loop: pull shapes → deploy them in the Engine to make Flux → forge rarer shapes → recrystallize to ascend a dimension (New Game+). Edutainment (the real maths) lives in each owned shape\'s Codex — discovery-first, and it never gates the fun.' },
  'settings.kbPullx1': { en: 'Pull ×1', ja: 'ガチャ ×1', zh: '抽取 ×1' },
  'settings.kbPullx10': { en: 'Pull ×10', ja: 'ガチャ ×10', zh: '抽取 ×10' },
  'settings.kbNavScreens': { en: 'Engine · Workshop · Pull · Room · Chatlas · Gallery · Forge · Shop · Ledger', ja: 'Engine · Workshop · Pull · Room · Chatlas · Gallery · Forge · Shop · Ledger', zh: 'Engine · Workshop · Pull · Room · Chatlas · Gallery · Forge · Shop · Ledger' },
  'settings.kbCloseDialog': { en: 'Close the open dialog', ja: '開いているダイアログを閉じる', zh: '关闭打开的对话框' },
  'settings.kbOrbitHint': { en: 'In any 3D view: drag (left or right) to orbit, scroll / pinch to zoom.', ja: 'In any 3D view: drag (left or right) to orbit, scroll / pinch to zoom.', zh: 'In any 3D view: drag (left or right) to orbit, scroll / pinch to zoom.' },

  'dialogLog.title': { en: 'Dialogue log', ja: '会話ログ', zh: '对话记录' },
  'dialogLog.empty': { en: 'Nothing said yet — tap a shape (or inspect one) to hear it speak.', ja: 'Nothing said yet — tap a shape (or inspect one) to hear it speak.', zh: 'Nothing said yet — tap a shape (or inspect one) to hear it speak.' },
  'dialogLog.close': { en: 'Close', ja: '閉じる', zh: '关闭' },

  'ship.resume': { en: '▸ Resume', ja: '▸ 再開', zh: '▸ 继续' },
  'ship.close': { en: 'Close ♥', ja: '閉じる ♥', zh: '关闭 ♥' },
  'ship.next': { en: 'Next ▸', ja: '次へ ▸', zh: '下一句 ▸' },
}

export function useT(): (key: string, vars?: Record<string, string | number>) => string {
  const lang = useLangStore((s) => s.lang)
  useLangStore((s) => s.convReady) // subscribe: re-render when the Traditional converter finishes loading
  return (key: string, vars?: Record<string, string | number>) => {
    let s = resolve(key, lang)
    if (vars) {
      for (const k in vars) s = s.split('{' + k + '}').join(String(vars[k]))
    }
    return s
  }
}

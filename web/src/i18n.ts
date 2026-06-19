import { create } from 'zustand'

// Lightweight i18n: externalised UI strings in EN / JA / ZH with a live switcher. JA is co-primary, ZH is
// Tier-1.5 (AGENTS.md §10). The deep character/codex transcreation is a separate content track; this
// covers the UI chrome so the trilingual plumbing is real and switchable. Nicknames stay as coined names.

export type Lang = 'en' | 'ja' | 'zh'
export const LANGS: { id: Lang; label: string }[] = [
  { id: 'en', label: 'EN' },
  { id: 'ja', label: '日本語' },
  { id: 'zh', label: '中文' },
]

const LANG_KEY = 'shipshape-lang'

interface LangStore {
  lang: Lang
  setLang: (l: Lang) => void
}
export const useLangStore = create<LangStore>((set) => ({
  lang: ((typeof localStorage !== 'undefined' && localStorage.getItem(LANG_KEY)) as Lang) || 'en',
  setLang: (lang) => {
    try {
      localStorage.setItem(LANG_KEY, lang)
    } catch {
      /* ignore */
    }
    set({ lang })
  },
}))

type Dict = Record<string, Record<Lang, string>>
const STR: Dict = {
  'nav.pull': { en: 'Pull', ja: 'ガチャ', zh: '抽取' },
  'nav.gallery': { en: 'Gallery', ja: '図鑑', zh: '图鉴' },
  'nav.engine': { en: 'Engine', ja: '工房', zh: '引擎' },
  'nav.forge': { en: 'Forge', ja: '鍛冶', zh: '熔炉' },

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
    en: 'This is your factory floor. Deploy shapes here to produce Flux automatically — even while the game is closed.',
    ja: 'ここが工場フロア。形を配置するとフラックスを自動生産——ゲームを閉じていても貯まる。',
    zh: '这是你的工厂车间。部署形状即可自动产出流量——即使关闭游戏也在累积。',
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
}

export function useT(): (key: string) => string {
  const lang = useLangStore((s) => s.lang)
  return (key: string) => STR[key]?.[lang] ?? STR[key]?.en ?? key
}

// Nesio shell — demo data (tools, AIs, reminders, quotes) + i18n
const NESIO_I18N = {
  zh: { brand:'宝盒', tagline:'数字静谧庭院', morning:'早安', day:'午安', evening:'晚安',
    settings:'账号设置', note:'笔记', ai:'智友', toolboxMore:'更多', toolbox:'宝盒工具',
    reminder:'陪你看见', reminderSub:'基于你的数据 · 今天', quoteLabel:'今日话语',
    handle:'轻轻处理', later:'稍后', skip:'跳过', enter:'进入', locked:'未开通 · 在工具箱开启',
    navHome:'宝盒', navNote:'笔记', navTodo:'待办', navMe:'我', groupChat:'群聊', send:'发送',
    aiHint:'让多个 AI 一起回答，省得来回复制', notePlaceholder:'现在的想法是…' },
  en: { brand:'Treasure Box', tagline:'A quiet digital courtyard', morning:'Good morning', day:'Good afternoon', evening:'Good evening',
    settings:'Account', note:'Notes', ai:'AI Friends', toolboxMore:'More', toolbox:'Toolbox',
    reminder:'Here with you', reminderSub:'From your data · today', quoteLabel:'Daily quote',
    handle:'Gently handle', later:'Later', skip:'Skip', enter:'Enter', locked:'Locked · open in toolbox',
    navHome:'Home', navNote:'Notes', navTodo:'To-do', navMe:'Me', groupChat:'Group', send:'Send',
    aiHint:'Ask several AIs at once — no more copy-pasting', notePlaceholder:'What are you thinking…' },
  ja: { brand:'宝箱', tagline:'静かなデジタルの庭', morning:'おはよう', day:'こんにちは', evening:'こんばんは',
    settings:'アカウント', note:'ノート', ai:'AIフレンド', toolboxMore:'その他', toolbox:'ツールボックス',
    reminder:'そばで見守る', reminderSub:'あなたのデータから · 今日', quoteLabel:'今日の言葉',
    handle:'そっと片づける', later:'あとで', skip:'スキップ', enter:'開く', locked:'未開放 · ツールボックスで開く',
    navHome:'ホーム', navNote:'ノート', navTodo:'タスク', navMe:'マイ', groupChat:'グループ', send:'送信',
    aiHint:'複数のAIにまとめて質問。コピペ不要', notePlaceholder:'いま考えていることは…' },
  ko: { brand:'보물상자', tagline:'고요한 디지털 정원', morning:'좋은 아침', day:'안녕하세요', evening:'좋은 저녁',
    settings:'계정', note:'노트', ai:'AI 친구', toolboxMore:'더보기', toolbox:'도구 상자',
    reminder:'함께 살펴봐요', reminderSub:'당신의 데이터로 · 오늘', quoteLabel:'오늘의 한마디',
    handle:'가볍게 처리', later:'나중에', skip:'건너뛰기', enter:'들어가기', locked:'미개방 · 도구 상자에서 열기',
    navHome:'홈', navNote:'노트', navTodo:'할 일', navMe:'나', groupChat:'그룹', send:'보내기',
    aiHint:'여러 AI에게 한 번에 — 복사 붙여넣기 끝', notePlaceholder:'지금 떠오르는 생각은…' },
};

// 11 modules from the live shell config. zone: cool 秩序 / warm 觉察 / neutral 体现
const NESIO_TOOLS = [
  { id:'plan',       name:{zh:'待办',en:'Flow',ja:'タスク',ko:'할 일'}, en:'Flow', icon:'plan',       zone:'cool',    owned:true,
    signal:{zh:'今天 5 件 · 先做最小的一件', en:'5 today · start tiny', ja:'今日5件 · 小さく', ko:'오늘 5개 · 작게'}, badge:{status:'gentle', label:{zh:'刚刚好',en:'just right',ja:'ちょうど',ko:'딱 좋아요'}} },
  { id:'inventory',  name:{zh:'收纳',en:'Storage',ja:'収納',ko:'수납'}, en:'Storage', icon:'storage', zone:'cool',    owned:true,
    signal:{zh:'牛奶 · 酸奶 · 鸡蛋', en:'Milk · yogurt · eggs', ja:'牛乳 · ヨーグルト · 卵', ko:'우유 · 요거트 · 계란'}, sub:{zh:'3 天内到期',en:'expiring in 3 days',ja:'3日以内に期限',ko:'3일 내 만료'}, badge:{status:'risk', label:{zh:'3 件将到期',en:'3 expiring',ja:'3件期限',ko:'3건 만료'}} },
  { id:'reading',    name:{zh:'阅读',en:'Reading',ja:'読書',ko:'독서'}, en:'Reading', icon:'reading', zone:'warm',    owned:true,
    signal:{zh:'《被讨厌的勇气》', en:'The Courage to Be Disliked', ja:'嫌われる勇気', ko:'미움받을 용기'}, sub:{zh:'读到 62% · 还剩 2 章',en:'62% · 2 chapters left',ja:'62% · 残り2章',ko:'62% · 2장 남음'}, badge:{status:'go', label:{zh:'在路上',en:'on track',ja:'順調',ko:'순조'}} },
  { id:'fitness',    name:{zh:'健身',en:'Fitness',ja:'フィットネス',ko:'피트니스'}, en:'Fitness', icon:'fitness', zone:'neutral', owned:true,
    signal:{zh:'今天 · 下肢', en:'Today · legs', ja:'今日 · 下半身', ko:'오늘 · 하체'}, sub:{zh:'约 28 分钟',en:'~28 min',ja:'約28分',ko:'약 28분'}, badge:{status:'go', label:{zh:'连续 5 天',en:'5-day streak',ja:'5日連続',ko:'5일 연속'}} },
  { id:'secretary',  name:{zh:'智友',en:'AI Friends',ja:'AIフレンド',ko:'AI 친구'}, en:'AI Friends', icon:'secretary', zone:'cool',  owned:false },
  { id:'quiz',       name:{zh:'刷题',en:'Quiz',ja:'問題演習',ko:'문제풀이'}, en:'Quiz', icon:'quiz',          zone:'cool',    owned:false },
  { id:'psychoanalysis', name:{zh:'咨询',en:'Psych',ja:'カウンセリング',ko:'상담'}, en:'Psych', icon:'psych', zone:'warm',  owned:false },
  { id:'sanctuary',  name:{zh:'冥想',en:'Shelter',ja:'瞑想',ko:'명상'}, en:'Shelter', icon:'sanctuary',     zone:'warm',    owned:false },
  { id:'health',     name:{zh:'溯',en:'SÙ Health',ja:'溯',ko:'溯'}, en:'SÙ Health', icon:'health',          zone:'neutral', owned:false },
  { id:'finance',    name:{zh:'财务',en:'Finance',ja:'家計',ko:'재무'}, en:'Finance', icon:'finance',        zone:'neutral', owned:false },
  { id:'lifesim',    name:{zh:'人生',en:'Weaver',ja:'人生',ko:'인생'}, en:'Weaver', icon:'lifesim',          zone:'neutral', owned:false },
];

const NESIO_AIS = [
  { id:'claude', name:'Claude', icon:'claude' },
  { id:'chatgpt', name:'ChatGPT', icon:'chatgpt' },
  { id:'gemini', name:'Gemini', icon:'gemini' },
  { id:'deepseek', name:'DeepSeek', icon:'deepseek' },
  { id:'doubao', name:'豆包', icon:'doubao' },
  { id:'grok', name:'Grok', icon:'grok' },
];

const NESIO_REMINDERS = {
  zh: [
    { kind:'重要日期', text:'妈妈的生日还有 3 天，要不要先想个小礼物？', status:'calm', action:'记一笔' },
    { kind:'下一步', text:'把昨天的想法保存下来，明天再决定也可以。', status:'gentle', action:'保存想法' },
    { kind:'到期', text:'冰箱里的牛奶 3 天后到期，需要的话顺路买点。', status:'risk', action:'查看收纳' },
  ],
  en: [
    { kind:'Important date', text:"Mom's birthday is in 3 days — want to jot down a small gift idea?", status:'calm', action:'Note it' },
    { kind:'Next step', text:"Save yesterday's thought. You can decide tomorrow.", status:'gentle', action:'Save' },
    { kind:'Expiring', text:'Milk expires in 3 days — grab some if you pass by.', status:'risk', action:'Open storage' },
  ],
  ja: [
    { kind:'大切な日', text:'お母さんの誕生日まであと3日。小さな贈り物を考えてみる？', status:'calm', action:'メモ' },
    { kind:'次の一歩', text:'昨日の思いつきを保存しよう。決めるのは明日でも大丈夫。', status:'gentle', action:'保存' },
    { kind:'期限', text:'牛乳があと3日で期限。通りがかりに買ってもいいかも。', status:'risk', action:'収納を見る' },
  ],
  ko: [
    { kind:'중요한 날', text:'엄마 생신이 3일 남았어요. 작은 선물 아이디어를 적어둘까요?', status:'calm', action:'메모' },
    { kind:'다음 단계', text:'어제의 생각을 저장해요. 결정은 내일 해도 괜찮아요.', status:'gentle', action:'저장' },
    { kind:'만료', text:'우유가 3일 후 만료돼요. 지나는 길에 사도 좋아요.', status:'risk', action:'수납 보기' },
  ],
};

const NESIO_QUOTES = {
  zh: ['把大事拆小，把今天过好就够了。','你已经做得很好了，休息也是前进。','允许自己不确定，答案会在路上长出来。','慢一点，深一点，稳一点。'],
  en: ['Break the big into small — making today good is enough.',"You've done well. Resting is also moving forward.",'Allow yourself uncertainty; answers grow along the way.','Slower, deeper, steadier.'],
  ja: ['大きなことは小さく。今日をちゃんと過ごせれば十分。','もう十分よくやっている。休むことも前進。','不確かさを許して。答えは道の途中で育つ。','ゆっくり、深く、穏やかに。'],
  ko: ['큰 일은 작게. 오늘을 잘 보내면 충분해요.','이미 충분히 잘했어요. 쉬는 것도 나아가는 거예요.','불확실함을 허락해요. 답은 길 위에서 자라요.','천천히, 깊게, 차분하게.'],
};

Object.assign(window, { NESIO_I18N, NESIO_TOOLS, NESIO_AIS, NESIO_REMINDERS, NESIO_QUOTES });

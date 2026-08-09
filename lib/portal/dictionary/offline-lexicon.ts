/**
 * 内置离线词库(欧路风格查词的数据层)。
 *
 * 不依赖网络、不走云 AI —— 词条打进包里。覆盖日常英汉 / 汉英常用词;
 * 查不到就如实说「词库里没有」,绝不编造释义。
 */

export interface DictSense {
  pos?: string;
  zh: string;
  en?: string;
}

export interface DictEntry {
  /** 主词形(英文小写或中文原形) */
  word: string;
  /** 展示用(保留大小写 / 中文) */
  headword: string;
  phonetic?: string;
  senses: DictSense[];
  examples?: Array<{ en: string; zh: string }>;
  /** 反向检索用的中文关键词 */
  zhKeys?: string[];
}

/** 精选常用词 —— 体积可控的离线底库(可后续扩包)。 */
export const OFFLINE_LEXICON: DictEntry[] = [
  { word: 'hello', headword: 'hello', phonetic: '/həˈləʊ/', senses: [{ pos: 'int.', zh: '你好;喂', en: 'used as a greeting' }], examples: [{ en: 'Hello, how are you?', zh: '你好,你好吗?' }], zhKeys: ['你好', '喂'] },
  { word: 'world', headword: 'world', phonetic: '/wɜːld/', senses: [{ pos: 'n.', zh: '世界;世人', en: 'the earth and all people' }], examples: [{ en: 'travel the world', zh: '环游世界' }], zhKeys: ['世界'] },
  { word: 'love', headword: 'love', phonetic: '/lʌv/', senses: [{ pos: 'n./v.', zh: '爱;热爱', en: 'a strong feeling of affection' }], examples: [{ en: 'I love this song.', zh: '我喜欢这首歌。' }], zhKeys: ['爱', '喜欢'] },
  { word: 'time', headword: 'time', phonetic: '/taɪm/', senses: [{ pos: 'n.', zh: '时间;次', en: 'the indefinite continued progress of existence' }], zhKeys: ['时间', '时候'] },
  { word: 'day', headword: 'day', phonetic: '/deɪ/', senses: [{ pos: 'n.', zh: '天;日;白天', en: 'a period of 24 hours' }], zhKeys: ['天', '日'] },
  { word: 'night', headword: 'night', phonetic: '/naɪt/', senses: [{ pos: 'n.', zh: '夜晚', en: 'the period of darkness' }], zhKeys: ['夜', '夜晚'] },
  { word: 'morning', headword: 'morning', phonetic: '/ˈmɔːnɪŋ/', senses: [{ pos: 'n.', zh: '早晨;上午', en: 'the early part of the day' }], zhKeys: ['早晨', '早上'] },
  { word: 'afternoon', headword: 'afternoon', phonetic: '/ˌɑːftəˈnuːn/', senses: [{ pos: 'n.', zh: '下午', en: 'the time from noon to evening' }], zhKeys: ['下午'] },
  { word: 'evening', headword: 'evening', phonetic: '/ˈiːvnɪŋ/', senses: [{ pos: 'n.', zh: '傍晚;晚上', en: 'the end of the day' }], zhKeys: ['傍晚', '晚上'] },
  { word: 'water', headword: 'water', phonetic: '/ˈwɔːtə/', senses: [{ pos: 'n.', zh: '水', en: 'a clear liquid' }], zhKeys: ['水'] },
  { word: 'food', headword: 'food', phonetic: '/fuːd/', senses: [{ pos: 'n.', zh: '食物', en: 'any nutritious substance' }], zhKeys: ['食物', '吃的'] },
  { word: 'home', headword: 'home', phonetic: '/həʊm/', senses: [{ pos: 'n./adv.', zh: '家;在家', en: 'the place where one lives' }], zhKeys: ['家'] },
  { word: 'work', headword: 'work', phonetic: '/wɜːk/', senses: [{ pos: 'n./v.', zh: '工作;运作', en: 'activity involving mental or physical effort' }], zhKeys: ['工作'] },
  { word: 'friend', headword: 'friend', phonetic: '/frend/', senses: [{ pos: 'n.', zh: '朋友', en: 'a person one knows and likes' }], zhKeys: ['朋友'] },
  { word: 'family', headword: 'family', phonetic: '/ˈfæməli/', senses: [{ pos: 'n.', zh: '家庭;家人', en: 'a group of related people' }], zhKeys: ['家庭', '家人'] },
  { word: 'happy', headword: 'happy', phonetic: '/ˈhæpi/', senses: [{ pos: 'adj.', zh: '快乐的;幸福的', en: 'feeling or showing pleasure' }], zhKeys: ['快乐', '开心', '幸福'] },
  { word: 'sad', headword: 'sad', phonetic: '/sæd/', senses: [{ pos: 'adj.', zh: '悲伤的', en: 'feeling sorrow' }], zhKeys: ['悲伤', '难过'] },
  { word: 'good', headword: 'good', phonetic: '/ɡʊd/', senses: [{ pos: 'adj.', zh: '好的;优良的', en: 'to be desired or approved of' }], zhKeys: ['好'] },
  { word: 'bad', headword: 'bad', phonetic: '/bæd/', senses: [{ pos: 'adj.', zh: '坏的;糟糕的', en: 'of poor quality' }], zhKeys: ['坏', '糟糕'] },
  { word: 'beautiful', headword: 'beautiful', phonetic: '/ˈbjuːtɪfl/', senses: [{ pos: 'adj.', zh: '美丽的', en: 'pleasing the senses or mind' }], zhKeys: ['美丽', '漂亮'] },
  { word: 'thank', headword: 'thank', phonetic: '/θæŋk/', senses: [{ pos: 'v.', zh: '感谢', en: 'express gratitude' }], examples: [{ en: 'Thank you.', zh: '谢谢。' }], zhKeys: ['感谢', '谢谢'] },
  { word: 'please', headword: 'please', phonetic: '/pliːz/', senses: [{ pos: 'adv./v.', zh: '请;使高兴', en: 'used in polite requests' }], zhKeys: ['请'] },
  { word: 'sorry', headword: 'sorry', phonetic: '/ˈsɒri/', senses: [{ pos: 'adj.', zh: '抱歉的;遗憾的', en: 'feeling regret' }], zhKeys: ['抱歉', '对不起'] },
  { word: 'yes', headword: 'yes', phonetic: '/jes/', senses: [{ pos: 'adv.', zh: '是;对', en: 'used to give an affirmative response' }], zhKeys: ['是', '对'] },
  { word: 'no', headword: 'no', phonetic: '/nəʊ/', senses: [{ pos: 'adv./det.', zh: '不;没有', en: 'used to give a negative response' }], zhKeys: ['不', '没有'] },
  { word: 'help', headword: 'help', phonetic: '/help/', senses: [{ pos: 'v./n.', zh: '帮助', en: 'make it easier for someone' }], zhKeys: ['帮助', '帮忙'] },
  { word: 'need', headword: 'need', phonetic: '/niːd/', senses: [{ pos: 'v./n.', zh: '需要', en: 'require something' }], zhKeys: ['需要'] },
  { word: 'want', headword: 'want', phonetic: '/wɒnt/', senses: [{ pos: 'v.', zh: '想要', en: 'have a desire to possess' }], zhKeys: ['想要', '想'] },
  { word: 'think', headword: 'think', phonetic: '/θɪŋk/', senses: [{ pos: 'v.', zh: '想;认为', en: 'have a particular belief' }], zhKeys: ['想', '认为'] },
  { word: 'know', headword: 'know', phonetic: '/nəʊ/', senses: [{ pos: 'v.', zh: '知道;认识', en: 'be aware of' }], zhKeys: ['知道', '认识'] },
  { word: 'see', headword: 'see', phonetic: '/siː/', senses: [{ pos: 'v.', zh: '看见;明白', en: 'perceive with the eyes' }], zhKeys: ['看见', '看'] },
  { word: 'hear', headword: 'hear', phonetic: '/hɪə/', senses: [{ pos: 'v.', zh: '听见', en: 'perceive with the ear' }], zhKeys: ['听见', '听'] },
  { word: 'speak', headword: 'speak', phonetic: '/spiːk/', senses: [{ pos: 'v.', zh: '说话;讲', en: 'say something' }], zhKeys: ['说话', '讲'] },
  { word: 'read', headword: 'read', phonetic: '/riːd/', senses: [{ pos: 'v.', zh: '阅读', en: 'look at and comprehend written words' }], zhKeys: ['读', '阅读'] },
  { word: 'write', headword: 'write', phonetic: '/raɪt/', senses: [{ pos: 'v.', zh: '写', en: 'mark letters or words' }], zhKeys: ['写'] },
  { word: 'buy', headword: 'buy', phonetic: '/baɪ/', senses: [{ pos: 'v.', zh: '买', en: 'obtain in exchange for money' }], zhKeys: ['买'] },
  { word: 'sell', headword: 'sell', phonetic: '/sel/', senses: [{ pos: 'v.', zh: '卖', en: 'give in exchange for money' }], zhKeys: ['卖'] },
  { word: 'money', headword: 'money', phonetic: '/ˈmʌni/', senses: [{ pos: 'n.', zh: '钱;货币', en: 'a medium of exchange' }], zhKeys: ['钱', '货币'] },
  { word: 'price', headword: 'price', phonetic: '/praɪs/', senses: [{ pos: 'n.', zh: '价格', en: 'the amount of money expected' }], zhKeys: ['价格', '价钱'] },
  { word: 'book', headword: 'book', phonetic: '/bʊk/', senses: [{ pos: 'n./v.', zh: '书;预订', en: 'a written work; reserve' }], zhKeys: ['书', '预订'] },
  { word: 'phone', headword: 'phone', phonetic: '/fəʊn/', senses: [{ pos: 'n./v.', zh: '电话;打电话', en: 'a telephone' }], zhKeys: ['电话', '手机'] },
  { word: 'computer', headword: 'computer', phonetic: '/kəmˈpjuːtə/', senses: [{ pos: 'n.', zh: '计算机;电脑', en: 'an electronic device for processing data' }], zhKeys: ['电脑', '计算机'] },
  { word: 'internet', headword: 'internet', phonetic: '/ˈɪntənet/', senses: [{ pos: 'n.', zh: '互联网', en: 'a global computer network' }], zhKeys: ['互联网', '网络'] },
  { word: 'email', headword: 'email', phonetic: '/ˈiːmeɪl/', senses: [{ pos: 'n./v.', zh: '电子邮件', en: 'messages distributed by electronic means' }], zhKeys: ['邮件', '电邮'] },
  { word: 'meeting', headword: 'meeting', phonetic: '/ˈmiːtɪŋ/', senses: [{ pos: 'n.', zh: '会议;会面', en: 'an assembly of people' }], zhKeys: ['会议', '会面'] },
  { word: 'travel', headword: 'travel', phonetic: '/ˈtrævl/', senses: [{ pos: 'v./n.', zh: '旅行', en: 'make a journey' }], zhKeys: ['旅行', '旅游'] },
  { word: 'flight', headword: 'flight', phonetic: '/flaɪt/', senses: [{ pos: 'n.', zh: '航班;飞行', en: 'a journey by air' }], zhKeys: ['航班', '飞行'] },
  { word: 'hotel', headword: 'hotel', phonetic: '/həʊˈtel/', senses: [{ pos: 'n.', zh: '酒店', en: 'an establishment providing lodging' }], zhKeys: ['酒店', '旅馆'] },
  { word: 'city', headword: 'city', phonetic: '/ˈsɪti/', senses: [{ pos: 'n.', zh: '城市', en: 'a large town' }], zhKeys: ['城市'] },
  { word: 'country', headword: 'country', phonetic: '/ˈkʌntri/', senses: [{ pos: 'n.', zh: '国家;乡村', en: 'a nation; rural areas' }], zhKeys: ['国家', '乡村'] },
  { word: 'weather', headword: 'weather', phonetic: '/ˈweðə/', senses: [{ pos: 'n.', zh: '天气', en: 'the state of the atmosphere' }], zhKeys: ['天气'] },
  { word: 'rain', headword: 'rain', phonetic: '/reɪn/', senses: [{ pos: 'n./v.', zh: '雨;下雨', en: 'water falling in drops' }], zhKeys: ['雨', '下雨'] },
  { word: 'sun', headword: 'sun', phonetic: '/sʌn/', senses: [{ pos: 'n.', zh: '太阳', en: 'the star that Earth orbits' }], zhKeys: ['太阳'] },
  { word: 'health', headword: 'health', phonetic: '/helθ/', senses: [{ pos: 'n.', zh: '健康', en: 'the state of being free from illness' }], zhKeys: ['健康'] },
  { word: 'doctor', headword: 'doctor', phonetic: '/ˈdɒktə/', senses: [{ pos: 'n.', zh: '医生', en: 'a qualified medical practitioner' }], zhKeys: ['医生'] },
  { word: 'medicine', headword: 'medicine', phonetic: '/ˈmedsn/', senses: [{ pos: 'n.', zh: '药;医学', en: 'a drug; the science of healing' }], zhKeys: ['药', '医学'] },
  { word: 'sleep', headword: 'sleep', phonetic: '/sliːp/', senses: [{ pos: 'v./n.', zh: '睡觉;睡眠', en: 'rest with eyes closed' }], zhKeys: ['睡觉', '睡眠'] },
  { word: 'eat', headword: 'eat', phonetic: '/iːt/', senses: [{ pos: 'v.', zh: '吃', en: 'put food into the mouth' }], zhKeys: ['吃'] },
  { word: 'drink', headword: 'drink', phonetic: '/drɪŋk/', senses: [{ pos: 'v./n.', zh: '喝;饮料', en: 'take liquid into the mouth' }], zhKeys: ['喝', '饮料'] },
  { word: 'coffee', headword: 'coffee', phonetic: '/ˈkɒfi/', senses: [{ pos: 'n.', zh: '咖啡', en: 'a drink made from coffee beans' }], zhKeys: ['咖啡'] },
  { word: 'tea', headword: 'tea', phonetic: '/tiː/', senses: [{ pos: 'n.', zh: '茶', en: 'a hot drink from tea leaves' }], zhKeys: ['茶'] },
  { word: 'apple', headword: 'apple', phonetic: '/ˈæpl/', senses: [{ pos: 'n.', zh: '苹果', en: 'a round fruit' }], zhKeys: ['苹果'] },
  { word: 'bread', headword: 'bread', phonetic: '/bred/', senses: [{ pos: 'n.', zh: '面包', en: 'food made of flour and water' }], zhKeys: ['面包'] },
  { word: 'rice', headword: 'rice', phonetic: '/raɪs/', senses: [{ pos: 'n.', zh: '米;米饭', en: 'a cereal grain' }], zhKeys: ['米', '米饭'] },
  { word: 'car', headword: 'car', phonetic: '/kɑː/', senses: [{ pos: 'n.', zh: '汽车', en: 'a road vehicle' }], zhKeys: ['汽车', '车'] },
  { word: 'bus', headword: 'bus', phonetic: '/bʌs/', senses: [{ pos: 'n.', zh: '公共汽车', en: 'a large road vehicle for passengers' }], zhKeys: ['公交', '巴士'] },
  { word: 'train', headword: 'train', phonetic: '/treɪn/', senses: [{ pos: 'n./v.', zh: '火车;训练', en: 'a railway locomotive; teach' }], zhKeys: ['火车', '训练'] },
  { word: 'walk', headword: 'walk', phonetic: '/wɔːk/', senses: [{ pos: 'v./n.', zh: '走;散步', en: 'move on foot' }], zhKeys: ['走', '散步'] },
  { word: 'run', headword: 'run', phonetic: '/rʌn/', senses: [{ pos: 'v.', zh: '跑;运行', en: 'move at a speed faster than a walk' }], zhKeys: ['跑'] },
  { word: 'open', headword: 'open', phonetic: '/ˈəʊpən/', senses: [{ pos: 'v./adj.', zh: '打开;开放的', en: 'allow access; not closed' }], zhKeys: ['打开', '开'] },
  { word: 'close', headword: 'close', phonetic: '/kləʊz/', senses: [{ pos: 'v./adj.', zh: '关闭;近的', en: 'move so as to cover an opening' }], zhKeys: ['关闭', '关'] },
  { word: 'start', headword: 'start', phonetic: '/stɑːt/', senses: [{ pos: 'v./n.', zh: '开始', en: 'begin' }], zhKeys: ['开始'] },
  { word: 'finish', headword: 'finish', phonetic: '/ˈfɪnɪʃ/', senses: [{ pos: 'v.', zh: '完成;结束', en: 'bring to an end' }], zhKeys: ['完成', '结束'] },
  { word: 'today', headword: 'today', phonetic: '/təˈdeɪ/', senses: [{ pos: 'adv./n.', zh: '今天', en: 'on this present day' }], zhKeys: ['今天'] },
  { word: 'tomorrow', headword: 'tomorrow', phonetic: '/təˈmɒrəʊ/', senses: [{ pos: 'adv./n.', zh: '明天', en: 'the day after today' }], zhKeys: ['明天'] },
  { word: 'yesterday', headword: 'yesterday', phonetic: '/ˈjestədeɪ/', senses: [{ pos: 'adv./n.', zh: '昨天', en: 'the day before today' }], zhKeys: ['昨天'] },
  { word: 'week', headword: 'week', phonetic: '/wiːk/', senses: [{ pos: 'n.', zh: '星期;周', en: 'a period of seven days' }], zhKeys: ['周', '星期'] },
  { word: 'month', headword: 'month', phonetic: '/mʌnθ/', senses: [{ pos: 'n.', zh: '月', en: 'each of the twelve periods of a year' }], zhKeys: ['月', '月份'] },
  { word: 'year', headword: 'year', phonetic: '/jɪə/', senses: [{ pos: 'n.', zh: '年', en: 'a period of 365 days' }], zhKeys: ['年'] },
  { word: 'remember', headword: 'remember', phonetic: '/rɪˈmembə/', senses: [{ pos: 'v.', zh: '记得;想起', en: 'have in or be able to bring to mind' }], zhKeys: ['记得', '想起'] },
  { word: 'forget', headword: 'forget', phonetic: '/fəˈɡet/', senses: [{ pos: 'v.', zh: '忘记', en: 'fail to remember' }], zhKeys: ['忘记'] },
  { word: 'important', headword: 'important', phonetic: '/ɪmˈpɔːtnt/', senses: [{ pos: 'adj.', zh: '重要的', en: 'of great significance' }], zhKeys: ['重要'] },
  { word: 'easy', headword: 'easy', phonetic: '/ˈiːzi/', senses: [{ pos: 'adj.', zh: '容易的', en: 'achieved without great effort' }], zhKeys: ['容易', '简单'] },
  { word: 'hard', headword: 'hard', phonetic: '/hɑːd/', senses: [{ pos: 'adj./adv.', zh: '困难的;努力地', en: 'solid; with effort' }], zhKeys: ['难', '努力'] },
  { word: 'small', headword: 'small', phonetic: '/smɔːl/', senses: [{ pos: 'adj.', zh: '小的', en: 'of a size less than normal' }], zhKeys: ['小'] },
  { word: 'big', headword: 'big', phonetic: '/bɪɡ/', senses: [{ pos: 'adj.', zh: '大的', en: 'of considerable size' }], zhKeys: ['大'] },
  { word: 'new', headword: 'new', phonetic: '/njuː/', senses: [{ pos: 'adj.', zh: '新的', en: 'not existing before' }], zhKeys: ['新'] },
  { word: 'old', headword: 'old', phonetic: '/əʊld/', senses: [{ pos: 'adj.', zh: '老的;旧的', en: 'having lived a long time; not new' }], zhKeys: ['老', '旧'] },
  { word: 'dictionary', headword: 'dictionary', phonetic: '/ˈdɪkʃənri/', senses: [{ pos: 'n.', zh: '词典;字典', en: 'a book that lists words and meanings' }], zhKeys: ['词典', '字典'] },
  { word: 'language', headword: 'language', phonetic: '/ˈlæŋɡwɪdʒ/', senses: [{ pos: 'n.', zh: '语言', en: 'the method of human communication' }], zhKeys: ['语言'] },
  { word: 'english', headword: 'English', phonetic: '/ˈɪŋɡlɪʃ/', senses: [{ pos: 'n./adj.', zh: '英语;英国的', en: 'the language; of England' }], zhKeys: ['英语', '英文'] },
  { word: 'chinese', headword: 'Chinese', phonetic: '/ˌtʃaɪˈniːz/', senses: [{ pos: 'n./adj.', zh: '汉语;中国的', en: 'the language; of China' }], zhKeys: ['汉语', '中文', '中国'] },
  { word: 'nesio', headword: 'Nesio', phonetic: '/ˈniːzioʊ/', senses: [{ pos: 'n.', zh: '宝盒(本应用)', en: 'this life app (Treasure Box)' }], zhKeys: ['宝盒', '念念'] },
];

export const LEXICON_SIZE = OFFLINE_LEXICON.length;

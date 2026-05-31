import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { readFileSync } from "fs";
import path from "path";

const prisma = new PrismaClient();

const DEMO_BIO = `<p>李明德先生，1938年4月3日出生于湖南省长沙市，2023年11月18日于家中安详辞世，享年85岁。</p>
<p>李先生自1962年起执教于长沙市第一中学，历任语文教师、班主任、教研组长，直至1998年荣休，执教生涯长达36年。他以渊博学识、宽厚待人著称，培养学生逾三千人，桃李遍布海内外。退休后，他笔耕不辍，编著《湖湘方言词典》，将毕生心血付诸语言文化的保护与传承。</p>
<p>先生喜书法、好古琴，尤嗜茶道，常言"一壶好茶，可抵十年浮名"。他与妻子陈美华携手相伴六十三载，育有二子一女，含饴弄孙，晚年颐养天年。</p>`;

const DEMO_FAMILY_NOTE = `父亲走了，带走了那扇永远亮着灯的窗。每个深夜，我们仍会想起您书房里飘出的墨香，和那句"字要写好，人要做正"。您说，教育是世上最慢的事业，需要用一生去等待花开。而今，满园桃李，都是您留给世间的答案。

——子女谨上，2023年冬月`;

const EXTRA_ARTICLES = [
  {
    slug: "funeral-checklist",
    cat: "ritual",
    catLabel: "丧礼礼仪",
    title: "丧礼前48小时必做清单",
    summary: "从联系殡仪馆到通知亲友，按时间顺序整理关键事项，避免遗漏。",
    emoji: "📋",
    bgStyle: "linear-gradient(135deg,#f0f0f8,#e0e0ed)",
    body: "亲人辞世后的48小时往往最为忙乱。建议按以下顺序推进：确认死亡证明、联系殡仪馆接运、通知最亲近家属、选择遗体安置方式、初步确定丧礼形式与时间。\n\n此时不必独自承担一切，可指定一位亲属负责对外联络，另一位负责内务协调。念归处「葬礼规划」清单可逐项勾选，减少遗漏带来的二次伤害。",
    sortOrder: 10,
  },
  {
    slug: "condolence-etiquette",
    cat: "ritual",
    catLabel: "丧礼礼仪",
    title: "吊唁礼仪：什么该说，什么不该说",
    summary: "探望丧家时的言语、礼品与着装，体现尊重而非打扰。",
    emoji: "🤝",
    bgStyle: "linear-gradient(135deg,#f5f0e8,#ede0d0)",
    body: "吊唁以简短、真诚为宜。可以说「请节哀」「我们陪您一起送一程」，避免「他解脱了」「你要坚强」等可能引发抵触的表达。\n\n礼品以花圈、鲜花、礼金（帛金）为常见形式，各地习俗略有差异。着装宜素雅，避免鲜艳与喧哗。若无法到场，可通过纪念馆留言表达哀思。",
    sortOrder: 11,
  },
  {
    slug: "inheritance-basics",
    cat: "legal",
    catLabel: "身后事务",
    title: "遗产继承入门：家属需要知道的五件事",
    summary: "遗嘱、法定继承、银行账户与房产过户的基本流程概览。",
    emoji: "📜",
    bgStyle: "linear-gradient(135deg,#eef0f5,#dde0ea)",
    body: "1. 确认是否存在有效遗嘱；2. 若无遗嘱，按法定顺序继承；3. 及时办理死亡注销与银行账户查询；4. 房产、车辆等需凭公证书或法院文书过户；5. 复杂情况建议咨询专业律师。\n\n本文仅为常识介绍，不构成法律意见。各地政策差异较大，请以当地民政、公证与不动产登记部门要求为准。",
    sortOrder: 12,
  },
  {
    slug: "qingming-guide",
    cat: "memory",
    catLabel: "守护记忆",
    title: "清明祭扫：传统与现代的结合",
    summary: "扫墓、供品、线上追思如何兼顾，让远方亲人也能参与。",
    emoji: "🌿",
    bgStyle: "linear-gradient(135deg,#e8f5e8,#d0edd0)",
    body: "清明祭扫重在「慎终追远」。现场扫墓可准备鲜花、素果、清扫墓位；无法返乡的亲属，可通过视频连线共同参与，或在数字纪念馆点烛献花。\n\n建议提前确认墓园开放时间，避开高峰。祭扫后可在纪念馆更新一段追忆文字，供家族长期保存。",
    sortOrder: 13,
  },
];

const PRODUCTS = [
  { slug: "white-chrysanthemum", name: "白菊花束·思念", description: "精选白菊与配叶，适合祭奠与追思场合，同城当日达。", priceCents: 12800, listCents: 16800, category: "flower", emoji: "🌼", bgStyle: "linear-gradient(135deg,#f5f5f5,#e8e8e8)", badge: "热销", sortOrder: 0 },
  { slug: "white-wreath", name: "白色祭奠花圈", description: "直径1.2米，含挽联定制，适合灵堂与告别仪式。", priceCents: 29800, category: "flower", emoji: "💐", bgStyle: "linear-gradient(135deg,#f0f5f0,#e0ede0)", sortOrder: 1 },
  { slug: "incense-gift-box", name: "祭祀香薰礼盒", description: "天然檀香与莲花蜡烛组合，附赠礼袋与说明卡。", priceCents: 19800, listCents: 23800, category: "candle", emoji: "🕯️", bgStyle: "linear-gradient(135deg,#fdf5e8,#f5e8d0)", badge: "新品", sortOrder: 2 },
  { slug: "memorial-album", name: "精装纪念相册", description: "30页硬壳相册，可定制封面姓名与生卒年，含排版服务。", priceCents: 68800, category: "gift", emoji: "📖", bgStyle: "linear-gradient(135deg,#e8e8f5,#d8d8ed)", sortOrder: 3 },
  { slug: "memorial-tree", name: "代为种植纪念树", description: "在指定园区代为种植，附证书与坐标，环保而长久。", priceCents: 16800, category: "plant", emoji: "🌳", bgStyle: "linear-gradient(135deg,#e8f5e8,#d0edd0)", badge: "环保", sortOrder: 4 },
  { slug: "qr-plaque", name: "QR二维码铭牌", description: "不锈钢激光蚀刻，扫码直达纪念馆，户外防锈。", priceCents: 38800, category: "gift", emoji: "📱", bgStyle: "linear-gradient(135deg,#1a1a1a,#2a2a2a)", sortOrder: 5 },
  { slug: "brass-plaque", name: "黄铜典藏铭牌", description: "铸造黄铜磨砂工艺，含红木底座，适合室内供奉。", priceCents: 58800, category: "gift", emoji: "🥉", bgStyle: "linear-gradient(135deg,#8b6914,#5a4010)", sortOrder: 6 },
  { slug: "stainless-plaque", name: "经典不锈钢铭牌", description: "304不锈钢，8×5cm，附安装配件，全国包邮。", priceCents: 29800, category: "gift", emoji: "🪨", bgStyle: "linear-gradient(135deg,#c8c8c8,#888)", sortOrder: 7 },
  {
    slug: "plan-premium-year",
    name: "念归处 · 高级版会员（年付）",
    description:
      "解锁全部主题、无限照片与视频、AI 讣告助手、自定义域名与最多 3 个纪念馆。数字服务，支付后即时开通。",
    priceCents: 39900,
    category: "plan",
    emoji: "✨",
    bgStyle: "linear-gradient(135deg,#f4f3f0,#e8e6e0)",
    badge: "年付",
    sortOrder: 20,
  },
  {
    slug: "plan-lifetime",
    name: "念归处 · 终身版会员",
    description:
      "一次付费永久享有高级版全部权益，最多 5 个纪念馆、优先客服、商城 8 折与传承保障。",
    priceCents: 99900,
    category: "plan",
    emoji: "♾️",
    bgStyle: "linear-gradient(135deg,#1a1a1a,#3a3a3a)",
    badge: "终身",
    sortOrder: 21,
  },
];

async function seedMemorialContent(memorialId: string) {
  await prisma.timelineEvent.deleteMany({ where: { memorialId } });
  await prisma.familyPerson.deleteMany({ where: { memorialId } });
  await prisma.memorialMedia.deleteMany({ where: { memorialId } });

  await prisma.timelineEvent.createMany({
    data: [
      { memorialId, yearLabel: "1938年", title: "出生于湖南长沙", description: "在书香门第中成长，自幼随父习字，打下深厚国学基础", sortOrder: 0 },
      { memorialId, yearLabel: "1960年", title: "毕业于湖南师范大学", description: "中文系优秀毕业生，留校任助教一年后赴基层执教", sortOrder: 1 },
      { memorialId, yearLabel: "1962年", title: "入职长沙市第一中学", description: "开始长达36年的执教生涯，任语文教师兼班主任", sortOrder: 2 },
      { memorialId, yearLabel: "1965年", title: "与陈美华成婚", description: "相识于教师进修班，情投意合，携手白头", sortOrder: 3 },
      { memorialId, yearLabel: "1985年", title: "荣获省优秀教师称号", description: "连续三年被评为优秀班主任，培养的学生多人考入名校", sortOrder: 4 },
      { memorialId, yearLabel: "1998年", title: "荣退，开始著书立说", description: "在师生的掌声与泪水中告别讲台，投身方言文化研究", sortOrder: 5 },
      { memorialId, yearLabel: "2010年", title: "出版《湖湘方言词典》", description: "历时十二年编著完成，被列入省级非遗保护文献", sortOrder: 6 },
      { memorialId, yearLabel: "2023年", title: "安然辞世", description: "11月18日，在家人陪伴下安详离去，享年85岁", sortOrder: 7 },
    ],
  });

  await prisma.familyPerson.createMany({
    data: [
      { memorialId, groupLabel: "配偶", name: "陈美华", relation: "妻子 · 相伴63载", avatarChar: "美", sortOrder: 0 },
      { memorialId, groupLabel: "子女", name: "李建国", relation: "长子 · 工程师", avatarChar: "建", sortOrder: 1 },
      { memorialId, groupLabel: "子女", name: "李欣然", relation: "女儿 · 医师", avatarChar: "欣", sortOrder: 2 },
      { memorialId, groupLabel: "子女", name: "李平安", relation: "幼子 · 教师（传承父志）", avatarChar: "平", sortOrder: 3 },
      { memorialId, groupLabel: "孙辈", name: "李晨曦 等3人", relation: "孙辈 · 承欢膝下", avatarChar: "晨", sortOrder: 4 },
      { memorialId, groupLabel: "兄弟姐妹", name: "李义德", relation: "胞弟 · 退休工人", avatarChar: "义", sortOrder: 5 },
    ],
  });

  await prisma.memorialMedia.createMany({
    data: [
      { memorialId, caption: "1998年退休典礼 · 三千学子送别恩师", emoji: "📸", yearLabel: "1998年", sortOrder: 0 },
      { memorialId, caption: "书法作品", emoji: "🖋️", yearLabel: "2015年", sortOrder: 1 },
      { memorialId, caption: "茶道雅集", emoji: "🫖", yearLabel: "晚年", sortOrder: 2 },
      { memorialId, caption: "全家福 · 2020年春节", emoji: "👨‍👩‍👧‍👦", yearLabel: "2020年", sortOrder: 3 },
      { memorialId, caption: "《湖湘方言词典》出版", emoji: "📚", yearLabel: "2010年", sortOrder: 4 },
      { memorialId, caption: "古琴雅奏", emoji: "🎻", yearLabel: "2018年", sortOrder: 5 },
    ],
  });
}

async function seedArticles() {
  const jsonPath = path.join(process.cwd(), "public/content/articles.json");
  let fromJson: Array<{
    id: string;
    cat: string;
    catLabel: string;
    title: string;
    summary: string;
    body: string;
    emoji?: string;
    bg?: string;
  }> = [];
  try {
    fromJson = JSON.parse(readFileSync(jsonPath, "utf8")).articles || [];
  } catch {
    /* optional file */
  }

  let order = 0;
  for (const a of fromJson) {
    await prisma.article.upsert({
      where: { slug: a.id },
      create: {
        slug: a.id,
        cat: a.cat,
        catLabel: a.catLabel,
        title: a.title,
        summary: a.summary,
        body: a.body,
        emoji: a.emoji || "📖",
        bgStyle: a.bg || "linear-gradient(135deg,#e8f4f8,#d0e8f0)",
        sortOrder: order++,
      },
      update: {
        title: a.title,
        summary: a.summary,
        body: a.body,
        catLabel: a.catLabel,
      },
    });
  }

  for (const a of EXTRA_ARTICLES) {
    await prisma.article.upsert({
      where: { slug: a.slug },
      create: { ...a },
      update: {
        title: a.title,
        summary: a.summary,
        body: a.body,
      },
    });
  }
}

async function seedProducts() {
  for (const p of PRODUCTS) {
    await prisma.product.upsert({
      where: { slug: p.slug },
      create: p,
      update: {
        name: p.name,
        description: p.description,
        priceCents: p.priceCents,
        listCents: p.listCents ?? null,
        badge: p.badge ?? null,
      },
    });
  }
}

async function main() {
  const email = "demo@nianguichu.local";
  const passwordHash = await bcrypt.hash("demo-demo-demo", 12);

  const user = await prisma.user.upsert({
    where: { email },
    create: { email, passwordHash, name: "演示家属" },
    update: {},
  });

  const slug = "li-mingde";
  const memorial = await prisma.memorial.upsert({
    where: { slug },
    create: {
      slug,
      ownerId: user.id,
      name: "李明德",
      birthDate: new Date("1938-04-03"),
      deathDate: new Date("2023-11-18"),
      motto: "春蚕到死丝尽，蜡炬成灰泪始干",
      bioHtml: DEMO_BIO,
      familyNote: DEMO_FAMILY_NOTE,
      themeId: "ink-default",
      privacy: "family",
      quietMode: true,
      members: { create: { email, role: "owner" } },
      rituals: {
        create: [{ type: "蜡烛", message: "父亲，我们很想您。", author: "李欣然" }],
      },
      fragments: {
        create: [
          {
            content:
              "先生，您还记得那年我作文不及格，您在放学后单独留我，给我讲了一个下午的「文以载道」。那是我人生的转折点。",
            relation: "留言祈福",
            author: "陈建国（学生，1982届）",
            status: "approved",
          },
          {
            content: "爸爸，您走后的第一个冬天，妈妈把您的茶具摆在了窗台上，说这样看着心里踏实。",
            relation: "留言祈福",
            author: "女儿 李欣然",
            status: "approved",
          },
        ],
      },
    },
    update: {
      bioHtml: DEMO_BIO,
      familyNote: DEMO_FAMILY_NOTE,
      themeId: "ink-default",
    },
  });

  await seedMemorialContent(memorial.id);
  await seedArticles();
  await seedProducts();

  console.log("Seed OK — demo login:", email, "/ demo-demo-demo");
  console.log("Memorial slug:", slug);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

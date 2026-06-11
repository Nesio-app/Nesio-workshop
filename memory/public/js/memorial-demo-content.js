/**
 * Bilingual demo overlays for memorial slug "li-mingde" (and others later).
 * Applied when MemorialI18n.lang === "en" via MemorialContent.demoOverlay().
 */
window.MemorialDemoContent = {
  _aliases: {
    林小玲: "lin-xiaoling",
    小玲: "lin-xiaoling",
  },

  resolveSlug(slug, memorial) {
    if (this[slug]?.en) return slug;
    const name = (memorial?.name || "").trim();
    if (name && this._aliases[name]) return this._aliases[name];
    if (name && (name.includes("小玲") || name === "林小玲")) {
      return "lin-xiaoling";
    }
    return slug;
  },

  "li-mingde": {
    en: {
      name: "Li Mingde",
      motto: "The silkworm spins until death; the candle weeps until ash.",
      bioHtml: `<p>Professor Li Mingde (1942–2024) taught Chinese literature at Beijing Normal University for thirty-eight years. Students remember his worn tweed jacket, chalk-dusted hands, and the way he paused before reading a line of Du Fu — as if the poem were meeting the room for the first time.</p>
<p>He was born in Suzhou during the war years, the eldest of four. His father repaired clocks; his mother copied classical texts for neighbors. Books were scarce, so young Mingde traded errands for library cards and read by kerosene lamp until the librarians chased him home.</p>
<p>After university he refused an administrative track and stayed in the classroom. He married Chen Meihua in 1968; they raised two children and kept a small garden where he grew roses and quoted Tang poetry to the cat.</p>
<p>In retirement he digitized family letters, corrected his students' theses from memory, and walked the Summer Palace every Sunday with his wife. He passed away peacefully at home, surrounded by family, on an autumn morning in 2024.</p>
<p class="memorial-quote">"A teacher plants words; the harvest is a life lived with attention."</p>`,
      familyNote:
        "The Li family thanks every student, colleague, and friend who sent condolences. This memorial is maintained by his children Li Wei and Li Fang, with contributions from grandchildren and former pupils worldwide.",
      timeline: [
        {
          yearLabel: "1942",
          title: "Born in Suzhou",
          description: "Eldest son of a clockmaker and a copyist; childhood among canals and courtyard schools.",
        },
        {
          yearLabel: "1960",
          title: "Entered Beijing Normal University",
          description: "Studied classical Chinese; won a university poetry prize for an essay on Du Fu.",
        },
        {
          yearLabel: "1968",
          title: "Married Chen Meihua",
          description: "Wedding in a simple hall; honeymoon was a week of reading together in the Western Hills.",
        },
        {
          yearLabel: "1972",
          title: "Began teaching at BNU",
          description: "Lectured on Tang and Song poetry; known for requiring students to memorize ten lines a week.",
        },
        {
          yearLabel: "1985",
          title: "Published \"Leaves in the Courtyard\"",
          description: "A collection of essays on teaching and memory; reprinted three times.",
        },
        {
          yearLabel: "2005",
          title: "Retired, continued advising",
          description: "Office hours on the porch; digitized family archives with his daughter.",
        },
        {
          yearLabel: "2024",
          title: "Passed at home",
          description: "Held his wife's hand; last words were a line from Wang Wei about empty mountains.",
        },
      ],
      family: [
        { groupLabel: "Spouse", name: "Chen Meihua", relation: "Wife", note: "Married 56 years; gardener and nurse." },
        { groupLabel: "Children", name: "Li Wei", relation: "Son", note: "Engineer in Shenzhen; memorial administrator." },
        { groupLabel: "Children", name: "Li Fang", relation: "Daughter", note: "Archivist in Beijing; curated the photo gallery." },
        { groupLabel: "Grandchildren", name: "Li Xiaoyu", relation: "Granddaughter", note: "University student; reads poetry at gatherings." },
        { groupLabel: "Grandchildren", name: "Li Haoran", relation: "Grandson", note: "High school; restores old family photos." },
      ],
    },
  },
  "zhang-xiuying": {
    en: {
      name: "Zhang Xiuying",
      motto: "Mother's hand-rolled noodles were the finest taste in the world.",
      bioHtml:
        "<p>Ms. Zhang Xiuying (1945–2022) was born in Xiangtan, Hunan, and passed away peacefully at home in Changsha at age 77.</p><p>She raised three children alone after her husband's early death, supporting the family with work at a textile mill and a reputation for noodles that drew neighbors to her kitchen.</p><p>In later years she tended roses and told her grandchildren: \"No matter how hard the day, make the meal, hold the home.\"</p>",
      familyNote:
        "We will never forget your hands tucking us in at night. — her children",
    },
  },
  "wang-shulan": {
    en: {
      name: "Wang Shulan",
      motto: "A century of grace, at peace at last.",
      bioHtml:
        "<p>Ms. Wang Shulan (1929–2021) lived through decades of change with quiet strength. Born in Wuxi, she taught primary school in Nanjing and loved Kunqu opera and brush-journal writing.</p><p>She often told her grandchildren: \"A peaceful life is its own blessing.\"</p>",
      familyNote: "Grandmother, we will tell your stories to the next generation.",
    },
  },
  "chen-meihua": {
    en: {
      name: "Chen Meihua",
      motto: "Blossoms have their season; love does not end.",
      bioHtml:
        "<p>Ms. Chen Meihua (1940–2025) was a county nurse before marrying Professor Li Mingde. For forty years she tended a courtyard of roses in Beijing, wrapping cut stems for neighbors with handwritten care notes.</p><p>She left in spring, in blossom season, surrounded by family.</p>",
      familyNote:
        "Mother, the roses bloomed again this year—we are watering them for you.",
    },
  },
  "lin-xiaoling": {
    en: {
      name: "Lin Xiaoling",
      motto: "Pain must be heard to be cared for.",
      bioHtml: `<p>Head nurse Lin Xiaoling (1956–2026) walked the night corridor of the county hospital for forty years. Colleagues said the rhythm of her shoes was the clock patients trusted when pain could not sleep.</p>
<p>At home she still sewed school uniforms after shifts. When her daughter joked that she had already stitched a whole hospital, she laughed and said she had room for three more.</p>
<p>She passed away in the spring of 2026, in blossom season, surrounded by family. More than three thousand candles were lit on this memorial—another shift that never ends.</p>`,
      familyNote:
        "For our mother, head nurse Lin Xiaoling — we hear you still on the ward. — her children",
      timeline: [
        {
          yearLabel: "1956",
          title: "Born in Hunan",
          description: "Raised in a county town; chose nursing young.",
        },
        {
          yearLabel: "1978",
          title: "County hospital night shift",
          description: "Forty years on the corridor; mentor to new nurses.",
        },
        {
          yearLabel: "2005",
          title: "Head nurse",
          description: "Known for listening first, charting second.",
        },
        {
          yearLabel: "2026",
          title: "Passed in spring",
          description: "Family at bedside; colleagues kept vigil online.",
        },
      ],
      family: [
        {
          groupLabel: "Children",
          name: "Lin Wei",
          relation: "Son · engineer",
          avatarChar: "伟",
        },
        {
          groupLabel: "Children",
          name: "Lin Fang",
          relation: "Daughter · teacher",
          avatarChar: "芳",
        },
      ],
    },
  },
};

/**
 * Bilingual demo overlays for memorial slug "li-mingde" (and others later).
 * Applied when MemorialI18n.lang === "en" via MemorialContent.demoOverlay().
 */
window.MemorialDemoContent = {
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
};

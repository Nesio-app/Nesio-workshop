# Personal Brand Website

A **Quiet Luxury** personal site: professional portfolio (Data Scientist / CFA Candidate) and personal introduction for high-quality connections.

## Stack

- **Next.js 14** (App Router)
- **Tailwind CSS** (custom palette: cream, beige, charcoal, dusty pink)
- **Framer Motion** (subtle animations)
- **Vercel**-ready

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## AI Dictionary

Open **[http://localhost:3000/dictionary](http://localhost:3000/dictionary)** (or use the “AI Dictionary” link on the home page).

- **Look up** words/phrases: choose your native and target language (top 10 world languages), then type and hit “Look up”. You get a definition in your language, an AI-generated image, two example sentences with translations, and a casual usage note.
- **Pronunciation**: Use the play buttons next to the term and each example for natural-sounding TTS in the target language.
- **Notebook**: Save any result with “Save to Notebook”. In the Notebook you can “Make up a story” so the AI weaves your saved words into a short story to help you remember them.
- **Study**: Flashcards from your notebook—front: word + image; back: definition + example. Tap to flip.

**Setup:** Copy `.env.example` to `.env` and set `OPENAI_API_KEY` (used for definitions, images, TTS, and story generation).

## 念归处 Memorial (`memory/`)

Static memorial SPA with bilingual UI, shop/checkout, and sample memorial books. See `memory/DEPLOY-RENDER.md` for API deployment.

## Customize

1. **Hero photo**: Add your image as `public/hero.jpg` (or update `components/Hero.tsx` to use Next.js `Image` with that path).
2. **Contact email**: In `components/Contact.tsx`, replace `hello@example.com` with your email.
3. **Portfolio**: Edit the `projects` array in `components/Portfolio.tsx`.
4. **Life & Interests**: Add real images and/or update labels in `components/LifeInterests.tsx`.

## Deploy on Vercel

Push to GitHub and import the repo in [Vercel](https://vercel.com); the default build settings work as-is.

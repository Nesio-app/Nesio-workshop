import type { Question, VideoItem, LibraryItem } from './types';

// Sample CFA practice questions
export const SAMPLE_QUESTIONS: Question[] = [
  {
    id: 'q1',
    level: 'L1',
    topic: 'Ethical and Professional Standards',
    question:
      'According to the CFA Institute Code of Ethics, a member must act with integrity, competence, diligence, and respect. Which of the following best describes "integrity"?',
    options: [
      'Putting client interests before personal interests',
      'Being honest and transparent in all professional conduct',
      'Maintaining and improving professional competence',
      'Exercising reasonable care in professional activities',
    ],
    correctIndex: 1,
    explanation:
      'Integrity requires honesty and transparency in all professional conduct. The other options describe loyalty (putting client first), competence, and diligence.',
  },
  {
    id: 'q2',
    level: 'L1',
    topic: 'Quantitative Methods',
    question:
      'An investment of $10,000 earns 8% compounded annually. What is the value after 5 years?',
    options: ['$14,000', '$14,693', '$14,800', '$15,000'],
    correctIndex: 1,
    explanation: 'FV = PV × (1 + r)^n = 10,000 × (1.08)^5 ≈ $14,693.28',
  },
  {
    id: 'q3',
    level: 'L1',
    topic: 'Financial Statement Analysis',
    question:
      'Which ratio would most likely increase if a company issues long-term debt to repurchase common stock?',
    options: [
      'Current ratio',
      'Debt-to-equity ratio',
      'Interest coverage ratio',
      'Return on equity',
    ],
    correctIndex: 1,
    explanation:
      'Issuing debt and repurchasing equity increases debt and decreases equity, so D/E ratio increases.',
  },
  {
    id: 'q4',
    level: 'L1',
    topic: 'Economics',
    question:
      'In a perfectly competitive market, the long-run equilibrium occurs when:',
    options: [
      'Price equals marginal cost and average total cost',
      'Price exceeds marginal revenue',
      'Firms earn economic profits',
      'Barriers to entry prevent new firms',
    ],
    correctIndex: 0,
    explanation:
      'In long-run equilibrium, P = MC = ATC, and firms earn zero economic profit.',
  },
  {
    id: 'q5',
    level: 'L1',
    topic: 'Fixed Income',
    question:
      'A bond with a modified duration of 5 will experience approximately what percentage price change for a 100 basis point increase in yield?',
    options: ['-5%', '-0.5%', '+5%', '+0.5%'],
    correctIndex: 0,
    explanation: 'ΔP/P ≈ -Modified Duration × Δy = -5 × 1% = -5%',
  },
  {
    id: 'q6',
    level: 'L1',
    topic: 'Equity Investments',
    question:
      'Which of the following is a characteristic of preferred stock?',
    options: [
      'Voting rights typically equal to common stock',
      'Fixed dividend that must be paid',
      'Priority over common stock in liquidation',
      'No par value',
    ],
    correctIndex: 2,
    explanation:
      'Preferred stock has priority over common in liquidation. Dividends are not guaranteed; preferred typically has no voting rights.',
  },
  {
    id: 'q7',
    level: 'L1',
    topic: 'Derivatives',
    question:
      'A call option is in-the-money when:',
    options: [
      'Stock price equals strike price',
      'Stock price is below strike price',
      'Stock price is above strike price',
      'Volatility is high',
    ],
    correctIndex: 2,
    explanation: 'A call is ITM when S > K (stock price exceeds strike price).',
  },
  {
    id: 'q8',
    level: 'L1',
    topic: 'Portfolio Management',
    question:
      'The capital allocation line (CAL) represents:',
    options: [
      'Combinations of risk-free and risky assets',
      'Efficient frontier of risky assets',
      'Minimum variance portfolio',
      'Market portfolio only',
    ],
    correctIndex: 0,
    explanation: 'CAL shows all combinations of risk-free asset and risky portfolio.',
  },
];

// Sample videos (YouTube links - user can replace)
export const SAMPLE_VIDEOS: VideoItem[] = [
  {
    id: 'v1',
    title: 'CFA Level 1 - Ethical Standards Overview',
    url: 'https://www.youtube.com/embed/34DovH19ErA',
    duration: '15:30',
    topic: 'Ethical and Professional Standards',
  },
  {
    id: 'v2',
    title: 'Time Value of Money - Core Concept',
    url: 'https://www.youtube.com/embed/xQ2n15qF3k0',
    duration: '20:00',
    topic: 'Quantitative Methods',
  },
  {
    id: 'v3',
    title: 'Financial Statement Analysis - Ratios',
    url: 'https://www.youtube.com/embed/5v-tS0Hs1-k',
    duration: '25:00',
    topic: 'Financial Statement Analysis',
  },
];

// Sample library items
export const SAMPLE_LIBRARY: LibraryItem[] = [
  {
    id: 'lib1',
    title: 'Ethics Quick Reference',
    type: 'summary',
    topic: 'Ethical and Professional Standards',
    keywords: ['ethics', 'code', 'standards', 'GIPS'],
    description: 'Key ethics concepts and GIPS summary',
  },
  {
    id: 'lib2',
    title: 'TVM Formulas Cheat Sheet',
    type: 'formula',
    topic: 'Quantitative Methods',
    keywords: ['TVM', 'PV', 'FV', 'annuity', 'formula'],
    description: 'Time value of money formulas',
  },
  {
    id: 'lib3',
    title: 'Financial Ratios Summary',
    type: 'formula',
    topic: 'Financial Statement Analysis',
    keywords: ['ratio', 'liquidity', 'solvency', 'profitability'],
    description: 'Key financial ratios and interpretations',
  },
  {
    id: 'lib4',
    title: 'Bond Pricing & Duration',
    type: 'note',
    topic: 'Fixed Income',
    keywords: ['bond', 'duration', 'convexity', 'yield'],
    description: 'Fixed income valuation notes',
  },
  {
    id: 'lib5',
    title: 'CAPM & Portfolio Theory',
    type: 'formula',
    topic: 'Portfolio Management',
    keywords: ['CAPM', 'beta', 'Sharpe', 'efficient frontier'],
    description: 'Portfolio management formulas',
  },
];

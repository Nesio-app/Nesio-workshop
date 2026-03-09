'use client';

import { motion } from 'framer-motion';

const projects = [
  {
    title: 'Airbnb Price Prediction (Paris)',
    description: 'Machine learning regression project predicting short-term rental prices using structured listing data.',
    tags: ['Python', 'Machine Learning', 'Regression'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
  {
    title: 'Lending Portfolio Default Prediction',
    description: 'Classification model using historical lending data to predict loan defaults and reduce charge-off risk.',
    tags: ['Python', 'Classification', 'SQL'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
  {
    title: 'Time Series Analysis of Financial Indicators',
    description: 'Forecasting trends using ARIMA and decomposition techniques on economic or financial datasets.',
    tags: ['Python', 'ARIMA', 'Time Series'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
  {
    title: 'Customer Segmentation Using Clustering',
    description: 'Unsupervised learning project applying K-Means and hierarchical clustering to identify customer segments.',
    tags: ['Python', 'K-Means', 'Clustering'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
  {
    title: 'Text Analysis & Sentiment Classification',
    description: 'Natural language processing project analyzing customer reviews or written feedback.',
    tags: ['Python', 'NLP', 'Sentiment'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
  {
    title: 'Bob\'s Fixit Database',
    description: 'Designed a relational database from scratch, including ERD, DDL table creation, and DML data population.',
    tags: ['SQL', 'Database', 'ERD'],
    href: 'https://github.com/hanbing6228/DS_Profolio',
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
};

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

export default function Portfolio() {
  return (
    <section id="work" className="px-6 py-20 lg:py-28 lg:px-16 xl:px-24 bg-beige/30 scroll-mt-20">
      <motion.h2
        className="font-serif text-3xl sm:text-4xl text-charcoal mb-4"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        Work & Projects
      </motion.h2>
      <motion.p
        className="font-sans text-charcoal-light text-lg mb-14 max-w-2xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.05 }}
      >
        Data science and analytics projects—from ML regression to NLP and database design.
      </motion.p>
      <motion.div
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl"
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
      >
        {projects.map((p, i) => (
          <motion.article
            key={i}
            variants={item}
            className="group p-8 rounded-sm border border-beige-dark/50 bg-cream shadow-sm hover:border-fidelity-blue/40 hover:shadow-md transition-all duration-300"
          >
            <h3 className="font-serif text-xl text-charcoal mb-3 group-hover:text-fidelity-blue transition-colors">
              {p.title}
            </h3>
            <p className="font-sans text-charcoal-light text-sm leading-relaxed mb-5">
              {p.description}
            </p>
            <div className="flex flex-wrap gap-2 mb-4">
              {p.tags.map((tag) => (
                <span
                  key={tag}
                  className="px-3 py-1 text-xs font-sans bg-beige text-charcoal-light rounded-full border border-beige-dark/50"
                >
                  {tag}
                </span>
              ))}
            </div>
            {p.href && (
              <a
                href={p.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 font-sans text-sm font-semibold text-fidelity-blue hover:text-fidelity-blue/80 transition-colors"
              >
                View on GitHub →
              </a>
            )}
          </motion.article>
        ))}
      </motion.div>
    </section>
  );
}

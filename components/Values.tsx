'use client';

import { motion } from 'framer-motion';

const values = [
  {
    title: 'Consistency & Emotional Maturity',
    description: 'I value stability over drama. Clear communication, follow-through, and a calm approach to life.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16m-7 6h7" />
      </svg>
    ),
  },
  {
    title: 'Growth Mindset',
    description: 'Seeking a teammate, not a savior. I believe we grow together through shared goals and mutual support.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
      </svg>
    ),
  },
  {
    title: 'Authentic Connection',
    description: 'Deep conversations over small talk. I’m drawn to curiosity, honesty, and genuine connection.',
    icon: (
      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
  },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12 },
  },
};

const card = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0 },
};

export default function Values() {
  return (
    <section className="px-6 py-20 lg:py-28 lg:px-16 xl:px-24 bg-cream">
      <motion.h2
        className="font-serif text-3xl sm:text-4xl text-charcoal mb-4"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        What I Value
      </motion.h2>
      <motion.p
        className="font-sans text-charcoal-light text-lg mb-14 max-w-2xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.05 }}
      >
        Life philosophy—what I look for in work and in connection.
      </motion.p>
      <motion.div
        className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 max-w-6xl"
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
      >
        {values.map((v, i) => (
          <motion.article
            key={i}
            variants={card}
            className="p-8 rounded-sm border border-beige-dark/50 bg-white/60 shadow-sm hover:shadow-md hover:border-dusty-pink/30 transition-all duration-300"
          >
            <div className="text-dusty-pink-dark mb-5">{v.icon}</div>
            <h3 className="font-serif text-xl text-charcoal mb-3">{v.title}</h3>
            <p className="font-sans text-charcoal-light leading-relaxed">{v.description}</p>
          </motion.article>
        ))}
      </motion.div>
    </section>
  );
}

'use client';

import { motion } from 'framer-motion';

export default function About() {
  return (
    <section id="about" className="px-6 py-20 lg:py-28 lg:px-16 xl:px-24 bg-beige/40 scroll-mt-20">
      <div className="max-w-4xl mx-auto">
        <motion.h2
          className="font-serif text-3xl sm:text-4xl text-charcoal mb-10"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.5 }}
        >
          About Me
        </motion.h2>
        <motion.div
          className="space-y-6 font-sans text-charcoal-light text-lg leading-relaxed"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-60px' }}
          transition={{ duration: 0.5, delay: 0.1 }}
        >
          <p>
            I am a <strong className="text-charcoal">System Analyst at Fidelity</strong> with a background in Software Engineering. Currently, I am pursuing my <strong className="text-charcoal">Master&apos;s in Data Science</strong> at Bellevue University. In 2024, I completed the <strong className="text-charcoal">Yale School of Management Women&apos;s Leadership Program</strong>.
          </p>
          <p>
            Beyond data, I am a passionate gardener of <strong className="text-charcoal">David Austin roses</strong> and enjoy time with my Cavalier King Charles Spaniel, <strong className="text-charcoal">Maple</strong>. I bring a rational mind and a warm heart to every challenge—a problem solver by profession and by nature.
          </p>
        </motion.div>
      </div>
    </section>
  );
}

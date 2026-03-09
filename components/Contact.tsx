'use client';

import { motion } from 'framer-motion';
import { Github } from 'lucide-react';

export default function Contact() {
  return (
    <section id="contact" className="px-6 py-20 lg:py-28 lg:px-16 xl:px-24 bg-beige/50 scroll-mt-20">
      <div className="max-w-2xl mx-auto text-center">
        <motion.h2
          className="font-serif text-3xl sm:text-4xl text-charcoal mb-4"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          Contact
        </motion.h2>
        <motion.div
          className="font-sans text-charcoal-light text-lg space-y-3"
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.05 }}
        >
          <p><strong className="text-charcoal">Location:</strong> North Carolina</p>
          <p>
            <strong className="text-charcoal">GitHub:</strong>{' '}
            <a href="https://github.com/hanbing6228" target="_blank" rel="noopener noreferrer" className="text-fidelity-blue hover:underline">
              hanbing6228
            </a>
          </p>
          <p><strong className="text-charcoal">Current Role:</strong> Bellevue University</p>
        </motion.div>
        <motion.a
          href="https://github.com/hanbing6228"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 mt-8 px-6 py-3 font-sans text-cream bg-charcoal hover:bg-charcoal-light rounded-sm transition-colors duration-200"
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
        >
          <Github className="w-5 h-5" /> View GitHub Profile
        </motion.a>
      </div>
    </section>
  );
}

'use client';

import { motion } from 'framer-motion';

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.12, delayChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0 },
};

export default function Hero() {
  return (
    <section className="min-h-[90vh] flex flex-col lg:flex-row lg:min-h-[85vh]">
      <motion.div
        className="flex-1 flex flex-col justify-center px-6 py-16 lg:py-24 lg:pl-16 lg:pr-12 xl:pl-24"
        variants={container}
        initial="hidden"
        animate="show"
      >
        <motion.h1
          className="font-serif text-4xl sm:text-5xl lg:text-6xl xl:text-7xl text-charcoal leading-tight tracking-tight"
          variants={item}
        >
          Jing Duan
        </motion.h1>
        <motion.p
          className="mt-6 font-sans text-lg sm:text-xl text-fidelity-blue font-semibold max-w-xl"
          variants={item}
        >
          System Analyst & Data Scientist
        </motion.p>
        <motion.p
          className="mt-4 font-sans text-lg text-charcoal-light max-w-xl"
          variants={item}
        >
          Bridging Systems and Insights at Fidelity
        </motion.p>
        <motion.p
          className="mt-8 text-beige-dark font-sans text-base max-w-lg"
          variants={item}
        >
          Rational optimist. Old soul. Multifunctional woman.
        </motion.p>
      </motion.div>
      <motion.div
        className="flex-1 relative min-h-[50vh] lg:min-h-[85vh] bg-beige/60 flex items-center justify-center overflow-hidden"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8, delay: 0.4 }}
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="relative w-full max-w-md aspect-[3/4] mx-8 lg:mx-12 rounded-sm shadow-lg overflow-hidden bg-beige-dark/30 flex items-center justify-center">
            <span className="text-charcoal-light/70 font-sans text-center px-6 text-sm">
              Your photo here
              <br />
              <small className="opacity-80">Add hero.jpg to /public</small>
            </span>
          </div>
        </div>
        <div className="absolute bottom-4 right-4 lg:bottom-8 lg:right-8 w-24 h-24 rounded-full border-2 border-fidelity-blue/30 bg-fidelity-blue/10" />
      </motion.div>
    </section>
  );
}

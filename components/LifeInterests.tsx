'use client';

import { motion } from 'framer-motion';

const interests = [
  { label: 'David Austin Roses', caption: 'Passionate gardener', placeholder: 'roses' },
  { label: 'Maple', caption: 'My Cavalier King Charles Spaniel', placeholder: 'dog' },
  { label: 'Reading', caption: 'Philosophy & history', placeholder: 'books' },
  { label: 'Hiking & Running', caption: '10km and beyond', placeholder: 'nature' },
];

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const card = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0 },
};

function InterestCard({
  label,
  caption,
  placeholder,
  index,
}: {
  label: string;
  caption: string;
  placeholder: string;
  index: number;
}) {
  const heights = ['h-64', 'h-56', 'h-72', 'h-52'];
  const h = heights[index % heights.length];
  return (
    <motion.div
      variants={card}
      className={`relative rounded-sm overflow-hidden border border-beige-dark/40 bg-beige-dark/20 ${h} min-h-[200px] group`}
    >
      <div className="absolute inset-0 bg-gradient-to-t from-charcoal/70 via-charcoal/20 to-transparent z-10 flex flex-col justify-end p-5">
        <span className="font-serif text-cream text-lg">{label}</span>
        <span className="font-sans text-cream/90 text-sm">{caption}</span>
      </div>
      <div className="absolute inset-0 flex items-center justify-center text-charcoal-light/30 font-sans text-sm">
        {placeholder}
      </div>
    </motion.div>
  );
}

export default function LifeInterests() {
  return (
    <section className="px-6 py-20 lg:py-28 lg:px-16 xl:px-24 bg-cream">
      <motion.h2
        className="font-serif text-3xl sm:text-4xl text-charcoal mb-4"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
      >
        Life & Interests
      </motion.h2>
      <motion.p
        className="font-sans text-charcoal-light text-lg mb-14 max-w-2xl"
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ delay: 0.05 }}
      >
        Finding order in chaos, and joy in discipline.
      </motion.p>
      <motion.div
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-6xl"
        variants={container}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: '-60px' }}
      >
        {interests.map((item, i) => (
          <InterestCard
            key={item.label}
            label={item.label}
            caption={item.caption}
            placeholder={item.placeholder}
            index={i}
          />
        ))}
      </motion.div>
    </section>
  );
}

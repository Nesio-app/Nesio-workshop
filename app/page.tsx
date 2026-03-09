import About from '@/components/About';
import Portfolio from '@/components/Portfolio';
import Contact from '@/components/Contact';

export default function Home() {
  return (
    <main className="min-h-screen">
      <nav className="fixed top-0 left-0 right-0 z-20 bg-cream/95 backdrop-blur-sm border-b border-beige-dark/30">
        <div className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center">
          <a href="#" className="font-serif text-lg text-charcoal hover:text-fidelity-blue transition-colors">
            Jing Duan
          </a>
          <div className="flex gap-6">
            <a href="#about" className="font-sans text-sm text-charcoal-light hover:text-fidelity-blue transition-colors">
              About
            </a>
            <a href="#work" className="font-sans text-sm text-charcoal-light hover:text-fidelity-blue transition-colors">
              Work
            </a>
            <a href="#contact" className="font-sans text-sm text-charcoal-light hover:text-fidelity-blue transition-colors">
              Contact
            </a>
            <a
              href="https://github.com/hanbing6228/DS_Profolio"
              target="_blank"
              rel="noopener noreferrer"
              className="font-sans text-sm text-fidelity-blue hover:text-fidelity-blue/80 font-medium"
            >
              GitHub →
            </a>
          </div>
        </div>
      </nav>

      <header className="pt-32 pb-20 px-6 lg:px-16 xl:px-24">
        <div className="max-w-4xl">
          <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-charcoal leading-tight tracking-tight">
            System Analyst & Data Scientist
          </h1>
          <p className="mt-6 font-sans text-xl text-fidelity-blue font-semibold">
            Bridging Systems and Insights at Fidelity
          </p>
          <p className="mt-4 font-sans text-lg text-charcoal-light max-w-2xl">
            Turning complex data into actionable insights. Master&apos;s in Data Science · Yale SOM Women&apos;s Leadership Program
          </p>
        </div>
      </header>

      <About />
      <Portfolio />
      <Contact />

      <footer className="py-8 text-center font-sans text-sm text-charcoal-light border-t border-beige-dark/30">
        © 2026 Jing Duan. Professional Portfolio.
      </footer>
    </main>
  );
}

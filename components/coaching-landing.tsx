import { ArrowDown, ArrowRight, AudioLines, Compass, Orbit, Sparkles, Target } from "lucide-react";
import { AIPresence } from "./ai-presence";

// Nav links: scroll to the section (phone/small windows) and, on the single-screen desktop/iPad layout
// where everything is already visible, move focus there and briefly highlight it so the click is meaningful.
const goToSection = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  target.focus({ preventScroll: true });
  target.classList.remove("is-highlighted");
  void target.offsetWidth;
  target.classList.add("is-highlighted");
  window.setTimeout(() => target.classList.remove("is-highlighted"), 1800);
};

export function CoachingLanding({ onStart, coachGender, onCoachChange }: { onStart: () => void; coachGender: "male" | "female"; onCoachChange: (gender: "male" | "female") => void }) {
  return (
    <div className="future-cover">
      <header className="future-header">
        <a href="#" className="future-brand" title="Agentic Coach home"><Orbit size={30} strokeWidth={1.2} aria-hidden="true" /><span>agentic{" "}<span className="brand-light" style={{ marginLeft: 0 }}>coach</span><small>HUMAN POTENTIAL. AMPLIFIED.</small></span></a>
        {/* Primary navigation */}
        <nav aria-label="Main navigation"><a href="#experience" onClick={(event) => goToSection(event, "experience")}>The experience</a><a href="#approach" onClick={(event) => goToSection(event, "approach")}>Our approach</a></nav>
        <button className="future-nav-cta" onClick={onStart}>Enter your studio <ArrowRight size={15} /></button>
      </header>
      <section className="future-hero" aria-labelledby="hero-heading">
        <div className="future-hero-copy">
          <div className="future-eyebrow"><span /> THE NEXT GENERATION OF LEADERSHIP COACHING</div>
          <h1 id="hero-heading">Extraordinary<br />leadership.<br /><em>Starts within.</em></h1>
          <p>A clearer mind. A bolder next move. Meet the AI thinking partner that turns reflection into meaningful action.</p>
          <div className="future-hero-actions"><button className="future-primary" onClick={onStart}>Start your coaching journey <ArrowRight size={18} /></button><a href="#experience" className="future-text-link" onClick={(event) => goToSection(event, "experience")}>Explore the experience <ArrowDown size={15} /></a></div>
          <div className="future-detail"><AudioLines size={16} /><span>Voice or text</span><span className="future-divider" /><span>Your pace. Your potential.</span></div>
        </div>
        <div className="future-hero-art">
          <div className="future-art-grid" />
          <div className="future-orbit-label"><span className="future-live-dot" /> INTELLIGENCE WITH INTENTION</div>
          <AIPresence variant={coachGender} />
          <div className="human-coach-options" aria-label="Choose your coach">
            <button type="button" aria-pressed={coachGender === "male"} onClick={() => onCoachChange("male")}>Male coach</button>
            <button type="button" aria-pressed={coachGender === "female"} onClick={() => onCoachChange("female")}>Female coach</button>
          </div>
          <div className="future-art-coordinate">01 / REFLECT · REFRAME · GROW</div>
          <div className="future-thought"><span className="future-thought-icon"><Sparkles size={18} /></span><div><small>A DIFFERENT KIND OF CONVERSATION</small><p>“What would change if you trusted<br />yourself to take the next step?”</p></div></div>
        </div>
      </section>
      <section className="future-proof" id="approach" tabIndex={-1}><span>ADVANCED AI.<br /><strong>DEEPLY HUMAN FOUNDATIONS.</strong></span><p>Built on <strong>10,000+ hours</strong> of executive coaching experience</p><p>Globally informed.<br /><strong>Rooted in the Gulf.</strong></p><p>Reflection that moves you.<br /><strong>Action that stays with you.</strong></p></section>
      <section className="future-experience" id="experience" tabIndex={-1}>
        <div className="future-section-heading"><div><span className="future-eyebrow">THE COACHING EXPERIENCE</span><h2>More than a conversation.<br /><em>A catalyst for your next chapter.</em></h2></div><p>A space to pause, see things differently,<br />and move forward with intention.</p></div>
        <div className="future-feature-grid">
          <article><div className="future-feature-top"><AudioLines /><span>01 / CONNECT</span></div><h3>Think out loud.</h3><p>Speak naturally or take your time in text. Choose a coach voice and bring what matters to you.</p><button onClick={onStart}>Meet your AI coach <ArrowRight size={16} /></button></article>
          <article><div className="future-feature-top"><Compass /><span>02 / DISCOVER</span></div><h3>See a new possibility.</h3><p>Explore your leadership, communication, and influence through a focused coaching dialogue.</p><button onClick={onStart}>Find your focus <ArrowRight size={16} /></button></article>
          <article><div className="future-feature-top"><Target /><span>03 / ACT</span></div><h3>Make growth tangible.</h3><p>Turn insight into an action plan. Keep your next steps together in your personal Action Hub.</p><button onClick={onStart}>Shape your next step <ArrowRight size={16} /></button></article>
        </div>
      </section>
      <footer className="future-footer"><span>agentic coach</span><p>World-class leadership. Locally rooted.</p><span>POWERED BY POSSIBILITY <Sparkles size={14} /></span></footer>
    </div>
  );
}

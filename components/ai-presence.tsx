import Image from "next/image";

type AIPresenceProps = { active?: boolean; speaking?: boolean; compact?: boolean; variant?: "male" | "female" };

export function AIPresence({ active = false, speaking = false, compact = false, variant = "male" }: AIPresenceProps) {
  const female = variant === "female";
  return (
    <div className={`human-presence ${compact ? "human-presence--compact" : ""} ${speaking && active ? "is-speaking" : ""} human-presence--${variant}`}>
      <div className="human-portrait">
        <Image src={female ? "/u-1698499352020-521e54040e04.jpg" : "/pexels-8837558.jpg"} alt={`${female ? "Female" : "Male"} AI coach portrait`} fill sizes={compact ? "180px" : "(max-width: 720px) 80vw, 360px"} priority={!compact} />
        <div className="human-portrait-shade" />
        <span className="human-ai-label">AI COACH</span>
        <div className="human-caption"><span>{female ? "Female" : "Male"} coach</span><small>{active ? speaking ? "Responding to you" : "Session in progress" : "Your thinking partner"}</small></div>
        {active ? <div className="human-signal" aria-hidden="true"><i /><i /><i /><i /><i /></div> : null}
      </div>
    </div>
  );
}

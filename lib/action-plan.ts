// Shared (client + server) helpers for the end-of-session action plan:
// - resolving due dates ("next Friday", "within a week", "20 Nov") against today in Europe/London,
// - normalising the structured plan returned by the chat API (safety signposting is never a plan item),
// - building a standards-compliant .ics calendar file (VTIMEZONE Europe/London, VEVENT + VALARM),
// - Google Calendar "add event" links and recipient email validation.
// Pure functions only (no Node or browser APIs beyond Intl), so tests can import this file directly.

export type PlanItem = {
  id: string;
  activity: string;
  /** Agreed due date, YYYY-MM-DD (Europe/London calendar date). null = not agreed yet. */
  dueDate: string | null;
  /** Optional local start time, HH:MM (24h, Europe/London). */
  time: string | null;
  /** Optional duration in minutes (used with time). */
  durationMinutes: number | null;
  /** The wording the date came from, e.g. "next Friday" (for display/debug). */
  dateText?: string;
};

export const PLAN_TIME_ZONE = "Europe/London";
export const MAX_PLAN_ITEMS = 6;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------- dates ----------

const isoFromUtcMs = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const utcMsFromIso = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));

export const isIsoDate = (value: unknown): value is string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = utcMsFromIso(value);
  return !Number.isNaN(ms) && isoFromUtcMs(ms) === value;
};

/** Today's calendar date in Europe/London, YYYY-MM-DD. */
export const londonToday = (now: Date = new Date()): string => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: PLAN_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
};

export const addDays = (iso: string, days: number) => isoFromUtcMs(utcMsFromIso(iso) + days * DAY_MS);

const weekdayIndex = (iso: string) => new Date(utcMsFromIso(iso)).getUTCDay(); // 0 = Sunday

const addMonthsClamped = (iso: string, months: number) => {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + months;
  const day = Number(iso.slice(8, 10));
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoFromUtcMs(Date.UTC(year, month, Math.min(day, lastDay)));
};

const endOfMonth = (iso: string, monthOffset = 0) => {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7)) - 1 + monthOffset;
  return isoFromUtcMs(Date.UTC(year, month + 1, 0));
};

/** Monday of the Mon-Sun week containing iso. */
const mondayOf = (iso: string) => addDays(iso, -((weekdayIndex(iso) + 6) % 7));

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_RE = "(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?";
const weekdayFromToken = (token: string) => WEEKDAYS.findIndex((name) => name.startsWith(token.slice(0, 3)));

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*";

const NUMBER_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fourteen: 14, "a couple of": 2, "a few": 3, couple: 2, few: 3
};
const NUM_RE = "(\\d{1,3}|a couple of|a few|an|a|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fourteen)";
const toNumber = (token: string) => (/^\d+$/.test(token) ? Number(token) : NUMBER_WORDS[token] ?? NaN);

const buildDate = (year: number, monthIndex: number, day: number) => {
  const ms = Date.UTC(year, monthIndex, day);
  const iso = isoFromUtcMs(ms);
  return Number(iso.slice(8, 10)) === day ? iso : null; // rejects 31 Feb etc.
};

/** Next date on or after `today` with the given month/day (rolls to next year if already past). */
const upcomingMonthDay = (today: string, monthIndex: number, day: number, year?: number) => {
  const thisYear = Number(today.slice(0, 4));
  if (year) return buildDate(year, monthIndex, day);
  const candidate = buildDate(thisYear, monthIndex, day);
  if (!candidate) return null;
  return candidate >= today ? candidate : buildDate(thisYear + 1, monthIndex, day);
};

/**
 * Resolves wording like "today", "tomorrow", "next Friday", "within a week", "in 2 weeks", "end of the month",
 * "20 November", "Nov 20th" or "20/11" to a YYYY-MM-DD date, relative to `today` (a Europe/London date).
 * Conventions: weeks run Monday-Sunday. "Friday"/"by Friday"/"this Friday" = the next Friday on or after today.
 * "next Friday" = the Friday of next week. "end of the week" = this week's Friday (next week's if already past).
 * "next week" = Monday of next week. Returns null when no date can be read.
 */
export const resolveDueDate = (text: string, today: string): string | null => {
  if (!text || !isIsoDate(today)) return null;
  const t = ` ${String(text).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[,.]/g, " ").replace(/\s+/g, " ")} `;

  const iso = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso && isIsoDate(`${iso[1]}-${iso[2]}-${iso[3]}`)) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const dayMonth = t.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}(?:\\s+(\\d{4}))?\\b`));
  if (dayMonth) {
    const resolved = upcomingMonthDay(today, MONTHS.indexOf(dayMonth[2].slice(0, 3)), Number(dayMonth[1]), dayMonth[3] ? Number(dayMonth[3]) : undefined);
    if (resolved) return resolved;
  }
  const monthDay = t.match(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s+(\\d{4}))?`));
  if (monthDay) {
    const resolved = upcomingMonthDay(today, MONTHS.indexOf(monthDay[1].slice(0, 3)), Number(monthDay[2]), monthDay[3] ? Number(monthDay[3]) : undefined);
    if (resolved) return resolved;
  }
  const numeric = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/); // UK day/month
  if (numeric) {
    const year = numeric[3] ? Number(numeric[3].length === 2 ? `20${numeric[3]}` : numeric[3]) : undefined;
    const resolved = upcomingMonthDay(today, Number(numeric[2]) - 1, Number(numeric[1]), year);
    if (resolved) return resolved;
  }

  if (/\b(day after tomorrow)\b/.test(t)) return addDays(today, 2);
  if (/\b(tomorrow|tmrw)\b/.test(t)) return addDays(today, 1);
  if (/\b(today|tonight|this (morning|afternoon|evening)|end of (the )?day|eod)\b/.test(t)) return today;

  const span = t.match(
    new RegExp(`\\b(?:(?:within|in|over)(?: the next)?|(?:the )?next) ${NUM_RE}\\s+(hours?|hrs?|days?|weeks?|months?)\\b`)
  );
  if (span) {
    const n = toNumber(span[1]);
    const unit = span[2];
    if (!Number.isNaN(n)) {
      if (unit.startsWith("h")) return n <= 12 ? today : addDays(today, Math.ceil(n / 24));
      if (unit.startsWith("d")) return addDays(today, n);
      if (unit.startsWith("w")) return addDays(today, 7 * n);
      if (unit.startsWith("m")) return addMonthsClamped(today, n);
    }
  }
  if (/\b(within|in) (a|one) fortnight\b|\bfortnight\b/.test(t)) return addDays(today, 14);
  if (/\b(?:within|in|over) the next week\b/.test(t)) return addDays(today, 7);
  if (/\b(?:within|in|over) the next month\b/.test(t)) return addMonthsClamped(today, 1);
  if (/\b(?:within|in|over) the next (few|couple of) days\b|\bnext few days\b/.test(t)) return addDays(today, 3);

  const nextWeekday = t.match(new RegExp(`\\bnext ${WEEKDAY_RE}\\b`));
  if (nextWeekday) {
    const target = weekdayFromToken(nextWeekday[1]);
    return addDays(mondayOf(today), 7 + ((target + 6) % 7));
  }
  if (/\bend of next week\b/.test(t)) return addDays(mondayOf(today), 7 + 4);
  if (/\b(end of (the |this )?week|this week|by the weekend|end of the working week)\b/.test(t)) {
    const friday = addDays(mondayOf(today), 4);
    return friday >= today ? friday : addDays(friday, 7);
  }
  if (/\bnext week\b/.test(t)) return addDays(mondayOf(today), 7);
  if (/\bend of next month\b/.test(t)) return endOfMonth(today, 1);
  if (/\b(end of (the |this )?month|this month)\b/.test(t)) return endOfMonth(today, 0);
  if (/\bnext month\b/.test(t)) return addMonthsClamped(today, 1);

  const weekday = t.match(new RegExp(`\\b(?:(?:by|on|this|before|until|till|coming) )?${WEEKDAY_RE}\\b`));
  if (weekday) {
    const target = weekdayFromToken(weekday[1]);
    if (target >= 0) return addDays(today, (target - weekdayIndex(today) + 7) % 7);
  }
  return null;
};

/** "at 9am", "9:30", "14:00", "3 pm", "noon" -> "HH:MM" (24h), else null. */
export const parseTimeOfDay = (text: string): string | null => {
  const t = String(text ?? "").toLowerCase();
  if (/\b(noon|midday)\b/.test(t)) return "12:00";
  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ampm) {
    let hour = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") hour += 12;
    const minute = Number(ampm[2] ?? 0);
    if (hour < 24 && minute < 60) return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  }
  const h24 = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (h24) return `${h24[1].padStart(2, "0")}:${h24[2]}`;
  return null;
};

/** "30 minutes", "1 hour", "half an hour", "90 mins" -> minutes, else null. */
export const parseDurationMinutes = (text: string): number | null => {
  const t = String(text ?? "").toLowerCase();
  if (/\bhalf an hour\b/.test(t)) return 30;
  const minutes = t.match(/\b(\d{1,3})\s*(?:-\s*)?(?:min|mins|minutes?)\b/);
  if (minutes) return Number(minutes[1]);
  const hours = t.match(/\b(\d{1,2}(?:\.\d)?|an|a|one|two|three)\s*(?:-\s*)?(?:hours?|hrs?)\b/);
  if (hours) {
    const n = /^\d/.test(hours[1]) ? Number(hours[1]) : toNumber(hours[1]);
    if (!Number.isNaN(n)) return Math.round(n * 60);
  }
  return null;
};

const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// ---------- plan items ----------

/** Crisis / HR / medical signposting is never a coaching action. */
export const isSafetySignpostingText = (text: string) =>
  /\b(samaritans|116 ?123|999|nhs ?111|a&e|acas|0300 ?123 ?1100|85258|shout|whistle-?blow\w*|speak-?up line|employee assistance|eap|gp|crisis line|people team|formal grievance|grievance|occupational health|a manager you trust)\b/i.test(
    text
  ) ||
  /\b(raise|report|refer|escalate|log|file)\b[^.]{0,40}\b(hr|human resources|people team)\b/i.test(text) ||
  /\b(hr|human resources|people team)\b[^.]{0,30}\b(grievance|complaint|referral)\b/i.test(text);

const cleanActivity = (raw: string) =>
  String(raw ?? "")
    .replace(/\*\*|__|`/g, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "")
    .replace(/,?\s*owner\s*:\s*[^,;]+/i, "")
    .replace(/[,;]?\s*(?:timeline|due|when|by when|deadline)\s*:\s*.+$/i, "")
    .replace(/\s+/g, " ")
    .replace(/[\s,;:.-]+$/, "")
    .trim()
    .slice(0, 200);

/**
 * Validates and normalises plan items from the chat API (LLM JSON) or any untrusted source:
 * cleans the activity text, keeps a valid due date (not in the past) or resolves one from the date wording,
 * reads time/duration, drops safety signposting, de-duplicates and caps the list.
 */
export const normalisePlanItems = (raw: unknown, today: string): PlanItem[] => {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const items: PlanItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const rawActivity = String(record.activity ?? record.action ?? record.title ?? "");
    const activity = cleanActivity(rawActivity);
    if (activity.length < 3 || isSafetySignpostingText(activity)) continue;
    const key = activity.toLowerCase();
    if (seen.has(key)) continue;
    const dateText = String(record.dateText ?? record.timeline ?? record.when ?? "").trim().slice(0, 80);
    // The date wording is resolved deterministically first (models often miscount weekdays), then a valid
    // ISO date from the source, then any date mentioned in the activity itself. Past dates are dropped.
    const llmDate = isIsoDate(record.dueDate) && (record.dueDate as string) >= today ? (record.dueDate as string) : null;
    const fromText = resolveDueDate(dateText, today);
    let dueDate = fromText ?? llmDate ?? resolveDueDate(rawActivity, today);
    if (dueDate && dueDate < today) dueDate = null;
    const time = isTime(record.time) ? (record.time as string) : parseTimeOfDay(dateText);
    const rawDuration = Number(record.durationMinutes ?? record.duration);
    const durationMinutes =
      Number.isFinite(rawDuration) && rawDuration >= 5 && rawDuration <= 480
        ? Math.round(rawDuration)
        : [parseDurationMinutes(dateText), parseDurationMinutes(rawActivity)].find(
            (minutes): minutes is number => typeof minutes === "number" && minutes >= 5 && minutes <= 480
          ) ?? null;
    seen.add(key);
    items.push({ id: `a${items.length + 1}`, activity, dueDate, time, durationMinutes, ...(dateText ? { dateText } : {}) });
    if (items.length >= MAX_PLAN_ITEMS) break;
  }
  return items;
};

/** Fallback: read the "## Focus Plan" bullets of a plan reply ("..., owner: you, timeline: next Friday"). */
export const extractPlanItemsFromPlanText = (text: string, today: string): PlanItem[] => {
  const source = String(text ?? "");
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^#{1,6}\s*(?:focus plan|action plan|your plan)\b/i.test(line));
  // Only the plan section counts: bullets elsewhere (e.g. signposting in a safety reply) are never actions.
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#{1,6}\s/.test(line));
  const body = (end >= 0 ? rest.slice(0, end) : rest).join("\n");
  const bullets = body
    .split("\n")
    .filter((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line))
    .map((line) => {
      const timeline = line.match(/(?:timeline|due|by when|deadline|when)\s*:\s*(.+)$/i)?.[1] ?? line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, "");
      return { activity: line, dateText: timeline.replace(/\*\*/g, "").trim() };
    });
  return normalisePlanItems(bullets, today);
};

// ---------- display ----------

export const formatDueDate = (iso: string | null): string => {
  if (!iso || !isIsoDate(iso)) return "No date yet";
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(utcMsFromIso(iso))
  );
};

// ---------- calendar (.ics) ----------

const escapeIcsText = (value: string) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const utf8Length = (value: string) => {
  let length = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
};

/** RFC 5545 line folding: lines longer than 75 octets continue on the next line after a single space. */
const foldLine = (line: string) => {
  const out: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (utf8Length(current + char) > limit) {
      out.push(current);
      current = " " + char;
      limit = 75;
    } else {
      current += char;
    }
  }
  out.push(current);
  return out.join("\r\n");
};

const icsUtcStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const icsDate = (iso: string) => iso.replace(/-/g, "");

/** Adds minutes to a local wall-clock date/time and returns ICS local form YYYYMMDDTHHMMSS. */
const localPlusMinutes = (iso: string, time: string, minutes: number) => {
  const ms = utcMsFromIso(iso) + (Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes) * 60000;
  return new Date(ms).toISOString().slice(0, 19).replace(/[-:]/g, "");
};

const LONDON_VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/London",
  "X-LIC-LOCATION:Europe/London",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0000",
  "TZOFFSETTO:+0100",
  "TZNAME:BST",
  "DTSTART:19700329T010000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0000",
  "TZNAME:GMT",
  "DTSTART:19701025T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE"
];

const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

export type IcsOptions = { now?: Date; method?: "PUBLISH" | "REQUEST"; attendeeEmail?: string; attendeeName?: string };

/**
 * Builds an RFC 5545 calendar with one VEVENT (+ VALARM reminder) per dated item.
 * Timed items: DTSTART/DTEND in Europe/London (default 30 minutes), reminder 30 minutes before.
 * Undated items are skipped. Date-only items: all-day event on the due date, reminder at 09:00 the day before.
 */
export const buildPlanIcs = (items: PlanItem[], options: IcsOptions = {}): string => {
  const now = options.now ?? new Date();
  const dated = items.filter((item) => item.dueDate && isIsoDate(item.dueDate) && item.activity.trim());
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Agentic Coach//Action Plan//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${options.method ?? "PUBLISH"}`,
    "X-WR-CALNAME:Agentic Coach actions",
    "X-WR-TIMEZONE:Europe/London",
    ...LONDON_VTIMEZONE
  ];
  for (const item of dated) {
    const due = item.dueDate as string;
    const summary = `Coaching action: ${item.activity}`;
    lines.push(
      "BEGIN:VEVENT",
      `UID:${stableHash(`${item.activity}|${due}|${item.time ?? ""}`)}-${icsDate(due)}@agentic-coach`,
      `DTSTAMP:${icsUtcStamp(now)}`
    );
    if (item.time && isTime(item.time)) {
      const duration = item.durationMinutes && item.durationMinutes > 0 ? item.durationMinutes : 30;
      lines.push(
        `DTSTART;TZID=Europe/London:${localPlusMinutes(due, item.time, 0)}`,
        `DTEND;TZID=Europe/London:${localPlusMinutes(due, item.time, duration)}`,
        "TRANSP:OPAQUE"
      );
    } else {
      lines.push(`DTSTART;VALUE=DATE:${icsDate(due)}`, `DTEND;VALUE=DATE:${icsDate(addDays(due, 1))}`, "TRANSP:TRANSPARENT");
    }
    lines.push(
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(`Agreed in your Agentic Coach session.\nDue: ${formatDueDate(due)}${item.time ? ` at ${item.time}` : ""}.`)}`,
      "STATUS:CONFIRMED"
    );
    if (options.attendeeEmail) {
      lines.push(`ATTENDEE;CN=${escapeIcsText(options.attendeeName || "Coachee")};ROLE=REQ-PARTICIPANT:mailto:${options.attendeeEmail}`);
    }
    lines.push(
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${escapeIcsText(`Reminder: ${item.activity}`)}`,
      item.time ? "TRIGGER:-PT30M" : "TRIGGER:-PT15H",
      "END:VALARM",
      "END:VEVENT"
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
};

/** Google Calendar "add event" link (no account linking needed; opens Google Calendar prefilled). */
export const googleCalendarUrl = (item: PlanItem): string | null => {
  if (!item.dueDate || !isIsoDate(item.dueDate)) return null;
  const dates =
    item.time && isTime(item.time)
      ? `${localPlusMinutes(item.dueDate, item.time, 0)}/${localPlusMinutes(item.dueDate, item.time, item.durationMinutes || 30)}`
      : `${icsDate(item.dueDate)}/${icsDate(addDays(item.dueDate, 1))}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: `Coaching action: ${item.activity}`,
    dates,
    ctz: PLAN_TIME_ZONE,
    details: "Agreed in your Agentic Coach session."
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
};

// ---------- recipients ----------

/** Single, well-formed email address (no display names, lists or header-injection characters). */
export const isValidRecipientEmail = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  const email = value.trim();
  if (!email || email.length > 254 || /[\s,;<>"\r\n\\]/.test(email)) return false;
  const at = email.lastIndexOf("@");
  if (at < 1 || at !== email.indexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();
  if (local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return false;
  if (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local)) return false;
  const labels = domain.split(".");
  if (labels.length < 2) return false;
  if (!labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return false;
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
};

/** Optional server allow-list, e.g. CALENDAR_ALLOWED_RECIPIENT_DOMAINS="company.com,partner.co.uk". */
export const isRecipientAllowed = (email: string, allowList: string | undefined): boolean => {
  const domains = String(allowList ?? "")
    .split(",")
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (domains.length === 0) return true;
  const domain = email.trim().toLowerCase().split("@")[1] ?? "";
  return domains.some((allowed) => domain === allowed || domain.endsWith(`.${allowed}`));
};

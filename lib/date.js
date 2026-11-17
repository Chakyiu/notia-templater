// Moment-style dates for template tags. Times are local, matching the
// built-in Date and time commands.

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** @param {number} value */
const pad = (value) => String(value).padStart(2, "0");

/** @param {Date} date */
const hour12 = (date) => {
  const hour = date.getHours() % 12;
  return hour === 0 ? 12 : hour;
};

/** @type {[string, (date: Date) => string][]} */
const TOKENS = [
  ["YYYY", (date) => String(date.getFullYear())],
  ["YY", (date) => String(date.getFullYear()).slice(-2)],
  ["MMMM", (date) => MONTHS[date.getMonth()]],
  ["MMM", (date) => MONTHS_SHORT[date.getMonth()]],
  ["MM", (date) => pad(date.getMonth() + 1)],
  ["DD", (date) => pad(date.getDate())],
  ["dddd", (date) => WEEKDAYS[date.getDay()]],
  ["ddd", (date) => WEEKDAYS_SHORT[date.getDay()]],
  ["HH", (date) => pad(date.getHours())],
  ["hh", (date) => pad(hour12(date))],
  ["mm", (date) => pad(date.getMinutes())],
  ["ss", (date) => pad(date.getSeconds())],
  ["M", (date) => String(date.getMonth() + 1)],
  ["D", (date) => String(date.getDate())],
  ["H", (date) => String(date.getHours())],
  ["h", (date) => String(hour12(date))],
  ["m", (date) => String(date.getMinutes())],
  ["s", (date) => String(date.getSeconds())],
  ["A", (date) => (date.getHours() < 12 ? "AM" : "PM")],
  ["a", (date) => (date.getHours() < 12 ? "am" : "pm")],
];

/**
 * Formats `date` with tokens such as `YYYY-MM-DD` and `HH:mm`.
 * Text in `[brackets]` is copied as written.
 * @param {Date} date
 * @param {string} format
 */
export function formatDate(date, format) {
  const pattern = format ?? "";
  let out = "";
  for (let i = 0; i < pattern.length; ) {
    if (pattern[i] === "[") {
      const end = pattern.indexOf("]", i + 1);
      if (end === -1) {
        out += "[";
        i += 1;
        continue;
      }
      out += pattern.slice(i + 1, end);
      i = end + 1;
      continue;
    }
    const token = TOKENS.find(([name]) => pattern.startsWith(name, i));
    if (token) {
      out += token[1](date);
      i += token[0].length;
    } else {
      out += pattern[i];
      i += 1;
    }
  }
  return out;
}

/**
 * A copy of `date` moved by `offset`. A number is days. A string is
 * `1d`, `-2 weeks`, `3h`, `30m`, or `1M` (months).
 * @param {Date} date
 * @param {unknown} offset
 */
export function shiftDate(date, offset) {
  const next = new Date(date.getTime());
  if (offset == null || offset === "") return next;
  const { amount, unit } = parseOffset(offset);
  if (unit === "month") next.setMonth(next.getMonth() + amount);
  else if (unit === "week") next.setDate(next.getDate() + amount * 7);
  else if (unit === "day") next.setDate(next.getDate() + amount);
  else if (unit === "hour") next.setHours(next.getHours() + amount);
  else if (unit === "minute") next.setMinutes(next.getMinutes() + amount);
  else next.setSeconds(next.getSeconds() + amount);
  return next;
}

/**
 * The `which` weekday in the same week as `now`. `0` is Sunday.
 * Names (`Monday`, `Mon`) work too.
 * @param {Date} now
 * @param {number | string} which
 */
export function weekdayDate(now, which) {
  const next = new Date(now.getTime());
  next.setDate(next.getDate() + (weekdayIndex(which) - next.getDay()));
  return next;
}

/** @param {unknown} offset */
function parseOffset(offset) {
  if (typeof offset === "number" && Number.isFinite(offset)) return { amount: offset, unit: "day" };
  const match = String(offset).trim().match(/^([+-]?\d+)\s*([A-Za-z]*)$/);
  if (!match) throw new Error(`Unknown date offset “${offset}”`);
  const unit = unitOf(match[2]);
  if (!unit) throw new Error(`Unknown date offset “${offset}”`);
  return { amount: Number(match[1]), unit };
}

/** @param {string} token */
function unitOf(token) {
  if (!token) return "day";
  if (token === "M" || /^months?$/i.test(token)) return "month";
  const lower = token.toLowerCase();
  if (/^d(ays?)?$/.test(lower)) return "day";
  if (/^w(eeks?)?$/.test(lower)) return "week";
  if (token === "h" || /^hours?$/.test(lower)) return "hour";
  if (token === "m" || /^mins?$/.test(lower) || /^minutes?$/.test(lower)) return "minute";
  if (token === "s" || /^secs?$/.test(lower) || /^seconds?$/.test(lower)) return "second";
  return null;
}

/** @param {number | string} which */
function weekdayIndex(which) {
  if (typeof which === "number" && Number.isInteger(which) && which >= 0 && which <= 6) return which;
  const name = String(which ?? "").trim().toLowerCase();
  const index = WEEKDAYS.findIndex(
    (day) => day.toLowerCase() === name || (name.length >= 3 && day.toLowerCase().startsWith(name)),
  );
  if (index === -1) throw new Error(`Unknown weekday “${which}”`);
  return index;
}

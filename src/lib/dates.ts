/* Festivals and important dates for Indian marketing calendars.
   Lunar festival dates were checked against published 2026 and 2027 calendars (Drik Panchang,
   Samvat, CalendarLabs, IslamicFinder) on 17 Sep 2026. Islamic dates depend on moon sighting and
   can move by a day. `buying` marks days Indians traditionally treat as auspicious for buying
   a vehicle, which matter most for a motorcycle brand. */

export type KeyDateKind = "festival" | "national" | "awareness" | "industry" | "season";
export type KeyDate = { date: string; name: string; kind: KeyDateKind; buying?: boolean; note: string };

const LUNAR: KeyDate[] = [
  // 2026
  { date: "2026-03-04", name: "Holi", kind: "festival", note: "Colour, fun, spring rides." },
  { date: "2026-03-21", name: "Eid ul-Fitr", kind: "festival", note: "Greetings; date depends on moon sighting." },
  { date: "2026-04-19", name: "Akshaya Tritiya", kind: "festival", buying: true, note: "Auspicious day to buy a vehicle." },
  { date: "2026-08-26", name: "Onam", kind: "festival", note: "Big in Kerala; festive offers." },
  { date: "2026-09-04", name: "Janmashtami", kind: "festival", note: "Greetings." },
  { date: "2026-09-14", name: "Ganesh Chaturthi", kind: "festival", buying: true, note: "New beginnings; many buy vehicles." },
  { date: "2026-10-11", name: "Navratri begins", kind: "festival", buying: true, note: "Festive buying season starts." },
  { date: "2026-10-20", name: "Dussehra", kind: "festival", buying: true, note: "One of the biggest vehicle-buying days." },
  { date: "2026-10-29", name: "Karwa Chauth", kind: "festival", note: "Couples; gifting." },
  { date: "2026-11-06", name: "Dhanteras", kind: "festival", buying: true, note: "Peak day for buying vehicles and gold." },
  { date: "2026-11-08", name: "Diwali", kind: "festival", buying: true, note: "Greetings; delivery photos; festive offers." },
  { date: "2026-11-10", name: "Govardhan Puja", kind: "festival", note: "Vishwakarma and vehicle puja in some regions." },
  { date: "2026-11-11", name: "Bhai Dooj", kind: "festival", note: "Siblings; gifting." },
  { date: "2026-11-15", name: "Chhath Puja", kind: "festival", note: "Big in Bihar and eastern UP." },
  { date: "2026-11-24", name: "Guru Nanak Jayanti", kind: "festival", note: "Greetings." },
  // 2027
  { date: "2027-01-15", name: "Makar Sankranti / Pongal", kind: "festival", buying: true, note: "Harvest festival; some regions observe 14 Jan." },
  { date: "2027-03-06", name: "Maha Shivaratri", kind: "festival", note: "Greetings." },
  { date: "2027-03-10", name: "Eid ul-Fitr", kind: "festival", note: "Greetings; date depends on moon sighting." },
  { date: "2027-03-22", name: "Holi", kind: "festival", note: "Colour, fun, spring rides." },
  { date: "2027-04-07", name: "Ugadi / Gudi Padwa", kind: "festival", buying: true, note: "New year in the south and Maharashtra; vehicle purchases." },
  { date: "2027-04-14", name: "Baisakhi / Ambedkar Jayanti", kind: "festival", note: "Harvest festival in Punjab; Ambedkar Jayanti." },
  { date: "2027-04-15", name: "Ram Navami", kind: "festival", note: "Greetings." },
  { date: "2027-05-08", name: "Akshaya Tritiya", kind: "festival", buying: true, note: "Auspicious day to buy a vehicle; some calendars say 9 May." },
  { date: "2027-05-16", name: "Eid al-Adha", kind: "festival", note: "Greetings; date depends on moon sighting." },
  { date: "2027-08-17", name: "Raksha Bandhan", kind: "festival", note: "Siblings; gifting." },
  { date: "2027-08-24", name: "Janmashtami", kind: "festival", note: "Greetings." },
  { date: "2027-09-04", name: "Ganesh Chaturthi", kind: "festival", buying: true, note: "New beginnings; many buy vehicles." },
  { date: "2027-09-12", name: "Onam", kind: "festival", note: "Big in Kerala; festive offers." },
  { date: "2027-09-30", name: "Navratri begins", kind: "festival", buying: true, note: "Festive buying season starts." },
  { date: "2027-10-09", name: "Dussehra", kind: "festival", buying: true, note: "One of the biggest vehicle-buying days." },
  { date: "2027-10-27", name: "Dhanteras", kind: "festival", buying: true, note: "Peak day for buying vehicles and gold." },
  { date: "2027-10-29", name: "Diwali", kind: "festival", buying: true, note: "Greetings; delivery photos; festive offers." },
  { date: "2027-11-14", name: "Guru Nanak Jayanti", kind: "festival", note: "Greetings; also Children's Day." },
];

// same day every year
const FIXED: { md: string; name: string; kind: KeyDateKind; note: string }[] = [
  { md: "01-01", name: "New Year", kind: "national", note: "Resolutions: switch to electric." },
  { md: "01-26", name: "Republic Day", kind: "national", note: "Made in India pride." },
  { md: "02-01", name: "Union Budget", kind: "industry", note: "Watch EV, GST and subsidy announcements." },
  { md: "03-08", name: "International Women's Day", kind: "awareness", note: "Women riders, women on the team." },
  { md: "04-22", name: "Earth Day", kind: "awareness", note: "Emissions and clean commuting." },
  { md: "06-05", name: "World Environment Day", kind: "awareness", note: "Clean air, electric commuting." },
  { md: "08-15", name: "Independence Day", kind: "national", note: "Made in India, freedom from fuel prices." },
  { md: "09-05", name: "Teachers' Day", kind: "awareness", note: "Light greeting." },
  { md: "09-09", name: "World EV Day", kind: "industry", note: "The day for EV education and community posts." },
  { md: "09-15", name: "Engineers' Day (India)", kind: "awareness", note: "Meet the engineers building the bike." },
  { md: "09-22", name: "World Car Free Day", kind: "awareness", note: "Two-wheelers and cleaner cities." },
  { md: "10-02", name: "Gandhi Jayanti", kind: "national", note: "Swachh, simple living; keep it respectful." },
  { md: "11-14", name: "Children's Day", kind: "awareness", note: "Light greeting." },
  { md: "12-14", name: "National Energy Conservation Day", kind: "awareness", note: "Energy use per km, charging efficiently." },
  { md: "12-25", name: "Christmas", kind: "festival", note: "Greetings; year-end offers." },
  { md: "12-31", name: "New Year's Eve", kind: "national", note: "Year in review." },
];

// changes every year but follows a rule
function nthWeekday(year: number, month: number, weekday: number, n: number) {
  const d = new Date(year, month - 1, 1);
  const shift = (weekday - d.getDay() + 7) % 7;
  return new Date(year, month - 1, 1 + shift + (n - 1) * 7);
}
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function keyDatesFor(year: number): KeyDate[] {
  const out: KeyDate[] = [
    ...LUNAR.filter((x) => x.date.startsWith(`${year}-`)),
    ...FIXED.map((f) => ({ date: `${year}-${f.md}`, name: f.name, kind: f.kind, note: f.note })),
    { date: key(nthWeekday(year, 5, 0, 2)), name: "Mother's Day", kind: "awareness", note: "Family, safe rides." },
    { date: key(nthWeekday(year, 6, 0, 3)), name: "Father's Day", kind: "awareness", note: "First bike memories." },
    { date: key(nthWeekday(year, 8, 0, 1)), name: "Friendship Day", kind: "awareness", note: "Riding buddies." },
    { date: `${year}-01-11`, name: "National Road Safety Week begins", kind: "awareness", note: "Helmets, safe riding; dates are set by the ministry each year." },
    { date: `${year}-06-01`, name: "Monsoon season begins", kind: "season", note: "Rain riding, charging safety; onset varies by region." },
    { date: `${year}-09-20`, name: "Monsoon withdrawing", kind: "season", note: "Post-monsoon care; withdrawal varies by region." },
  ];
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export function keyDatesBetween(from: string, to: string): KeyDate[] {
  const years = new Set<number>();
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.add(y);
  return Array.from(years).flatMap(keyDatesFor).filter((x) => x.date >= from && x.date <= to);
}

export function keyDatesInMonth(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y, m, 0).getDate();
  return keyDatesBetween(`${month}-01`, `${month}-${String(last).padStart(2, "0")}`);
}

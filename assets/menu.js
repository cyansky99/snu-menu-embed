export const restaurants = ["3식당", "두레미담", "학생회관식당"];
export const mealLabels = { breakfast: "아침", lunch: "점심", dinner: "저녁" };

export function displayContext(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(part => [part.type, part.value]));
  const hour = Number(parts.hour);
  let date = `${parts.year}-${parts.month}-${parts.day}`;
  if (hour >= 19) {
    const tomorrow = new Date(`${date}T00:00:00Z`);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    date = tomorrow.toISOString().slice(0, 10);
  }
  const meal = hour < 10 || hour >= 19 ? "breakfast" : hour < 14 ? "lunch" : "dinner";
  return { date, meal, tomorrow: hour >= 19 };
}

export function parseLine(line) {
  const section = line.match(/^<([^>]+)>\s*(.*)$/);
  if (section) return { name: section[1], price: section[2], section: true };
  const priced = line.match(/^(.*?)\s*[:：]\s*([\d,]+\s*원)\s*$/);
  return { name: priced ? priced[1] : line, price: priced ? priced[2] : "", section: false };
}

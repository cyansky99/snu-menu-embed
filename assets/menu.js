export const mealLabels = { breakfast: "아침", lunch: "점심", dinner: "저녁" };

export const restaurantColors = {
  "학생회관식당": "#3979b5",
  "자하연식당": "#9364b0",
  "예술계식당": "#c46891",
  "두레미담": "#bc8d32",
  "동원관식당": "#8a9446",
  "기숙사식당": "#339593",
  "3식당": "#428862",
  "302동식당": "#626fba",
  "301동식당": "#c27648",
  "아워홈": "#b85d5d",
};

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

export function adjacentMeal(context, offset) {
  const meals = ["breakfast", "lunch", "dinner"];
  const index = meals.indexOf(context.meal) + offset;
  const date = new Date(`${context.date}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.floor(index / meals.length));
  return { date: date.toISOString().slice(0, 10), meal: meals[((index % 3) + 3) % 3] };
}

export function parseLine(line) {
  const noMeat = line.includes("(#)");
  line = line.replaceAll("(#)", "").trim();
  const section = line.match(/^<([^>]+)>\s*(.*)$/);
  if (section) return { name: section[1], price: section[2], section: true, noMeat };
  const priced = line.match(/^(.*?)\s*[:：]\s*([\d,]+\s*원)\s*$/);
  return { name: priced ? priced[1] : line, price: priced ? priced[2] : "", section: false, noMeat };
}

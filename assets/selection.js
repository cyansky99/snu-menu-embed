export const restaurantCatalog = [
  { id: "student-hall", name: "학생회관식당" },
  { id: "jahayeon", name: "자하연식당" },
  { id: "arts", name: "예술계식당" },
  { id: "duremidam", name: "두레미담" },
  { id: "dongwon", name: "동원관식당" },
  { id: "dorm", name: "기숙사식당" },
  { id: "3", name: "3식당" },
  { id: "302", name: "302동식당" },
  { id: "301", name: "301동식당" },
  { id: "ourhome", name: "아워홈" },
];

export function moveRestaurant(ids, id, direction) {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (![-1, 1].includes(direction) || index < 0 || target < 0 || target >= ids.length) return ids;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function restaurantGroups(rows, params) {
  const byName = new Map(rows.map(row => [row.name, row]));
  const byId = new Map(restaurantCatalog.map(entry => [entry.id, entry]));
  const explicit = params.has("restaurants");
  const entries = explicit
    ? [...new Set(params.get("restaurants").split(",").map(id => id.trim()))]
        .map(id => byId.get(id)).filter(Boolean)
    : rows.map(row => restaurantCatalog.find(entry => entry.name === row.name)).filter(Boolean);
  const selectedIds = new Set(entries.map(entry => entry.id));
  const resolve = entry => byName.get(entry.name) || { name: entry.name, meals: {}, hours: {}, sections: {} };
  return {
    ids: entries.map(entry => entry.id),
    selected: explicit ? entries.map(resolve) : rows,
    remaining: restaurantCatalog.filter(entry => !selectedIds.has(entry.id)).map(resolve),
  };
}

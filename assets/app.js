import { restaurants, mealLabels, displayContext, parseLine } from "./menu.js";

const contextElement = document.querySelector("#context");
const statusElement = document.querySelector("#status");
const container = document.querySelector("#restaurants");
let data = null;
let failed = false;
let loading = false;
let lastAttempt = 0;
let renderedKey = "";

function render() {
  const context = displayContext();
  const key = `${context.date}/${context.meal}`;
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(`${context.date}T12:00:00+09:00`));
  contextElement.textContent = `${dateLabel} · ${context.tomorrow ? "내일 " : ""}${mealLabels[context.meal]}`;
  const day = data?.days?.[context.date];
  statusElement.hidden = Boolean(day) && !failed;
  statusElement.textContent = failed
    ? (day ? "메뉴를 새로 불러오지 못했습니다. 마지막 수집 내용을 표시합니다." : "메뉴를 불러오지 못했습니다.")
    : data ? "해당 날짜의 메뉴가 아직 준비되지 않았습니다." : "메뉴를 불러오는 중입니다.";

  container.replaceChildren();
  restaurants.forEach(name => {
    const card = document.createElement("section");
    card.className = "restaurant";
    const heading = document.createElement("h2");
    heading.textContent = name;
    card.append(heading);
    const menu = day?.restaurants?.find(item => item.name === name)?.meals?.[context.meal] || "";
    if (menu.trim()) {
      const list = document.createElement("ul");
      list.className = "menu-list";
      menu.split("\n").filter(line => line.trim()).forEach(line => {
        const item = parseLine(line.trim());
        const row = document.createElement("li");
        row.className = `menu-line${item.section ? " section" : ""}`;
        const label = document.createElement("span");
        label.className = "menu-name";
        label.textContent = item.name;
        row.append(label);
        if (item.price) {
          const price = document.createElement("span");
          price.className = "price";
          price.textContent = item.price;
          row.append(price);
        }
        list.append(row);
      });
      card.append(list);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "메뉴 정보 없음";
      card.append(empty);
    }
    container.append(card);
  });
  renderedKey = key;
}

async function refresh() {
  if (loading) return;
  loading = true;
  lastAttempt = Date.now();
  try {
    const response = await fetch("./data/menus.json", { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const next = await response.json();
    if (next.schemaVersion !== 1 || !next.days || typeof next.days !== "object") {
      throw new Error("Invalid menu data");
    }
    data = next;
    failed = false;
  } catch (error) {
    console.error("Failed to load menus:", error);
    failed = true;
  } finally {
    loading = false;
    render();
  }
}

function tick() {
  const context = displayContext();
  if (`${context.date}/${context.meal}` !== renderedKey) render();
  if (Date.now() - lastAttempt >= 5 * 60 * 1000) refresh();
}

render();
refresh();
setInterval(tick, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

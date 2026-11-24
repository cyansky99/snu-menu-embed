import { mealLabels, restaurantColors, displayContext, adjacentMeal, parseLine } from "./menu.js?v=menu-labels-10";
import { packCards } from "./layout.js?v=card-spacing-13";

const contextElement = document.querySelector("#context");
const statusElement = document.querySelector("#status");
const container = document.querySelector("#restaurants");
const previousButton = document.querySelector("#previous-meal");
const nextButton = document.querySelector("#next-meal");
// Set false to return to the original aligned-row layout.
const compactCardLayout = true;
let layoutFrame = null;
function scheduleLayout() {
  if (!compactCardLayout || layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    packCards(container, window.matchMedia("(max-width: 639px)").matches ? 1 : 3);
  });
}
const layoutObserver = compactCardLayout && typeof ResizeObserver !== "undefined"
  ? new ResizeObserver(scheduleLayout) : null;
window.addEventListener("resize", scheduleLayout);
document.fonts?.ready.then(scheduleLayout);
let data = null;
let failed = false;
let loading = false;
let lastAttempt = 0;
let currentKey = "";
let selectedOffset = 0;
let mealWindow = [];

function syncWindow() {
  const current = displayContext();
  const key = `${current.date}/${current.meal}`;
  const changed = key !== currentKey;
  if (changed) selectedOffset = 0;
  currentKey = key;
  // Replace the old window so only previous/current/next remain navigable.
  mealWindow = [-1, 0, 1].map(offset => adjacentMeal(current, offset));
  return changed;
}

function makeHoursLabel(hours) {
  const label = document.createElement("span");
  label.className = "restaurant-hours";
  label.setAttribute("aria-label", `운영시간 ${hours}`);
  const [start, end] = hours.split("–").map(part => part.trim());
  const startLabel = document.createElement("span");
  startLabel.textContent = start;
  label.append(startLabel);
  if (end) {
    const separator = document.createElement("span");
    separator.className = "hours-separator";
    separator.setAttribute("aria-hidden", "true");
    const endLabel = document.createElement("span");
    endLabel.textContent = end;
    label.append(separator, endLabel);
  }
  return label;
}

function appendMenu(parent, menu) {
  if (!menu.trim()) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "메뉴 정보 없음";
    parent.append(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "menu-list";
  menu.split("\n").filter(line => line.trim()).forEach(line => {
    const item = parseLine(line.trim());
    const row = document.createElement("li");
    row.className = `menu-line${item.section ? " section" : ""}${item.section && item.name === "세미뷔페" ? " supplement" : ""}`;
    const label = document.createElement("span");
    label.className = "menu-name";
    label.textContent = item.name;
    if (item.noMeat) {
      const tag = document.createElement("span");
      tag.className = "no-meat";
      tag.textContent = "No meat";
      label.append(tag);
    }
    row.append(label);
    if (item.price) {
      const price = document.createElement("span");
      price.className = "price";
      price.textContent = item.price;
      row.append(price);
    }
    list.append(row);
  });
  parent.append(list);
}

function appendSections(parent, sections) {
  sections.forEach(section => {
    const group = document.createElement("section");
    group.className = "menu-corner";
    const heading = document.createElement("h3");
    heading.className = "corner-heading";
    const name = document.createElement("span");
    name.textContent = section.name;
    heading.append(name);
    if (section.hours) heading.append(makeHoursLabel(section.hours));
    group.append(heading);
    if (section.accessHours?.length) {
      const schedule = document.createElement("div");
      schedule.className = "corner-schedule";
      section.accessHours.forEach(access => {
        const row = document.createElement("div");
        row.className = "access-hours";
        const label = document.createElement("span");
        label.textContent = access.label;
        row.append(label, makeHoursLabel(access.hours));
        schedule.append(row);
      });
      group.append(schedule);
    }
    appendMenu(group, section.menu);
    parent.append(group);
  });
}

function render() {
  syncWindow();
  const context = mealWindow[selectedOffset + 1];
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(`${context.date}T12:00:00+09:00`));
  contextElement.textContent = `${dateLabel} · ${mealLabels[context.meal]}`;
  previousButton.disabled = selectedOffset === -1;
  nextButton.disabled = selectedOffset === 1;
  const day = data?.days?.[context.date];
  statusElement.hidden = Boolean(day) && !failed;
  statusElement.textContent = failed
    ? (day ? "메뉴를 새로 불러오지 못했습니다. 마지막 수집 내용을 표시합니다." : "메뉴를 불러오지 못했습니다.")
    : data ? "해당 날짜의 메뉴가 아직 준비되지 않았습니다." : "메뉴를 불러오는 중입니다.";

  layoutObserver?.disconnect();
  container.classList.remove("packed");
  container.replaceChildren();
  (day?.restaurants || []).forEach(restaurant => {
    const card = document.createElement("section");
    card.className = "restaurant";
    card.style.setProperty("--accent", restaurantColors[restaurant.name] || "#787774");
    const heading = document.createElement("h2");
    const name = document.createElement("span");
    name.className = "restaurant-name";
    name.textContent = restaurant.name;
    heading.append(name);
    const menu = restaurant.meals?.[context.meal] || "";
    const hours = restaurant.hours?.[context.meal];
    const sections = restaurant.sections?.[context.meal] || [];
    if (menu.trim() && hours && !sections.length) heading.append(makeHoursLabel(hours));
    card.append(heading);
    if (sections.length) {
      appendSections(card, sections);
    } else if (menu.trim()) {
      appendMenu(card, menu);
    } else {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "메뉴 정보 없음";
      card.append(empty);
    }
    container.append(card);
  });
  layoutObserver?.observe(container);
  Array.from(container.children).forEach(card => layoutObserver?.observe(card));
  scheduleLayout();
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
  const changed = syncWindow();
  if (changed) render();
  if (changed || Date.now() - lastAttempt >= 5 * 60 * 1000) refresh();
}

function navigate(direction) {
  if (syncWindow()) {
    render();
    refresh();
    return;
  }
  selectedOffset = Math.max(-1, Math.min(1, selectedOffset + direction));
  render();
}

previousButton.addEventListener("click", () => navigate(-1));
nextButton.addEventListener("click", () => navigate(1));

render();
refresh();
setInterval(tick, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

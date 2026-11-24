import { mealLabels, restaurantColors, displayContext, adjacentMeal, parseLine } from "./menu.js?v=restaurant-palette-23";
import { packCards } from "./layout.js?v=card-spacing-13";
import { restaurantCatalog, restaurantGroups, moveRestaurant } from "./selection.js?v=settings-order-18";

const contextElement = document.querySelector("#context");
const statusElement = document.querySelector("#status");
const container = document.querySelector("#restaurants");
const previousButton = document.querySelector("#previous-meal");
const nextButton = document.querySelector("#next-meal");
const settingsMode = document.body.dataset.page === "settings";
const otherContainer = document.querySelector("#other-restaurants");
const otherSection = document.querySelector("#other-restaurants-section");
const configurationLink = document.querySelector("#configuration-link");
const addAllButton = document.querySelector("#add-all-restaurants");
const removeAllButton = document.querySelector("#remove-all-restaurants");
const params = new URLSearchParams(location.search);
const themeModes = ["auto", "light", "dark"];
const themeLabels = { auto: "Auto", light: "Light", dark: "Dark" };
let initialView = params.get("view");
const cardContainers = [container, otherContainer].filter(Boolean);
// Set false to return to the original aligned-row layout.
const compactCardLayout = true;
let layoutFrame = null;
function scheduleLayout() {
  if (!compactCardLayout || layoutFrame !== null) return;
  layoutFrame = requestAnimationFrame(() => {
    layoutFrame = null;
    cardContainers.forEach(group => packCards(group, window.matchMedia("(max-width: 639px)").matches ? 1 : 3));
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
  if (initialView) {
    const index = mealWindow.findIndex(context => `${context.date}/${context.meal}` === initialView);
    if (index >= 0) selectedOffset = index - 1;
    initialView = null;
  }
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

function saveSelection(ids, buttonId, message, fallbackId = buttonId) {
  const context = mealWindow[selectedOffset + 1];
  params.set("restaurants", ids.join(","));
  params.set("view", `${context.date}/${context.meal}`);
  const url = new URL(location.href);
  url.search = params.toString();
  history.replaceState(null, "", url);
  const restoreFocus = document.activeElement?.id === buttonId;
  render();
  if (restoreFocus) {
    const button = document.getElementById(buttonId);
    (button && !button.disabled ? button : document.getElementById(fallbackId))?.focus({ preventScroll: true });
  }
  const announcement = document.querySelector("#settings-announcement");
  if (announcement) {
    announcement.textContent = message;
  }
}

function updateSelection(id) {
  if (!settingsMode) return;
  const context = mealWindow[selectedOffset + 1];
  const groups = restaurantGroups(data?.days?.[context.date]?.restaurants || [], params);
  const removing = groups.ids.includes(id);
  const ids = removing ? groups.ids.filter(value => value !== id) : [...groups.ids, id];
  const name = restaurantCatalog.find(entry => entry.id === id)?.name || "식당";
  saveSelection(ids, `restaurant-toggle-${id}`, `${name} ${removing ? "제외됨" : "추가됨"}. ${ids.length}개 식당 선택됨.`);
}

function reorderSelection(id, direction) {
  if (!settingsMode) return;
  const context = mealWindow[selectedOffset + 1];
  const groups = restaurantGroups(data?.days?.[context.date]?.restaurants || [], params);
  const ids = moveRestaurant(groups.ids, id, direction);
  if (ids === groups.ids) return;
  const name = restaurantCatalog.find(entry => entry.id === id)?.name || "식당";
  saveSelection(ids, `restaurant-move-${id}-${direction}`, `${name}, ${ids.indexOf(id) + 1}번째로 이동됨.`, `restaurant-move-${id}-${-direction}`);
}

function updateAllSelections(add) {
  if (!settingsMode || !data) return;
  const context = mealWindow[selectedOffset + 1];
  const groups = restaurantGroups(data.days?.[context.date]?.restaurants || [], params);
  const ids = add ? [...groups.ids, ...restaurantCatalog.map(entry => entry.id).filter(id => !groups.ids.includes(id))] : [];
  saveSelection(ids, add ? "add-all-restaurants" : "remove-all-restaurants",
    add ? `${ids.length}개 식당을 모두 추가했습니다.` : "모든 식당을 제외했습니다.",
    add ? "remove-all-restaurants" : "add-all-restaurants");
}

function appendSelectionControls(card, heading, restaurant, selected, selectedIds) {
  const entry = restaurantCatalog.find(item => item.name === restaurant.name);
  if (entry) {
    const button = document.createElement("button");
    button.type = "button";
    button.id = `restaurant-toggle-${entry.id}`;
    button.className = "restaurant-toggle";
    button.setAttribute("aria-label", `${restaurant.name} ${selected ? "빼기" : "추가"}`);
    button.title = selected ? "식당 빼기" : "식당 추가";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", selected ? "M4 8h8" : "M4 8h8M8 4v8");
    icon.append(path);
    button.append(icon);
    button.addEventListener("click", () => updateSelection(entry.id));
    heading.append(button);
  }
  const placeholder = document.createElement("div");
  placeholder.className = "menu-placeholder";
  placeholder.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 2; i++) {
    const line = document.createElement("span");
    line.className = "placeholder-line";
    placeholder.append(line);
  }
  card.append(placeholder);
  if (entry) {
    const controls = document.createElement("div");
    controls.className = "restaurant-order";
    const index = selectedIds.indexOf(entry.id);
    for (const direction of [-1, 1]) {
      const button = document.createElement("button");
      button.type = "button";
      button.id = `restaurant-move-${entry.id}-${direction}`;
      button.className = "restaurant-move";
      button.disabled = !selected || (direction === -1 ? index === 0 : index === selectedIds.length - 1);
      const label = `${restaurant.name} ${direction === -1 ? "앞으로" : "뒤로"} 이동`;
      button.setAttribute("aria-label", label);
      button.title = label;
      const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      icon.setAttribute("viewBox", "0 0 16 16");
      icon.setAttribute("aria-hidden", "true");
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", direction === -1 ? "m10 4-4 4 4 4" : "m6 4 4 4-4 4");
      icon.append(path);
      button.append(icon);
      button.addEventListener("click", () => reorderSelection(entry.id, direction));
      controls.append(button);
    }
    card.append(controls);
  }
}

function render() {
  syncWindow();
  const context = mealWindow[selectedOffset + 1];
  const dateLabel = new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul", month: "long", day: "numeric", weekday: "short",
  }).format(new Date(`${context.date}T12:00:00+09:00`));
  const contextLabel = `${dateLabel} · ${mealLabels[context.meal]}`;
  if (settingsMode) {
    // Invisible date text preserves the exact meal-label width in the shared header.
    const measure = document.createElement("span");
    measure.className = "context-measure";
    measure.setAttribute("aria-hidden", "true");
    measure.textContent = contextLabel;
    const theme = document.createElement("span");
    theme.className = "context-theme";
    theme.textContent = themeLabels[window.menuTheme.get()];
    theme.title = window.menuTheme.get() === "auto" ? "기기·브라우저 설정에 맞춤" : "화면 밝기 테마";
    contextElement.replaceChildren(measure, theme);
  } else {
    contextElement.textContent = contextLabel;
  }
  for (const [selector, base] of [
    ["#cooperative-source", "https://snuco.snu.ac.kr/foodmenu/"],
    ["#dormitory-source", "https://snudorm.snu.ac.kr/foodmenu/"],
  ]) {
    const source = new URL(base);
    source.searchParams.set("date", context.date);
    document.querySelector(selector).href = source.href;
  }
  previousButton.disabled = !settingsMode && selectedOffset === -1;
  nextButton.disabled = !settingsMode && selectedOffset === 1;
  const day = data?.days?.[context.date];
  const groups = restaurantGroups(day?.restaurants || [], params);
  const destination = new URL(settingsMode ? "./index.html" : "./settings.html", location.href);
  // Carry the current selection, order and meal into settings and back.
  if (day || params.has("restaurants")) destination.searchParams.set("restaurants", groups.ids.join(","));
  destination.searchParams.set("view", `${context.date}/${context.meal}`);
  if (params.has("theme")) destination.searchParams.set("theme", window.menuTheme.get());
  configurationLink.href = destination.href;
  statusElement.hidden = Boolean(day) && !failed;
  statusElement.textContent = failed
    ? (day ? "메뉴를 새로 불러오지 못했습니다. 마지막 수집 내용을 표시합니다." : "메뉴를 불러오지 못했습니다.")
    : data ? "해당 날짜의 메뉴가 아직 준비되지 않았습니다." : "메뉴를 불러오는 중입니다.";
  if (day && !groups.selected.length && !failed) {
    statusElement.hidden = false;
    statusElement.textContent = settingsMode ? "아래 + 버튼으로 식당을 추가하세요." : "표시할 식당이 없습니다.";
  }

  layoutObserver?.disconnect();
  cardContainers.forEach(group => {
    group.classList.remove("packed");
    group.replaceChildren();
  });
  const renderCard = (restaurant, target) => {
    const card = document.createElement("section");
    card.className = settingsMode ? "restaurant settings-card" : "restaurant";
    card.style.setProperty("--accent", restaurantColors[restaurant.name] || "#787774");
    const heading = document.createElement("h2");
    const name = document.createElement("span");
    name.className = "restaurant-name";
    name.textContent = restaurant.name;
    heading.append(name);
    card.append(heading);
    if (settingsMode) {
      appendSelectionControls(card, heading, restaurant, target === container, groups.ids);
      target.append(card);
      return;
    }
    const menu = restaurant.meals?.[context.meal] || "";
    const hours = restaurant.hours?.[context.meal];
    const sections = restaurant.sections?.[context.meal] || [];
    if (menu.trim() && hours && !sections.length) heading.append(makeHoursLabel(hours));
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
    target.append(card);
  };
  groups.selected.forEach(restaurant => renderCard(restaurant, container));
  if (settingsMode) {
    otherSection.hidden = false;
    addAllButton.disabled = !data || !groups.remaining.length;
    removeAllButton.disabled = !data || !groups.ids.length;
    if (data) groups.remaining.forEach(restaurant => renderCard(restaurant, otherContainer));
  }
  cardContainers.forEach(group => {
    layoutObserver?.observe(group);
    Array.from(group.children).forEach(card => layoutObserver?.observe(card));
  });
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
  if (settingsMode) {
    const index = themeModes.indexOf(window.menuTheme.get());
    const mode = themeModes[(index + direction + themeModes.length) % themeModes.length];
    window.menuTheme.set(mode);
    params.set("theme", mode);
    const url = new URL(location.href);
    url.search = params.toString();
    history.replaceState(null, "", url);
    render();
    return;
  }
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
addAllButton?.addEventListener("click", () => updateAllSelections(true));
removeAllButton?.addEventListener("click", () => updateAllSelections(false));

render();
refresh();
setInterval(tick, 15000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) tick();
});

// Keep row-major column assignment for the current number of CSS grid columns.
// Only the vertical positions change; DOM and keyboard reading order stay intact.
export function packCards(container, columns) {
  const cards = Array.from(container.children);
  if (columns === 1 || !cards.length) {
    container.classList.remove("packed");
    cards.forEach(card => {
      card.style.removeProperty("grid-column");
      card.style.removeProperty("grid-row");
    });
    return;
  }

  // Measure natural heights before stretching cards to whole-pixel row spans.
  container.classList.remove("packed");
  cards.forEach((card, index) => {
    card.style.removeProperty("grid-row");
    card.style.gridColumn = String(index % columns + 1);
  });
  const heights = cards.map(card => Math.ceil(card.getBoundingClientRect().height));
  const gap = Number.parseFloat(getComputedStyle(container).getPropertyValue("--card-gap")) || 12;
  const nextRow = Array(columns).fill(1);
  container.classList.add("packed");
  cards.forEach((card, index) => {
    const column = index % columns;
    const height = Math.max(1, heights[index]);
    card.style.gridRow = `${nextRow[column]} / span ${height}`;
    nextRow[column] += height + gap;
  });
}

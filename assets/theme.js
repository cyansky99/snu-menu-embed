// Apply before styles load so dark embeds never paint a light background first.
(() => {
  const modes = ["auto", "light", "dark", "christmas", "snu"];
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const normalize = value => modes.includes(value) ? value : "auto";
  let preference = normalize(new URLSearchParams(location.search).get("theme"));
  const apply = () => {
    document.documentElement.dataset.theme = preference === "auto"
      ? (system.matches ? "dark" : "light") : preference;
  };
  window.menuTheme = {
    get: () => preference,
    set(value) { preference = normalize(value); apply(); },
  };
  system.addEventListener("change", apply);
  apply();
})();

(function () {
  try {
    var t = localStorage.getItem("gs-theme");
    var dark =
      t === "dark" ||
      (t !== "light" &&
        window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (dark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();

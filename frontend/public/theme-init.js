// Runs before the stylesheet so the first paint uses the right theme, mode and language.
// A file rather than an inline script: the Content-Security-Policy forbids inline scripts.
(function () {
  var THEMES = ["default", "dusk"];
  var LANGUAGES = ["en", "fr"];
  function read(key) {
    try {
      return localStorage.getItem("yasad." + key);
    } catch {
      return null;
    }
  }
  var root = document.documentElement;
  var dev = root.hasAttribute("data-dev");
  var theme = (dev && read("devTheme")) || read("instanceTheme");
  root.setAttribute("data-theme", THEMES.indexOf(theme) >= 0 ? theme : "default");

  var mode = read("mode");
  var dark = mode === "dark" || (mode !== "light" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.setAttribute("data-mode", dark ? "dark" : "light");

  var language = read("language");
  if (LANGUAGES.indexOf(language) < 0) {
    language = null;
    var asked = navigator.languages || [navigator.language];
    for (var i = 0; i < asked.length && !language; i++) {
      var primary = String(asked[i]).split("-")[0].toLowerCase();
      if (LANGUAGES.indexOf(primary) >= 0) language = primary;
    }
    var cached = read("instanceLanguage");
    language = language || (LANGUAGES.indexOf(cached) >= 0 ? cached : "en");
  }
  root.setAttribute("lang", language);
})();

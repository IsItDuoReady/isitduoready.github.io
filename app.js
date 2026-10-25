"use strict";

// All text from the App Store (names, release notes) is set with textContent, never as HTML.

const PAGE = 50;
const STATUSES = {
  optimized: { label: "Optimized", chip: "chip-optimized", glyph: "#g-optimized" },
  unconfirmed: { label: "Not confirmed", chip: "chip-unconfirmed", glyph: "#g-unconfirmed" },
  not_optimized: { label: "Not optimized", chip: "chip-not", glyph: "#g-not" },
};
const SUMMARY_NOUN = {
  all: ["app", "apps"],
  optimized: ["optimized app", "optimized apps"],
  unconfirmed: ["app not confirmed", "apps not confirmed"],
  not_optimized: ["app not optimized", "apps not optimized"],
};

const $ = (id) => document.getElementById(id);
const els = {
  q: $("q"), statuses: $("statuses"), genre: $("genre"), sort: $("sort"),
  summary: $("summary"), list: $("apps"), more: $("more"), intro: $("intro"), checked: $("checked"),
  row: $("app-row"),
};

const state = { q: "", status: "all", genre: "", sort: "popular", shown: PAGE };
let data = null;
let apps = [];

// Some app names use Apple's private symbol characters, which only render on Apple devices.
const PRIVATE_USE = /[\uE000-\uF8FF]|[\u{F0000}-\u{10FFFD}]/gu;
const keepTogether = (s) => s.replace(/iPhone Duo/g, "iPhone\u00a0Duo");
const fold = (s) => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const number = (n) => n.toLocaleString("en-US");
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const longDate = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
const day = (iso, format = dateFormat) => (iso ? format.format(new Date(iso.slice(0, 10) + "T00:00:00Z")) : "");

// --- Filtering -----------------------------------------------------------------

function matchesQuery(app, words) {
  return words.every((w) => app.key.includes(w));
}

// Lower is better: a word in the name starts with the search, then the name contains it,
// then only the developer matches. Ties go to the chosen sort (most popular by default).
function rank(app, phrase) {
  if (!phrase) return 0;
  if (app.nameKey.startsWith(phrase) || app.nameKey.includes(" " + phrase)) return 0;
  return app.nameKey.includes(phrase) ? 1 : 2;
}

const SORTS = {
  popular: (a, b) => b.ratings - a.ratings,
  recent: (a, b) => (b.updated > a.updated ? 1 : b.updated < a.updated ? -1 : b.ratings - a.ratings),
  name: (a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }),
};

function filtered() {
  const phrase = fold(state.q).trim().replace(/\s+/g, " ");
  const words = phrase ? phrase.split(" ") : [];
  const pool = apps.filter((a) => (!state.genre || a.genre === state.genre) && matchesQuery(a, words));
  const counts = { all: pool.length, optimized: 0, unconfirmed: 0, not_optimized: 0 };
  for (const a of pool) counts[a.status]++;
  const shown = state.status === "all" ? pool : pool.filter((a) => a.status === state.status);
  const sort = SORTS[state.sort];
  shown.sort((a, b) => rank(a, phrase) - rank(b, phrase) || sort(a, b));
  return { shown, counts };
}

// --- Rendering -----------------------------------------------------------------

// Icons load as background images once their row is near the screen; a missing or
// broken icon just leaves the plain tile.
const icon = {
  watcher: new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      const tile = entry.target;
      icon.watcher.unobserve(tile);
      const img = new Image();
      img.onload = () => { tile.style.backgroundImage = `url("${img.src.replace(/"/g, "%22")}")`; };
      img.src = tile.dataset.src;
    }
  }, { rootMargin: "400px" }),
  observe(tile, src) {
    if (!/^https:\/\//.test(src)) return;
    tile.dataset.src = src;
    icon.watcher.observe(tile);
  },
};

function by(app) {
  if (app.genre === "Games") return `Game by ${app.developer}`;
  return app.genre ? `${app.genre} app by ${app.developer}` : `By ${app.developer}`;
}

function detail(app) {
  const since = day(data.since);
  const version = app.version ? ` (version ${app.version})` : "";
  if (app.status === "optimized") {
    return `Optimized in version ${app.quote.version}, released ${day(app.quote.date)}.`;
  }
  if (app.status === "unconfirmed") {
    if (app.quote && app.quote.kind === "mentions") {
      return `Updated ${day(app.updated)}${version}. The release notes mention iPhone Duo but don’t say it’s optimized:`;
    }
    if (app.quote && app.quote.kind === "foldable") {
      return `Updated ${day(app.updated)}${version}. The release notes mention foldable screens but not iPhone Duo by name:`;
    }
    return `Updated ${day(app.updated)}${version}, but the release notes don’t mention iPhone Duo.`;
  }
  if (!app.updated) return "We couldn’t find when this app was last updated.";
  return `Last updated ${day(app.updated)}${version}, before Apple started accepting iPhone Duo apps on ${since}.`;
}

function notes(app) {
  const block = document.createElement("blockquote");
  block.className = "notes";
  const text = document.createElement("p");
  text.textContent = `“${app.quote.text}”`;
  const source = document.createElement("footer");
  source.textContent = `Release notes for version ${app.quote.version}, ${day(app.quote.date)}`;
  block.append(text, source);
  return block;
}

function row(app) {
  const li = els.row.content.firstElementChild.cloneNode(true);
  const status = STATUSES[app.status];
  li.dataset.status = app.status;

  if (app.icon) icon.observe(li.querySelector(".icon"), app.icon);

  const link = li.querySelector(".name a");
  link.href = `https://apps.apple.com/${data.country}/app/id${app.id}`;
  link.textContent = app.name;
  li.querySelector(".by").textContent = by(app);

  const chip = li.querySelector(".chip");
  chip.classList.add(status.chip);
  chip.querySelector("use").setAttribute("href", status.glyph);
  chip.querySelector(".chip-label").textContent = status.label;

  li.querySelector(".detail").textContent = keepTogether(detail(app));
  if (app.quote && app.status !== "not_optimized") li.querySelector(".body").append(notes(app));
  return li;
}

function summary(count) {
  const [one, many] = SUMMARY_NOUN[state.status];
  let text = `${number(count)} ${count === 1 ? one : many}`;
  if (state.genre) text += ` in ${state.genre}`;
  if (state.q.trim()) text += ` matching “${state.q.trim()}”`;
  return text;
}

function emptyState() {
  const li = document.createElement("li");
  li.className = "empty";
  const q = state.q.trim();
  li.textContent = q
    ? `No tracked apps match “${q}”${state.status === "all" ? "" : " with this status"}. We track apps that have appeared on the US App Store’s top charts, so the app you’re looking for may not be on the list yet. Check the spelling, or try the developer’s name.`
    : "No apps have this status in this category.";
  return li;
}

function render() {
  icon.watcher.disconnect();  // rows from the previous render are about to be replaced
  const { shown, counts } = filtered();
  for (const button of els.statuses.querySelectorAll("button")) {
    button.querySelector(".count").textContent = number(counts[button.dataset.status]);
    button.setAttribute("aria-pressed", String(button.dataset.status === state.status));
  }
  els.summary.textContent = summary(shown.length);

  const fragment = document.createDocumentFragment();
  if (!shown.length) fragment.append(emptyState());
  for (const app of shown.slice(0, state.shown)) fragment.append(row(app));
  els.list.replaceChildren(fragment);

  const remaining = shown.length - state.shown;
  els.more.hidden = remaining <= 0;
  els.more.textContent = `Show ${number(Math.min(PAGE, remaining))} more`;
}

// --- State in the address bar, so a search can be shared -----------------------

function readUrl() {
  const p = new URLSearchParams(location.search);
  state.q = p.get("q") || "";
  state.status = STATUSES[p.get("status")] ? p.get("status") : "all";
  state.genre = p.get("category") || "";
  state.sort = SORTS[p.get("sort")] ? p.get("sort") : "popular";
}

function writeUrl() {
  const p = new URLSearchParams();
  if (state.q.trim()) p.set("q", state.q.trim());
  if (state.status !== "all") p.set("status", state.status);
  if (state.genre) p.set("category", state.genre);
  if (state.sort !== "popular") p.set("sort", state.sort);
  const query = p.toString();
  history.replaceState(null, "", query ? `?${query}` : location.pathname);
}

function update(changes) {
  Object.assign(state, changes, { shown: PAGE });
  render();
  writeUrl();
  if ("q" in changes) countSearch();
}

// --- Analytics -----------------------------------------------------------------
// GoatCounter (loaded in index.html) counts visits on its own. Searches are counted as
// events once someone stops typing: "search/<words>", or "search-not-found/<words>" when
// no tracked app matches, which shows the apps people want that aren't on the list.

const SEARCH_PAUSE = 1500;
let searchTimer;
let lastCounted = "";

function countSearch() {
  clearTimeout(searchTimer);
  const words = fold(state.q).trim().replace(/\s+/g, " ").slice(0, 60);
  if (words.length < 2 || words === lastCounted) return;
  searchTimer = setTimeout(() => {
    const counter = window.goatcounter;
    if (!counter || typeof counter.count !== "function") return;  // blocked or not loaded yet
    lastCounted = words;
    const found = apps.some((a) => matchesQuery(a, words.split(" ")));
    counter.count({ path: `${found ? "search" : "search-not-found"}/${words}`, title: words, event: true });
  }, SEARCH_PAUSE);
}

// --- Start ---------------------------------------------------------------------

function setup() {
  apps = data.apps.map((a) => ({
    ...a,
    name: (a.name || "").replace(PRIVATE_USE, "").trim(),
    nameKey: fold(a.name),
    key: fold(`${a.name} ${a.developer}`),
  }));

  const total = number(apps.length);
  els.intro.textContent =
    `We read the App Store release notes of ${total} popular apps every day to see which ones have been optimized for iPhone Duo’s inner display.`;
  els.checked.textContent = `Last checked ${day(data.generated, longDate)}.`;
  for (const el of document.querySelectorAll(".since-date")) {
    el.textContent = el.textContent.includes(",") ? day(data.since, longDate) : day(data.since, longDate).replace(/, \d{4}$/, "");
  }

  const genres = [...new Set(apps.map((a) => a.genre).filter(Boolean))].sort();
  for (const g of genres) els.genre.add(new Option(g, g));

  readUrl();
  if (state.genre && !genres.includes(state.genre)) state.genre = "";
  els.q.value = state.q;
  els.genre.value = state.genre;
  els.sort.value = state.sort;
  els.q.disabled = false;

  let typing;
  els.q.addEventListener("input", () => {
    clearTimeout(typing);
    typing = setTimeout(() => update({ q: els.q.value }), 120);
  });
  els.statuses.addEventListener("click", (e) => {
    const button = e.target.closest("button");
    if (button) update({ status: button.dataset.status });
  });
  els.genre.addEventListener("change", () => update({ genre: els.genre.value }));
  els.sort.addEventListener("change", () => update({ sort: els.sort.value }));
  els.more.addEventListener("click", () => {
    state.shown += PAGE;
    render();
  });

  render();
  if (state.q) countSearch();  // someone opened a shared search link
}

fetch("apps.json")
  .then((response) => {
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  })
  .then((json) => {
    data = json;
    setup();
  })
  .catch(() => {
    els.summary.textContent = "The app list didn’t load. Reload the page to try again.";
  });

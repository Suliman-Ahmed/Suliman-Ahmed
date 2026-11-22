// Draws the last year of GitHub contributions as an isometric city.
// Writes city/city-light.svg and city/city-dark.svg. No dependencies.
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

const USER = process.env.CITY_USER || "Suliman-Ahmed";
const OUT = process.env.CITY_OUT || "city";

async function fromGraphQL() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${token}`, "Content-Type": "application/json", "User-Agent": "contribution-city" },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  if (!res.ok) return null;
  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) return null;
  return weeks.flatMap((w) => w.contributionDays.map((d) => [d.date, d.contributionCount]));
}

async function fromProfilePage() {
  const res = await fetch(`https://github.com/users/${USER}/contributions`, { headers: { "User-Agent": "contribution-city" } });
  if (!res.ok) throw new Error(`contributions page: HTTP ${res.status}`);
  const html = await res.text();
  const counts = {};
  for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].trim().match(/^(\d+)/);
    counts[m[1]] = n ? Number(n[1]) : 0;
  }
  const days = [];
  for (const m of html.matchAll(/<td[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"[^>]*>|<td[^>]*id="([^"]+)"[^>]*data-date="(\d{4}-\d{2}-\d{2})"[^>]*>/g)) {
    const date = m[1] || m[4], id = m[2] || m[3];
    days.push([date, counts[id] ?? 0]);
  }
  return days.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

const GREENS = [
  ["#9be9a8", "#7fcf8d", "#68b878"],
  ["#40c463", "#34a853", "#2b8d45"],
  ["#30a14e", "#278741", "#1f6e35"],
  ["#216e39", "#1a582e", "#134323"],
];
const THEMES = {
  light: { empty: ["#ebedf0", "#d8dbe0", "#c9ccd1"], ink: "#57606a", line: "#8c959f" },
  dark: { empty: ["#2d333b", "#22272e", "#1c2128"], ink: "#9198a1", line: "#656c76" },
};
const level = (c) => (c <= 2 ? 0 : c <= 5 ? 1 : c <= 10 ? 2 : 3);
const height = (c) => (c ? 8 + Math.sqrt(c) * 12 : 2);

function draw(days, theme) {
  const t = THEMES[theme];
  // Align so column 0 starts on a Sunday, like GitHub's calendar.
  const first = new Date(days[0][0] + "T00:00:00Z").getUTCDay();
  const cells = days.map(([date, c], i) => ({ date, c, w: Math.floor((i + first) / 7), d: (i + first) % 7 }));
  const weeks = cells[cells.length - 1].w + 1;
  const s = 11.6, cs = Math.cos(Math.PI / 6);
  const W = 680, ox = 7 * s * cs + 14;
  const maxH = height(Math.max(...cells.map((x) => x.c)));
  const oy = Math.max(70, maxH + 56);
  const H = Math.ceil(oy + (weeks + 7) * s * 0.5 + 16);
  const P = (w, d, h) => `${(ox + (w - d) * s * cs).toFixed(1)},${(oy + (w + d) * s * 0.5 - h).toFixed(1)}`;

  let shapes = "";
  for (const { w, d, c } of [...cells].sort((a, b) => a.w + a.d - (b.w + b.d) || a.w - b.w)) {
    const h = height(c);
    const [top, left, right] = c ? GREENS[level(c)] : t.empty;
    shapes += `<polygon points="${P(w, d + 1, 0)} ${P(w + 1, d + 1, 0)} ${P(w + 1, d + 1, h)} ${P(w, d + 1, h)}" fill="${left}"/>`;
    shapes += `<polygon points="${P(w + 1, d, 0)} ${P(w + 1, d + 1, 0)} ${P(w + 1, d + 1, h)} ${P(w + 1, d, h)}" fill="${right}"/>`;
    shapes += `<polygon points="${P(w, d, h)} ${P(w + 1, d, h)} ${P(w + 1, d + 1, h)} ${P(w, d + 1, h)}" fill="${top}"/>`;
  }

  const total = cells.reduce((a, x) => a + x.c, 0);
  const best = cells.reduce((a, x) => (x.c > a.c ? x : a), cells[0]);
  let label = "";
  if (best.c > 0) {
    const [x, y] = P(best.w + 0.5, best.d + 0.5, height(best.c)).split(",").map(Number);
    const when = new Date(best.date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
    label = `<line x1="${x}" y1="${y - 4}" x2="${x}" y2="${y - 34}" stroke="${t.line}" stroke-width="1"/>` +
      `<text x="${x}" y="${y - 40}" text-anchor="middle" font-size="12" fill="${t.ink}">${best.c} on ${when}</text>`;
  }
  const font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${font}" role="img" aria-label="${total} GitHub contributions in the last year, drawn as a city">` +
    `<text x="14" y="24" font-size="14" fill="${t.ink}">${total} contributions in the last year</text>` +
    shapes + label + `</svg>`;
}

// Use whichever source sees more contributions (the public profile page counts
// private work when "Private contributions" is on in profile settings).
const sum = (d) => (d || []).reduce((a, x) => a + x[1], 0);
let days;
if (process.env.CITY_DATA) days = JSON.parse(readFileSync(process.env.CITY_DATA, "utf8"));
else {
  const [a, b] = await Promise.all([fromGraphQL().catch(() => null), fromProfilePage().catch(() => null)]);
  days = sum(b) >= sum(a) ? b || a : a;
}
if (!days?.length) throw new Error("no contribution data");
mkdirSync(OUT, { recursive: true });
for (const theme of ["light", "dark"]) writeFileSync(`${OUT}/city-${theme}.svg`, draw(days, theme));
console.log(`drew ${days.length} days, ${days.reduce((a, x) => a + x[1], 0)} contributions`);

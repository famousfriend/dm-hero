// Player journal: what the DM hands to the players (quests, places, NPCs) as one
// file to send on Discord, email or USB. The web page works offline in any
// browser and keeps the players' own notes; the text file is the plain version.
// The page text stays English like the item handouts.

import type { PackNpc, PackQuest, PackQuestStatus, PlayerPack } from '~~/types/player-pack'
import { escapeHtml } from './escapeHtml'

const STATUS_LABEL: Record<PackQuestStatus, string> = { active: 'Active', open: 'Open', done: 'Done', failed: 'Failed' }
const STATUS_ORDER: PackQuestStatus[] = ['active', 'open', 'done', 'failed']

function sortQuests(quests: PackQuest[]) {
  return [...quests].sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || a.name.localeCompare(b.name))
}

function exportedDate(pack: PlayerPack) {
  const date = new Date(pack.exportedAt)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "Curse of Strahd - Kara" (safe as a file name) */
export function playerJournalFileName(pack: PlayerPack) {
  const name = [pack.campaign.name, pack.forCharacter].filter(Boolean).join(' - ').replace(/[\\/:*?"<>|]+/g, '').trim()
  return `${name || 'Campaign'} - journal`
}

function subtitle(pack: PlayerPack) {
  return [
    pack.forCharacter ? `Journal of ${pack.forCharacter}` : 'Party journal',
    pack.campaign.dmName ? `DM ${pack.campaign.dmName}` : '',
    exportedDate(pack) ? `Updated ${exportedDate(pack)}` : '',
  ].filter(Boolean).join(' · ')
}

const indent = (text: string) => text.trim().split(/\r?\n/).map(line => `    ${line}`).join('\n')

/** Plain text version (opens in Notepad) */
export function playerJournalText(pack: PlayerPack): string {
  const placeName = new Map(pack.places.map(p => [p.ref, p.name]))
  const lines: string[] = [pack.campaign.name.toUpperCase(), subtitle(pack), '']
  const block = (title: string, entries: string[]) => {
    if (!entries.length) return
    lines.push(title, '-'.repeat(title.length), ...entries, '')
  }
  block('QUESTS', sortQuests(pack.quests).map(q => [
    `[${STATUS_LABEL[q.status]}] ${q.name}`,
    q.reward ? `    Reward: ${q.reward}` : '',
    q.description ? indent(q.description) : '',
  ].filter(Boolean).join('\n')))
  block('PLACES', pack.places.map((p) => {
    const met = pack.npcs.filter(n => n.placeRef === p.ref).map(n => n.name)
    return [`* ${p.name}`, p.description ? indent(p.description) : '', met.length ? `    Met here: ${met.join(', ')}` : ''].filter(Boolean).join('\n')
  }))
  block('NPCS', pack.npcs.map((n: PackNpc) => {
    const where = n.placeRef ? placeName.get(n.placeRef) : undefined
    return [`* ${n.name}${where ? ` (met at ${where})` : ''}`, n.description ? indent(n.description) : ''].filter(Boolean).join('\n')
  }))
  return `${lines.join('\n').trimEnd()}\n`
}

/** JSON that is safe inside a <script> element */
const scriptJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

const PAGE_STYLE = `
:root { color-scheme: dark; --bg: #1A1D29; --card: #232632; --line: #3A3F52; --text: #E8DCC4; --muted: #A99F8C; --accent: #D4A574;
  --active: #D4A574; --open: #7B92AB; --done: #689F38; --failed: #D32F2F; }
@media (prefers-color-scheme: light) { :root { color-scheme: light; --bg: #F7F3EC; --card: #FFFFFF; --line: #DDD3C2; --text: #2B2620; --muted: #6E6355; --accent: #9A6A33; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); font: 15px/1.5 system-ui, "Segoe UI", Roboto, sans-serif; }
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { margin: 0; font-size: 28px; color: var(--accent); overflow-wrap: anywhere; }
h2 { margin: 32px 0 12px; font-size: 20px; border-bottom: 1px solid var(--line); padding-bottom: 6px; }
.sub, .hint { color: var(--muted); }
.hint { font-size: 13px; margin: 8px 0 0; }
.bar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.bar input { flex: 1 1 220px; min-width: 0; }
input, textarea, button { font: inherit; color: var(--text); background: var(--card); border: 1px solid var(--line); border-radius: 6px; }
input { padding: 8px 10px; }
button { padding: 8px 14px; cursor: pointer; }
button.primary { background: var(--accent); color: #1A1D29; border-color: var(--accent); }
textarea { width: 100%; min-height: 64px; padding: 8px 10px; resize: vertical; margin-top: 8px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; }
.card { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 14px; min-width: 0; }
.card h3 { margin: 0; font-size: 17px; overflow-wrap: anywhere; }
.head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.chip { flex: none; font-size: 12px; padding: 2px 10px; border-radius: 999px; color: #fff; }
.chip.active { background: var(--active); color: #1A1D29; } .chip.open { background: var(--open); }
.chip.done { background: var(--done); } .chip.failed { background: var(--failed); }
.meta { color: var(--muted); font-size: 14px; margin: 4px 0 0; overflow-wrap: anywhere; }
.desc { white-space: pre-wrap; overflow-wrap: anywhere; margin: 8px 0 0; }
details > summary { cursor: pointer; color: var(--muted); margin: 12px 0; }
.empty { color: var(--muted); }
[hidden] { display: none !important; }
@media print {
  :root { --bg: #fff; --card: #fff; --text: #000; --muted: #444; --line: #bbb; --accent: #000; }
  .bar, .hint, textarea:placeholder-shown { display: none; }
  .card { break-inside: avoid; }
  details > *:not(summary) { display: block; }
}
`

// Runs in the player's browser. Notes are kept per entry ref in this browser
// (localStorage) and baked into the file by "Save my copy", so a newer file
// from the DM shows the same notes again.
const PAGE_SCRIPT = `
(function () {
  var source = '<!doctype html>\\n' + document.documentElement.outerHTML;
  var data = JSON.parse(document.getElementById('journal-data').textContent);
  var baked = JSON.parse(document.getElementById('journal-notes').textContent || '{}');
  var app = document.getElementById('app');
  var STATUS = { active: 'Active', open: 'Open', done: 'Done', failed: 'Failed' };
  var ORDER = ['active', 'open', 'done', 'failed'];
  var store = null;
  try { store = window.localStorage; store.getItem('x'); } catch (e) { store = null; }
  var key = function (ref) { return 'dmcc-journal:' + ref; };
  var notes = {};
  var noteOf = function (ref) {
    var saved = null;
    try { saved = store && store.getItem(key(ref)); } catch (e) {}
    return saved !== null && saved !== undefined ? saved : (baked[ref] || '');
  };

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  }
  function noteBox(ref, placeholder) {
    var box = el('textarea');
    box.placeholder = placeholder || 'My notes';
    box.value = notes[ref] = noteOf(ref);
    box.addEventListener('input', function () {
      notes[ref] = box.value;
      try { store && store.setItem(key(ref), box.value); } catch (e) {}
    });
    return box;
  }
  function card(entry, chip, metaLines) {
    var c = el('div', 'card');
    var head = el('div', 'head');
    head.appendChild(el('h3', '', entry.name));
    if (chip) head.appendChild(el('span', 'chip ' + chip, STATUS[chip]));
    c.appendChild(head);
    metaLines.forEach(function (line) { if (line) c.appendChild(el('p', 'meta', line)); });
    if (entry.description) c.appendChild(el('p', 'desc', entry.description));
    c.appendChild(noteBox(entry.ref));
    c.dataset.search = [entry.name, entry.description].concat(metaLines).join(' ').toLowerCase();
    return c;
  }
  function section(title, cards, emptyText) {
    var s = el('section');
    s.appendChild(el('h2', '', title + ' (' + cards.length + ')'));
    var grid = el('div', 'grid');
    cards.forEach(function (c) { grid.appendChild(c); });
    s.appendChild(cards.length ? grid : el('p', 'empty', emptyText));
    app.appendChild(s);
    return grid;
  }

  var placeName = {};
  data.places.forEach(function (p) { placeName[p.ref] = p.name; });
  var quests = data.quests.slice().sort(function (a, b) { return ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.name.localeCompare(b.name); });
  var current = quests.filter(function (q) { return q.status === 'active' || q.status === 'open'; });
  var finished = quests.filter(function (q) { return q.status === 'done' || q.status === 'failed'; });
  var questCard = function (q) { return card(q, q.status, [q.reward ? 'Reward: ' + q.reward : '']); };

  var journal = el('section');
  journal.appendChild(el('h2', '', 'My journal'));
  journal.appendChild(noteBox(data.campaign.ref + ':journal', 'Anything you want to remember about the campaign'));
  app.appendChild(journal);

  section('Quests', current.map(questCard), 'No open quests right now.');
  if (finished.length) {
    var more = el('details');
    more.appendChild(el('summary', '', 'Finished quests (' + finished.length + ')'));
    var grid = el('div', 'grid');
    finished.forEach(function (q) { grid.appendChild(questCard(q)); });
    more.appendChild(grid);
    app.lastChild.appendChild(more);
  }
  section('Places', data.places.map(function (p) {
    var met = data.npcs.filter(function (n) { return n.placeRef === p.ref; }).map(function (n) { return n.name; });
    return card(p, null, [met.length ? 'Met here: ' + met.join(', ') : '']);
  }), 'No places yet.');
  section('NPCs', data.npcs.map(function (n) {
    return card(n, null, [n.placeRef && placeName[n.placeRef] ? 'Met at ' + placeName[n.placeRef] : '']);
  }), 'No NPCs yet.');

  document.getElementById('search').addEventListener('input', function (e) {
    var q = e.target.value.trim().toLowerCase();
    app.querySelectorAll('.card').forEach(function (c) {
      var text = c.dataset.search + ' ' + c.querySelector('textarea').value.toLowerCase();
      c.hidden = !!q && text.indexOf(q) === -1;
    });
    if (q && more) more.open = true;
  });
  document.getElementById('print').addEventListener('click', function () { window.print(); });
  document.getElementById('save').addEventListener('click', function () {
    var json = JSON.stringify(notes).replace(/</g, '\\\\u003c');
    var html = source.replace(/(<script id="journal-notes" type="application\\/json">)[\\s\\S]*?(<\\/script>)/, function (_, a, b) { return a + json + b; });
    var link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    link.download = document.title + '.html';
    document.body.appendChild(link);
    link.click();
    link.remove();
  });
})();
`

/** Self-contained web page: no internet, no external files */
export function playerJournalHtml(pack: PlayerPack): string {
  const title = escapeHtml(playerJournalFileName(pack))
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src blob: data:">
<title>${title}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
<header>
<h1>${escapeHtml(pack.campaign.name)}</h1>
<div class="sub">${escapeHtml(subtitle(pack))}</div>
<div class="bar">
<input id="search" type="search" placeholder="Search">
<button id="save" class="primary" type="button">Save my copy</button>
<button id="print" type="button">Print</button>
</div>
<p class="hint">Your notes are kept in this browser, and come back when your DM sends a newer version of this page. To keep them inside the file (for another computer or a backup), click Save my copy.</p>
</header>
<div id="app"></div>
<noscript><p>This page needs JavaScript to show the journal. Open the text version instead, or allow scripts for this file.</p></noscript>
</main>
<script id="journal-data" type="application/json">${scriptJson(pack)}</script>
<script id="journal-notes" type="application/json">{}</script>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`
}

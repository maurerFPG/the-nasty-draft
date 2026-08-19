/* The 'Nasty — remaining-name glance. No pick recommender. */
(() => {
  const TARGETS_KEY = "nasty-draft-hq-targets-v1";
  const BOARD_H_KEY = "nasty-ui-board-h-v1";
  const CARD_H_KEY = "nasty-ui-card-h-v1";
  const COL_L_KEY = "nasty-ui-col-left-v1";
  const POLL_MS = 30000;
  const ROB_USER = "469299052404535296";

  const state = {
    players: [],
    byId: new Map(),
    draft: null,
    sources: {},
    match: {},
    picks: [],
    draftedIds: new Set(),
    pickByOverall: new Map(),
    robTaken: [],
    selectedId: null,
    filterPos: "ALL",
    search: "",
    targets: new Set(),
    lastPoll: null,
    pollError: null,
    draftStatus: "pre_draft",
    research: { key: null, status: "idle", headlines: [], error: null },
  };

  const $ = (id) => document.getElementById(id);

  function loadTargets() {
    try {
      const raw = JSON.parse(localStorage.getItem(TARGETS_KEY) || "[]");
      state.targets = new Set((raw || []).map(String));
    } catch {
      state.targets = new Set();
    }
  }
  function saveTargets() {
    localStorage.setItem(TARGETS_KEY, JSON.stringify([...state.targets]));
  }

  function loadLayout() {
    const h = Number(localStorage.getItem(BOARD_H_KEY));
    const ch = Number(localStorage.getItem(CARD_H_KEY));
    const left = Number(localStorage.getItem(COL_L_KEY));
    if (Number.isFinite(h) && h >= 120) {
      document.documentElement.style.setProperty("--board-h", Math.round(h) + "px");
    }
    if (Number.isFinite(ch) && ch >= 88) {
      document.documentElement.style.setProperty("--card-h", Math.round(ch) + "px");
    }
    if (Number.isFinite(left) && left >= 22 && left <= 78) {
      document.documentElement.style.setProperty("--col-left", left + "fr");
      document.documentElement.style.setProperty("--col-right", 100 - left + "fr");
    }
  }

  function bindSplitters() {
    const hs = $("split-h");
    const hsc = $("split-h-card");
    const vs = $("split-v");
    const pane = $("board-pane");
    const cardPane = $("card-pane");
    const cols = $("cols");

    function bind(el, kind, onMove, onEnd) {
      el.addEventListener("pointerdown", (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        el.setPointerCapture(ev.pointerId);
        el.classList.add("dragging");
        document.body.classList.add(kind === "h" ? "resizing-h" : "resizing-v");
        const move = (e) => onMove(e);
        const up = (e) => {
          try { el.releasePointerCapture(e.pointerId); } catch { /* already released */ }
          el.classList.remove("dragging");
          document.body.classList.remove("resizing-h", "resizing-v");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          onEnd();
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      });
    }

    bind(hs, "h", (e) => {
      const top = pane.getBoundingClientRect().top;
      const max = Math.floor(window.innerHeight * 0.7);
      const hgt = Math.min(Math.max(e.clientY - top, 120), max);
      document.documentElement.style.setProperty("--board-h", hgt + "px");
    }, () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--board-h").trim();
      const px = raw.endsWith("px") ? parseFloat(raw) : pane.getBoundingClientRect().height;
      if (Number.isFinite(px)) localStorage.setItem(BOARD_H_KEY, String(Math.round(px)));
    });

    bind(hsc, "h", (e) => {
      const top = cardPane.getBoundingClientRect().top;
      const max = Math.floor(window.innerHeight * 0.55);
      const hgt = Math.min(Math.max(e.clientY - top, 88), max);
      document.documentElement.style.setProperty("--card-h", hgt + "px");
    }, () => {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--card-h").trim();
      const px = raw.endsWith("px") ? parseFloat(raw) : cardPane.getBoundingClientRect().height;
      if (Number.isFinite(px)) localStorage.setItem(CARD_H_KEY, String(Math.round(px)));
    });

    bind(vs, "v", (e) => {
      const box = cols.getBoundingClientRect();
      if (box.width < 40) return;
      const pct = ((e.clientX - box.left) / box.width) * 100;
      const clamped = Math.min(78, Math.max(22, pct));
      document.documentElement.style.setProperty("--col-left", clamped + "fr");
      document.documentElement.style.setProperty("--col-right", 100 - clamped + "fr");
    }, () => {
      const left = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--col-left"));
      const right = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--col-right"));
      if (Number.isFinite(left) && Number.isFinite(right) && left + right > 0) {
        const pct = (left / (left + right)) * 100;
        localStorage.setItem(COL_L_KEY, String(Math.round(pct * 10) / 10));
      }
    });
  }

  function lastName(full) {
    if (!full) return "";
    const suf = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
    const parts = full.replace(/,/g, "").trim().split(/\s+/);
    while (parts.length > 1 && suf.has(parts[parts.length - 1].toLowerCase().replace(/\./g, ""))) {
      parts.pop();
    }
    if (parts.length >= 2 && /^st\.?$/i.test(parts[parts.length - 2])) {
      return `${parts[parts.length - 2]} ${parts[parts.length - 1]}`;
    }
    return parts[parts.length - 1] || full;
  }

  function fmtAdp(v) {
    if (v == null || Number.isNaN(Number(v))) return "—";
    return Number(v).toFixed(1);
  }
  function fmtFoRank(v) {
    if (v == null) return "—";
    return String(v);
  }
  function fmtRank(v) {
    if (v == null) return "—";
    return `#${v}`;
  }
  function gapClass(gap) {
    if (gap == null) return "flat";
    if (gap >= 8) return "steal";
    if (gap <= -8) return "reach";
    return "flat";
  }
  function gapLabel(gap) {
    if (gap == null) return "—";
    const n = Number(gap);
    const sign = n > 0 ? "+" : "";
    if (n >= 8) return `+${n}`;
    if (n <= -8) return `${n}`;
    return `${sign}${n}`;
  }
  function playerKey(p) {
    return p.id != null ? String(p.id) : `name:${p.name}`;
  }
  function remaining(p) {
    return !p.id || !state.draftedIds.has(String(p.id));
  }
  function matchesFilter(p) {
    if (!remaining(p)) return false;
    if (state.filterPos === "TARGETS") {
      if (!p.id || !state.targets.has(String(p.id))) return false;
    } else if (state.filterPos !== "ALL" && p.pos !== state.filterPos) {
      return false;
    }
    const q = state.search.trim().toLowerCase();
    if (!q) return true;
    return (
      (p.name || "").toLowerCase().includes(q) ||
      (p.team || "").toLowerCase().includes(q) ||
      (p.pos || "").toLowerCase() === q
    );
  }

  function teamLogoUrl(team) {
    if (!team || team === "FA") return null;
    return `https://sleepercdn.com/images/team_logos/nfl/${String(team).toLowerCase()}.png`;
  }
  function logoHtml(team) {
    const url = teamLogoUrl(team);
    if (!url) return `<span class="logo ph" aria-hidden="true"></span>`;
    return `<img class="logo" src="${esc(url)}" alt="" onerror="this.style.display='none'" />`;
  }
  function headshotHtml(id) {
    if (!id) return `<span class="headshot ph" aria-hidden="true"></span>`;
    const url = `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;
    return `<img class="headshot" src="${esc(url)}" alt="" onerror="this.style.display='none'" />`;
  }

  function heatMark(p) {
    if (p.hot) return `<span class="heat fire" title="Trending add or rising public buzz">🔥</span>`;
    if (p.cold) return `<span class="heat ice" title="Trending drop (48h)">🧊</span>`;
    return "";
  }
  function rookieChip(p) {
    if (!p.is_rookie) return "";
    const rnd = Number(p.nfl_draft_round);
    const known = Number.isFinite(rnd) && rnd > 0;
    const lab = known ? "R" + rnd : "UDFA";
    const title = known ? `2026 rookie · NFL draft round ${rnd}` : "2026 rookie · undrafted free agent";
    return `<span class="rchip" title="${esc(title)}">${esc(lab)}</span>`;
  }
  function rookieCell(p) {
    return rookieChip(p) || `<span class="rchip empty" aria-hidden="true"></span>`;
  }
  function injuryAbbrev(status) {
    const s = String(status || "").trim();
    if (!s) return "";
    const map = {
      Questionable: "Q",
      Doubtful: "D",
      Out: "O",
      IR: "IR",
      PUP: "PUP",
      NA: "NA",
      Sus: "Sus",
      DNR: "DNR",
    };
    return map[s] || s;
  }
  function injuryTone(status) {
    const s = String(status || "").trim().toLowerCase();
    if (s === "questionable") return "q";
    if (s === "out" || s === "ir" || s === "doubtful") return "out";
    return "other";
  }
  function injuryBadge(p) {
    const st = String(p.injury_status || "").trim();
    if (!st) return "";
    const abbr = injuryAbbrev(st);
    if (!abbr) return "";
    const bits = [st];
    if (p.injury_body_part) bits.push(p.injury_body_part);
    return `<span class="ichip ${injuryTone(st)}" title="${esc(bits.join(" · "))}">${esc(abbr)}</span>`;
  }
  function injuryLine(p) {
    const st = String(p.injury_status || "").trim();
    if (!st) return `<div class="inj none">No injury listed.</div>`;
    const bits = [st];
    if (p.injury_body_part) bits.push(p.injury_body_part);
    if (p.injury_notes) bits.push(p.injury_notes);
    return `<div class="inj ${injuryTone(st)}">${esc(bits.join(" · "))}</div>`;
  }
  function nameCell(p) {
    const rook = p.is_rookie ? " rookie" : "";
    return `<span class="c-who">${heatMark(p)}<span class="c-name${rook}">${esc(p.name)}</span>${injuryBadge(p)}</span>`;
  }

  function nextEmptyPick() {
    const map = state.draft?.pick_map || [];
    for (const cell of map) {
      if (!state.pickByOverall.has(cell.overall)) return cell;
    }
    return null;
  }
  function nextRobPick() {
    const map = state.draft?.pick_map || [];
    for (const cell of map) {
      if (cell.is_rob && !state.pickByOverall.has(cell.overall)) return cell;
    }
    return null;
  }

  function isRobPick(pk) {
    const robUser = String(state.draft?.rob_user_id || ROB_USER);
    if (pk.picked_by && String(pk.picked_by) === robUser) return true;
    const slot = (state.draft?.slots || []).find((s) => s.is_rob) || { slot: 3, roster_id: 12 };
    if (pk.roster_id != null && Number(pk.roster_id) === Number(slot.roster_id)) return true;
    if (pk.draft_slot != null && Number(pk.draft_slot) === Number(slot.slot)) return true;
    return false;
  }

  function renderBoard() {
    const board = $("board");
    const d = state.draft;
    if (!d) return;
    const frag = document.createDocumentFragment();
    const corner = document.createElement("div");
    corner.className = "b-corner";
    frag.appendChild(corner);
    for (const slot of d.slots) {
      const el = document.createElement("div");
      el.className = "b-team" + (slot.slot === d.rob_slot ? " rob" : "");
      el.innerHTML = `<div class="tn">${esc(slot.short || slot.display)}</div>`;
      frag.appendChild(el);
    }
    const next = nextEmptyPick();
    const byRound = new Map();
    for (const cell of d.pick_map) {
      if (!byRound.has(cell.round)) byRound.set(cell.round, []);
      byRound.get(cell.round).push(cell);
    }
    for (let rnd = 1; rnd <= d.rounds; rnd++) {
      const rh = document.createElement("div");
      rh.className = "b-rnd";
      rh.textContent = rnd;
      frag.appendChild(rh);
      const row = byRound.get(rnd) || [];
      const bySlot = new Map(row.map((c) => [c.slot, c]));
      for (let slot = 1; slot <= d.teams; slot++) {
        const cell = bySlot.get(slot);
        const el = document.createElement("div");
        const pick = cell ? state.pickByOverall.get(cell.overall) : null;
        const cls = ["b-cell"];
        if (cell?.is_rob) cls.push("rob");
        if (pick) {
          cls.push("filled");
          const pos = (pick.position || "").toUpperCase();
          if (pos) cls.push("pos-" + pos);
          const nm = lastName(pick.name);
          el.innerHTML = `<span class="nm">${esc(nm)}</span><span class="p">${esc(pos)}</span>`;
          el.title = `${cell.label} · ${pick.name} (${pos} ${pick.team || ""})`;
        } else {
          if (next && cell && cell.overall === next.overall) cls.push("next");
          el.innerHTML = `<span class="lbl">${esc(cell ? cell.label : "")}</span>`;
          el.title = cell ? `${cell.label} · slot ${cell.slot}` : "";
        }
        el.className = cls.join(" ");
        frag.appendChild(el);
      }
    }
    board.replaceChildren(frag);
  }

  function renderMyPicks() {
    const el = $("mypicks-list");
    if (!el) return;
    const taken = state.robTaken;
    if (!taken.length) {
      el.innerHTML = `<span class="mp-empty">No picks yet</span>`;
      return;
    }
    el.innerHTML = taken
      .map((p) => {
        return `<span class="mp-chip">${logoHtml(p.team)}<span class="mp-name">${esc(p.name)}</span><span class="c-pos ${esc(p.position || "")}">${esc(p.position || "")}</span></span>`;
      })
      .join("");
  }

  function renderLists() {
    const foPending = state.match && state.match.fo_file_present === false;
    const fo = $("list-fo");
    const fp = $("list-fp");
    if (foPending) {
      fo.innerHTML = `<div class="empty-col"><strong>ADP snapshot pending</strong>Drop <code>fantasy_orphans_sf_tep_adp.csv</code> into <code>/workspace/ff-dynasty/data/</code> and run <code>python3 dashboard/build_data.py</code>. Left column stays empty until then — no invented ADP.</div>`;
      $("count-fo").textContent = "0";
    } else {
      const foRows = state.players
        .filter((p) => p.fo_adp != null && matchesFilter(p))
        .sort((a, b) => (a.fo_rank || 9999) - (b.fo_rank || 9999) || a.fo_adp - b.fo_adp);
      fo.replaceChildren(...foRows.map((p) => rowEl(p, "fo")));
      $("count-fo").textContent = `${foRows.length} left`;
    }
    const fpRows = state.players
      .filter((p) => p.fp_rank != null && matchesFilter(p))
      .sort((a, b) => a.fp_rank - b.fp_rank);
    fp.replaceChildren(...fpRows.map((p) => rowEl(p, "fp")));
    $("count-fp").textContent = `${fpRows.length} left`;
  }

  function rowEl(p, side) {
    const el = document.createElement("div");
    const key = playerKey(p);
    const sel = state.selectedId && key === String(state.selectedId);
    const tgt = p.id && state.targets.has(String(p.id));
    el.className = "rowp " + (side === "fo" ? "fo" : "fp") + (sel ? " sel" : "") + (tgt ? " tgt" : "");
    el.dataset.key = key;
    const rank =
      side === "fo"
        ? `<span class="c-rank" title="FO list order">${esc(fmtFoRank(p.fo_rank))}</span><span class="c-adp" title="${esc(p.fo_pick || "ADP")}">${esc(fmtAdp(p.fo_adp))}</span>`
        : `<span class="c-rank">${esc(fmtRank(p.fp_rank))}</span>`;
    el.innerHTML = `
      <span class="c-mark">
        <button type="button" class="star${tgt ? " on" : ""}" data-star="${esc(p.id || "")}" title="Target">${tgt ? "★" : "☆"}</button>
      </span>
      ${rank}
      ${logoHtml(p.team)}
      ${nameCell(p)}
      ${rookieCell(p)}
      <span class="c-pos ${esc(p.pos || "")}">${esc(p.pos || "")}</span>
      <span class="c-gap ${gapClass(p.gap)}">${esc(gapLabel(p.gap))}</span>
    `;
    el.addEventListener("click", (ev) => {
      const t = ev.target instanceof Element ? ev.target : ev.target && ev.target.parentElement;
      if (t && t.closest && t.closest("[data-star], .star")) return;
      selectPlayer(key);
    });
    const star = el.querySelector("[data-star]");
    if (star) {
      star.addEventListener("click", (ev) => {
        ev.stopPropagation();
        if (!p.id) return;
        toggleTarget(String(p.id));
      });
    }
    return el;
  }

  function toggleTarget(id) {
    if (state.targets.has(id)) state.targets.delete(id);
    else state.targets.add(id);
    saveTargets();
    renderLists();
    renderCard();
  }

  function selectPlayer(key) {
    if (state.selectedId && String(state.selectedId) !== String(key)) {
      state.research = { key: null, status: "idle", headlines: [], error: null };
    }
    state.selectedId = key;
    renderLists();
    renderCard();
    document.querySelectorAll(".rowp.sel").forEach((el) => {
      el.scrollIntoView({ block: "nearest" });
    });
  }

  function findPlayer(key) {
    if (!key) return null;
    if (state.byId.has(String(key))) return state.byId.get(String(key));
    return state.players.find((p) => playerKey(p) === String(key)) || null;
  }

  function alternates(p) {
    const pool = state.players.filter((o) => remaining(o) && playerKey(o) !== playerKey(p));
    const scored = [];
    for (const o of pool) {
      let score = 0;
      const samePos = o.pos && p.pos && o.pos === p.pos;
      if (samePos) score += 30;
      if (p.fp_rank != null && o.fp_rank != null) {
        const d = Math.abs(o.fp_rank - p.fp_rank);
        if (d <= 8) score += 24 - d;
        else if (d <= 15 && samePos) score += 10;
      }
      if (p.fo_adp != null && o.fo_adp != null) {
        const d = Math.abs(o.fo_adp - p.fo_adp);
        if (d <= 8) score += 24 - d;
        else if (d <= 15 && samePos) score += 10;
      }
      if (score <= 0) continue;
      scored.push({ o, score });
    }
    scored.sort((a, b) => b.score - a.score);
    const out = [];
    const seen = new Set();
    for (const { o } of scored) {
      const k = playerKey(o);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(o);
      if (out.length >= 5) break;
    }
    return out.slice(0, Math.max(3, Math.min(5, out.length)));
  }

  function trimHeadline(title) {
    const t = String(title || "").replace(/\s+/g, " ").trim();
    if (t.length <= 110) return t;
    return t.slice(0, 107).replace(/\s+\S*$/, "") + "…";
  }

  function synthesizeBrief(headlines, name) {
    /* Headline synthesis only — not a ranking or a Grok take. */
    const items = (headlines || []).filter((h) => h && h.title);
    if (!items.length) return "";
    const titles = items.map((h) => String(h.title).replace(/\s+/g, " ").trim());
    const sources = [...new Set(items.map((h) => h.source).filter(Boolean))];
    const who = name || "this player";
    const checks = [
      ["injury or availability", /injur|questionable|doubtful|\bir\b|pup|hamstring|ankle|knee|concussion|surgery|ailment|limited|week-to-week/i],
      ["training camp", /camp|practice|preseason|workout|reps|padded/i],
      ["role or usage", /role|starter|starting|snap|usage|committee|backup|depth chart|target|workload|feature|first-team|first team/i],
      ["a trade", /trade|traded|acquired|dealt/i],
      ["contract news", /contract|extension|franchise tag/i],
      ["a suspension", /suspend/i],
    ];
    const themes = [];
    for (const [label, re] of checks) {
      if (titles.some((t) => re.test(t))) themes.push(label);
    }
    const sentences = [];
    if (themes.length) {
      const listed =
        themes.length === 1
          ? themes[0]
          : themes.slice(0, -1).join(", ") + " and " + themes[themes.length - 1];
      sentences.push(`Recent public headlines on ${who} are mostly about ${listed}.`);
    } else {
      sentences.push(`Recent public headlines mention ${who} in NFL coverage.`);
    }
    if (titles[0]) sentences.push(`One thread: “${trimHeadline(titles[0])}.”`);
    if (titles[1] && sentences.length < 4) sentences.push(`Another: “${trimHeadline(titles[1])}.”`);
    if (sources.length && sentences.length < 4) {
      sentences.push(`Sources in the feed include ${sources.slice(0, 3).join(", ")}.`);
    }
    return sentences.slice(0, 4).join(" ");
  }

  function researchBlock(p) {
    const r = state.research;
    const same = r.key && r.key === playerKey(p);
    if (!same || r.status === "idle") {
      return `<div class="flash" id="research-flash">Research fetches recent public headlines (Google News RSS). Needs internet.</div>`;
    }
    if (r.status === "loading") {
      return `<div class="flash" id="research-flash">Loading headlines…</div>`;
    }
    if (r.status === "err") {
      return `<div class="flash err" id="research-flash">${esc(r.error || "Research failed.")}</div>`;
    }
    if (r.status === "empty" || !r.headlines.length) {
      return `<div class="flash" id="research-flash">No headlines found</div>`;
    }
    const brief = synthesizeBrief(r.headlines, p.name);
    const lis = r.headlines
      .slice(0, 3)
      .map((h) => {
        const src = h.source ? `<em>${esc(h.source)}</em>` : "";
        return `<li><a href="${esc(h.url)}" target="_blank" rel="noopener noreferrer">${esc(h.title)}</a>${src}</li>`;
      })
      .join("");
    return `<div class="coverage" id="research-flash"><div class="k">From recent coverage</div><p class="brief">${esc(brief)}</p><ul class="hl-list compact">${lis}</ul></div>`;
  }

  /*
   * Est. gone before Rob's next pick — OUR logistic, not FantasyPros mock odds.
   *   current_pick = max(picks.pick_no)+1, or 1 if the board is empty
   *   Rob remaining pick numbers come from the 3RR map (slot 3): 3, 22, 34, 39, …
   *     skip any already past
   *   next_pick = smallest Rob pick_no >= current_pick
   *   picks_until = next_pick - current_pick
   *   Use fo_adp if present, else fp_rank as a fallback stand-in
   *     (label says ADP-based when fo_adp exists; if only FP rank, say “ECR stand-in”)
   *   x = (adp - next_pick) / max(3, picks_until * 0.35 + 2)
   *   P(gone) = 1 / (1 + exp(x))
   *   ADP well before his next pick → high %; ADP after his pick → lower %;
   *   as the room reaches a steal (ADP << current), % goes to ~100.
   *   Clamp 1–99. Hide for already-drafted players.
   */
  function currentPickNo() {
    let max = 0;
    for (const pk of state.picks) {
      const n = Number(pk.pick_no || pk.pickNo);
      if (Number.isFinite(n) && n > max) max = n;
    }
    return max > 0 ? max + 1 : 1;
  }

  function goneBeforeEstimate(p) {
    if (!p) return null;
    if (p.id && state.draftedIds.has(String(p.id))) return null;
    const current = currentPickNo();
    const map = state.draft?.pick_map || [];
    const rob = map.find((cell) => cell.is_rob && cell.overall >= current && !state.pickByOverall.has(cell.overall));
    if (!rob) return null;
    const nextPick = rob.overall;
    const picksUntil = nextPick - current;
    const hasAdp = p.fo_adp != null && !Number.isNaN(Number(p.fo_adp));
    const adp = hasAdp ? Number(p.fo_adp) : p.fp_rank != null ? Number(p.fp_rank) : null;
    if (adp == null || Number.isNaN(adp)) return null;
    const x = (adp - nextPick) / Math.max(3, picksUntil * 0.35 + 2);
    const raw = 1 / (1 + Math.exp(x));
    const pct = Math.min(99, Math.max(1, Math.round(raw * 100)));
    return {
      pct,
      label: rob.label,
      source: hasAdp ? "adp" : "ecr",
    };
  }

  function goneBlock(p) {
    const g = goneBeforeEstimate(p);
    if (!g) return "";
    const cap =
      g.source === "adp"
        ? "Est. gone before your next pick · Sleeper-sample ADP, not FantasyPros."
        : "Est. gone before your next pick · ECR stand-in, not FantasyPros.";
    return `<div class="gone-est"><div class="gone-num"><b>${g.pct}%</b> gone before ${esc(g.label)}</div><div class="gone-cap">${esc(cap)}</div></div>`;
  }

  function renderCard() {
    const card = $("player-card");
    const p = findPlayer(state.selectedId);
    if (!p) {
      card.innerHTML = `<div class="card-empty">Click a player</div>`;
      return;
    }
    const tgt = p.id && state.targets.has(String(p.id));
    const alts = alternates(p);
    const exp = p.years_exp == null ? "" : p.years_exp === 0 ? " · rookie" : ` · ${p.years_exp} yr`;
    const rook = p.is_rookie ? " · rookie" : "";
    const age = p.age == null ? "" : ` · ${p.age}`;
    card.innerHTML = `
      <div class="card-top">
        ${headshotHtml(p.id)}
        <div class="card-id">
          <div class="who">${heatMark(p)}<span class="${p.is_rookie ? "rookie" : ""}">${esc(p.name)}</span>${rookieChip(p)}${injuryBadge(p)}</div>
          <div class="meta"><span class="c-pos ${esc(p.pos || "")}">${esc(p.pos || "")}</span> · ${esc(p.team || "FA")}${age}${exp}${p.is_rookie && p.years_exp !== 0 ? rook : ""}</div>
          ${injuryLine(p)}
        </div>
        <div class="stat">
          <div class="k">Rank</div>
          <div class="v">${esc(fmtFoRank(p.fo_rank))}</div>
        </div>
        <div class="stat">
          <div class="k">ADP</div>
          <div class="v">${esc(fmtAdp(p.fo_adp))}</div>
        </div>
        <div class="stat">
          <div class="k">ECR</div>
          <div class="v">${esc(fmtRank(p.fp_rank))}</div>
        </div>
        <div class="stat">
          <div class="k">Gap</div>
          <div class="v ${gapClass(p.gap)}">${esc(gapLabel(p.gap))}</div>
        </div>
        <div class="card-ops">
          <button type="button" class="toggle${tgt ? " on" : ""}" id="btn-target">${tgt ? "★ Target" : "☆ Target"}</button>
          <button type="button" class="btn" id="btn-research">Research</button>
          <button type="button" class="card-x" id="btn-close" title="Clear">×</button>
        </div>
      </div>
      ${goneBlock(p)}
      <div class="alts">
        <div class="k">Nearby on the boards</div>
        <div class="alt-list">
          ${
            alts.length
              ? alts
                  .map((a) => {
                    const bits = [];
                    if (a.fo_adp != null) bits.push("ADP " + fmtAdp(a.fo_adp));
                    if (a.fp_rank != null) bits.push("ECR #" + a.fp_rank);
                    return `<button type="button" class="alt" data-alt="${esc(playerKey(a))}"><b>${esc(a.name)}</b> ${esc(a.pos || "")} <em>${esc(bits.join(" · "))}</em></button>`;
                  })
                  .join("")
              : `<span class="flash">No close neighbors on these boards.</span>`
          }
        </div>
        ${researchBlock(p)}
      </div>
    `;
    $("btn-target").addEventListener("click", () => {
      if (p.id) toggleTarget(String(p.id));
    });
    $("btn-research").addEventListener("click", () => fetchResearch(p, alts));
    $("btn-close").addEventListener("click", () => {
      state.selectedId = null;
      state.research = { key: null, status: "idle", headlines: [], error: null };
      renderLists();
      renderCard();
    });
    card.querySelectorAll("[data-alt]").forEach((btn) => {
      btn.addEventListener("click", () => selectPlayer(btn.getAttribute("data-alt")));
    });
  }

  async function fetchResearch(p, alts) {
    const key = playerKey(p);
    state.research = { key, status: "loading", headlines: [], error: null };
    renderCard();
    const payload = {
      player_id: p.id || null,
      name: p.name,
      fp_rank: p.fp_rank,
      fo_adp: p.fo_adp,
      alternates: alts.map((a) => ({
        player_id: a.id || null,
        name: a.name,
        pos: a.pos,
        fp_rank: a.fp_rank,
        fo_adp: a.fo_adp,
      })),
    };
    try {
      const res = await fetch("/research", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const js = await res.json();
      const headlines = Array.isArray(js.headlines) ? js.headlines : [];
      state.research = {
        key,
        status: headlines.length ? "ok" : "empty",
        headlines,
        error: null,
      };
    } catch (err) {
      state.research = {
        key,
        status: "err",
        headlines: [],
        error: "Could not fetch headlines. Check internet and that this page is served from the local app.",
      };
    }
    if (state.selectedId && playerKey(p) === String(state.selectedId)) renderCard();
  }

  function renderChrome() {
    const status = state.draftStatus || state.draft?.status || "pre_draft";
    const pill = $("draft-status");
    pill.textContent = String(status).replace(/_/g, " ").toUpperCase();
    pill.className = "status-pill" + (status === "drafting" ? " live" : status === "complete" ? " done" : "");
    const robNext = nextRobPick();
    const onClock = nextEmptyPick();
    const chip = $("rob-chip");
    if (robNext) {
      $("rob-next").textContent =
        onClock && onClock.is_rob ? `On the clock · ${robNext.label}` : `Next: ${robNext.label}`;
      chip.classList.toggle("up", !!(onClock && onClock.is_rob));
    } else {
      $("rob-next").textContent = "Board complete";
      chip.classList.remove("up");
    }
    const meta = $("poll-meta");
    if (state.pollError) meta.textContent = "Picks poll failed · " + state.pollError;
    else if (state.lastPoll) meta.textContent = `Picks ${state.picks.length} · ${state.lastPoll}`;
    else meta.textContent = "Picks poll every 30s";
    const dot = $("poll-dot");
    dot.className = "poll-dot" + (state.pollError ? " err" : state.lastPoll ? " ok" : "");
  }

  function tickCountdown() {
    const el = $("countdown");
    const iso = state.draft?.start_time_ct;
    if (!iso) {
      el.textContent = "—";
      return;
    }
    if (state.draftStatus === "drafting") {
      el.textContent = "LIVE";
      return;
    }
    if (state.draftStatus === "complete") {
      el.textContent = "FINAL";
      return;
    }
    const start = new Date(iso).getTime();
    const now = Date.now();
    let ms = start - now;
    if (ms <= 0) {
      el.textContent = "START WINDOW";
      return;
    }
    const d = Math.floor(ms / 86400000);
    ms -= d * 86400000;
    const h = Math.floor(ms / 3600000);
    ms -= h * 3600000;
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms - m * 60000) / 1000);
    el.textContent = d > 0 ? `${d}d ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function applyPicks(picks) {
    state.picks = Array.isArray(picks) ? picks : [];
    state.draftedIds = new Set();
    state.pickByOverall = new Map();
    state.robTaken = [];
    for (const pk of state.picks) {
      const overall = Number(pk.pick_no || pk.pickNo);
      const pid = pk.player_id != null ? String(pk.player_id) : null;
      if (pid) state.draftedIds.add(pid);
      const meta = pk.metadata || {};
      const name =
        [meta.first_name, meta.last_name].filter(Boolean).join(" ") ||
        (pid && state.byId.get(pid)?.name) ||
        "Unknown";
      const rec = {
        overall,
        player_id: pid,
        name,
        position: meta.position || state.byId.get(pid)?.pos || "",
        team: meta.team || state.byId.get(pid)?.team || "",
        slot: pk.draft_slot,
        picked_by: pk.picked_by,
        roster_id: pk.roster_id,
        draft_slot: pk.draft_slot,
      };
      state.pickByOverall.set(overall, rec);
      if (isRobPick(pk)) state.robTaken.push(rec);
    }
    state.robTaken.sort((a, b) => (a.overall || 0) - (b.overall || 0));
  }

  async function pollPicks(manual) {
    const btn = $("btn-refresh");
    if (manual) btn.classList.add("busy");
    try {
      const [pRes, dRes] = await Promise.all([
        fetch(state.draft.picks_api, { cache: "no-store" }),
        fetch(state.draft.draft_api, { cache: "no-store" }),
      ]);
      if (!pRes.ok) throw new Error("picks " + pRes.status);
      const picks = await pRes.json();
      applyPicks(picks);
      if (dRes.ok) {
        const dj = await dRes.json();
        if (dj && dj.status) state.draftStatus = dj.status;
      }
      state.pollError = null;
      const now = new Date();
      state.lastPoll = now.toLocaleTimeString("en-US", { timeZone: "America/Chicago", hour: "numeric", minute: "2-digit", second: "2-digit" }) + " CT";
      $("poll-dot").classList.add("pulse");
      setTimeout(() => $("poll-dot").classList.remove("pulse"), 1200);
    } catch (err) {
      state.pollError = (err && err.message) || "network";
    }
    renderBoard();
    renderMyPicks();
    renderLists();
    renderCard();
    renderChrome();
    btn.classList.remove("busy");
  }

  function bind() {
    $("btn-refresh").addEventListener("click", () => pollPicks(true));
    document.querySelectorAll(".pos-tabs .pos").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filterPos = btn.getAttribute("data-pos");
        document.querySelectorAll(".pos-tabs .pos").forEach((b) => b.classList.toggle("on", b === btn));
        renderLists();
      });
    });
    $("search").addEventListener("input", (ev) => {
      state.search = ev.target.value;
      renderLists();
    });
    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") {
        state.selectedId = null;
        state.research = { key: null, status: "idle", headlines: [], error: null };
        renderLists();
        renderCard();
      }
      if (ev.key === "/" && ev.target.tagName !== "INPUT") {
        ev.preventDefault();
        $("search").focus();
      }
    });
    bindSplitters();
    bindListClicks();
  }

  function eventEl(ev) {
    const t = ev && ev.target;
    if (t instanceof Element) return t;
    return t && t.parentElement ? t.parentElement : null;
  }

  function rowFromPoint(x, y) {
    const rows = document.querySelectorAll(".rowp");
    for (const row of rows) {
      const r = row.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return row;
    }
    return null;
  }

  function bindListClicks() {
    document.addEventListener("click", (ev) => {
      const el = eventEl(ev);
      if (el && el.closest && el.closest(".card-pane, .card-scroll, .star, [data-star], .btn, .toggle, .pos, .search, input, textarea, button, a, .topbar, .board-pane, .toolbar, .mypicks")) {
        return;
      }
      const row = (el && el.closest && el.closest(".rowp")) || rowFromPoint(ev.clientX, ev.clientY);
      if (row && row.dataset.key) selectPlayer(row.dataset.key);
    });
  }

  function esc(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function init() {
    loadTargets();
    loadLayout();
    const [pj, dj] = await Promise.all([
      fetch("data/players.json", { cache: "no-store" }).then((r) => r.json()),
      fetch("data/draft.json", { cache: "no-store" }).then((r) => r.json()),
    ]);
    state.players = pj.players || [];
    state.sources = pj.sources || {};
    state.match = pj.match || {};
    state.draft = dj;
    state.draftStatus = dj.status || "pre_draft";
    state.byId = new Map(state.players.filter((p) => p.id != null).map((p) => [String(p.id), p]));
    bind();
    renderBoard();
    renderMyPicks();
    renderLists();
    renderCard();
    renderChrome();
    tickCountdown();
    setInterval(tickCountdown, 1000);
    await pollPicks(false);
    setInterval(() => pollPicks(false), POLL_MS);
  }

  init().catch((err) => {
    $("poll-meta").textContent = "Failed to load local data: " + (err && err.message);
  });
})();

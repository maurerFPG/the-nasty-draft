# Fantasy Orphans ADP match report

Source: `data/fantasy_orphans_sf_tep_adp.csv` (12-team SF TEP snapshot).
Sleeper ids via the same conservative matcher as `tools/ingest_cheatsheet.py`.

- FO file present: **True**
- FO rows: **300**
- Matched to a Sleeper player: **300**
- Unmatched: **0**
- FP-ranked players on board: **499**

### Match methods

- `name+pos+team`: 300

### 2026 NFL draft (Wikipedia, one-time)

- Draft CSV rows: **257**
- Conservative name matches to Sleeper: **257**
- Unmatched / ambiguous (left blank): **0**
- Rookies on the dashboard board: **303**
- Board players with a draft round: **81**

### Fire / ice

Official Sleeper trending add/drop (48h, limit 25) plus public RSS mention volume
(r/DynastyFF + Google News). No Twitter/X. No invented sentiment scores.
Ice is trending-drop only — a single buzz snapshot cannot show fading.

- Trending adds: **25**
- Trending drops: **25**
- Tagged hot: **33** (adds + up to 8 buzz-only with ≥3 full-name hits)
- Tagged cold: **21**
- Buzz-only extra fires: **8**

## Unmatched FO names

None.


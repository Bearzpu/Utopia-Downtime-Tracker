# CLAUDE.md (process/workflow — rebuilt from session.md v1.7.0)

**IMPORTANT — where this file needs to live:** Claude Code on the web only
reads a `CLAUDE.md` committed inside a project's own repo — it does not read
a global file on your PC. So this same file needs to be **committed into
every project repo** (not symlinked — GitHub doesn't support that across
separate repos). See your migration notes doc for the submodule-based
single-source-of-truth option once you're ready for it; for now, copy this
file into each repo and update all copies by hand when it changes.

This file is process/workflow only — nothing project-specific belongs here.
Stack, quirks, changelog path, tutorial status, etc. live in that project's
`queue.md` instead.

## Standing preferences
- **UK/Australian English in prose.** Responses, code comments, and any
  user-facing copy (UI strings, settings descriptions, changelog entries,
  docs) use UK/Australian spelling. Exception: code identifiers, CSS
  properties, and established API/library terms keep whatever spelling the
  codebase/platform already uses — not renamed for consistency's sake.
- **Diffs off by default.** Describe changes by file + function/anchor name
  rather than posting full diffs, unless explicitly asked to show one.
- **No snippets or work narration while actively working an item.** Share
  only: issues found, direction-decision questions, and more-efficient-
  approach ideas. Don't restate what's being built in prose — the actual
  file edit is the output.
- **Edit files directly; don't batch changes for a later "output" step.**
  Unlike a chat that had to post full files back, Claude Code edits files
  in place. When a queue item is done, the code change, the `queue.md`
  update (Ready → Complete), and the changelog update happen together, in
  the same commit — don't defer any of them.
- **Sequencing near a context/compaction wall.** If a file is too large to
  safely regenerate given remaining context, leave it at Ready (not
  Complete) and make it the first thing picked up next session.
- **Ready-state items must be self-contained.** A queue item's job is to let
  a brand-new session — with zero memory of how it was designed — build it
  correctly from the written spec alone. If a design decision, exact
  function/selector name, or specific value was settled in conversation, it
  must be written into `queue.md` verbatim before the session ends. A
  one-line item name is not enough. **Corollary: nothing goes into
  `queue.md` without a traceable source** — if it can't be traced to where
  it came from, don't write it in as fact.
- **Design/clarifying questions as plain numbered text**, not an interactive
  widget — those can truncate on mobile.
- **Ideas-file ingestion.** When asked to process a project's `ideas.txt`
  into its queue: analyse it, triage entries into `queue.md` per the rules
  above, then reset `ideas.txt` back to its blank template — same commit.
- **Tutorial freshness check.** Any change that adds or changes a
  user-facing screen, gesture, or Settings section flags `TUTORIAL_CONTENT`
  for review, including a note on how likely it is to need rebuilding (not
  just re-reading). Doesn't block shipping. The tutorial is tagged with the
  app version it was last substantively rebuilt at (tracked in that
  project's `queue.md`) — a wording patch doesn't move the tag, only a real
  rebuild does. Once the app is 10 versions past that tag, flag it as due
  for a full rebuild regardless of whether this change touched a
  tutorial-relevant screen.
- **Feature gating via Developer Mode.** Available convention: a master
  `developerMode` flag plus a per-feature flag in settings, hidden from
  nav/UI until explicitly graduated. Whether a given project uses this is
  tracked in that project's `queue.md`.
- **Cross-file reference check after any multi-file split or refactor.** If
  a change touches how markup and script are divided across files, verify
  every `getElementById`/`querySelector` id target referenced from script
  actually exists in the markup before calling it Complete. Do this by
  direct inspection of the files already on hand.
- **Queue items are numbered, not bulleted**, sorted by priority marker
  (🔴 > 🟠 > 🟡 > 🟢) — changing a marker re-sorts the list.
- **New items get a genuine urgency judgment, not a default marker.**
  Whenever an item is added — from `ideas.txt` ingestion, a mid-session
  idea, or a bug found in passing — actually assess where it sits against
  what's already queued before picking its marker. A great idea or a bug
  needing immediate attention should land at `🔴` and outrank everything
  below it on the spot; don't reflexively bottom-slot new entries at `🟢`
  just because they're new. The whole point of marker-driven sort (not
  add-order) is that arrival time never has to determine priority.
- **`Status: <text>` messages are a personal placeholder, not a prompt.** An
  exact `Status: <anything>` message isn't a request — acknowledge with the
  single word `Logged.` and nothing else.

## Three-state task model
- `Waiting` (not started) → `Ready` (decided + full spec drafted in
  `queue.md`, not yet in the actual code) → `Complete` (in the real files,
  committed).
- Deciding a design in conversation makes something Ready, never Complete —
  only an actual file edit + commit does that.
- **Complete means removed, not marked.** The moment an item's changelog
  entry is written, delete that item from `queue.md` entirely in the same
  commit — don't leave a "SHIPPED" narrative sitting in the active queue.
  `queue.md` should only ever contain Waiting/Ready items, so a glance at
  it (or a `Code`/`Plan` run) always shows exactly what's left to do, never
  a mix of done-and-not-done. Git history is the permanent record if a
  shipped item's full original write-up is ever needed again. Its "why"
  paragraph — the design reasoning, trade-offs, and anything rejected
  along the way — gets relocated (not rewritten) into that project's
  `decisions.md`, dated, in the same commit. This is a move, not new
  writing: if it ever starts requiring real authoring effort per item,
  that's the signal to drop the practice rather than let it become
  overhead.

## Changelog voice
- **The always-visible note is plain English, Tutorial voice — one or two
  short sentences, no internal vocabulary** (session, completion, cascade,
  orphaned, etc.). Anything more precise than that, even short of full
  root-cause detail, goes in a `devOnly` companion note using the existing
  `{text, devOnly: true}` shape — the same mechanism already used for deep
  technical write-ups, just used a notch more liberally. Don't invent a
  third tier or a new schema field for this; the existing filter
  (`devMode || !n.devOnly`) already does the job once the always-visible
  text is actually kept simple.
- Applies going forward only — not worth retrofitting past versions.

## Trigger words
| Type this | Result |
|---|---|
| `Go` | Single-item, minimal-typing entry point — resume the top Ready item. If nothing's Ready, ingest `ideas.txt` into the queue instead. If the top-priority item is Waiting instead of Ready, enter Plan Mode before touching anything else (see Mode/effort automation below). This is the cold-start command: use it after reopening the app following a quota-wall shutdown, or any time you want to work exactly one thing and decide what's next yourself. |
| `Plan` | Bulk planning session — work every Waiting item in priority-marker order, one at a time, via a real Plan Mode design conversation each (actual back-and-forth where a decision needs it, not a blast-through of assumptions). The instant an item's design is settled, write its full spec into `queue.md` and flip it to Ready before moving to the next — never batch these. If nothing is Waiting, ingest `ideas.txt` into the queue instead. |
| `Code` | Bulk coding session — work consecutive Ready items in priority-marker order until input is needed or context runs low, then stop and report. (Replaces the old `A`/Auto label — same behaviour, clearer name.) |
| a number, e.g. `3` | Work that queue item now, out of order if needed |
| `N` / `next` | Work the top unchecked queue item |
| `Q` | Post the current queue, compact form (see Queue snapshot format) |
| `Qx`, e.g. `Q10` | Post just the top `x` priority-sorted queue items, compact form |
| `I` | Step back and analyse the current app — unprompted critique, optimisation ideas, new concepts that fit what's already built |
| `Status: <text>` | Personal placeholder note only — reply `Logged.` and stop |
| `Commit` | Run the standard git commit workflow now for whatever's currently pending (review what's staged, write a message per this repo's convention, commit) |

*(Dropped from the old table: `F` and `C` — both assumed the claude.ai chat
model of posting full files back and giving a continue-vs-new-chat verdict.
Claude Code edits files directly and surfaces its own context/compaction
state natively, so those two are obsolete here rather than translated.)*

## Queue snapshot format
Applies to `Q`, `Qx`, and the end-of-response top-10 snapshot alike — none
of these should reproduce a queue item's full write-up from `queue.md`.
That much detail exists so a fresh session can build the item correctly,
not to be re-pushed to screen every time the queue is glanced at.
- **Default: one line per item.** Marker + short title + status
  (Waiting/Ready). No anchors, no file/function references, no rationale.
- **Exception — an item has an open decision only the user can make**
  (e.g. "needs your call before Ready," unresolved options a/b/c): add one
  short second line stating just the question being asked, not the
  reasoning that produced it.
- Skip the Project config section by default; only include a line from it
  if directly relevant to what's being asked.
- Full detail is always one open of `queue.md` away, or by asking for that
  item by number.

## Mode/effort automation
- **Waiting items get Plan Mode automatically.** Whenever a trigger word is
  about to start work on an item whose status is Waiting (via `Go`, `Plan`,
  or a direct number), enter Plan Mode first — no need to be asked. Ready
  items never need this; their design is already settled, so just execute.
- **`/clear` is recommended, never auto-run.** Nothing can force a `/clear`
  from inside a session — say so explicitly ("recommend `/clear` now")
  when: a queue item reaches Complete (code + `queue.md` + changelog all
  committed); the next item is unrelated to the one just finished; or a
  `Plan` session's decisions are fully written into `queue.md` as Ready —
  that's the point of a Ready spec being self-contained, so there's no
  reason to keep carrying the design conversation into whatever `Code`
  run picks it up later. The user presses it.
- **Effort level is flagged, never auto-changed.** There's no mechanism to
  switch the Effort slider from inside a session — recommend bumping it
  (out loud, not silently) for multi-file `Store`/state-logic work or a bug
  that's already resisted one fix; leave it alone for cosmetic/copy-only
  changes. The user turns the dial.
- **`/compact` needs no manual handling.** Auto-compact is a built-in
  harness feature (`autoCompactEnabled`/`autoCompactWindow`), already
  active by default — don't build workflow around triggering it manually.

## Soft quit from `Plan`/`Code`
Typing **`Wrap`** at any point during a `Plan` or `Code` batch means: finish
the item currently in progress — through its full commit (code/spec +
`queue.md` + changelog, whichever apply) — then stop and report, rather
than starting the next item. Never leave an item half-committed to honour
a `Wrap` faster; finishing the in-flight item cleanly takes priority over
stopping immediately. (A hard, instant stop — regardless of in-flight
state — is already available natively via Escape/interrupt; `Wrap` is
specifically for "let me finish this one, then hand back control.")

## Changelog updates
On every completed item, update the changelog in the same commit as the
code change. Target file path is recorded in that project's `queue.md`
(Project config section). Before writing:
- **Same date as the most recent entry** → append to that entry's existing
  `changes` array.
- **Different date** → new entry dated today, bump the app's version number
  to match.

## End-of-response queue snapshot
Every response ends with the **top 10** priority-sorted queue items,
whatever their status — Waiting and Ready both included, each labelled
with its status. Since Complete items are removed from `queue.md` entirely
(see Three-state task model), everything left in it is by definition still
outstanding — hiding Ready would just make an item invisible right when
it's most relevant (it's sitting there finished-and-designed, waiting on
a `Code` run).

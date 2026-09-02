# Table Card & Slot Toolkit

A surgical tool for the flashcards and slots (properties) of RemNote tags and tables. It does two things:

1. **Restores the "extra properties on front/back of card" picker** that RemNote removed from the primary column of a table — the reason cloze tables can no longer be configured at all — and adds control over the order those extras appear in.
2. **Bulk-manages tags and powerups** — inventories what every rem referencing a given rem carries (for a slot rem, that is its whole column) and adds or removes a tag or built-in powerup across the lot.
3. **Inspects and repairs tag slots** — finding ghost slots whose deletion failed (but which keep generating flashcards) and force-deleting them along with their property-value child rems.

![./image/debugger-widget.png](https://raw.githubusercontent.com/hugomarins/slot-debug/refs/heads/main/image/debugger-widget.png)

---

## Plugin Commands Reference

| Command | Quick code | Opens / does | Writes? |
| --- | --- | --- | --- |
| **Configure Table Card Extras** | `cce` | Opens the *Card Extras Configurator*. Choose which properties show on the front/back of a table's cards, and set the order they render in. | Yes — config immediately; rows/columns only via **Apply order to cards** |
| **Inspect Slot Config (Cards)** | `isc` | Opens the *Slot Inspector*. Dumps the `Slot` powerup card config for a rem and its columns, plus a row's property-value order. | No — read-only |
| **Sync All Rows To Column Order** | `sro` | Reorders every row's property values to match the table's current column order, so card extras render in column order. Dry-runs and reports counts before asking. | Yes — reversible |
| **Undo Row Order Sync** | `sru` | Restores every row (and the column order, if it was changed) from the last sync's snapshot. | Yes |
| **Bulk Tags & Powerups** | `btp` | Opens the *Bulk Tag Manager*. Inventories the tags and powerups on every rem referencing the focused rem (or on a table's cells), then adds or removes one across the set. | Only on explicit Add/Remove — reversible |
| **Undo Bulk Tag Change** | `btu` | Reverses the last bulk add or remove, restoring any powerup values captured before removal. | Yes |
| **Debug Tag Slots** | `dts` | Opens the *Tag Slot Debugger*. Lists a tag's slots with reference counts, flags orphaned rems, and offers Force Delete. | Only on explicit Force Delete — **irreversible** |
| **Inspect Rem (Diagnostic)** | `inr` | Logs full diagnostics for the focused rem (type, powerups, tags, children) to the browser console. | No — read-only |

All commands act on the **focused rem**. `cce`, `isc`, `sro` and `sru` resolve the tag automatically: focus the tag rem itself, any row of its table, or one of its slot rems. `btp` needs no tag at all — it works on any rem — but resolves one when it can, to offer the table-shaped scopes as well.

## Plugin Widgets Reference

All five are popups, opened by the commands above rather than mounted in the sidebar.

| Widget | Opened by | What it shows |
| --- | --- | --- |
| **Card Extras Configurator** (`card_slot_config`) | `cce` | Target selector (primary card, or a card-generating column), the front and back extra lists with add/remove/reorder, and **Apply order to cards** with a row count. |
| **Slot Inspector** (`slot_inspector`) | `isc` | Per-rem dump: rem ID, `isProperty`/`isSlot`/`propertyType`, every built-in powerup present, and the raw plus resolved values of all three `Slot` powerup slots. For a row, also its property-value order next to the tag's column order. **Dump JSON to console** exports the whole tree. |
| **Bulk Tag Manager** (`bulk_tag_manager`) | `btp`, `btu` | The scope selector (references vs. table cells/columns/rows), the reference-shape filter with counts, the locked list of held-back references, every tag and powerup found with the count carrying it and a Remove button each, and an Add section for a searched tag or a built-in powerup with its slot values. |
| **Tag Slot Debugger** (`tag_debug`) | `dts` | Tag name and ID, how many rems carry the tag, every slot (including template-supplied ones) with reference counts, an orphaned-rem warning, and Force Delete per slot. |
| **Orphaned Rems Inspector** (`orphaned_rems`) | The Tag Slot Debugger's warning box | A table of blank-front debris rems with instance name, rem ID and back text, plus bulk delete. |

---

## Configure Card Extras

### The problem it solves

RemNote lets a table column show other properties as extra context on the front or back of the cards it generates, via **Configure Cards → Extra properties to show on front/back of card**.

That menu is reachable only from the definition-type column that surfaces the row's `backText` (labelled "Definition"), because the config it edits belongs to the **primary card** — the row's front → back, *and any cloze cards made from the row's own text*.

A cloze table has no such column. So when RemNote removed the menu from the primary/Name column, cloze tables lost the entry point entirely — while the stored values stayed live and kept rendering on the cards. You can see the extras on your cloze cards but have no way to change them.

This plugin rebuilds that picker.

### Usage

1. Focus the tag rem, or any row of the table, or one of its slot rems.
2. Run **Configure Card Extras** (`cce`).
3. Pick what to configure:
   - **Primary card (row front → back, and clozes)** — the target RemNote no longer exposes.
   - **Column: `<name>`** — a slot column that generates its own cards; equivalent to its native menu.
4. Click a `+ Name` button to add a property to a side, `✕` to remove it. Changes save immediately; **Revert to opened state** undoes the session.
5. To change the *order*, use the `↑` / `↓` arrows and then **Apply order to cards** — see below.

### Rules the renderer enforces

- **A property on the front is skipped on the back.** Adding it to one side therefore removes it from the other, which is why RemNote's own chip lists are always disjoint.
- **Blank cells are omitted entirely.** A property configured as an extra doesn't appear on rows where it has no value.
- **Definition-type columns are never offered.** Such a column is a real slot rem, but it holds no value of its own — it surfaces the row's `backText`, i.e. it *is* the primary card's back. It can neither be shown as an extra nor take part in ordering. RemNote's own picker omits it too.
- **A column is never offered as an extra on its own card.** When configuring `Column: X`, `X` is the card being tested, so it cannot also be extra content on it. If an existing config already contains it, it stays listed and flagged so you can remove it.
- **The order you pick is not stored anywhere the renderer reads** — see the next section.

### Where the data lives

The config is the built-in `Slot` powerup (code `y`), slots `ExtraSlotsOnFrontOfCard` (`f`) and `ExtraSlotsOnBackOfCard` (`b`), holding rich text made of rem references to the slot rems to render. The primary card's copy lives on the **tag rem**; a card-generating column's copy lives on that **slot rem**.

> ⚠️ `isProperty()` is backed by that same `Slot` powerup, so writing any `y.*` property to a rem **promotes it into a column of its parent**. If a row ever gets promoted this way, it starts appearing as a table column. This plugin only ever writes to the tag rem or to real column slots, and its column lists exclude rems tagged with the tag (i.e. rows).

---

## The order card extras appear in

This is the least obvious part of the feature, so it's worth stating exactly.

Card extras render in the order of **that row's own property-value rems** — the order in which the row's cells were first filled in. Not the order stored in the config, and not the table's current column order.

Two things follow:

- **Column order governs only rows created later.** A new row's values are created as you fill its cells, so they land in the current column order. Dragging a column changes the header immediately but leaves every existing row untouched.
- **Existing rows must each be reordered.** Their value order was frozen when they were created, and nothing in the UI revisits it.

So making a whole table consistent takes both levers: set the column order (fixing future rows) *and* rewrite the existing rows.

### Apply order to cards (in the widget)

The `↑` / `↓` arrows are **staged**: pressing one saves the new order into the tag's stored config (like the `+`/`✕` chips, that write is immediate) but touches no row and no card, so a single arrow press can never trigger a bulk rewrite. **Apply order to cards** does the work:

1. It counts the affected rows first and shows them in a confirmation panel **inside the widget**. Nothing is written while that panel is open.
2. The **"Also reorder the table columns to match"** checkbox (on by default) additionally puts the columns in the same order, so rows you create later inherit it.
3. Press the orange button in the panel to apply, or **Cancel**. Undo with **Undo Row Order Sync** (`sru`).

Editing the list again while the panel is open discards it — the counts it shows always describe the list as displayed.

The button stays greyed until there is something to do. It enables when either the arrows moved something in this session, or the rows still disagree with a stored order from a previous one — the check is measured against the rows themselves on every open, not against the saved config, which persists and would otherwise look already-applied.

> Note: the order is a property of the **row**, so it is shared by every card that row generates — not only the target selected in the widget.

### Sync All Rows To Column Order (command)

`sro` is the column-order-driven counterpart: it takes the table's **current** column order as the target and rewrites every row to match. Use it when you have already arranged the columns the way you want by dragging them. Same protections — dry run, counts, confirmation, and `sru` to undo. Both `sro` and `sru` open a popup to do this; the command itself only launches it.

> **Why confirmations are drawn in the widget.** RemNote runs plugins in a sandboxed iframe where `window.confirm` never opens a dialog *and returns a truthy value anyway*. Every guard built on it therefore approved itself and the write ran unannounced (fixed in 0.2.4). Nothing in this plugin uses `window.confirm`; every destructive step is confirmed by a panel rendered by the plugin's own UI.

### Only one undo is stored

Both entry points keep a single snapshot. If a previous reordering has not been undone, the confirmation panel opens with an explicit warning naming that earlier reordering — table, row count, whether columns were moved, and when — and states that proceeding makes it permanent. Confirming accepts the old change and starts a fresh undo; cancelling leaves everything untouched so you can still run `sru`. The full snapshot is logged to the console before being replaced.

### How this was established

Each claim above was tested rather than inferred, because the plausible-looking explanations were wrong twice:

- Writing two slots to the config in reverse order still rendered them the other way round → the config array's order is ignored.
- Dragging a column changed the table header but not the rendered card, and the row's value positions still held the old order → column order is not the render order.
- Swapping two non-empty extras configured on the same side of one row flipped that card → the row's value order is causal, not merely correlated.
- The swap survived a quit, reopen and sync → the change is durable, not a live-session artifact.
- A newly created row filled its cells in the current column order → column order does govern future rows.
- Columns turned out to sit at child positions 428–433 of 533, interleaved among the rows → column moves must use absolute sibling indices, never the column's index in the column list.

---

## Bulk tags and powerups

![Bulk Tags & Powerups widget: scope selector, the tags and powerups found with per-item Remove buttons, the unverified-powerups notice, and the Add section](https://raw.githubusercontent.com/hugomarins/slot-debug/refs/heads/main/image/bulk-tag-untag.png)

### The problem it solves

Before this plugin restored the card-extras picker, the only way to get a property onto a card was to apply the built-in **Extra Card Detail** powerup to each cell by hand. Once the picker exists that powerup is redundant, but it is now sitting on hundreds or thousands of cell rems with no way to take it off in bulk — RemNote offers no multi-rem tag or powerup editing at all.

The same gap shows up in the other direction: applying one highlight colour, or a tag that carries custom CSS, to every cell of a column means visiting every row.

### The insight: a slot's references *are* its column

A table cell holds a reference to its slot rem inside its own text. That is not incidental — it is exactly how this plugin locates cells (`getRowValueOrder` matches each of a row's children to a column by the slot reference in the child's text), and it is why the "Extra" slot rem in a 1000-row cloze table shows **1000 References**, each one a cell bullet.

So "every rem referencing this slot" and "every cell of this column" are the same set of rems. Scanning references therefore covers the table case with no table code — and it keeps working on any rem at all, not just slots. That matters here specifically, because the table internals are the part of RemNote that keeps changing under this plugin.

Display mode is irrelevant to this. Showing a slot as a bullet changes how the cell renders, not whether the cell holds the reference, so non-bullet columns are found too.

### References are a superset, so they are classified rather than trusted

Some rems reference a slot without being one of its cells, and two kinds must never be bulk-edited:

- **Stored powerup values.** The card-extras config that `cce` writes is rich text made of references to the slot rem, parked on a powerup property rem. It *always* appears in the reference list. Tagging or untagging it would corrupt the config.
- **Powerup definitions.**

Both are **hard-excluded** — never edited, never counted — and listed behind a `🔒` disclosure so you can see what was held back and why.

Everything else is bucketed by the *shape* of the reference, which is what separates a cell from a passing mention:

| Bucket | Meaning | Selected by default |
| --- | --- | --- |
| **Cell / bullet** | The reference is the first node of the rem's text | ✅ |
| **Mention** | The reference sits further inside the text — a prose mention somewhere in your KB | ✖️ |
| **Answer side** | The reference appears only in the rem's back text | ✖️ |
| **Indirect** | No direct reference in the text (alias, portal, …) | ✖️ |

Changing the buckets re-counts everything instantly — the scan covers all of them, so the filter is applied to results rather than requiring a re-scan.

### The other scopes

When a tag can be resolved from the focused rem (the tag rem, a row, or a slot rem — the same rules as `cce`), three table-shaped scopes are offered alongside references, computed by walking the table rather than by references:

- **Table cells of one column** — pick the column; pre-selected when the focused rem is itself a slot.
- **Table cells, every column.**
- **Rows tagged with the table** — the row rems themselves, not their cells.

These are kept because they are exact for tables regardless of how references behave. Use them to cross-check a reference count you don't trust.

### Usage

1. Focus the rem — a slot rem, a tag, a row, or any ordinary rem.
2. Run **Bulk Tags & Powerups** (`btp`).
3. Choose the scope, then press **Scan for tags & powerups**. Nothing is written by a scan.
4. Adjust the reference buckets if you are in the references scope. If the amber notice lists powerups that were not counted, press **Ask every rem about all N powerups** to rule them in or out exhaustively.
5. Either:
   - press **Remove from N** next to anything the scan found, or
   - pick a tag (searched) or a built-in powerup in the **Add** section and press **Add to N rems**.
6. A confirmation panel replaces the body, naming the operation, the count and the scope. Press the coloured button to apply, or **Cancel**.
7. Undo with **Undo Bulk Tag Change** (`btu`).

For the case this was built for: focus the `Extra` slot rem, `btp`, keep the default references scope and the **Cell / bullet** bucket, scan, then **Remove from N** next to `⚡ Extra Card Detail`.

### Powerup values are learned, not guessed

Powerups with slots (Highlight's `Color`, Header's `Size`, Todo's `Status`, …) show the values **already in use in your own knowledge base**, read off the rems the scan found carrying that powerup. Those are the values known to work, so they are offered as one-click buttons next to a free-text field. Highlight falls back to a preset colour list when the scan observes none.

Leaving a slot blank adds the powerup without writing that slot, keeping RemNote's default.

### Everything is counted, confirmed and reversible

- **The scan is read-only.** It builds the set and reports what is on it; no write happens until a button in the confirmation panel is pressed.
- **Every rem is re-checked before it is touched.** A rem that already carries the tag is skipped on an add, and one that doesn't is skipped on a remove. So the counts reported after the fact are real changes, not attempts — and a generous scan can never produce a spurious write.
- **Only the rems actually changed are snapshotted**, so an undo cannot strip a tag from a rem that already had it.
- **Powerup slot values are captured before removal** (`removePowerup` takes the powerup's slots with it) and restored by the undo.
- **Only one undo is stored**, like the row-order commands. If a previous bulk change has not been undone, the confirmation panel names it and warns that proceeding makes it permanent.

> ⚠️ One exception to reversibility: removing a **tag** can also drop property values RemNote stored under that tag. Those are not snapshotted, so re-adding the tag brings back the tag but not its values.

---

## Ghost slots and orphaned rems

### The problem it solves

#### Ghost slots generating phantom flashcards

When you delete a slot (property) from a RemNote tag via the UI, the deletion sometimes fails silently. The slot rem may still exist in the database, and rems tagged with that tag continue to have spurious "Deleted Bullet" child rems linked to it — causing phantom flashcards to be generated in your queue.

#### Orphaned rems after reference cleanup

Even after a ghost slot is successfully force-deleted, a second class of debris can remain. If you used RemNote's built-in "delete references to deleted rem" option, the forward references in those child rems are cleared — but the rem itself is not removed. You are left with rems that have a **blank front** and a non-empty back (the original property value), which still generate flashcards with no question.

**Example:** an "English Words" tag had a "Definition" slot. After force-deleting the slot and clearing its references globally, each vocabulary word still had a child rem with an empty front and the definition text as its back. These continued to appear as cards in the queue.

This plugin handles both problems.

### Usage

#### Step 1 — Inspect and Force Delete ghost slots

1. In the RemNote editor, click on (focus into) the tag rem you want to debug (e.g. "English Words").
2. Open the command palette and run **Debug Tag Slots** (`dts`).
3. A popup appears showing:
   - The tag rem's name and ID
   - How many rems are tagged with this tag
   - All slots/properties, including those from attached templates, with each slot's name, ID, source, and reference count
   - An orphaned rems warning (if any exist — see Step 2)
4. Identify the ghost slot.
5. Click **Force Delete** next to it. A red confirmation panel opens under the button — read it, then press **Delete it** (or **Cancel**).

#### Step 2 — Clean up orphaned rems (blank-front debris)

After force-deleting a ghost slot (or after using RemNote's global reference cleanup), check whether the Tag Slot Debugger shows an amber warning box below the instance count:

> ⚠️ N orphaned rem(s) in X instance(s) — Empty front + non-empty back

If it does:

1. Click **"Show N Orphaned Rem(s) →"** to open the Orphaned Rems inspector.
2. Review the table: each row shows the instance name (e.g. "denigrate", "restive"), the rem ID, and the back text. Confirm these are debris and not intentional rems.
3. Click **"Delete All N Orphaned Rem(s)"**, read the red confirmation panel that opens above the table, then press **Delete N rem(s)** (or **Cancel**).

> **Note on the filter:** a rem is flagged as orphaned only if its front is completely empty (no text, no references, no links) **and** its back is non-empty. Rems whose front contains a slot reference (such as Priority or Source from other powerups) are excluded, even if that reference resolves to empty-looking text.

#### Step 3 — Diagnostic (advanced)

If you need to identify how RemNote classifies a particular rem internally (powerups, tag memberships, type), focus on the rem and run **Inspect Rem (Diagnostic)** (`inr`). Full details are logged to the browser console (F12 → Console).

---

## ⚠️ Warnings

- **Back up your knowledge base before any write operation.** Go to RemNote Settings → Export to create a full backup. This applies to Force Delete, orphaned rem deletion, **and** the row/column reordering — the latter moves rems that RemNote maintains itself.
- Force Delete and orphaned rem deletion are **irreversible**. They permanently remove rems and their associated data.
- Only delete slots you are certain are ghost/spurious. Deleting an active slot will erase all data stored in it across every tagged rem.
- Review the orphaned rems table before confirming deletion — verify that the back text shown matches the debris you expect to remove.
- Row and column reordering is reversible via **Undo Row Order Sync**, but only for the **most recent** operation, and the snapshot lives in plugin storage — not a substitute for an export.
- Bulk tag/powerup changes are reversible via **Undo Bulk Tag Change**, again only for the **most recent** operation. Removing a *tag* is the one partial exception: property values stored under it are not snapshotted.
- **Disable this plugin when not in use** to prevent accidental triggering of destructive commands.

## How things work

### How card extras are read and written

1. The config is rich text of rem references in the `Slot` powerup (`y`), slots `ExtraSlotsOnFrontOfCard` / `ExtraSlotsOnBackOfCard`.
2. The SDK resolves built-in powerup slots via `PowerupSlotCodeMap[powerupCode][slot]`, so these calls must pass the slot **name**, not the one-letter code stored in the knowledge base.
3. Render order comes from the row's property-value children, so changing it means moving those rems with `setParent(row, index)`.
4. Column order is changed by swapping slot rems' **absolute** sibling positions, via a series of pairwise swaps. This keeps the set of positions the columns occupy unchanged, so columns can never migrate into the middle of the rows.

### How tags and powerups are detected

**Built-in powerup membership is not enumerable in RemNote.** This is the central constraint of the feature:

- `getPowerupByCode(code)` resolves the powerup rem, but its `taggedRem()` comes back empty, or returns a handful of rems on a knowledge base holding thousands.
- `getTagRems()` does not report built-in powerups either. A cell carrying Extra Card Detail returns no tag for it.

The first version of this scanner used both of those and reported **"Extra Card Detail: 0" across 1406 cells that visibly carry it**. The same limit was hit independently in the incremental-everything plugin (`lib/synced_key_audit.ts`, `lib/priority_bands.ts`, and its `dpecd` probe command, which exists for exactly this reason). Asking each rem directly with `hasPowerup()` is the only answer that is ever right.

So:

1. Scope members are collected — from `remsReferencingThis()`, or by walking the tag's rows and matching cells by their slot reference.
2. **Tags** come from `getTagRems()` per member, chunked 20 at a time in parallel. Exact.
3. **Powerups** are probed with `hasPowerup()`, one call per rem per code, in two passes:
   - **Discovery** asks every manageable powerup of an evenly-spread sample (60 rems — strided, not the first 60, because cells come out ordered by row). Unioned with anything the powerup index turns up, which under-reports but never invents. This decides only *which* powerups to count.
   - **Exact** asks every rem about the powerups discovery found. Every count and rem id shown in the UI comes only from this pass.
4. A powerup discovery never saw is reported as **unverified**, not as absent — a sample says nothing about a powerup sitting on three rems out of a thousand. The widget names them and offers **"Ask every rem about all N powerups"** for the exhaustive pass.
5. `applyBulk` re-checks each rem with `hasPowerup()` / `getTagRems()` before touching it, so a member listed in error is skipped, not written to.

### How Force Delete works

1. Fetches all rems tagged with the focused tag rem.
2. For each tagged rem, retrieves the property-value rem linked to the target slot (via `getTagPropertyAsRem`).
3. Deletes each found property-value rem.
4. Deletes the slot rem itself.

### How orphaned rem detection works

1. Fetches all rems tagged with the tag.
2. For each tagged rem, inspects its direct children.
3. A child is flagged as orphaned if and only if:
   - Its `text` array contains **no nodes at all**, or contains only plain-string nodes that trim to `""` (object nodes — references, links, powerup properties — are treated as occupied and excluded).
   - Its `backText` array is non-empty after converting to plain text.
4. The Orphaned Rems inspector displays all flagged rems with their instance name, rem ID, and back text for review before deletion.

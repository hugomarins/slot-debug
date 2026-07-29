# Slot Debug

A surgical tool for RemNote tag slots/properties. It does two things:

1. **Restores the "extra properties on front/back of card" picker** that RemNote removed from the primary column of a table — the reason cloze tables can no longer be configured at all.
2. **Inspects and repairs tag slots** — finding ghost slots whose deletion failed (but which keep generating flashcards) and force-deleting them along with their property-value child rems.

![./image/debugger-widget.png](https://raw.githubusercontent.com/hugomarins/slot-debug/refs/heads/main/image/debugger-widget.png)

## Configure Card Extras

### The problem it solves

RemNote lets a table column show other properties as extra context on the front or back of the cards it generates, via **Configure Cards → Extra properties to show on front/back of card**.

That menu is reachable only from the column that renders the row's `backText` (labelled "Definition"), because the config it edits belongs to the **primary card** — the row's front → back, *and any cloze cards made from the row's own text*.

A cloze table has no such column. So when RemNote removed the menu from the primary/Name column, cloze tables lost the entry point entirely — while the stored values stayed live and kept rendering on the cards. You can see the extras on your cloze cards but have no way to change them.

This plugin rebuilds that picker.

### Usage

1. Focus the tag rem, or any row of the table, or one of its slot rems.
2. Run **"Configure Card Extras"** (quick code: `cce`).
3. Pick what to configure:
   - **Primary card (row front → back, and clozes)** — the target RemNote no longer exposes.
   - **Column: `<name>`** — a slot column that generates its own cards; equivalent to its native menu.
4. Click a `+ Name` button to add a property to a side, `✕` to remove it. Changes save immediately; **Revert to opened state** undoes the session.

### Two rules the renderer enforces

- **Order is not configurable.** Extras always render in table column order; the order they are stored in is ignored. The numbering in the widget reflects the order the card will actually use.
- **A property on the front is skipped on the back.** Adding it to one side therefore removes it from the other, which is why RemNote's own chip lists are always disjoint.

### Where the data lives

The config is the built-in `Slot` powerup (code `y`), slots `ExtraSlotsOnFrontOfCard` (`f`) and `ExtraSlotsOnBackOfCard` (`b`), holding rich text made of rem references to the slot rems to render. The primary card's copy lives on the **tag rem**; a card-generating column's copy lives on that **slot rem**.

> ⚠️ `isProperty()` is backed by that same `Slot` powerup, so writing any `y.*` property to a rem **promotes it into a column of its parent**. If a row ever gets promoted this way, it starts appearing as a table column. This plugin only ever writes to the tag rem or to real column slots, and its column lists exclude rems tagged with the tag (i.e. rows).

## Inspect Slot Config

Run **"Inspect Slot Config (Cards)"** (quick code: `isc`) on any rem to dump, for it and each of its column slots: rem ID, `isProperty`/`isSlot`/`propertyType`, every built-in powerup present, and the raw plus resolved values of all three `Slot` powerup slots. Rems with a card config are highlighted. **Dump JSON to console** exports the whole tree.

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
2. Open the command palette and run **"Debug Tag Slots"** (quick code: `dts`).
3. A popup appears showing:
   - The tag rem's name and ID
   - How many rems are tagged with this tag
   - All slots/properties, including those from attached templates, with each slot's name, ID, source, and reference count
   - An orphaned rems warning (if any exist — see Step 2)
4. Identify the ghost slot.
5. Click **Force Delete** next to it. Read the warning carefully, then confirm.

#### Step 2 — Clean up orphaned rems (blank-front debris)

After force-deleting a ghost slot (or after using RemNote's global reference cleanup), check whether the Tag Slot Debugger shows an amber warning box below the instance count:

> ⚠️ N orphaned rem(s) in X instance(s) — Empty front + non-empty back

If it does:

1. Click **"Show N Orphaned Rem(s) →"** to open the Orphaned Rems inspector.
2. Review the table: each row shows the instance name (e.g. "denigrate", "restive"), the rem ID, and the back text. Confirm these are debris and not intentional rems.
3. Click **"Delete All N Orphaned Rem(s)"**, read the warning, and confirm.

> **Note on the filter:** a rem is flagged as orphaned only if its front is completely empty (no text, no references, no links) **and** its back is non-empty. Rems whose front contains a slot reference (such as Priority or Source from other powerups) are excluded, even if that reference resolves to empty-looking text.

#### Step 3 — Diagnostic (advanced)

If you need to identify how RemNote classifies a particular rem internally (powerups, tag memberships, type), focus on the rem and run **"Inspect Rem (Diagnostic)"** (quick code: `inr`). Full details are logged to the browser console (F12 → Console).

## ⚠️ Warnings

- **Back up your knowledge base before using any delete operation.** Go to RemNote Settings → Export to create a full backup.
- Force Delete and orphaned rem deletion are **irreversible**. They permanently remove rems and their associated data.
- Only delete slots you are certain are ghost/spurious. Deleting an active slot will erase all data stored in it across every tagged rem.
- Review the orphaned rems table before confirming deletion — verify that the back text shown matches the debris you expect to remove.
- **Disable this plugin when not in use** to prevent accidental triggering of destructive commands.

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

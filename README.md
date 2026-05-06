# Slot Debug

A surgical debug tool for RemNote tag slots/properties. Use it to inspect the slots of a tag rem, identify ghost slots whose deletion failed (but which keep generating flashcards), and force-delete them along with all their property-value child rems in tagged rems.

<img src"https://raw.githubusercontent.com/hugomarins/slot-debug/refs/heads/main/image/debugger-widget.png" width="500">

## The problem it solves

### Ghost slots generating phantom flashcards

When you delete a slot (property) from a RemNote tag via the UI, the deletion sometimes fails silently. The slot rem may still exist in the database, and rems tagged with that tag continue to have spurious "Deleted Bullet" child rems linked to it — causing phantom flashcards to be generated in your queue.

### Orphaned rems after reference cleanup

Even after a ghost slot is successfully force-deleted, a second class of debris can remain. If you used RemNote's built-in "delete references to deleted rem" option, the forward references in those child rems are cleared — but the rem itself is not removed. You are left with rems that have a **blank front** and a non-empty back (the original property value), which still generate flashcards with no question.

**Example:** an "English Words" tag had a "Definition" slot. After force-deleting the slot and clearing its references globally, each vocabulary word still had a child rem with an empty front and the definition text as its back. These continued to appear as cards in the queue.

This plugin handles both problems.

## Usage

### Step 1 — Inspect and Force Delete ghost slots

1. In the RemNote editor, click on (focus into) the tag rem you want to debug (e.g. "English Words").
2. Open the command palette and run **"Debug Tag Slots"** (quick code: `dts`).
3. A popup appears showing:
   - The tag rem's name and ID
   - How many rems are tagged with this tag
   - All slots/properties, including those from attached templates, with each slot's name, ID, source, and reference count
   - An orphaned rems warning (if any exist — see Step 2)
4. Identify the ghost slot.
5. Click **Force Delete** next to it. Read the warning carefully, then confirm.

### Step 2 — Clean up orphaned rems (blank-front debris)

After force-deleting a ghost slot (or after using RemNote's global reference cleanup), check whether the Tag Slot Debugger shows an amber warning box below the instance count:

> ⚠️ N orphaned rem(s) in X instance(s) — Empty front + non-empty back

If it does:

1. Click **"Show N Orphaned Rem(s) →"** to open the Orphaned Rems inspector.
2. Review the table: each row shows the instance name (e.g. "denigrate", "restive"), the rem ID, and the back text. Confirm these are debris and not intentional rems.
3. Click **"Delete All N Orphaned Rem(s)"**, read the warning, and confirm.

> **Note on the filter:** a rem is flagged as orphaned only if its front is completely empty (no text, no references, no links) **and** its back is non-empty. Rems whose front contains a slot reference (such as Priority or Source from other powerups) are excluded, even if that reference resolves to empty-looking text.

### Step 3 — Diagnostic (advanced)

If you need to identify how RemNote classifies a particular rem internally (powerups, tag memberships, type), focus on the rem and run **"Inspect Rem (Diagnostic)"** (quick code: `inr`). Full details are logged to the browser console (F12 → Console).

## ⚠️ Warnings

- **Back up your knowledge base before using any delete operation.** Go to RemNote Settings → Export to create a full backup.
- Force Delete and orphaned rem deletion are **irreversible**. They permanently remove rems and their associated data.
- Only delete slots you are certain are ghost/spurious. Deleting an active slot will erase all data stored in it across every tagged rem.
- Review the orphaned rems table before confirming deletion — verify that the back text shown matches the debris you expect to remove.
- **Disable this plugin when not in use** to prevent accidental triggering of destructive commands.

## How Force Delete works

1. Fetches all rems tagged with the focused tag rem.
2. For each tagged rem, retrieves the property-value rem linked to the target slot (via `getTagPropertyAsRem`).
3. Deletes each found property-value rem.
4. Deletes the slot rem itself.

## How orphaned rem detection works

1. Fetches all rems tagged with the tag.
2. For each tagged rem, inspects its direct children.
3. A child is flagged as orphaned if and only if:
   - Its `text` array contains **no nodes at all**, or contains only plain-string nodes that trim to `""` (object nodes — references, links, powerup properties — are treated as occupied and excluded).
   - Its `backText` array is non-empty after converting to plain text.
4. The Orphaned Rems inspector displays all flagged rems with their instance name, rem ID, and back text for review before deletion.

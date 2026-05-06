# Slot Debug

A surgical debug tool for RemNote tag slots/properties. Use it to inspect the slots of a tag rem, identify ghost slots whose deletion failed (but which keep generating flashcards), and force-delete them along with all their property-value child rems in tagged rems.

## The problem it solves

When you delete a slot (property) from a RemNote tag via the UI, the deletion sometimes fails silently. The slot rem may still exist in the database, and rems tagged with that tag continue to have spurious "Deleted Bullet" child rems linked to it — causing phantom flashcards to be generated in your queue.

This plugin lets you:

1. **Inspect** all children (slots/properties) of any tag rem, including ghost slots not visible in the UI.
2. **See the slot IDs** — useful for cross-referencing with RemNote support or your own debugging.
3. **See how many rems reference each slot** (proxy for the number of phantom property-value rems).
4. **Force Delete** a slot: removes the slot rem itself and deletes all property-value child rems linked to it across every rem tagged with that tag.

## Usage

1. In the RemNote editor, click on (focus into) the tag rem you want to debug (e.g. "English Words").
2. Open the command palette and run **"Debug Tag Slots"** (quick code: `tsd`).
3. A popup appears showing:
   - The tag rem's name and ID
   - How many rems are tagged with this tag
   - All children of the tag rem, with each slot's name, ID, property status, and reference count
4. Identify the ghost slot (typically marked "NOT a property" or has an unexpected name/ID).
5. Click **Force Delete** next to it. Read the warning carefully, then confirm.

## ⚠️ Warnings

- **Back up your knowledge base before using Force Delete.** Go to RemNote Settings → Export to create a full backup.
- Force Delete is **irreversible**. It permanently removes the slot rem and all property-value rems linked to it in every tagged rem.
- Only delete slots you are certain are ghost/spurious. Deleting an active slot will erase all data stored in it.
- **Disable this plugin when not in use** to prevent accidental triggering of the Force Delete command.

## How Force Delete works

1. Fetches all rems tagged with the focused tag rem.
2. For each tagged rem, retrieves the property-value rem linked to the target slot (via `getTagPropertyAsRem`).
3. Deletes each found property-value rem.
4. Deletes the slot rem itself.

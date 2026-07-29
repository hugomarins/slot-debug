import {
  BuiltInPowerupCodes,
  RNPlugin,
  PluginRem as Rem,
  RichTextInterface,
} from '@remnote/plugin-sdk';

/**
 * Read/write helpers for RemNote's "extra properties on front/back of card"
 * configuration.
 *
 * The config lives in the built-in `Slot` powerup (code "y") on the rem that
 * owns the card:
 *
 *   - Primary card (row front -> row backText, and cloze cards made from the
 *     row's own text): stored on the TAG rem. The "Definition" column in the
 *     table UI is not a real column — it renders the row's backText — so
 *     RemNote uses it only as the entry point for this config. Cloze tables
 *     have no definition column at all, which is why they lost the menu while
 *     keeping the stored values.
 *   - A slot column that generates its own cards: stored on that slot rem.
 *
 * The value is rich text made of rem references pointing at the slot rems to
 * render. Two things about ordering, both verified:
 *
 *   - This array's order is IGNORED. Writing two slots in reverse order still
 *     rendered them the other way round.
 *   - Cards render extras in the order of THAT ROW's property-value rems, which
 *     is fixed when each value is first filled in. It is not the tag's column
 *     order: after dragging a column, the table header changed but the rendered
 *     card did not, and the row's value positions still held the old order.
 *
 * So render order is per-row, and changing it means reordering a row's
 * property-value children — not this array and not the columns.
 *
 * A slot listed on both sides renders only on the front.
 *
 * IMPORTANT: the SDK resolves built-in powerup slots via
 * `PowerupSlotCodeMap[powerupCode][slot]`, so these calls must use the slot
 * NAME, not the one-letter code ("f" / "b") stored in the KB.
 */

export const SLOT_POWERUP = 'y';
export const FRONT_SLOT = 'ExtraSlotsOnFrontOfCard';
export const BACK_SLOT = 'ExtraSlotsOnBackOfCard';

export type CardSide = typeof FRONT_SLOT | typeof BACK_SLOT;

export const richTextToString = (text: any[] | undefined): string =>
  (text || [])
    .map((n: any) => {
      if (typeof n === 'string') return n;
      if (n?.i === 'q') return `[[${n._id}]]`;
      return n?.text || '';
    })
    .join('');

/** Extract the referenced rem ids, in order, from an extra-slots value. */
export const richTextToRemIds = (richText: RichTextInterface | undefined): string[] =>
  (richText || [])
    .filter((n: any) => n && typeof n === 'object' && n.i === 'q' && n._id)
    .map((n: any) => n._id as string);

/** Build an extra-slots value from an ordered list of slot rem ids. */
export const remIdsToRichText = (ids: string[]): RichTextInterface =>
  ids.map((_id) => ({ i: 'q' as const, _id }));

export async function readExtraSlotIds(rem: Rem, side: CardSide): Promise<string[]> {
  const richText = await rem.getPowerupPropertyAsRichText(SLOT_POWERUP, side);
  return richTextToRemIds(richText);
}

export async function writeExtraSlotIds(
  rem: Rem,
  side: CardSide,
  ids: string[]
): Promise<void> {
  await rem.setPowerupProperty(SLOT_POWERUP, side, remIdsToRichText(ids));
}

/**
 * The property children of `tagRem` that are genuine table columns.
 *
 * `isProperty()` is backed by the Slot powerup ("y") itself, so ANY rem that
 * has ever had a Slot powerup property written to it reports as a property —
 * including a table row that got one by mistake. Rows are distinguishable
 * because a row is tagged with the tag, whereas a column never is.
 */
export async function getColumnSlots(tagRem: Rem): Promise<Rem[]> {
  const out: Rem[] = [];
  for (const c of await tagRem.getChildrenRem()) {
    if (!(await c.isProperty().catch(() => false))) continue;
    const tags = await c.getTagRems().catch(() => [] as Rem[]);
    if (tags.some((t) => t._id === tagRem._id)) continue; // a row, not a column
    out.push(c);
  }
  return out;
}

/**
 * The slots that may be shown on a card owned by `rem`.
 *
 * For a tag rem those are its column slots. For a slot rem they are its
 * siblings, i.e. the column slots of its parent.
 */
export async function getCandidateSlots(plugin: RNPlugin, rem: Rem): Promise<Rem[]> {
  const own = await getColumnSlots(rem);
  if (own.length > 0) return own;

  const parent = await rem.getParentRem();
  if (!parent) return [];
  return (await getColumnSlots(parent)).filter((s) => s._id !== rem._id);
}

export interface RowValueEntry {
  slotId: string;
  slotName: string;
  valueRemId: string;
  /** Index among the row's children — this is what decides card render order. */
  position: number;
  /** False when the cell is blank; blank cells are omitted from cards entirely. */
  hasValue: boolean;
}

/**
 * The order of a row's property-value rems, which is the order the row's card
 * renders its extras in.
 *
 * Deliberately avoids `getTagPropertyAsRem`: that appears to CREATE a missing
 * value rem on access (a row whose empty cell was probed gained a child), which
 * is unacceptable in a read-only inspector. Instead each child is matched to a
 * column by the slot reference inside its own text, which touches nothing.
 */
export async function getRowValueOrder(row: Rem, columns: Rem[]): Promise<RowValueEntry[]> {
  const slotNames = new Map(columns.map((c) => [c._id, richTextToString(c.text) || '[unnamed]']));
  const children = await row.getChildrenRem();
  const out: RowValueEntry[] = [];

  children.forEach((child, index) => {
    for (const node of (child.text || []) as any[]) {
      const id = node && typeof node === 'object' && node.i === 'q' ? node._id : undefined;
      if (id && slotNames.has(id)) {
        // The cell content is whatever is left once the slot reference itself is
        // dropped, plus any backText. A blank cell still has a value rem, but it
        // is skipped when the card renders, so it cannot be used to observe order.
        const rest = ((child.text || []) as any[]).filter(
          (n) => !(n && typeof n === 'object' && n.i === 'q' && n._id === id)
        );
        const content =
          richTextToString(rest) + richTextToString((child as any).backText || []);

        out.push({
          slotId: id,
          slotName: slotNames.get(id)!,
          valueRemId: child._id,
          position: index,
          hasValue: content.trim() !== '',
        });
        break;
      }
    }
  });

  return out;
}

/**
 * Move a row's property-value rems into `orderedValueIds` order.
 *
 * Applies one rem at a time via `setParent(row, i)`, walking front to back so
 * each already-placed prefix stays put as later items are inserted after it.
 * These are rems RemNote maintains itself, so callers must snapshot first.
 */
export async function applyValueOrder(
  plugin: RNPlugin,
  row: Rem,
  orderedValueIds: string[]
): Promise<void> {
  for (let i = 0; i < orderedValueIds.length; i++) {
    const valueRem = await plugin.rem.findOne(orderedValueIds[i]);
    if (!valueRem) throw new Error(`Value rem ${orderedValueIds[i]} not found`);
    await valueRem.setParent(row, i);
  }
}

export const BULK_ORDER_BACKUP_KEY = 'bulkRowOrderBackup';

export interface BulkOrderBackup {
  tagId: string;
  tagName: string;
  /** Only rows that were actually changed, with their pre-change order. */
  rows: { rowId: string; originalOrder: string[] }[];
  timestamp: number;
}

export interface RowSyncPlan {
  rowId: string;
  name: string;
  /** Slot names in their current order, for reporting. */
  from: string[];
  originalOrder: string[];
  toIds: string[];
}

/**
 * Work out which rows would change if every row's property values were put into
 * `targetSlotIds` order. Read-only — call this before asking the user anything.
 *
 * Slots missing from `targetSlotIds` sort to the end, keeping their relative
 * order, so a partial target (e.g. only the configured extras) leaves everything
 * else alone.
 */
export async function planRowSync(
  tag: Rem,
  columns: Rem[],
  targetSlotIds: string[]
): Promise<{ plans: RowSyncPlan[]; totalRows: number }> {
  const rank = new Map(targetSlotIds.map((id, i) => [id, i]));
  const rankOf = (slotId: string) => rank.get(slotId) ?? Number.MAX_SAFE_INTEGER;

  const rows = await tag.taggedRem();
  const plans: RowSyncPlan[] = [];

  for (const row of rows) {
    const current = await getRowValueOrder(row, columns);
    if (current.length < 2) continue;

    // Tie-break on current position so equally-ranked slots keep their order.
    const desired = current
      .map((e, i) => ({ e, i }))
      .sort((x, y) => rankOf(x.e.slotId) - rankOf(y.e.slotId) || x.i - y.i)
      .map((w) => w.e);

    if (desired.every((e, i) => e.valueRemId === current[i].valueRemId)) continue;

    plans.push({
      rowId: row._id,
      name: richTextToString(row.text) || '[unnamed]',
      from: current.map((e) => e.slotName),
      originalOrder: current.map((e) => e.valueRemId),
      toIds: desired.map((e) => e.valueRemId),
    });
  }

  return { plans, totalRows: rows.length };
}

/**
 * Apply a plan produced by `planRowSync`. The caller must have stored a backup
 * first — this writes immediately and does not roll back on partial failure.
 */
export async function applyRowSync(
  plugin: RNPlugin,
  plans: RowSyncPlan[],
  onProgress?: (completed: number, total: number) => void
): Promise<{ done: number; failed: number }> {
  let done = 0;
  let failed = 0;

  for (const plan of plans) {
    const row = await plugin.rem.findOne(plan.rowId);
    if (!row) {
      failed++;
      console.warn(`[RowSync] Row ${plan.rowId} no longer exists — skipped.`);
    } else {
      try {
        await applyValueOrder(plugin, row, plan.toIds);
        done++;
      } catch (e) {
        failed++;
        console.error(`[RowSync] Row ${plan.rowId} failed:`, e);
      }
    }
    onProgress?.(done + failed, plans.length);
  }

  return { done, failed };
}

export interface TagResolution {
  tag: Rem;
  /** Null when the focused rem already was the tag rem. */
  resolvedFrom: string | null;
}

/**
 * Find the rem that owns a table's card config, starting from whatever the user
 * happened to focus: the tag rem itself, a row tagged with it, or a slot rem.
 *
 * Writing to the wrong rem here is silent — a row rem will happily accept a
 * `Slot` powerup property that nothing ever reads — so every caller that writes
 * config must go through this.
 */
export async function resolveTagRem(
  plugin: RNPlugin,
  focused: Rem
): Promise<TagResolution> {
  const hasProperties = async (r: Rem): Promise<boolean> => {
    for (const k of await r.getChildrenRem()) {
      if (await k.isProperty().catch(() => false)) return true;
    }
    return false;
  };

  const isTag = await focused
    .hasPowerup(BuiltInPowerupCodes.UsedAsTag)
    .catch(() => false);
  if (isTag) return { tag: focused, resolvedFrom: null };

  const tags = await focused.getTagRems().catch(() => [] as Rem[]);
  for (const t of tags) {
    if (await hasProperties(t)) {
      return { tag: t, resolvedFrom: 'tag of the focused rem' };
    }
  }

  if (await focused.isProperty().catch(() => false)) {
    const parent = await focused.getParentRem();
    if (parent) return { tag: parent, resolvedFrom: 'parent of the focused slot' };
  }

  return { tag: focused, resolvedFrom: null };
}

export async function describeSlotIds(plugin: RNPlugin, ids: string[]): Promise<string> {
  if (ids.length === 0) return '(empty)';
  const names = await Promise.all(
    ids.map(async (id) => {
      const r = await plugin.rem.findOne(id);
      return r ? richTextToString(r.text) || '[unnamed]' : `[NOT FOUND ${id}]`;
    })
  );
  return names.join(', ');
}

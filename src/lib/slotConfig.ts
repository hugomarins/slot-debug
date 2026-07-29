import { ReactRNPlugin, PluginRem as Rem, RichTextInterface } from '@remnote/plugin-sdk';

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
 * render, in display order.
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
 * The slots that may be shown on a card owned by `rem`.
 *
 * For a tag rem those are its own property children (the table columns). For a
 * slot rem they are its siblings, i.e. the property children of its parent.
 */
export async function getCandidateSlots(plugin: ReactRNPlugin, rem: Rem): Promise<Rem[]> {
  const ownChildren = await rem.getChildrenRem();
  const ownProperties: Rem[] = [];
  for (const c of ownChildren) {
    if (await c.isProperty().catch(() => false)) ownProperties.push(c);
  }
  if (ownProperties.length > 0) return ownProperties;

  const parent = await rem.getParentRem();
  if (!parent) return [];
  const siblings = await parent.getChildrenRem();
  const siblingProperties: Rem[] = [];
  for (const s of siblings) {
    if (s._id === rem._id) continue;
    if (await s.isProperty().catch(() => false)) siblingProperties.push(s);
  }
  return siblingProperties;
}

export async function describeSlotIds(plugin: ReactRNPlugin, ids: string[]): Promise<string> {
  if (ids.length === 0) return '(empty)';
  const names = await Promise.all(
    ids.map(async (id) => {
      const r = await plugin.rem.findOne(id);
      return r ? richTextToString(r.text) || '[unnamed]' : `[NOT FOUND ${id}]`;
    })
  );
  return names.join(', ');
}

import {
  BuiltInPowerupCodes,
  RNPlugin,
  PluginRem as Rem,
} from '@remnote/plugin-sdk';
import {
  getColumnSlots,
  getRowValueOrder,
  resolveTagRem,
  richTextToString,
} from './slotConfig';

/**
 * Bulk tag / powerup management over a set of rems.
 *
 * The set is chosen by SCOPE. Two mechanisms produce it, deliberately:
 *
 *   - `refs` — every rem that references the focused rem. For a slot rem this
 *     IS its column: a table cell holds a reference to the slot inside its own
 *     text (that is exactly how `getRowValueOrder` finds cells), so the slot's
 *     reference list and its cells are the same rems. It costs one call instead
 *     of walking every row, works on any rem — not just slots — and does not
 *     depend on table internals.
 *   - `slot-cells` / `all-cells` / `rows` — resolved through the tag by walking
 *     the table, the way the rest of this plugin does. Kept because it is exact
 *     for tables and independent of how references behave.
 *
 * References are a SUPERSET of cells and contain rems that must never be
 * bulk-edited, so `refs` classifies rather than trusts:
 *
 *   - Powerup property rems are excluded outright. The tag's
 *     `ExtraSlotsOnFrontOfCard` value is rich text made of references to the
 *     slot rem — the very config `cce` writes — so it appears in the reference
 *     list. Tagging it would corrupt the card config.
 *   - The rest are bucketed by SHAPE: a reference leading the rem's text is a
 *     cell/bullet; one further in is a prose mention; one only in backText is an
 *     answer-side mention. Only `leading` is selected by default.
 */

/** A powerup this tool offers to add or remove, with the slots worth keeping. */
export interface PowerupDef {
  code: string;
  name: string;
  /** Slot NAMES (never the KB's one-letter codes — the SDK resolves by name). */
  slots: string[];
}

/**
 * Powerups that make sense on a cell, a bullet or a card-bearing rem.
 *
 * Deliberately not every `BuiltInPowerupCodes` value: the powerup index below
 * asks each of these for its full tagged set, so listing document-wide powerups
 * (Document, List, Divider) would pull enormous payloads to find nothing.
 */
export const MANAGEABLE_POWERUPS: PowerupDef[] = [
  { code: BuiltInPowerupCodes.ExtraCardDetail, name: 'Extra Card Detail', slots: [] },
  { code: BuiltInPowerupCodes.Highlight, name: 'Highlight', slots: ['Color'] },
  { code: BuiltInPowerupCodes.CustomCSS, name: 'Custom CSS', slots: [] },
  { code: BuiltInPowerupCodes.DisableCards, name: 'Disable Cards', slots: [] },
  { code: BuiltInPowerupCodes.HideQueueAncestors, name: 'Hide Queue Ancestors', slots: [] },
  { code: BuiltInPowerupCodes.EditLater, name: 'Edit Later', slots: ['Message'] },
  { code: BuiltInPowerupCodes.Todo, name: 'Todo', slots: ['Status'] },
  { code: BuiltInPowerupCodes.Quote, name: 'Quote', slots: [] },
  { code: BuiltInPowerupCodes.Code, name: 'Code', slots: ['Language'] },
  { code: BuiltInPowerupCodes.Callout, name: 'Callout', slots: ['BulletIcon'] },
  { code: BuiltInPowerupCodes.TypeInAnswer, name: 'Type In Answer', slots: [] },
  { code: BuiltInPowerupCodes.MultiLineCard, name: 'Multi Line Card', slots: [] },
  { code: BuiltInPowerupCodes.MultipleChoice, name: 'Multiple Choice', slots: [] },
  { code: BuiltInPowerupCodes.Header, name: 'Header', slots: ['Size'] },
];

/** Fallback colours offered when the scan observes none already in use. */
export const HIGHLIGHT_COLOR_PRESETS = [
  'Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple',
];

export type ScopeKind = 'refs' | 'slot-cells' | 'all-cells' | 'rows';

/**
 * Where the reference to the focused rem sits, which is what separates a cell
 * from a passing mention. Non-reference scopes report `leading` by construction.
 */
export type RefShape = 'leading' | 'embedded' | 'back' | 'other';

export interface ScopeMember {
  id: string;
  name: string;
  shape: RefShape;
  /** Set when the rem is locked out of every operation. */
  excluded?: string;
}

export const SHAPE_LABELS: Record<RefShape, string> = {
  leading: 'Cell / bullet — the reference leads the text',
  embedded: 'Mention — the reference sits inside the text',
  back: 'Answer side — the reference is only in the back text',
  other: 'Indirect — no direct reference found in the text',
};

const isRefTo = (node: any, id: string): boolean =>
  !!node && typeof node === 'object' && node.i === 'q' && node._id === id;

/** Rich text as a label, with the focused rem's own reference spelled out. */
const labelFor = (text: any[] | undefined, focusedId: string, focusedName: string): string =>
  (text || [])
    .map((n: any) => {
      if (typeof n === 'string') return n;
      if (n?.i === 'q') return n._id === focusedId ? `[[${focusedName}]]` : '[[…]]';
      return n?.text || '';
    })
    .join('')
    .trim();

/** Run `fn` over `items` a chunk at a time so N rems do not mean N round trips. */
export async function mapChunked<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>,
  onProgress?: (done: number, total: number) => void
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) {
    const chunk = items.slice(i, i + size);
    out.push(...(await Promise.all(chunk.map(fn))));
    onProgress?.(Math.min(i + size, items.length), items.length);
  }
  return out;
}

export interface SlotOption {
  id: string;
  name: string;
}

export interface ScopeContext {
  focusedId: string;
  focusedName: string;
  /** Null when no tag could be resolved — then only `refs` is available. */
  tagId: string | null;
  tagName: string | null;
  slots: SlotOption[];
  /** The slot the focused rem itself is, when it is one. */
  focusedSlotId: string | null;
  refCount: number | null;
}

/**
 * What the focused rem offers, without building any scope yet.
 *
 * `resolveTagRem` is reused so the same focus rules as the rest of the plugin
 * apply: the tag rem, a row tagged with it, or one of its slot rems all resolve
 * to the tag. It falls back to returning the focused rem itself, so the result
 * is only treated as a tag when it actually has column slots.
 */
export async function readScopeContext(plugin: RNPlugin, focused: Rem): Promise<ScopeContext> {
  const focusedName = richTextToString(focused.text) || '[unnamed]';

  let refCount: number | null = null;
  try {
    refCount = (await focused.remsReferencingThis()).length;
  } catch (e) {
    console.warn('[BulkTags] Could not count references:', e);
  }

  let tagId: string | null = null;
  let tagName: string | null = null;
  let slots: SlotOption[] = [];
  try {
    const { tag } = await resolveTagRem(plugin, focused);
    const columns = await getColumnSlots(tag);
    if (columns.length > 0) {
      tagId = tag._id;
      tagName = richTextToString(tag.text) || '[unnamed]';
      slots = columns.map((c) => ({
        id: c._id,
        name: richTextToString(c.text) || '[unnamed]',
      }));
    }
  } catch (e) {
    console.warn('[BulkTags] Could not resolve a tag from the focused rem:', e);
  }

  const focusedSlotId = slots.some((s) => s.id === focused._id) ? focused._id : null;

  return { focusedId: focused._id, focusedName, tagId, tagName, slots, focusedSlotId, refCount };
}

/**
 * The rems a scope covers, classified but not yet filtered.
 *
 * Read-only. The excluded members are returned rather than dropped so the UI can
 * show what was held back and why.
 */
export async function buildScope(
  plugin: RNPlugin,
  focused: Rem,
  kind: ScopeKind,
  slotId: string | null,
  onProgress?: (done: number, total: number) => void
): Promise<ScopeMember[]> {
  const focusedName = richTextToString(focused.text) || '[unnamed]';

  if (kind === 'refs') {
    const refs = await focused.remsReferencingThis();
    return mapChunked(
      refs,
      20,
      async (r): Promise<ScopeMember> => {
        const name = labelFor(r.text, focused._id, focusedName) || '[empty]';

        if (r._id === focused._id) {
          return { id: r._id, name, shape: 'other', excluded: 'the focused rem itself' };
        }

        // A powerup property rem is where RemNote parks a powerup's stored
        // value. The card-extras config is one of those and its value is a
        // reference to this very slot, so it always shows up here.
        const [isPowerupProperty, isPowerup] = await Promise.all([
          r.isPowerupProperty().catch(() => false),
          r.isPowerup().catch(() => false),
        ]);
        if (isPowerupProperty) {
          return {
            id: r._id,
            name,
            shape: 'other',
            excluded: 'stored powerup value (card config) — editing it would corrupt the config',
          };
        }
        if (isPowerup) {
          return { id: r._id, name, shape: 'other', excluded: 'a powerup definition' };
        }

        const idx = (r.text || []).findIndex((n: any) => isRefTo(n, focused._id));
        let shape: RefShape;
        if (idx === 0) shape = 'leading';
        else if (idx > 0) shape = 'embedded';
        else if (((r as any).backText || []).some((n: any) => isRefTo(n, focused._id))) shape = 'back';
        else shape = 'other';

        return { id: r._id, name, shape };
      },
      onProgress
    );
  }

  const { tag } = await resolveTagRem(plugin, focused);
  const tagName = richTextToString(tag.text) || '[unnamed]';

  if (kind === 'rows') {
    const rows = await tag.taggedRem();
    return rows.map((r) => ({
      id: r._id,
      name: richTextToString(r.text) || '[unnamed]',
      shape: 'leading' as RefShape,
    }));
  }

  // Cells are located by `getRowValueOrder`, which matches each of a row's
  // children to a column by the slot reference inside the child's own text.
  // `getTagPropertyAsRem` is avoided on purpose: it appears to CREATE a missing
  // value rem on access, which a read-only scan must never do.
  const columns = await getColumnSlots(tag);
  const rows = await tag.taggedRem();
  const members: ScopeMember[] = [];

  await mapChunked(
    rows,
    20,
    async (row) => {
      const rowName = richTextToString(row.text) || '[unnamed]';
      for (const entry of await getRowValueOrder(row, columns)) {
        if (kind === 'slot-cells' && entry.slotId !== slotId) continue;
        members.push({
          id: entry.valueRemId,
          name: `${rowName.slice(0, 60)} › ${entry.slotName}`,
          shape: 'leading',
        });
      }
    },
    onProgress
  );

  console.log(
    `[BulkTags] Scope "${kind}" on tag "${tagName}" — ${members.length} rems from ${rows.length} rows.`
  );
  return members;
}

export interface FoundEntry {
  kind: 'tag' | 'powerup';
  /** Tag rem id, or powerup code. */
  key: string;
  name: string;
  remIds: string[];
  /** Slot values seen on the rems that carry this powerup, per slot name. */
  observed: Record<string, string[]>;
  /** Which detector saw it. A disagreement is reported rather than hidden. */
  detectedBy: string[];
}

export interface ScanResult {
  entries: FoundEntry[];
  scanned: number;
  /** How many rems the powerup discovery pass actually asked. */
  sampled: number;
  /** Powerups nothing suggested were present — their ABSENCE is not proven. */
  unverified: PowerupDef[];
  /** True when every manageable powerup was asked of every rem. */
  exhaustive: boolean;
}

/** How many rems the discovery pass asks about every powerup. */
export const DISCOVERY_SAMPLE_SIZE = 60;

/**
 * A sample spread evenly across the set.
 *
 * Cells come out ordered by row, and the first N rows of a table built up over
 * years are not representative of it, so this strides rather than slicing.
 */
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const stride = items.length / max;
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(items[Math.floor(i * stride)]);
  return out;
}

/**
 * Which of `codes` each rem carries, asked of each rem directly.
 *
 * `hasPowerup` is the only reliable answer for a built-in powerup, and it costs
 * one call per rem per code, so the work is chunked to keep roughly a fixed
 * number of calls in flight instead of issuing them one at a time or all at once.
 */
export async function probeCodes(
  plugin: RNPlugin,
  memberIds: string[],
  codes: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, string[]>> {
  const hits = new Map<string, string[]>();
  if (codes.length === 0 || memberIds.length === 0) return hits;
  const perChunk = Math.max(2, Math.floor(120 / codes.length));

  await mapChunked(
    memberIds,
    perChunk,
    async (id) => {
      const rem = await plugin.rem.findOne(id);
      if (!rem) return;
      const carried = await Promise.all(codes.map((c) => rem.hasPowerup(c).catch(() => false)));
      carried.forEach((has, i) => {
        if (!has) return;
        const list = hits.get(codes[i]) ?? [];
        list.push(id);
        hits.set(codes[i], list);
      });
    },
    onProgress
  );

  return hits;
}

/**
 * Every tag and powerup carried by `members`, with the rems carrying each.
 *
 * TAGS come from `getTagRems()` per rem. That is reliable and exact.
 *
 * POWERUPS cannot be enumerated. This is the central constraint of this file and
 * it was learned the hard way, in this plugin and independently in the
 * incremental-everything plugin (`lib/synced_key_audit.ts`, `lib/priority_bands.ts`,
 * the `dpecd` probe command):
 *
 *   - `getPowerupByCode(code)` resolves the built-in powerup rem, but its
 *     `taggedRem()` comes back empty or returns a handful of rems on a knowledge
 *     base holding thousands. Built-in powerup membership is simply not indexed
 *     in a way the plugin API exposes.
 *   - `getTagRems()` does not report built-in powerups either. A cell carrying
 *     Extra Card Detail returns no tag for it.
 *
 * A first version of this scanner used both of those and reported "Extra Card
 * Detail: 0" across 1406 cells that visibly carry it. Asking each rem directly
 * with `hasPowerup()` is the only answer that is ever right.
 *
 * That is one call per rem per code, so it runs in two passes:
 *
 *   1. DISCOVERY — every manageable powerup asked of an evenly-spread sample,
 *      unioned with whatever the (unreliable, but never harmful) powerup index
 *      turns up. This decides only WHICH powerups to count, never how many.
 *   2. EXACT — every rem asked about the powerups discovery turned up. The
 *      counts and rem ids that reach the UI come only from this pass.
 *
 * Powerups discovery never saw are returned in `unverified`: the sample says
 * nothing about a powerup sitting on three rems out of a thousand, so the UI must
 * offer the exhaustive pass rather than claim the powerup is absent.
 */
export async function scanMembers(
  plugin: RNPlugin,
  members: ScopeMember[],
  onProgress?: (phase: string, done: number, total: number) => void,
  options?: { exhaustivePowerups?: boolean }
): Promise<ScanResult> {
  const targets = members.filter((m) => !m.excluded);
  const targetIds = targets.map((m) => m.id);
  const targetIdSet = new Set(targetIds);
  const allCodes = MANAGEABLE_POWERUPS.map((d) => d.code);

  // Powerup rems must be recognised by id if one ever does turn up in
  // getTagRems, or it would be listed a second time as an ordinary tag.
  const powerupIdToCode = new Map<string, string>();
  await Promise.all(
    Object.entries(BuiltInPowerupCodes).map(async ([, code]) => {
      const p = await plugin.powerup.getPowerupByCode(code as string).catch(() => undefined);
      if (p) powerupIdToCode.set(p._id, code as string);
    })
  );

  const byTag = new Map<string, { name: string; ids: string[] }>();

  await mapChunked(
    targets,
    20,
    async (m) => {
      const rem = await plugin.rem.findOne(m.id);
      if (!rem) return;
      const tags = await rem.getTagRems().catch(() => [] as Rem[]);
      for (const t of tags) {
        if (powerupIdToCode.has(t._id)) continue;
        const entry = byTag.get(t._id) ?? {
          name: richTextToString(t.text) || '[unnamed]',
          ids: [],
        };
        entry.ids.push(m.id);
        byTag.set(t._id, entry);
      }
    },
    (done, total) => onProgress?.('Reading tags', done, total)
  );

  const exhaustive = !!options?.exhaustivePowerups;
  let codesToCount: string[];
  let sampled: number;

  if (exhaustive) {
    codesToCount = allCodes;
    sampled = targetIds.length;
  } else {
    const sample = sampleEvenly(targetIds, DISCOVERY_SAMPLE_SIZE);
    sampled = sample.length;
    const discovered = new Set<string>();

    const sampleHits = await probeCodes(plugin, sample, allCodes, (d, t) =>
      onProgress?.(`Probing ${allCodes.length} powerups on a ${sample.length}-rem sample`, d, t)
    );
    for (const code of sampleHits.keys()) discovered.add(code);

    // The powerup index under-reports badly, so it can never decide a count —
    // but anything it does find is a real carrier, which makes it a free extra
    // source of codes worth counting properly in the pass below.
    for (let i = 0; i < MANAGEABLE_POWERUPS.length; i++) {
      const def = MANAGEABLE_POWERUPS[i];
      if (discovered.has(def.code)) continue;
      onProgress?.('Checking the powerup index', i, MANAGEABLE_POWERUPS.length);
      try {
        const p = await plugin.powerup.getPowerupByCode(def.code);
        if (!p) continue;
        if ((await p.taggedRem()).some((r) => targetIdSet.has(r._id))) discovered.add(def.code);
      } catch (e) {
        console.warn(`[BulkTags] Powerup index failed for "${def.name}" (${def.code}):`, e);
      }
    }

    codesToCount = allCodes.filter((c) => discovered.has(c));
  }

  const hits = await probeCodes(plugin, targetIds, codesToCount, (d, t) =>
    onProgress?.(
      exhaustive
        ? `Probing all ${codesToCount.length} powerups on every rem`
        : `Counting ${codesToCount.length} powerup(s) on every rem`,
      d,
      t
    )
  );

  const entries: FoundEntry[] = [];

  for (const [code, ids] of hits) {
    if (ids.length === 0) continue;
    const def = MANAGEABLE_POWERUPS.find((d) => d.code === code);
    const observed: Record<string, string[]> = {};

    // Learn the stored format from the KB rather than guessing it: the values
    // already in use are the ones known to work, and they become the choices
    // offered when adding this powerup.
    if (def && def.slots.length > 0) {
      const sample = sampleEvenly(ids, 25);
      for (const slot of def.slots) {
        const seen = new Set<string>();
        await mapChunked(sample, 20, async (id) => {
          const rem = await plugin.rem.findOne(id);
          if (!rem) return;
          const v = await rem.getPowerupProperty(code, slot).catch(() => '');
          if (v && v.trim()) seen.add(v.trim());
        });
        if (seen.size > 0) observed[slot] = [...seen];
      }
    }

    entries.push({
      kind: 'powerup',
      key: code,
      name: def?.name ?? `Powerup "${code}"`,
      remIds: ids,
      observed,
      detectedBy: ['hasPowerup'],
    });
  }

  for (const [id, e] of byTag) {
    entries.push({
      kind: 'tag',
      key: id,
      name: e.name,
      remIds: e.ids,
      observed: {},
      detectedBy: ['getTagRems'],
    });
  }

  entries.sort((a, b) => b.remIds.length - a.remIds.length || a.name.localeCompare(b.name));

  const unverified = exhaustive
    ? []
    : MANAGEABLE_POWERUPS.filter((d) => !codesToCount.includes(d.code));

  console.group(`[BulkTags] Scanned ${targets.length} rems`);
  entries.forEach((e) =>
    console.log(`  ${e.kind === 'powerup' ? '⚡' : '#'} ${e.name} — ${e.remIds.length}`)
  );
  console.log(
    exhaustive
      ? 'Exhaustive: every manageable powerup was asked of every rem.'
      : `Counted exactly: ${codesToCount.length ? codesToCount.join(', ') : 'none'}. ` +
          `Not seen in the ${sampled}-rem sample, so absence is unproven: ` +
          `${unverified.map((d) => d.name).join(', ') || 'none'}.`
  );
  console.groupEnd();

  return { entries, scanned: targets.length, sampled, unverified, exhaustive };
}

export interface BulkOp {
  action: 'add' | 'remove';
  kind: 'tag' | 'powerup';
  /** Tag rem id, or powerup code. */
  key: string;
  name: string;
  /** Powerup slot values to write after adding, by slot name. */
  slotValues?: Record<string, string>;
}

export const BULK_TAG_BACKUP_KEY = 'bulkTagBackup';

export interface BulkTagBackup {
  timestamp: number;
  /** What was done, for the undo panel to describe. */
  did: string;
  /** The operation that reverses it. */
  undo: BulkOp;
  remIds: string[];
  /** Powerup slot values captured before a removal, by rem id then slot name. */
  slotValues?: Record<string, Record<string, string>>;
}

export interface ApplyResult {
  changed: number;
  skipped: number;
  failed: number;
  /** The rems actually changed — the only ones an undo should touch. */
  changedIds: string[];
  slotValues: Record<string, Record<string, string>>;
}

/**
 * Apply `op` to every member, re-checking each rem first.
 *
 * The re-check is what makes a generous scan safe: a rem the scan listed but
 * which does not actually carry the tag is skipped, not "removed" from.
 * Slot values are captured before a powerup removal so the undo can put them back
 * — `removePowerup` takes the powerup's slots with it.
 */
export async function applyBulk(
  plugin: RNPlugin,
  memberIds: string[],
  op: BulkOp,
  onProgress?: (done: number, total: number) => void
): Promise<ApplyResult> {
  const def = MANAGEABLE_POWERUPS.find((d) => d.code === op.key);
  const result: ApplyResult = { changed: 0, skipped: 0, failed: 0, changedIds: [], slotValues: {} };

  for (let i = 0; i < memberIds.length; i++) {
    const id = memberIds[i];
    try {
      const rem = await plugin.rem.findOne(id);
      if (!rem) {
        result.failed++;
        console.warn(`[BulkTags] Rem ${id} no longer exists — skipped.`);
      } else if (op.kind === 'tag') {
        const has = (await rem.getTagRems().catch(() => [] as Rem[])).some((t) => t._id === op.key);
        if (op.action === 'add' ? has : !has) {
          result.skipped++;
        } else {
          if (op.action === 'add') await rem.addTag(op.key);
          else await rem.removeTag(op.key);
          result.changed++;
          result.changedIds.push(id);
        }
      } else {
        const has = await rem.hasPowerup(op.key).catch(() => false);
        if (op.action === 'add') {
          const writesValues = !!op.slotValues && Object.keys(op.slotValues).length > 0;
          if (has && !writesValues) {
            result.skipped++;
          } else {
            if (!has) await rem.addPowerup(op.key);
            for (const [slot, value] of Object.entries(op.slotValues || {})) {
              await rem.setPowerupProperty(op.key, slot, [value]);
            }
            result.changed++;
            result.changedIds.push(id);
          }
        } else if (!has) {
          result.skipped++;
        } else {
          const captured: Record<string, string> = {};
          for (const slot of def?.slots || []) {
            const v = await rem.getPowerupProperty(op.key, slot).catch(() => '');
            if (v) captured[slot] = v;
          }
          if (Object.keys(captured).length > 0) result.slotValues[id] = captured;
          await rem.removePowerup(op.key);
          result.changed++;
          result.changedIds.push(id);
        }
      }
    } catch (e) {
      result.failed++;
      console.error(`[BulkTags] Rem ${id} failed:`, e);
    }
    onProgress?.(i + 1, memberIds.length);
  }

  return result;
}

/** Apply a stored backup's inverse operation, restoring captured slot values. */
export async function applyUndo(
  plugin: RNPlugin,
  backup: BulkTagBackup,
  onProgress?: (done: number, total: number) => void
): Promise<ApplyResult> {
  const result = await applyBulk(plugin, backup.remIds, backup.undo, onProgress);

  if (backup.undo.action === 'add' && backup.undo.kind === 'powerup' && backup.slotValues) {
    for (const [id, slots] of Object.entries(backup.slotValues)) {
      try {
        const rem = await plugin.rem.findOne(id);
        if (!rem) continue;
        for (const [slot, value] of Object.entries(slots)) {
          await rem.setPowerupProperty(backup.undo.key, slot, [value]);
        }
      } catch (e) {
        console.error(`[BulkTags] Could not restore powerup values on ${id}:`, e);
      }
    }
  }

  return result;
}

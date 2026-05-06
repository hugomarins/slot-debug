import { useState } from 'react';
import {
  renderWidget,
  usePlugin,
  useRunAsync,
  WidgetLocation,
} from '@remnote/plugin-sdk';

const richTextToString = (text: any[]): string =>
  (text || []).map((n: any) => (typeof n === 'string' ? n : n?.text || '')).join('');

interface SlotInfo {
  id: string;
  name: string;
  refsCount: number;
  source: 'direct' | string; // 'direct' or template name
}

interface TagData {
  name: string;
  id: string;
  taggedCount: number;
  slots: SlotInfo[];
  nonPropertyChildCount: number;
  emptyFrontInstanceCount: number;
  emptyFrontRemIds: string[];
}

const preStyle: React.CSSProperties = {
  backgroundColor: 'var(--rn-clr-background-secondary)',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '10px',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  userSelect: 'all',
  margin: 0,
};

const label: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--rn-clr-content-tertiary)',
  marginBottom: '3px',
};

const divider: React.CSSProperties = {
  borderBottom: '1px solid var(--rn-clr-background-tertiary)',
  marginBottom: '12px',
  paddingBottom: '6px',
};

function TagDebug() {
  const plugin = usePlugin();
  const [refreshKey, setRefreshKey] = useState(0);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Record<string, number>>({});

  const ctx = useRunAsync(
    async () => plugin.widget.getWidgetContext<WidgetLocation.Popup>(),
    []
  );
  const remId = ctx?.contextData?.remId as string | undefined;

  const data = useRunAsync<TagData | null>(async () => {
    if (!remId) return null;
    const rem = await plugin.rem.findOne(remId);
    if (!rem) return null;

    const name = richTextToString(rem.text || []) || '[unnamed]';
    const [children, taggedRems] = await Promise.all([
      rem.getChildrenRem(),
      rem.taggedRem(),
    ]);

    const slots: SlotInfo[] = [];
    let nonPropertyChildCount = 0;

    for (const child of children) {
      const isProperty = await child.isProperty();
      if (isProperty) {
        const childName = richTextToString(child.text || []) || '[unnamed]';
        const refs = await child.remsReferencingThis();
        slots.push({ id: child._id, name: childName, refsCount: refs.length, source: 'direct' });
        continue;
      }

      // Template containers (e.g. "Vocab Template") are tagged with RemNote's
      // built-in "Tag Template" tag. Check for it by name via getTagRems().
      const childTags = await child.getTagRems();
      const isTemplateContainer = childTags.some(
        (t) => richTextToString(t.text || []) === 'Tag Template'
      );
      if (isTemplateContainer) {
        const templateName = richTextToString(child.text || []) || '[unnamed template]';
        const templateChildren = await child.getChildrenRem();
        for (const tc of templateChildren) {
          if (!await tc.isProperty()) continue;
          const tcName = richTextToString(tc.text || []) || '[unnamed]';
          const refs = await tc.remsReferencingThis();
          slots.push({ id: tc._id, name: tcName, refsCount: refs.length, source: templateName });
        }
        continue;
      }

      nonPropertyChildCount++;
    }

    // A front is truly empty only when every node in the text array is a plain
    // string that trims to "". Object nodes (references, links, powerup slots)
    // must not be treated as empty — richTextToString converts them to "" which
    // caused false positives for Priority/Source slots of other powerups.
    const isTrulyEmptyFront = (nodes: any[]): boolean =>
      nodes.length === 0 || nodes.every((n: any) =>
        typeof n === 'string' ? n.trim() === '' : false
      );

    const emptyFrontChecks = await Promise.all(
      taggedRems.map(async (r) => {
        const ch = await r.getChildrenRem();
        return ch
          .filter(c =>
            isTrulyEmptyFront(c.text || []) &&
            richTextToString((c as any).backText || []).trim() !== ''
          )
          .map(c => c._id);
      })
    );
    const emptyFrontRemIds = emptyFrontChecks.flat();
    const emptyFrontInstanceCount = emptyFrontChecks.filter(ids => ids.length > 0).length;

    return { name, id: remId, taggedCount: taggedRems.length, slots, nonPropertyChildCount, emptyFrontInstanceCount, emptyFrontRemIds };
  }, [remId, refreshKey]);

  const handleForceDelete = async (slot: SlotInfo) => {
    const confirmed = window.confirm(
      `⚠️ DANGER — Force Delete Slot\n\n` +
      `Slot: "${slot.name}"\n` +
      `ID: ${slot.id}\n\n` +
      `This will:\n` +
      `  1. Remove the slot rem itself\n` +
      `  2. Remove its property-value rem from every tagged rem\n\n` +
      `MAKE A BACKUP FIRST. This is IRREVERSIBLE.\n\nProceed?`
    );
    if (!confirmed) {
      console.log(`[TagDebug] Force delete cancelled by user for slot "${slot.name}" (${slot.id})`);
      return;
    }

    console.log(`[TagDebug] Force delete started for slot "${slot.name}" (${slot.id})`);
    setDeleting(slot.id);
    try {
      const tagRem = await plugin.rem.findOne(remId!);
      if (!tagRem) {
        const msg = 'Tag rem not found.';
        console.error('[TagDebug]', msg, 'remId:', remId);
        await plugin.app.toast(msg);
        setDeleting(null);
        return;
      }
      console.log(`[TagDebug] Tag rem found: "${richTextToString(tagRem.text || [])}" (${tagRem._id})`);

      console.log('[TagDebug] Fetching tagged rems…');
      const taggedRems = await tagRem.taggedRem();
      console.log(`[TagDebug] Found ${taggedRems.length} tagged rems. Resolving property-value rems for slot…`);

      const valueRems = await Promise.all(taggedRems.map((r) => r.getTagPropertyAsRem(slot.id)));
      const presentValues = valueRems.filter(Boolean);
      console.log(`[TagDebug] ${presentValues.length} of ${taggedRems.length} tagged rems have a value for this slot.`);

      let deletedCount = 0;
      for (const v of valueRems) {
        if (v) {
          try {
            await v.remove();
            deletedCount++;
            console.log(`[TagDebug] Deleted property-value rem ${v._id} (${deletedCount}/${presentValues.length})`);
          } catch (e) {
            console.error(`[TagDebug] Failed to delete property-value rem ${v._id}:`, e);
          }
        }
      }
      console.log(`[TagDebug] Property-value deletion done. ${deletedCount} removed.`);

      console.log(`[TagDebug] Deleting slot rem itself (${slot.id})…`);
      const slotRem = await plugin.rem.findOne(slot.id);
      if (slotRem) {
        await slotRem.remove();
        console.log(`[TagDebug] Slot rem deleted.`);
      } else {
        console.warn(`[TagDebug] Slot rem (${slot.id}) not found — may have already been deleted.`);
      }

      const msg = `Deleted slot "${slot.name}" + ${deletedCount} property-value rem(s).`;
      console.log('[TagDebug]', msg);
      await plugin.app.toast(msg);
      setDeleted((prev) => ({ ...prev, [slot.id]: deletedCount }));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      const msg = 'Force delete failed — check browser console.';
      console.error('[TagDebug]', msg, e);
      await plugin.app.toast(msg);
    }
    setDeleting(null);
  };


  if (!remId) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Focus on a tag rem in the editor, then run <strong>Debug Tag Slots</strong>.
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ padding: 16, fontSize: 13, color: 'var(--rn-clr-content-primary)' }}>
        Loading…
      </div>
    );
  }

  return (
    <div style={{ padding: 16, fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--rn-clr-content-primary)', maxHeight: '90vh', overflowY: 'auto' }}>

      {/* Header */}
      <div style={{ ...divider, display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Tag Slot Debugger</span>
      </div>

      {/* Tag identity */}
      <div style={{ marginBottom: 10 }}>
        <div style={label}>Tag Name</div>
        <div style={{ fontWeight: 700, fontSize: 16 }}>{data.name}</div>
      </div>
      <div style={{ marginBottom: 10 }}>
        <div style={label}>Tag Rem ID</div>
        <pre style={preStyle}>{data.id}</pre>
      </div>
      <div style={{ marginBottom: 16, ...divider }}>
        <div style={label}>Instances (rems tagged with this tag)</div>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{data.taggedCount}</div>
        {data.nonPropertyChildCount > 0 && (
          <div style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)', marginTop: 2 }}>
            + {data.nonPropertyChildCount} non-property children hidden (rows / nested rems)
          </div>
        )}
        {data.emptyFrontInstanceCount > 0 && (
          <div style={{ marginTop: 10, padding: '8px 10px', backgroundColor: 'var(--rn-clr-background-secondary)', borderRadius: 5, border: '1px solid #b45309' }}>
            <div style={{ fontSize: 12, color: '#f59e0b', fontWeight: 600, marginBottom: 6 }}>
              ⚠️ {data.emptyFrontRemIds.length} orphaned rem(s) found in {data.emptyFrontInstanceCount} instance(s)
            </div>
            <div style={{ fontSize: 11, color: 'var(--rn-clr-content-tertiary)', marginBottom: 6 }}>
              Empty front + non-empty back (deleted property-value rems)
            </div>
            <button
              onClick={async () => {
                console.log(`[TagDebug] Opening orphaned rems inspector for "${data.name}" (${data.id})`);
                await plugin.widget.openPopup('orphaned_rems', { remId: data.id, tagName: data.name });
              }}
              style={{
                padding: '3px 10px',
                backgroundColor: '#b45309',
                color: 'white',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              Show {data.emptyFrontRemIds.length} Orphaned Rem(s) →
            </button>
          </div>
        )}
      </div>

      {/* Slots section */}
      <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
        Slots / Properties ({data.slots.length})
      </div>

      {data.slots.length === 0 ? (
        <div style={{ fontSize: 12, color: 'var(--rn-clr-content-tertiary)', marginBottom: 12 }}>
          No property-flagged children found on this rem.{' '}
          {data.nonPropertyChildCount > 0 && 'Check that you focused on the tag definition rem, not a tagged instance.'}
        </div>
      ) : (
        data.slots.map((slot) => (
          <div key={slot.id} style={{ border: '1px solid var(--rn-clr-background-tertiary)', borderRadius: 6, padding: 10, marginBottom: 8 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{slot.name}</div>
              <div style={{ fontSize: 10, color: 'var(--rn-clr-content-tertiary)', fontStyle: 'italic' }}>
                {slot.source === 'direct' ? 'direct property' : `via "${slot.source}"`}
              </div>
            </div>

            <div style={{ marginBottom: 4 }}>
              <div style={label}>Property ID</div>
              <pre style={preStyle}>{slot.id}</pre>
            </div>

            <div style={{ fontSize: 12, marginBottom: 6 }}>
              <strong>Tagged rems with a value here:</strong> ~{slot.refsCount}
            </div>

            {deleted[slot.id] !== undefined && (
              <div style={{ fontSize: 11, color: '#22c55e', fontWeight: 600, marginBottom: 4 }}>
                ✓ Deleted — {deleted[slot.id]} property-value rem(s) removed from tagged rems.
              </div>
            )}

            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button
                disabled={!!deleting || deleted[slot.id] !== undefined}
                onClick={() => handleForceDelete(slot)}
                style={{
                  padding: '3px 10px',
                  backgroundColor: deleted[slot.id] !== undefined ? '#374151' : '#dc2626',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: (deleting || deleted[slot.id] !== undefined) ? 'default' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: deleting === slot.id ? 0.6 : 1,
                }}
              >
                {deleting === slot.id ? 'Deleting…'
                  : deleted[slot.id] !== undefined ? `Deleted (${deleted[slot.id]} removed)`
                  : `Force Delete`}
              </button>

              <button
                onClick={async () => {
                  const rem = await plugin.rem.findOne(slot.id);
                  if (!rem) {
                    await plugin.app.toast(`Rem not found: ${slot.id}`);
                    return;
                  }
                  await plugin.window.openRem(rem);
                }}
                style={{
                  padding: '3px 10px',
                  backgroundColor: 'transparent',
                  color: 'var(--rn-clr-content-primary)',
                  border: '1px solid var(--rn-clr-background-tertiary)',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                Open Property Rem
              </button>
            </div>
          </div>
        ))
      )}

      <div style={{ marginTop: 12, padding: 8, backgroundColor: 'var(--rn-clr-background-secondary)', borderRadius: 4, fontSize: 11, color: 'var(--rn-clr-content-tertiary)' }}>
        ⚠️ Back up your knowledge base before Force Delete. Disable this plugin when not in use.
      </div>
    </div>
  );
}

renderWidget(TagDebug);

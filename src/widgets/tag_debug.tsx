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
  isProperty: boolean;
  refsCount: number;
}

interface TagData {
  name: string;
  id: string;
  taggedCount: number;
  slots: SlotInfo[];
}

const preStyle: React.CSSProperties = {
  backgroundColor: 'var(--rn-clr-background-secondary)',
  padding: '4px 6px',
  borderRadius: '3px',
  fontSize: '10px',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
  userSelect: 'all',
};

const sectionHeader: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--rn-clr-content-tertiary)',
  marginBottom: '2px',
};

const card: React.CSSProperties = {
  border: '1px solid var(--rn-clr-background-tertiary)',
  borderRadius: '6px',
  padding: '10px',
  marginBottom: '8px',
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

    const children = await rem.getChildrenRem();
    const slots: SlotInfo[] = [];
    for (const child of children) {
      const isProperty = await child.isProperty();
      const childName = richTextToString(child.text || []) || '[unnamed]';
      const refs = await child.remsReferencingThis();
      slots.push({
        id: child._id,
        name: childName,
        isProperty,
        refsCount: refs.length,
      });
    }

    const taggedRems = await rem.taggedRem();

    return { name, id: remId, taggedCount: taggedRems.length, slots };
  }, [remId, refreshKey]);

  const handleForceDelete = async (slot: SlotInfo) => {
    const warningMsg =
      `⚠️  DANGER: Force Delete Slot\n\n` +
      `Slot: "${slot.name}"\n` +
      `ID: ${slot.id}\n` +
      `Estimated refs to delete: ${slot.refsCount}\n\n` +
      `This will:\n` +
      `  1. Delete the slot rem itself\n` +
      `  2. Delete all property-value rems in tagged rems linked to it\n\n` +
      `⚠️  MAKE A BACKUP BEFORE PROCEEDING.\n` +
      `This operation is IRREVERSIBLE.\n\n` +
      `Click OK to proceed.`;

    if (!window.confirm(warningMsg)) return;

    setDeleting(slot.id);
    try {
      const tagRem = await plugin.rem.findOne(remId!);
      if (!tagRem) {
        await plugin.app.toast('Tag rem not found.');
        setDeleting(null);
        return;
      }

      // Delete property values from each tagged rem using precise API
      const taggedRems = await tagRem.taggedRem();
      const propertyValueRems = await Promise.all(
        taggedRems.map((r) => r.getTagPropertyAsRem(slot.id))
      );

      let deletedCount = 0;
      for (const valueRem of propertyValueRems) {
        if (valueRem) {
          try {
            await valueRem.remove();
            deletedCount++;
          } catch (e) {
            console.error('[TagDebug] Failed to delete property value rem:', e);
          }
        }
      }

      // Delete the slot rem itself
      const slotRem = await plugin.rem.findOne(slot.id);
      if (slotRem) {
        await slotRem.remove();
      }

      await plugin.app.toast(
        `Deleted slot "${slot.name}" and ${deletedCount} linked property value rem(s).`
      );
      setDeleted((prev) => ({ ...prev, [slot.id]: deletedCount }));
      setRefreshKey((k) => k + 1);
    } catch (e) {
      console.error('[TagDebug] Force delete failed:', e);
      await plugin.app.toast('Force delete failed — check browser console.');
    }
    setDeleting(null);
  };

  if (!remId) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--rn-clr-content-primary)' }}>
        No rem context. Focus on a tag rem in the editor, then run the command.
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-4 text-sm" style={{ color: 'var(--rn-clr-content-primary)' }}>
        Loading…
      </div>
    );
  }

  return (
    <div
      className="p-4 w-full max-h-[80vh] overflow-y-auto"
      style={{ fontFamily: 'system-ui, -apple-system, sans-serif', color: 'var(--rn-clr-content-primary)' }}
    >
      <h2 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '12px', paddingBottom: '6px', borderBottom: '1px solid var(--rn-clr-background-tertiary)' }}>
        Tag Slot Debugger
      </h2>

      <div style={{ marginBottom: '12px' }}>
        <div style={sectionHeader}>Tag Name</div>
        <div style={{ fontWeight: 600 }}>{data.name}</div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <div style={sectionHeader}>Tag Rem ID</div>
        <pre style={preStyle}>{data.id}</pre>
      </div>

      <div style={{ marginBottom: '16px' }}>
        <div style={sectionHeader}>Rems Tagged with This Tag</div>
        <div style={{ fontSize: '20px', fontWeight: 700 }}>{data.taggedCount}</div>
      </div>

      <h3 style={{ fontSize: '13px', fontWeight: 'bold', marginBottom: '8px', paddingBottom: '4px', borderBottom: '1px solid var(--rn-clr-background-tertiary)' }}>
        Children / Slots ({data.slots.length})
      </h3>

      <div style={{ fontSize: '11px', color: 'var(--rn-clr-content-tertiary)', marginBottom: '10px' }}>
        "Refs" = rems referencing this slot rem (proxy for property-value rems in tagged rems).
        Ghost slots may appear here as non-properties with refs still pointing at them.
      </div>

      {data.slots.length === 0 && (
        <div style={{ color: 'var(--rn-clr-content-tertiary)', fontSize: '13px' }}>
          No children found on this rem.
        </div>
      )}

      {data.slots.map((slot) => (
        <div key={slot.id} style={card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ fontWeight: 600, fontSize: '13px' }}>{slot.name}</div>
            <div style={{ fontSize: '12px', padding: '1px 6px', borderRadius: '10px', backgroundColor: slot.isProperty ? '#166534' : '#7f1d1d', color: 'white', whiteSpace: 'nowrap' }}>
              {slot.isProperty ? 'property ✓' : 'NOT a property'}
            </div>
          </div>

          <div style={{ marginTop: '6px' }}>
            <div style={sectionHeader}>Slot ID</div>
            <pre style={preStyle}>{slot.id}</pre>
          </div>

          <div style={{ marginTop: '6px', fontSize: '12px' }}>
            <span style={{ marginRight: '12px' }}>
              <strong>Refs count:</strong> {slot.refsCount}
            </span>
          </div>

          {deleted[slot.id] !== undefined && (
            <div style={{ marginTop: '6px', fontSize: '11px', color: '#22c55e', fontWeight: 600 }}>
              ✓ Deleted — removed {deleted[slot.id]} property value rem(s) from tagged rems.
            </div>
          )}

          <button
            disabled={deleting === slot.id || deleted[slot.id] !== undefined}
            onClick={() => handleForceDelete(slot)}
            style={{
              marginTop: '8px',
              padding: '4px 10px',
              backgroundColor: deleted[slot.id] !== undefined ? '#374151' : '#dc2626',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: deleting === slot.id || deleted[slot.id] !== undefined ? 'default' : 'pointer',
              fontSize: '12px',
              fontWeight: 600,
              opacity: deleting === slot.id ? 0.6 : 1,
            }}
          >
            {deleting === slot.id
              ? 'Deleting…'
              : deleted[slot.id] !== undefined
              ? `Deleted (${deleted[slot.id]} refs removed)`
              : `Force Delete (${slot.refsCount} refs)`}
          </button>
        </div>
      ))}

      <div style={{ marginTop: '16px', padding: '8px', backgroundColor: 'var(--rn-clr-background-secondary)', borderRadius: '4px', fontSize: '11px', color: 'var(--rn-clr-content-tertiary)' }}>
        ⚠️ Always back up your RemNote knowledge base before using Force Delete. Disable this plugin when not in use to avoid accidental deletions.
      </div>
    </div>
  );
}

renderWidget(TagDebug);

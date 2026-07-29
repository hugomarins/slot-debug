import {
	declareIndexPlugin,
	ReactRNPlugin,
	WidgetLocation,
	BuiltInPowerupCodes,
} from "@remnote/plugin-sdk";
import "../style.css";
import {
	resolveTagRem,
	getColumnSlots,
	getRowValueOrder,
	applyValueOrder,
	richTextToString as slotRichTextToString,
} from "../lib/slotConfig";

const ROW_ORDER_BACKUP_KEY = 'rowOrderProbeBackup';

interface RowOrderBackup {
	rowId: string;
	rowName: string;
	/** Value rem ids in their original order, index = original position. */
	originalOrder: string[];
	timestamp: number;
}

const richTextToString = (text: any[]): string =>
  (text || []).map((n: any) => (typeof n === 'string' ? n : n?.text || '')).join('');

async function onActivate(plugin: ReactRNPlugin) {
	plugin.app.registerWidget('tag_debug', WidgetLocation.Popup, {
		dimensions: { width: '500px', height: 900 },
	});

	plugin.app.registerWidget('orphaned_rems', WidgetLocation.Popup, {
		dimensions: { width: '860px', height: 700 },
	});

	plugin.app.registerWidget('slot_inspector', WidgetLocation.Popup, {
		dimensions: { width: '640px', height: 900 },
	});

	await plugin.app.registerCommand({
		id: 'inspect-slot-config',
		name: 'Inspect Slot Config (Cards)',
		description:
			'Dump the Slot powerup ("y") card config — ExtraSlotsOnFront/BackOfCard — for the focused rem and its children.',
		quickCode: 'isc',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a rem first.');
				return;
			}
			await plugin.widget.openPopup('slot_inspector', { remId: rem._id });
		},
	});

	plugin.app.registerWidget('card_slot_config', WidgetLocation.Popup, {
		dimensions: { width: '520px', height: 700 },
	});

	await plugin.app.registerCommand({
		id: 'configure-card-extras',
		name: 'Configure Card Extras',
		description:
			'Choose which properties show on the front/back of a table\'s cards — including the primary/cloze card, whose menu RemNote removed.',
		quickCode: 'cce',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus a tag rem (or a rem tagged with it) first.');
				return;
			}
			await plugin.widget.openPopup('card_slot_config', { remId: rem._id });
		},
	});


	// --- Row value-order probe -------------------------------------------
	// Cards render extras in the order of the ROW's property-value rems. This
	// reorders one row's value rems to match the tag's column order to find out
	// whether that order is (a) writable at all, (b) reflected on the card, and
	// (c) stable. Reversible via "PROBE: Restore Row Value Order".
	await plugin.app.registerCommand({
		id: 'probe-reorder-row-values',
		name: 'PROBE: Reorder Row Values To Column Order',
		description:
			'Reversible — moves one row\'s property-value rems into the tag\'s column order to test whether card render order follows.',
		quickCode: 'prv',
		action: async () => {
			const row = await plugin.focus.getFocusedRem();
			if (!row) {
				await plugin.app.toast('Focus a table ROW first.');
				return;
			}

			const rowName = slotRichTextToString(row.text) || '[unnamed]';
			console.group(`[RowOrderProbe] Row "${rowName}" (${row._id})`);

			const pending = await plugin.storage.getLocal<RowOrderBackup>(ROW_ORDER_BACKUP_KEY);
			if (pending) {
				console.warn('[RowOrderProbe] A previous backup is still pending:', pending);
				console.groupEnd();
				await plugin.app.toast(
					`Row "${pending.rowName}" is not restored yet. Run "PROBE: Restore Row Value Order" first.`
				);
				return;
			}

			const { tag } = await resolveTagRem(plugin, row);
			const tagsOfRow = await row.getTagRems().catch(() => []);
			if (tag._id === row._id || !tagsOfRow.some((t) => t._id === tag._id)) {
				console.warn('[RowOrderProbe] Focused rem is not a row of a table tag.');
				console.groupEnd();
				await plugin.app.toast('That rem is not a table row — focus a row.');
				return;
			}

			const columns = await getColumnSlots(tag);
			const current = await getRowValueOrder(row, columns);
			const columnIndex = new Map(columns.map((c, i) => [c._id, i]));

			console.log('Column order:', columns.map((c) => slotRichTextToString(c.text)).join(', '));
			console.log(
				'Current value order:',
				current.map((e) => `${e.slotName}@${e.position}`).join(', ')
			);

			if (current.length < 2) {
				console.warn('[RowOrderProbe] Fewer than two values on this row — nothing to reorder.');
				console.groupEnd();
				await plugin.app.toast('This row has fewer than two property values.');
				return;
			}

			const desired = [...current].sort(
				(a, b) => (columnIndex.get(a.slotId) ?? 0) - (columnIndex.get(b.slotId) ?? 0)
			);
			if (desired.every((e, i) => e.valueRemId === current[i].valueRemId)) {
				console.log('Row already matches column order — nothing to do.');
				console.groupEnd();
				await plugin.app.toast('This row already matches the column order.');
				return;
			}

			console.log('Desired value order:', desired.map((e) => e.slotName).join(', '));

			const confirmed = window.confirm(
				`Reorder the property values of this row?\n\n"${rowName}"\n${row._id}\n\n` +
				`from: ${current.map((e) => e.slotName).join(', ')}\n` +
				`to:   ${desired.map((e) => e.slotName).join(', ')}\n\n` +
				`This moves rems that RemNote maintains itself. BACK UP FIRST.\n` +
				`Undo with "PROBE: Restore Row Value Order".\n\nProceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user.');
				console.groupEnd();
				return;
			}

			await plugin.storage.setLocal(ROW_ORDER_BACKUP_KEY, {
				rowId: row._id,
				rowName,
				originalOrder: current.map((e) => e.valueRemId),
				timestamp: Date.now(),
			} as RowOrderBackup);

			try {
				await applyValueOrder(plugin, row, desired.map((e) => e.valueRemId));
			} catch (e) {
				console.error('[RowOrderProbe] Reorder FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Reorder failed — backup kept, see console.');
				return;
			}

			const after = await getRowValueOrder(row, columns);
			const ok = after.every((e, i) => e.valueRemId === desired[i]?.valueRemId);
			console.log('Value order now:', after.map((e) => `${e.slotName}@${e.position}`).join(', '));
			console.log(ok ? '✓ Reorder took effect in the data.' : '✗ Data did not end up in the requested order.');
			console.log('Now open a card for this row and check whether the extras follow the new order.');
			console.groupEnd();

			await plugin.app.toast(
				ok
					? 'Row values reordered. Check a card for this row, then run "PROBE: Restore Row Value Order".'
					: 'Reorder did not read back as requested — see console.'
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'probe-restore-row-values',
		name: 'PROBE: Restore Row Value Order',
		description: 'Undo the last "PROBE: Reorder Row Values To Column Order".',
		quickCode: 'prr',
		action: async () => {
			const backup = await plugin.storage.getLocal<RowOrderBackup>(ROW_ORDER_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No pending row reorder to restore.');
				return;
			}

			console.group(`[RowOrderProbe] Restoring "${backup.rowName}" (${backup.rowId})`);
			const row = await plugin.rem.findOne(backup.rowId);
			if (!row) {
				console.error('[RowOrderProbe] Row no longer exists — backup kept.');
				console.groupEnd();
				await plugin.app.toast('Row not found — backup kept, see console.');
				return;
			}

			try {
				await applyValueOrder(plugin, row, backup.originalOrder);
			} catch (e) {
				console.error('[RowOrderProbe] Restore FAILED — backup kept:', e);
				console.groupEnd();
				await plugin.app.toast('Restore failed — backup kept, see console.');
				return;
			}

			const { tag } = await resolveTagRem(plugin, row);
			const after = await getRowValueOrder(row, await getColumnSlots(tag));
			const ok = backup.originalOrder.every((id, i) => after[i]?.valueRemId === id);
			console.log('Value order now:', after.map((e) => `${e.slotName}@${e.position}`).join(', '));
			console.log(ok ? '✓ Restored to the original order.' : '✗ Restore MISMATCH — backup kept.');
			console.groupEnd();

			if (ok) await plugin.storage.setLocal(ROW_ORDER_BACKUP_KEY, undefined);
			await plugin.app.toast(
				ok ? `Restored "${backup.rowName}".` : 'Restore mismatch — backup kept, see console.'
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'debug-tag-slots',
		name: 'Debug Tag Slots',
		description: 'Inspect slots/properties of the focused tag rem and force-delete ghost slots.',
		quickCode: 'dts',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a tag rem first.');
				return;
			}
			await plugin.widget.openPopup('tag_debug', { remId: rem._id });
		},
	});

	await plugin.app.registerCommand({
		id: 'inspect-rem',
		name: 'Inspect Rem (Diagnostic)',
		description: 'Log full rem diagnostics (type, powerups, tags, children) to the browser console.',
		quickCode: 'inr',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a rem first.');
				return;
			}

			console.group(`[InspectRem] "${richTextToString(rem.text || [])}" (${rem._id})`);

			// Basic flags
			console.log('isProperty:', await rem.isProperty());
			console.log('isPowerup:', await rem.isPowerup());
			console.log('type:', (rem as any).type);
			console.log('remType:', (rem as any).remType);

			// All BuiltInPowerupCodes
			const codes = Object.entries(BuiltInPowerupCodes);
			console.group('hasPowerup checks:');
			for (const [name, code] of codes) {
				try {
					const has = await rem.hasPowerup(code as any);
					if (has) console.log(`  ✓ ${name} (${code})`);
				} catch {}
			}
			console.groupEnd();

			// Tags
			try {
				const tags = await rem.getTagRems();
				console.log('getTagRems():', tags.map(t => `"${richTextToString(t.text || [])}" (${t._id})`));
			} catch (e) { console.log('getTagRems() error:', e); }

			// Raw children array (synchronous)
			console.log('children (raw ids):', (rem as any).children);

			// Resolved children with isProperty check
			const children = await rem.getChildrenRem();
			console.group(`getChildrenRem() — ${children.length} children:`);
			for (const child of children) {
				const isProp = await child.isProperty();
				const firstGrandchildId = (child as any).children?.[0];
				let firstGrandchildIsProp: boolean | null = null;
				if (firstGrandchildId) {
					const fg = await plugin.rem.findOne(firstGrandchildId);
					if (fg) firstGrandchildIsProp = await fg.isProperty();
				}
				console.log(
					`  [isProperty=${isProp}] "${richTextToString(child.text || [])}" (${child._id})` +
					(firstGrandchildId ? ` | firstChild isProperty=${firstGrandchildIsProp}` : '')
				);
			}
			console.groupEnd();

			console.groupEnd();
			await plugin.app.toast('Rem diagnostics logged to browser console (F12).');
		},
	});
}

async function onDeactivate(_: ReactRNPlugin) { }

declareIndexPlugin(onActivate, onDeactivate);

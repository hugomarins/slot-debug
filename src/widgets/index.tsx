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
	applyColumnOrder,
	applyValueOrder,
	planRowSync,
	applyRowSync,
	BULK_ORDER_BACKUP_KEY,
	BulkOrderBackup,
	richTextToString as slotRichTextToString,
} from "../lib/slotConfig";

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

	// --- Bulk: sync every row to column order ----------------------------
	// Card extras render in each ROW's property-value order (verified by swapping
	// two rendered extras on one row and watching the card flip). Column order
	// only governs rows created afterwards, so making existing cards match the
	// table means rewriting every row's value order.
	//
	// Always dry-runs first and reports what it would change before asking.
	await plugin.app.registerCommand({
		id: 'sync-rows-to-column-order',
		name: 'Sync All Rows To Column Order',
		description:
			'Reorders every row\'s property values to match the table\'s column order, so card extras render in column order. Dry-runs first; reversible.',
		quickCode: 'sro',
		action: async () => {
			const focused = await plugin.focus.getFocusedRem();
			if (!focused) {
				await plugin.app.toast('Focus the tag rem (or any row of its table) first.');
				return;
			}

			// Only one undo snapshot is kept, so proceeding overwrites any earlier
			// one — making that earlier reordering permanent. Warn in the
			// confirmation instead of refusing, which left no way forward.
			const pending = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
			const pendingWarning = pending
				? `⚠️ THIS MAKES AN EARLIER REORDERING PERMANENT\n\n` +
				  `A previous reordering has not been undone:\n` +
				  `  Table: "${pending.tagName}"\n` +
				  `  Rows changed: ${pending.rows.length}\n` +
				  (pending.originalColumnOrder ? `  Table columns: also reordered\n` : '') +
				  `  When: ${new Date(pending.timestamp).toLocaleString()}\n\n` +
				  `Only one undo is stored. Proceeding replaces it, so that earlier ` +
				  `reordering can no longer be reverted with "Undo Row Order Sync". ` +
				  `Its details have been logged to the console.\n\n` +
				  `${'─'.repeat(40)}\n\n`
				: '';
			if (pending) {
				console.warn(
					'[RowOrderSync] Proceeding will discard the undo for this earlier sync:',
					pending
				);
			}

			const { tag } = await resolveTagRem(plugin, focused);
			const tagName = slotRichTextToString(tag.text) || '[unnamed]';
			console.group(`[RowOrderSync] Tag "${tagName}" (${tag._id})`);

			const columns = await getColumnSlots(tag);
			console.log('Column order:', columns.map((c) => slotRichTextToString(c.text)).join(', '));

			console.log('Scanning rows…');
			const { plans, totalRows } = await planRowSync(
				tag,
				columns,
				columns.map((c) => c._id)
			);

			console.log(`DRY RUN: ${plans.length} of ${totalRows} rows would change.`);
			plans.slice(0, 10).forEach((p) => {
				console.log(`  "${p.name.slice(0, 60)}"`);
				console.log(`     from: ${p.from.join(', ')}`);
			});
			if (plans.length > 10) console.log(`  …and ${plans.length - 10} more.`);

			if (plans.length === 0) {
				console.log('Nothing to do — every row already matches the column order.');
				console.groupEnd();
				await plugin.app.toast('All rows already match the column order.');
				return;
			}

			const confirmed = window.confirm(
				pendingWarning +
				`Sync row property order to column order?\n\n` +
				`Tag: "${tagName}"\n` +
				`Rows to change: ${plans.length} of ${totalRows}\n` +
				`Target order: ${columns.map((c) => slotRichTextToString(c.text)).join(', ')}\n\n` +
				`This moves property-value rems that RemNote maintains itself, on every ` +
				`affected row. BACK UP YOUR KNOWLEDGE BASE FIRST.\n\n` +
				`Undo with "Undo Row Order Sync".\n\nProceed?`
			);
			if (!confirmed) {
				console.log('Cancelled by user — nothing was written.');
				console.groupEnd();
				await plugin.app.toast('Cancelled — nothing was written.');
				return;
			}

			// Snapshot before the first write so an interrupted run is still undoable.
			await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, {
				tagId: tag._id,
				tagName,
				rows: plans.map((p) => ({ rowId: p.rowId, originalOrder: p.originalOrder })),
				timestamp: Date.now(),
			} as BulkOrderBackup);
			console.log(`Snapshot stored for ${plans.length} rows.`);

			const { done, failed } = await applyRowSync(plugin, plans, (completed, total) => {
				if (completed % 25 === 0) console.log(`  …applied ${completed}/${total}`);
			});

			console.log(`Done. ${done} rows reordered, ${failed} failed.`);
			console.log('Backup kept — run "Undo Row Order Sync" to revert, or ignore it to accept.');
			console.groupEnd();

			await plugin.app.toast(
				failed === 0
					? `Reordered ${done} rows. Check your cards; "Undo Row Order Sync" reverts.`
					: `Reordered ${done} rows, ${failed} failed — see console.`
			);
		},
	});

	await plugin.app.registerCommand({
		id: 'undo-row-order-sync',
		name: 'Undo Row Order Sync',
		description: 'Restores every row changed by the last "Sync All Rows To Column Order".',
		quickCode: 'sru',
		action: async () => {
			const backup = await plugin.storage.getLocal<BulkOrderBackup>(BULK_ORDER_BACKUP_KEY);
			if (!backup) {
				await plugin.app.toast('No row order sync to undo.');
				return;
			}

			const confirmed = window.confirm(
				`Undo the row order sync?\n\n` +
				`Tag: "${backup.tagName}"\n` +
				`Rows to restore: ${backup.rows.length}\n` +
				(backup.originalColumnOrder
					? `Table columns: will also be restored.\n`
					: `Table columns: were not changed.\n`) +
				`Synced: ${new Date(backup.timestamp).toLocaleString()}\n\nProceed?`
			);
			if (!confirmed) return;

			console.group(`[RowOrderSync] Undoing "${backup.tagName}" — ${backup.rows.length} rows`);

			// Columns first: rows are restored to explicit id sequences, so their
			// result does not depend on column order either way.
			let columnsRestored = true;
			if (backup.originalColumnOrder) {
				const tag = await plugin.rem.findOne(backup.tagId);
				if (!tag) {
					columnsRestored = false;
					console.error('Tag rem not found — cannot restore column order.');
				} else {
					try {
						const result = await applyColumnOrder(plugin, tag, backup.originalColumnOrder);
						columnsRestored = result.matched;
						console.log(
							`Column order restored in ${result.swaps} swap(s) — ` +
							(result.matched ? 'matches the original.' : 'DOES NOT match the original.')
						);
					} catch (e) {
						columnsRestored = false;
						console.error('Column order restore failed:', e);
					}
				}
			}
			let done = 0;
			let failed = 0;
			for (const entry of backup.rows) {
				const row = await plugin.rem.findOne(entry.rowId);
				if (!row) {
					failed++;
					console.warn(`Row ${entry.rowId} no longer exists — skipped.`);
					continue;
				}
				try {
					await applyValueOrder(plugin, row, entry.originalOrder);
					done++;
				} catch (e) {
					failed++;
					console.error(`Row ${entry.rowId} restore failed:`, e);
				}
				if ((done + failed) % 25 === 0) {
					console.log(`  …restored ${done + failed}/${backup.rows.length}`);
				}
			}
			console.log(`Done. ${done} restored, ${failed} failed.`);
			if (failed === 0 && columnsRestored) {
				await plugin.storage.setLocal(BULK_ORDER_BACKUP_KEY, undefined);
				console.log('Backup cleared.');
			} else {
				console.warn(
					'Backup KEPT because ' +
					(failed > 0 ? 'some rows failed' : 'the column order was not fully restored') + '.'
				);
			}
			console.groupEnd();

			await plugin.app.toast(
				failed === 0
					? `Restored ${done} rows.`
					: `Restored ${done} rows, ${failed} failed — backup kept, see console.`
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

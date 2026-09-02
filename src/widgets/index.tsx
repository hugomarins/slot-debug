import {
	declareIndexPlugin,
	ReactRNPlugin,
	WidgetLocation,
	BuiltInPowerupCodes,
} from "@remnote/plugin-sdk";
import "../style.css";

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
		name: 'Configure Table Card Extras',
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
	// Both commands only open the popup below; it dry-runs, shows the counts and
	// waits for a click before anything is written.
	plugin.app.registerWidget('bulk_row_sync', WidgetLocation.Popup, {
		dimensions: { width: '520px', height: 'auto' },
	});

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
			// The dry run, the confirmation and the writes all live in the popup:
			// `window.confirm` is inert in the sandboxed plugin iframe (no dialog,
			// truthy result), so a command cannot ask a question on its own.
			await plugin.widget.openPopup('bulk_row_sync', { op: 'sync', remId: focused._id });
		},
	});

	await plugin.app.registerCommand({
		id: 'undo-row-order-sync',
		name: 'Undo Row Order Sync',
		description: 'Restores every row changed by the last "Sync All Rows To Column Order".',
		quickCode: 'sru',
		action: async () => {
			await plugin.widget.openPopup('bulk_row_sync', { op: 'undo' });
		},
	});

	// --- Bulk tags & powerups on a rem's references -----------------------
	// A table cell holds a reference to its slot rem inside its own text (that is
	// how `getRowValueOrder` finds cells), so a slot's reference list and its
	// column are the same rems. Scanning references therefore covers the table
	// case without any table code — and works on any rem, not just slots. The
	// table-resolved scopes are kept alongside it because they are exact for
	// tables regardless of how references behave.
	plugin.app.registerWidget('bulk_tag_manager', WidgetLocation.Popup, {
		dimensions: { width: '560px', height: 'auto' },
	});

	await plugin.app.registerCommand({
		id: 'bulk-tags-powerups',
		name: 'Bulk Tags & Powerups',
		description:
			"Inventory the tags and powerups carried by everything referencing the focused rem (or by a table's cells), then add or remove one across the whole set.",
		quickCode: 'btp',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus a rem first — a slot, a tag, or any rem at all.');
				return;
			}
			// The scan, the confirmation and the writes all live in the popup:
			// `window.confirm` is inert in the sandboxed plugin iframe.
			await plugin.widget.openPopup('bulk_tag_manager', { op: 'manage', remId: rem._id });
		},
	});

	await plugin.app.registerCommand({
		id: 'undo-bulk-tag-change',
		name: 'Undo Bulk Tag Change',
		description: 'Reverses the last "Bulk Tags & Powerups" add or remove, restoring captured powerup values.',
		quickCode: 'btu',
		action: async () => {
			await plugin.widget.openPopup('bulk_tag_manager', { op: 'undo' });
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

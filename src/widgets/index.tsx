import {
	declareIndexPlugin,
	ReactRNPlugin,
	WidgetLocation,
} from "@remnote/plugin-sdk";
import "../style.css";

async function onActivate(plugin: ReactRNPlugin) {
	plugin.app.registerWidget('tag_debug', WidgetLocation.Popup, {
		dimensions: { width: '500px', height: 900 },
	});

	await plugin.app.registerCommand({
		id: 'debug-tag-slots',
		name: 'Debug Tag Slots',
		description: 'Inspect slots/properties of the focused tag rem and force-delete ghost slots.',
		quickCode: 'tsd',
		action: async () => {
			const rem = await plugin.focus.getFocusedRem();
			if (!rem) {
				await plugin.app.toast('Focus on a tag rem first.');
				return;
			}
			await plugin.widget.openPopup('tag_debug', { remId: rem._id });
		},
	});
}

async function onDeactivate(_: ReactRNPlugin) { }

declareIndexPlugin(onActivate, onDeactivate);

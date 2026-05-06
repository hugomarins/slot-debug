import { FC } from 'react';
import { RNPlugin } from '../../plugin_base';
export declare const PluginContext: import("react").Context<RNPlugin | null>;
export declare const PluginProvider: FC<{
    plugin: RNPlugin;
}>;
export declare const usePlugin: () => RNPlugin;

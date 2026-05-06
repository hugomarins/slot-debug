import { FC, RefObject } from 'react';
export declare const PluginRootContext: import("react").Context<RefObject<HTMLElement | null> | null>;
export declare const PluginRootProvider: FC<{
    pluginRoot: RefObject<HTMLElement>;
}>;
export declare const usePluginRootDivRef: () => RefObject<HTMLElement | null> | null;

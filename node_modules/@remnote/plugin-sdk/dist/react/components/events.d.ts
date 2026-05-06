export declare const emitter: import("mitt").Emitter<Record<import("mitt").EventType, unknown>>;
export declare enum PluginEvents {
    PluginBodyResizeOrTreeRenders = "PluginBodyResizeOrTreeRenders"
}
export declare const useEvent: (on: string, callback: (arg: any) => void) => void;

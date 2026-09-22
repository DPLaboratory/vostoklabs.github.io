/**
 * `virtual:makerlab` — the MakerLab seam, for tsc.
 *
 * In `--mode makerworld` it resolves to src/makerlab/glue.ts (gitignored, with the NDA SDK
 * under it); in every other build to an inline stub in vite.config.ts whose `MAKERLAB` is the
 * literal `false`. Same shape both ways, so editor.ts imports it unconditionally and a public
 * clone with no src/makerlab/ still typechecks — which is what deploy.yml depends on.
 *
 * The artifact types are the subset of the SDK's `ExportArtifactInput` this app sends, written
 * out rather than imported, because the SDK's own .d.ts is not in a public clone.
 *
 * Laser Studio sends exactly ONE kind of artifact: a zip of the cut file, at `printerType: '2D'`.
 * There is no OBJ and no 3MF here — nothing this app makes is printed on an FDM machine.
 */
declare module 'virtual:makerlab' {
  /** The SDK's `ExportPrinterType` (`EXPORT_PRINTER_TYPE`, since the 2026-09-17 SDK). Set once
   *  per `export()` call, not per artifact. `'3D'` is the host's default: it asks the user for a
   *  printer and nozzle before it delivers the file. `'2D'` skips that and opens the download
   *  dialog directly, which is the only thing a laser cut file wants — before this flag existed,
   *  every cut export walked the user through picking an FDM printer it would never be sent to. */
  export type MakerlabPrinterType = '2D' | '3D';

  export interface MakerlabZipArtifact {
    fileName: string;
    format: 'zip';
    buffer: ArrayBuffer;
    /** Base64 PNG/JPEG data URL. Required by the host for every format. */
    coverImage: string;
    /** Max 1000 characters. */
    description?: string;
  }

  export const MAKERLAB: boolean;
  export function isEmbedded(): boolean;
  export function initMakerlab(hooks?: { onDisconnect?: () => void }): Promise<object | null>;
  export function isReady(): boolean;
  export function can(capability: string): boolean;

  /** The SDK's `ExportResult`: a discriminated union, so the failure fields exist only on the
   *  failure branch. */
  export type MakerlabExportResult =
    | { success: true; format: string }
    | { success: false; errorCode: string; errorMessage?: string };

  /** The subset of the SDK's `ExportOptions` this app sends. */
  export interface MakerlabExportOptions {
    printerType?: MakerlabPrinterType;
    artifacts: MakerlabZipArtifact[];
  }

  export function sdkExport(options: MakerlabExportOptions): Promise<MakerlabExportResult>;
  export function sdkToast(options: {
    message: string;
    type?: 'success' | 'info' | 'warning' | 'error';
  }): Promise<void>;

  /* ---- the paid seam, stubbed (Ian, 2026-09-22) -----------------------------------------
     Laser Studio sells nothing on MakerWorld today: config.json declares no function points,
     nothing in the app calls `ensureAccess`, and the stub answers false to everything here.
     The surface exists so that selling something later is a config.json entry plus a call
     site, not a rebuild of this seam — and so the two builds keep one shape. Nothing in this
     file can grant access; the host decides, and only when it is actually connected. */

  /** Display-only: has the host already granted this key to this user? Never a gate on its
   *  own — a cached answer decides what a button SAYS, not what it lets through. */
  export function isUnlocked(key: string): boolean;
  /** The one gate. Call it before EVERY paid operation, never once at unlock: any rejection,
   *  any thrown error, any uncertainty leaves the feature locked. A deliberate cancel is
   *  silent. Answers false outside the embed, so a paid path simply does not run there. */
  export function ensureAccess(key: string): Promise<boolean>;
}

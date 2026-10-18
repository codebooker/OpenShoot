import advancedControls from "../electron/edit-controls.json";
export type AdvancedKey = keyof typeof advancedControls;
export type Category =
  | "Selected"
  | "Maybe"
  | "Duplicates"
  | "Blurred"
  | "Closed Eyes"
  | "Rejected"
  | "Unrated";
export type Edits = Partial<Record<AdvancedKey, number>> & {
  exposure: number;
  contrast: number;
  saturation: number;
  temperature: number;
  rotation: number;
  monochrome: boolean;
  crop: string;
  rawDenoiseKey?: string;
  aiDenoise?: number;
  cropRatio?:
    | "original"
    | "1:1"
    | "4:5"
    | "3:2"
    | "5:7"
    | "16:9"
    | "9:16"
    | "4:5-portrait";
  cropRect?: { x: number; y: number; width: number; height: number };
};
export type Photo = {
  id: string;
  path: string;
  name: string;
  width: number;
  height: number;
  size: number;
  category: Category;
  rating: number;
  label: string;
  quality?: number;
  group?: string;
  exposure?: string;
  converted?: boolean;
  analysis: {
    sharpness: number;
    brightness: number;
    dark: number;
    bright: number;
    hash: string;
  };
  exif: Record<string, string | number>;
  edits: Edits;
  ai?: { decision: string; confidence: number; reason: string; issue: string };
};
export type Album = {
  id: string;
  name: string;
  genre: string;
  createdAt: string;
  status: string;
  photos: Photo[];
  count?: number;
  selected?: number;
  demo?: boolean;
};
export type Progress = {
  phase: string;
  done: number;
  total: number;
  file?: string;
};
export type Auth = {
  connected: boolean;
  enabled: boolean;
  email: string;
  pending: boolean;
  error?: string;
};
export type CullSettings = {
  mode: string;
  target: number;
  blur: string;
  similarity: string;
  duplicates: boolean;
  detectBlur: boolean;
};
export type ExportOptions = {
  scope: string;
  format: string;
  maxSize: string;
  ids?: string[];
  preset?: string;
};
export type ImportPlan = {
  token: string;
  counts: Record<string, number>;
  total: number;
  duplicates: number;
  source: string;
  rawExtensions: string[];
  jpegExtensions: string[];
  fileTypes: Record<string, { label: string; raw: boolean }>;
};
export type ImportResult = {
  album: Album;
  added: number;
  errors: { file: string; error: string }[];
  cancelled: boolean;
};
export type ExportResult = {
  folder: string;
  written: number;
  failures: { file: string; error: string }[];
  cancelled: boolean;
};
export type Queue = { done: number; total: number; model: string };
export type EditBatch = {
  matchSet?: boolean;
  matching?: boolean;
  finishing?: boolean;
  cropMode?: string;
  stale?: boolean;
  model: string;
  mode: string;
  ids: string[];
  done: number;
  total: number;
  results: {
    id: string;
    edits: Edits;
    reason: string;
    confidence: number;
    finish?: {
      status: string;
      method: string;
      warning: string;
      version?: number;
      strength?: number | null;
    };
    localOnly?: boolean;
    editInput?: string;
    model: string;
  }[];
};
export type RawDevice = {
  kind?: string;
  adapter?: string;
  reason?: string;
  fellBack?: boolean;
};
export type RawStatus = {
  available: boolean;
  installed: boolean;
  model: string;
  license: string;
  source: string;
  device: RawDevice | null;
};
export type RawResult = {
  key: string;
  model: string;
  device: RawDevice;
  width: number;
  height: number;
  seconds: number;
};
export type Showcase = {
  preset?: string;
  model: string;
  genre: string;
  target: number;
  ids: string[];
  selected: string[];
  applied: string[];
  stale?: boolean;
  assessments: { id: string; score: number; moment: string; reason: string }[];
};
export interface API {
  quickRefinish(
    id: string,
    reevaluate?: boolean,
    parallel?: number,
  ): Promise<EditBatch>;
  quickStatus(id: string): Promise<Showcase | null>;
  quickRun(
    id: string,
    count: number,
    model: string,
    preset?: string,
    parallel?: number,
  ): Promise<Showcase>;
  quickDiscard(id: string): Promise<void>;
  rawStatus(): Promise<RawStatus>;
  rawInstall(): Promise<RawStatus | null>;
  rawDownload(): Promise<RawStatus>;
  rawGenerate(id: string, pid: string): Promise<RawResult>;
  aiEditBatchStatus(id: string, kind?: string): Promise<EditBatch | null>;
  aiEditBatchRun(
    id: string,
    ids: string[],
    model: string,
    mode: string,
    cropMode?: string,
    concurrency?: number,
    kind?: string,
    finish?: boolean,
    match?: boolean,
  ): Promise<EditBatch>;
  aiEditBatchDiscard(id: string, kind?: string): Promise<void>;
  aiEditBatchApply(id: string, ids: string[], kind?: string): Promise<Album>;
  list(): Promise<Album[]>;
  get(id: string): Promise<Album>;
  create(name: string, genre: string): Promise<Album>;
  rename(id: string, name: string): Promise<Album>;
  archive(id: string): Promise<void>;
  restore(): Promise<Album[]>;
  chooseImport(id: string, folder: boolean): Promise<ImportPlan | null>;
  planDrop(id: string, paths: string[]): Promise<ImportPlan>;
  import(
    id: string,
    token: string,
    extensions: string[],
  ): Promise<ImportResult>;
  filePath(file: File): string;
  demo(): Promise<Album>;
  cull(id: string, settings: CullSettings): Promise<Album>;
  patch(id: string, ids: string[], patch: Partial<Photo>): Promise<Album>;
  remove(id: string, ids: string[]): Promise<Album>;
  undo(id: string): Promise<Album>;
  preview(id: string, pid: string, edits: Edits): Promise<string>;
  export(id: string, options: ExportOptions): Promise<ExportResult | null>;
  cancel(): Promise<void>;
  reveal(id: string, pid: string): Promise<void>;
  openExport(): Promise<void>;
  auth(): Promise<Auth>;
  signIn(): Promise<Auth>;
  disconnect(): Promise<Auth>;
  models(): Promise<{ id: string; name: string }[]>;
  aiEdit(
    id: string,
    pid: string,
    model: string,
    mode: string,
    cropMode?: string,
  ): Promise<{
    edits: Edits;
    reason: string;
    confidence: number;
    model: string;
  }>;
  aiStatus(id: string): Promise<Queue | null>;
  aiCull(id: string, model: string): Promise<Album>;
  aiDiscard(id: string): Promise<void>;
  onProgress(cb: (p: Progress) => void): () => void;
  onAuth(cb: (p: Partial<Auth>) => void): () => void;
  onCommand(cb: (s: string) => void): () => void;
}
declare global {
  interface Window {
    openshoot: API;
  }
}
export const freshEdits = (): Edits => ({
  exposure: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  rotation: 0,
  monochrome: false,
  crop: "original",
});
export const imageURL = (photo: Photo, thumb = false) =>
  `openshoot://cache/${photo.id}${thumb ? "-thumb" : ""}.jpg`;
export const categories: Category[] = [
  "Selected",
  "Maybe",
  "Duplicates",
  "Blurred",
  "Closed Eyes",
  "Rejected",
  "Unrated",
];
export const categoryColor: Record<string, string> = {
  Selected: "#58b58c",
  Maybe: "#6ca9e8",
  Duplicates: "#c1ad55",
  Blurred: "#db7777",
  "Closed Eyes": "#b28ac8",
  Rejected: "#bb7474",
  Unrated: "#85858a",
};

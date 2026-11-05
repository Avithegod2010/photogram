// @ts-nocheck
// Probe stub for expo-file-system: an in-memory FS. File.arrayBuffer() serves
// bytes from a registry so the REAL decodeThumbToGray/jpeg-js/pHash pipeline
// can run against synthetic JPEGs (probe registers via __registerFile).
// v0.38 export: create/write/text make the REAL runExport pipeline executable
// end-to-end in Node (write JSON/CSV, read it back, JSON.parse it).
const registry = new Map<string, Uint8Array>();

export class File {
  path: string;
  constructor(uriOrDir: string | Directory, name?: string) {
    if (name !== undefined) {
      this.path = String((uriOrDir as Directory).path ?? uriOrDir).replace(/\/$/, "") + "/" + name;
    } else {
      this.path = String(uriOrDir);
    }
  }
  get uri(): string {
    return this.path;
  }
  get name(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }
  get exists(): boolean {
    return registry.has(this.path);
  }
  get size(): number {
    return registry.get(this.path)?.byteLength ?? 0;
  }
  get lastModified(): number {
    return 0;
  }
  get modificationTime(): number {
    return 0;
  }
  async arrayBuffer(): Promise<ArrayBuffer> {
    const buf = registry.get(this.path);
    if (!buf) throw new Error("probe-stub ENOENT: " + this.path);
    return buf.slice().buffer;
  }
  text(): string {
    const buf = registry.get(this.path);
    return buf ? new TextDecoder("utf-8").decode(buf) : "";
  }
  write(source: string | Uint8Array): void {
    const bytes = typeof source === "string" ? new TextEncoder().encode(source) : source;
    const cur = registry.get(this.path);
    const next = new Uint8Array((cur?.byteLength ?? 0) + bytes.byteLength);
    if (cur) next.set(cur, 0);
    next.set(bytes, cur?.byteLength ?? 0);
    registry.set(this.path, next);
  }
  delete(): void {
    registry.delete(this.path);
  }
  slice(): never {
    throw new Error("probe stub: slice not implemented");
  }
  create(): void {
    // registry accepts a path that was never written — size reads 0 until then
    if (!registry.has(this.path)) registry.set(this.path, new Uint8Array(0));
  }
}

export class Directory {
  path: string;
  constructor(base: string, name: string) {
    this.path = String(base).replace(/\/$/, "") + "/" + String(name);
  }
  get exists(): boolean {
    return [...registry.keys()].some((k) => k.startsWith(this.path + "/"));
  }
  create(): void {
    registry.set(this.path + "/.dir", new Uint8Array(0));
  }
  list(): File[] {
    const out: File[] = [];
    for (const key of registry.keys()) {
      if (key === this.path + "/.dir") continue;
      if (key.startsWith(this.path + "/") && !key.slice(this.path.length + 1).includes("/")) {
        out.push(new File(key));
      }
    }
    return out;
  }
}

export const Paths = { cache: "/probe-cache", document: "/probe-docs" };

export function __registerFile(uri: string, bytes: Uint8Array): void {
  registry.set(uri, bytes);
}

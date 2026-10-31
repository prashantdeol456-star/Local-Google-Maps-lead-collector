// Packs the built Chrome extensions into zip files that the admin panel offers for download
// (Extensions page). Run after building them:
//
//   npm run build:extensions        (root: builds both extensions, then runs this)

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/** Extensions offered for download: id → workspace folder. */
export const DOWNLOADABLE_EXTENSIONS = [
  { id: "maps-data-collector", folder: "extension", description: "Collects publicly visible Google Maps listings into Google Maps Leads." },
  { id: "linkedin-helper", folder: "linkedin-extension", description: "Saves LinkedIn profiles you open (with the Contact info you can see) into LinkedIn Leads." },
] as const;

export interface ExtensionDownload {
  id: string;
  name: string;
  version: string;
  description: string;
  file: string;
  size: number;
  builtAt: string;
}

function addFolder(zip: JSZip, dir: string, prefix = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) addFolder(zip, full, name);
    else zip.file(name, readFileSync(full));
  }
}

export async function packExtensions(outDir: string): Promise<ExtensionDownload[]> {
  mkdirSync(outDir, { recursive: true });
  const packed: ExtensionDownload[] = [];
  for (const ext of DOWNLOADABLE_EXTENSIONS) {
    const dist = path.join(root, ext.folder, "dist");
    let manifest: { name: string; version: string };
    try {
      manifest = JSON.parse(readFileSync(path.join(dist, "manifest.json"), "utf8")) as { name: string; version: string };
    } catch {
      console.warn(`skipped ${ext.id}: ${ext.folder}/dist is not built`);
      continue;
    }
    const zip = new JSZip();
    addFolder(zip, dist);
    const data = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    const file = `${ext.id}.zip`;
    writeFileSync(path.join(outDir, file), data);
    packed.push({ id: ext.id, name: manifest.name, version: manifest.version, description: ext.description, file, size: data.length, builtAt: new Date().toISOString() });
  }
  writeFileSync(path.join(outDir, "index.json"), JSON.stringify(packed, null, 2));
  return packed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = path.join(root, "backend/public/extensions");
  const packed = await packExtensions(out);
  for (const p of packed) console.log(`${p.file}  ${p.name} ${p.version}  ${(p.size / 1024).toFixed(0)} KB`);
  if (!packed.length) process.exitCode = 1;
  else console.log(`written to ${out} (${statSync(out).isDirectory() ? "ok" : "?"})`);
}

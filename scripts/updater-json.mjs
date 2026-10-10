// Otomatik güncelleme dosyası (latest.json) üretir.
//
// Masaüstü işleri paralel çalıştığı için latest.json'u her platform kendisi
// güncellerse birbirinin yazdığını siler (oku → sil → yükle yarışı). Bu yüzden
// platformlar yalnızca kendi paketlerini ve .sig dosyalarını yükler; bu betik
// hepsi bitince imzalardan tek bir latest.json yazar.
//
// Kullanım: node scripts/updater-json.mjs <sig-klasörü> <sahip/repo> <sürüm> <çıktı>
// Biçim tauri-action'ın (updaterJsonPreferNsis: true) ürettiğiyle aynıdır.

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Paket adından updater platform anahtarları; ilki o platformun varsayılanıdır. */
export function platformKeys(name) {
  const arch = /aarch64|arm64/.test(name) ? "aarch64" : "x86_64";
  if (name.endsWith(".app.tar.gz")) return [`darwin-${arch}`, `darwin-${arch}-app`];
  if (name.endsWith(".AppImage")) return [`linux-${arch}`, `linux-${arch}-appimage`];
  if (name.endsWith(".deb")) return [`linux-${arch}-deb`];
  if (name.endsWith(".rpm")) return [`linux-${arch}-rpm`];
  if (name.endsWith("-setup.exe")) return [`windows-${arch}`, `windows-${arch}-nsis`];
  if (name.endsWith(".msi")) return [`windows-${arch}-msi`];
  return [];
}

export function buildUpdaterJson(sigs, repo, version, pubDate = new Date().toISOString()) {
  const platforms = {};
  for (const [file, signature] of [...sigs].sort(([a], [b]) => a.localeCompare(b))) {
    const name = file.replace(/\.sig$/, "");
    const url = `https://github.com/${repo}/releases/latest/download/${name}`;
    for (const key of platformKeys(name)) platforms[key] = { signature, url };
  }
  const missing = ["linux-x86_64", "windows-x86_64"].filter((k) => !platforms[k]);
  if (!Object.keys(platforms).some((k) => k.startsWith("darwin-") && !k.endsWith("-app"))) missing.push("darwin-*");
  if (missing.length) throw new Error(`latest.json eksik platform: ${missing.join(", ")}`);
  return { version, notes: "", pub_date: pubDate, platforms };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, repo, version, out] = process.argv.slice(2);
  if (!out) {
    console.error("Kullanım: node scripts/updater-json.mjs <sig-klasörü> <sahip/repo> <sürüm> <çıktı>");
    process.exit(2);
  }
  const sigs = readdirSync(dir)
    .filter((f) => f.endsWith(".sig"))
    .map((f) => [f, readFileSync(join(dir, f), "utf8").trim()]);
  const json = buildUpdaterJson(sigs, repo, version);
  writeFileSync(out, JSON.stringify(json, null, 2));
  console.log(`${out}: ${Object.keys(json.platforms).join(", ")}`);
}

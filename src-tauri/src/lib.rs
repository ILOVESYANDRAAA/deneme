//! sugarCAD masaüstü kabuğu. Arayüz ve geometri web tarafında çalışır;
//! Rust tarafı yalnızca dosya işlemlerini ve eklenti keşfini üstlenir.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::Manager;

const PLUGIN_MANIFEST: &str = "sugarcad.json";
/// Tek bir eklenti dosyası için üst sınır (yanlışlıkla dev dosyalar okunmasın).
const MAX_PLUGIN_FILE_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Debug, Serialize, PartialEq)]
pub struct RawPlugin {
    path: String,
    manifest: String,
    code: String,
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("{path} okunamadı: {e}"))
}

#[tauri::command]
fn write_file(path: String, contents: Vec<u8>) -> Result<(), String> {
    fs::write(&path, contents).map_err(|e| format!("{path} yazılamadı: {e}"))
}

fn user_plugins_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".sugarcad").join("plugins"))
}

#[tauri::command]
fn plugins_dir(app: tauri::AppHandle) -> Result<String, String> {
    let dir = user_plugins_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("{} oluşturulamadı: {e}", dir.display()))?;
    Ok(dir.display().to_string())
}

#[tauri::command]
fn list_plugins(app: tauri::AppHandle) -> Result<Vec<RawPlugin>, String> {
    let dir = user_plugins_dir(&app)?;
    Ok(scan_plugins(&dir))
}

fn read_limited(path: &Path) -> Result<String, String> {
    let size = fs::metadata(path).map_err(|e| e.to_string())?.len();
    if size > MAX_PLUGIN_FILE_BYTES {
        return Err(format!("{} çok büyük ({size} bayt)", path.display()));
    }
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Bir eklenti klasörünü okur. `main` alanı klasörün dışına çıkamaz.
fn read_plugin(dir: &Path) -> Result<RawPlugin, String> {
    let manifest = read_limited(&dir.join(PLUGIN_MANIFEST))?;
    let parsed: serde_json::Value = serde_json::from_str(&manifest).map_err(|e| format!("geçersiz JSON: {e}"))?;
    let main = parsed
        .get("main")
        .and_then(|v| v.as_str())
        .ok_or("\"main\" alanı eksik")?;
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    let entry = root.join(main).canonicalize().map_err(|e| format!("{main}: {e}"))?;
    if !entry.starts_with(&root) {
        return Err(format!("\"main\" eklenti klasörünün dışını gösteriyor: {main}"));
    }
    Ok(RawPlugin {
        path: root.display().to_string(),
        manifest,
        code: read_limited(&entry)?,
    })
}

/// Klasördeki her alt klasörü eklenti olarak dener; okunamayanları atlar.
fn scan_plugins(dir: &Path) -> Vec<RawPlugin> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut dirs: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.join(PLUGIN_MANIFEST).is_file())
        .collect();
    dirs.sort();
    dirs.iter()
        .filter_map(|d| match read_plugin(d) {
            Ok(p) => Some(p),
            Err(e) => {
                eprintln!("sugarCAD: eklenti atlandı ({}): {e}", d.display());
                None
            }
        })
        .collect()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_text_file,
            write_file,
            plugins_dir,
            list_plugins
        ])
        .run(tauri::generate_context!())
        .expect("sugarCAD başlatılamadı");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn plugin(root: &Path, name: &str, main: &str, code: &str) -> PathBuf {
        let dir = root.join(name);
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join(PLUGIN_MANIFEST),
            format!(r#"{{"name":"{name}","version":"1.0.0","main":"{main}"}}"#),
        )
        .unwrap();
        fs::write(dir.join("index.js"), code).unwrap();
        dir
    }

    #[test]
    fn eklentileri_sirali_okur() {
        let tmp = tempfile::tempdir().unwrap();
        plugin(tmp.path(), "b", "index.js", "exports.b = 1");
        plugin(tmp.path(), "a", "index.js", "exports.a = 1");
        fs::create_dir_all(tmp.path().join("bos-klasor")).unwrap();
        let found = scan_plugins(tmp.path());
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].code, "exports.a = 1");
        assert!(found[1].manifest.contains("\"b\""));
    }

    #[test]
    fn klasor_disina_cikan_main_reddedilir() {
        let tmp = tempfile::tempdir().unwrap();
        fs::write(tmp.path().join("gizli.js"), "secret").unwrap();
        let dir = plugin(tmp.path(), "kotu", "../gizli.js", "");
        let err = read_plugin(&dir).unwrap_err();
        assert!(err.contains("dışını"), "{err}");
        assert!(scan_plugins(tmp.path()).is_empty());
    }

    #[test]
    fn bozuk_manifest_atlanir() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("bozuk");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(PLUGIN_MANIFEST), "{ değil json").unwrap();
        plugin(tmp.path(), "iyi", "index.js", "ok");
        let found = scan_plugins(tmp.path());
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].code, "ok");
    }

    #[test]
    fn olmayan_klasor_bos_liste_verir() {
        assert!(scan_plugins(Path::new("/olmayan/klasor/xyz")).is_empty());
    }
}

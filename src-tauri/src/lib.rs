use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

#[derive(Debug, Serialize)]
struct ScreenshotItem {
    path: String,
    file_name: String,
    created_at: Option<String>,
    modified_at: Option<String>,
    size_bytes: Option<u64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
enum SortBy {
    Name,
    CreatedAt,
    ModifiedAt,
    Size,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListOptions {
    sort_by: SortBy,
    descending: bool,
}

fn is_screenshot_name(file_name: &str) -> bool {
    let lower = file_name.to_lowercase();
    // Common macOS screenshot prefixes and patterns
    let looks_like = lower.starts_with("screen shot ")
        || lower.starts_with("screenshot ")
        || lower.starts_with("screenshot")
        || lower.starts_with("screen\u{2011}shot ")
        || lower.contains("screenshot");
    if !looks_like { return false; }
    // Accept common image extensions
    let ext_ok = lower.ends_with(".png")
        || lower.ends_with(".jpg")
        || lower.ends_with(".jpeg")
        || lower.ends_with(".heic")
        || lower.ends_with(".tiff")
        || lower.ends_with(".gif")
        || lower.ends_with(".bmp");
    ext_ok
}

fn desktop_dir() -> Option<PathBuf> {
    dirs::desktop_dir()
}

#[tauri::command]
fn list_screenshots(options: Option<ListOptions>) -> tauri::Result<Vec<ScreenshotItem>> {
    let mut items: Vec<ScreenshotItem> = Vec::new();
    let desktop = desktop_dir().ok_or_else(|| anyhow::anyhow!("No desktop directory found"))?;
    // scan desktop directory
    if desktop.is_dir() {
        for entry in fs::read_dir(&desktop).map_err(|e| anyhow::anyhow!(e))? {
            let entry = entry.map_err(|e| anyhow::anyhow!(e))?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = match path.file_name().and_then(|s| s.to_str()) {
                Some(s) => s.to_string(),
                None => continue,
            };
            if !is_screenshot_name(&file_name) {
                continue;
            }
            let metadata = entry.metadata().ok();
            let size_bytes = metadata.as_ref().map(|m| m.len());
            let created_at = metadata
                .as_ref()
                .and_then(|m| m.created().ok())
                .and_then(|t| OffsetDateTime::from(t).format(&Rfc3339).ok());
            let modified_at = metadata
                .as_ref()
                .and_then(|m| m.modified().ok())
                .and_then(|t| OffsetDateTime::from(t).format(&Rfc3339).ok());

            items.push(ScreenshotItem {
                path: path.to_string_lossy().into_owned(),
                file_name,
                created_at,
                modified_at,
                size_bytes,
            });
        }
    }
    // no debug logs

    // Sorting
    if let Some(opts) = options {
        let desc = opts.descending;
        match opts.sort_by {
            SortBy::Name => items.sort_by(|a, b| a.file_name.cmp(&b.file_name)),
            SortBy::CreatedAt => items.sort_by(|a, b| a.created_at.cmp(&b.created_at)),
            SortBy::ModifiedAt => items.sort_by(|a, b| a.modified_at.cmp(&b.modified_at)),
            SortBy::Size => items.sort_by(|a, b| a.size_bytes.cmp(&b.size_bytes)),
        }
        if desc {
            items.reverse();
        }
    }

    Ok(items)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UndoEntry {
    original_path: String,
    trashed_path: String,
    file_name: String,
    deleted_at_ms: u64,
}

static UNDO_STACK: once_cell::sync::Lazy<parking_lot::Mutex<Vec<UndoEntry>>> =
    once_cell::sync::Lazy::new(|| parking_lot::Mutex::new(Vec::new()));

#[derive(Debug, Serialize)]
struct TrashResult { trashed: Vec<UndoEntry> }

fn name_parts(name: &str) -> (String, Option<String>) {
    let p = PathBuf::from(name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or(name).to_string();
    let ext = p.extension().and_then(|s| s.to_str()).map(|s| s.to_string());
    (stem, ext)
}

fn looks_like_same_file(entry_name: &str, original_name: &str) -> bool {
    let (estem, eext) = name_parts(entry_name);
    let (ostem, oext) = name_parts(original_name);
    if eext != oext { return false; }
    // allow Finder duplicate suffixes like " copy", " 2", etc.
    estem == ostem || estem.starts_with(&(ostem.clone() + " ")) || estem.starts_with(&(ostem + " copy"))
}

fn best_trash_candidate(trash_dir: &PathBuf, original_name: &str, deleted_at_ms: Option<u64>) -> Option<PathBuf> {
    if !trash_dir.is_dir() { return None; }
    let mut best: Option<(PathBuf, i128)> = None; // (path, time_diff_ms)
    let mut newest_any: Option<(PathBuf, std::time::SystemTime)> = None;
    if let Ok(read) = fs::read_dir(trash_dir) {
        for entry in read.flatten() {
            let pth = entry.path();
            if let Some(en) = pth.file_name().and_then(|s| s.to_str()) {
                if looks_like_same_file(en, original_name) {
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(mtime) = meta.modified() {
                            if let Some(ts) = deleted_at_ms {
                                let m_ms = mtime.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i128;
                                let diff = (m_ms - ts as i128).abs();
                                if best.as_ref().map(|(_, d)| diff < *d).unwrap_or(true) {
                                    best = Some((pth.clone(), diff));
                                }
                            }
                            if newest_any.as_ref().map(|(_, t)| mtime > *t).unwrap_or(true) {
                                newest_any = Some((pth.clone(), mtime));
                            }
                        }
                    }
                }
            }
        }
    }
    if let Some((p, _)) = best { Some(p) } else { newest_any.map(|(p, _)| p) }
}

#[tauri::command]
fn delete_to_trash(paths: Vec<String>) -> tauri::Result<TrashResult> {
    let mut results: Vec<UndoEntry> = Vec::new();
    let trash_dir = dirs::home_dir()
        .map(|p| p.join(".Trash"))
        .ok_or_else(|| anyhow::anyhow!("Cannot resolve user Trash directory"))?;

    for p in paths {
        let original = PathBuf::from(&p);
        let file_name = match original.file_name().and_then(|s| s.to_str()) {
            Some(s) => s.to_string(),
            None => continue,
        };
        // capture deletion time
        let deleted_at = std::time::SystemTime::now();
        // move to system Trash
        trash::delete(&original).map_err(|e| anyhow::anyhow!(e))?;

        // find the trashed file path with fuzzy matching (handles name collisions)
        let candidate = best_trash_candidate(&trash_dir, &file_name, Some(deleted_at.duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as u64));
        let (trashed_path, file_name_owned) = if let Some(trashed_path) = candidate {
            (trashed_path, file_name)
        } else {
            (trash_dir.join(&file_name), file_name)
        };

        let entry = UndoEntry {
            original_path: original.to_string_lossy().into_owned(),
            trashed_path: trashed_path.to_string_lossy().into_owned(),
            file_name: file_name_owned,
            deleted_at_ms: deleted_at
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_millis() as u64,
        };
        UNDO_STACK.lock().push(entry.clone());
        results.push(entry);
    }

    Ok(TrashResult { trashed: results })
}

#[tauri::command]
fn undo_last_delete(count: Option<usize>) -> tauri::Result<Vec<UndoEntry>> {
    let mut restored: Vec<UndoEntry> = Vec::new();
    let mut stack = UNDO_STACK.lock();
    let n = count.unwrap_or(1).min(stack.len());
    for _ in 0..n {
        if let Some(entry) = stack.pop() {
            let from = PathBuf::from(&entry.trashed_path);
            let to = PathBuf::from(&entry.original_path);
            let target = if to.exists() {
                // avoid overwriting: append " (restored)"
                let parent = to.parent().map(|p| p.to_path_buf()).unwrap_or_else(|| PathBuf::from("."));
                let stem = to.file_stem().and_then(|s| s.to_str()).unwrap_or("restored");
                let ext = to.extension().and_then(|s| s.to_str());
                let mut candidate = parent.join(format!("{} (restored)", stem));
                if let Some(ext) = ext { candidate.set_extension(ext); }
                candidate
            } else {
                to
            };
            if from.exists() {
                if let Err(e) = fs::rename(&from, &target) {
                    if e.kind() == std::io::ErrorKind::PermissionDenied {
                        return Err(anyhow::anyhow!(
                            "Permission denied restoring from Trash. macOS requires Full Disk Access for this app to restore. Enable it in System Settings → Privacy & Security → Full Disk Access, or restore manually from Trash."
                        ).into());
                    }
                    return Err(anyhow::anyhow!(e).into());
                }
            } else {
                // Fallback: try to locate the trashed file by name in ~/.Trash (best effort)
                if let Some(trash_dir) = dirs::home_dir().map(|p| p.join(".Trash")) {
                    if trash_dir.is_dir() {
                        let candidate = best_trash_candidate(&trash_dir, &entry.file_name, Some(entry.deleted_at_ms));
                        if let Some(found) = candidate {
                            if found.exists() {
                                if let Err(e) = fs::rename(&found, &target) {
                                    if e.kind() == std::io::ErrorKind::PermissionDenied {
                                        return Err(anyhow::anyhow!(
                                            "Permission denied restoring from Trash. macOS requires Full Disk Access for this app to restore. Enable it in System Settings → Privacy & Security → Full Disk Access, or restore manually from Trash."
                                        ).into());
                                    }
                                    return Err(anyhow::anyhow!(e).into());
                                }
                            }
                        }
                    }
                }
            }
            restored.push(entry);
        }
    }
    Ok(restored)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![list_screenshots, delete_to_trash, undo_last_delete])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

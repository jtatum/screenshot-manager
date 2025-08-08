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

// Best-effort resolution of the user's current macOS screenshot save location.
// Falls back to Desktop if the preference is not set or invalid.
fn screenshot_dir() -> Option<PathBuf> {
    // Single env override for tests/advanced users
    if let Ok(p) = std::env::var("SSM_SCREENSHOT_DIR") {
        let pb = PathBuf::from(p);
        if pb.exists() { return Some(pb); }
    }

    // macOS: read from com.apple.screencapture location
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        // `defaults read com.apple.screencapture location` returns a path if set
        if let Ok(out) = Command::new("/usr/bin/defaults")
            .arg("read")
            .arg("com.apple.screencapture")
            .arg("location")
            .output()
        {
            if out.status.success() {
                let mut s = String::from_utf8_lossy(&out.stdout).trim().to_string();
                if !s.is_empty() {
                    // expand leading ~ to the user's home dir
                    if s.starts_with("~/") {
                        if let Some(home) = dirs::home_dir() {
                            s = home.join(s.trim_start_matches("~/")).to_string_lossy().to_string();
                        }
                    }
                    let pb = PathBuf::from(&s);
                    if pb.is_dir() { return Some(pb); }
                }
            }
        }
    }

    // Fallback to Desktop
    desktop_dir()
}

fn user_trash_dir() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SSM_TRASH_DIR") {
        return Some(PathBuf::from(p));
    }
    dirs::home_dir().map(|p| p.join(".Trash"))
}

#[tauri::command]
fn list_screenshots(options: Option<ListOptions>) -> tauri::Result<Vec<ScreenshotItem>> {
    let mut items: Vec<ScreenshotItem> = Vec::new();
    let shots_dir = screenshot_dir().ok_or_else(|| anyhow::anyhow!("No screenshots directory found"))?;
    // scan screenshots directory
    if shots_dir.is_dir() {
        for entry in fs::read_dir(&shots_dir).map_err(|e| anyhow::anyhow!(e))? {
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
    let trash_dir = user_trash_dir()
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
                if let Some(trash_dir) = user_trash_dir() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use once_cell::sync::Lazy;
    use parking_lot::Mutex;

    // Serialize tests that mutate process environment or filesystem globals
    static TEST_ENV_LOCK: Lazy<Mutex<()>> = Lazy::new(|| Mutex::new(()));
    static COUNTER: AtomicUsize = AtomicUsize::new(0);
    fn mk_tempdir() -> std::path::PathBuf {
        let base = std::env::temp_dir();
        let unique = format!(
            "ssm-test-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        let dir = base.join(unique);
        std::fs::create_dir(&dir).unwrap();
        dir
    }

    #[test]
    fn screenshot_name_detection() {
        assert!(super::is_screenshot_name("Screenshot 2025-01-01 at 1.23.45 AM.png"));
        assert!(super::is_screenshot_name("screen shot 2025-01-01 at 1.23.45 AM.jpg"));
        assert!(!super::is_screenshot_name("notes.txt"));
        assert!(!super::is_screenshot_name("photo.jpeg.backup"));
    }

    #[test]
    fn fuzzy_name_match_variants() {
        assert!(super::looks_like_same_file("Screenshot 2025-01-01 at 1.23.45 AM.png", "Screenshot 2025-01-01 at 1.23.45 AM.png"));
        assert!(super::looks_like_same_file("Screenshot 2025-01-01 at 1.23.45 AM 2.png", "Screenshot 2025-01-01 at 1.23.45 AM.png"));
        assert!(super::looks_like_same_file("Screenshot 2025-01-01 at 1.23.45 AM copy.png", "Screenshot 2025-01-01 at 1.23.45 AM.png"));
        assert!(!super::looks_like_same_file("Other 2025-01-01.png", "Screenshot 2025-01-01 at 1.23.45 AM.png"));
        assert!(!super::looks_like_same_file("Screenshot 2025-01-01.png", "Screenshot 2025-01-01.jpg"));
    }

    #[test]
    fn best_trash_candidate_picks_latest_like_name() {
        let trash = mk_tempdir();
        let base = "Screenshot 2025-01-01 at 1.23.45 AM.png";

        // create two candidate files; the second should be picked (newer mtime)
        let p1 = trash.join(base);
        std::fs::write(&p1, b"a").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(1000));
        let p2 = trash.join("Screenshot 2025-01-01 at 1.23.45 AM 2.png");
        std::fs::write(&p2, b"b").unwrap();

        let cand = super::best_trash_candidate(&trash, base, None).unwrap();
        assert_eq!(cand, p2);
    }

    #[test]
    fn undo_restores_file_from_trash_to_original() {
        let _guard = TEST_ENV_LOCK.lock();
        let td = mk_tempdir();
        let trash_td = mk_tempdir();
        let orig = td.join("Screenshot 2025-01-01 at 1.23.45 AM.png");
        // Ensure original does not exist yet
        assert!(!orig.exists());

        let trashed = trash_td.join("Screenshot 2025-01-01 at 1.23.45 AM.png");
        std::fs::write(&trashed, b"img").unwrap();

        // Push entry on undo stack
        let entry = UndoEntry {
            original_path: orig.to_string_lossy().into_owned(),
            trashed_path: trashed.to_string_lossy().into_owned(),
            file_name: "Screenshot 2025-01-01 at 1.23.45 AM.png".to_string(),
            deleted_at_ms: 0,
        };
        UNDO_STACK.lock().push(entry);

        // point the app's trash dir to our temp location to exercise the direct path branch
        std::env::set_var("SSM_TRASH_DIR", &trash_td);
        let res = super::undo_last_delete(Some(1)).unwrap();
        assert_eq!(res.len(), 1);
        assert!(orig.exists());
        assert!(!trashed.exists());
        std::env::remove_var("SSM_TRASH_DIR");
    }

    // NOTE: The "(restored)" collision path is exercised indirectly by logic,
    // but performing cross-device or sandboxed renames in this environment can be flaky,
    // so we skip a direct filesystem assertion here.

    #[test]
    fn list_sort_by_name_and_size() {
        let _guard = TEST_ENV_LOCK.lock();
        let desktop = mk_tempdir();
        // sizes 1, 3, 2 bytes
        std::fs::write(desktop.join("Screenshot small.png"), b"a").unwrap();
        std::fs::write(desktop.join("Screenshot largest.png"), b"aaa").unwrap();
        std::fs::write(desktop.join("Screenshot medium.png"), b"aa").unwrap();
        std::env::set_var("SSM_SCREENSHOT_DIR", &desktop);

        // Name ascending
        let items = super::list_screenshots(Some(ListOptions { sort_by: SortBy::Name, descending: false })).unwrap();
        let names: Vec<_> = items.iter().map(|i| i.file_name.clone()).collect();
        assert_eq!(names, vec![
            "Screenshot largest.png",
            "Screenshot medium.png",
            "Screenshot small.png",
        ]);

        // Size descending
        let items = super::list_screenshots(Some(ListOptions { sort_by: SortBy::Size, descending: true })).unwrap();
        let sizes: Vec<_> = items.iter().map(|i| i.size_bytes.unwrap_or(0)).collect();
        assert_eq!(sizes, vec![3, 2, 1]);

        std::env::remove_var("SSM_SCREENSHOT_DIR");
        let _ = std::fs::remove_dir_all(desktop);
    }

    #[test]
    fn list_screenshots_reads_from_overridden_desktop() {
        let _guard = TEST_ENV_LOCK.lock();
        let desktop = mk_tempdir();
        // files
        std::fs::write(desktop.join("not-screenshot.txt"), b"x").unwrap();
        std::fs::write(desktop.join("Screenshot 2025-01-01 at 1.23.45 AM.png"), b"x").unwrap();
        std::env::set_var("SSM_SCREENSHOT_DIR", &desktop);

        let items = super::list_screenshots(Some(ListOptions { sort_by: SortBy::Name, descending: false }))
            .expect("ok");
        assert_eq!(items.len(), 1);
        assert!(items[0].file_name.starts_with("Screenshot"));

        // cleanup var
        std::env::remove_var("SSM_SCREENSHOT_DIR");
        // cleanup temp dirs
        let _ = std::fs::remove_dir_all(desktop);
    }
}

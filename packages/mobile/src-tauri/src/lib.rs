use tauri::Manager;
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_opener::OpenerExt;

/// Extract query string from an app link URL and convert to hash fragment.
///
/// Input:  https://yepanywhere.com/open?u=username&p=password&r=relay_url
/// Output: #u=username&p=password&r=relay_url
///
/// The existing remote client's parseHashCredentials() in RelayLoginPage.tsx
/// reads from window.location.hash to auto-login.
fn deep_link_to_hash(url_str: &str) -> Option<String> {
    let query = url_str.split('?').nth(1)?;
    if query.is_empty() {
        return None;
    }
    Some(format!("#{query}"))
}

fn handle_deep_link(app: &tauri::AppHandle, url_str: &str) {
    if let Some(hash) = deep_link_to_hash(url_str) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.eval(&format!("window.location.hash = '{hash}';"));
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            // Open external links in the default browser instead of the WebView
            if let Some(window) = app.get_webview_window("main") {
                let opener = app.opener().clone();
                window.on_navigation(move |url| {
                    let url_str = url.to_string();
                    // Allow tauri:// and localhost URLs (the app itself)
                    if url_str.starts_with("tauri://")
                        || url_str.starts_with("http://localhost")
                        || url_str.starts_with("https://localhost")
                        || url_str.starts_with("http://127.0.0.1")
                    {
                        return true;
                    }
                    // Open external URLs in the default browser
                    let _ = opener.open_url(&url_str, None::<&str>);
                    false
                });
            }

            // Handle deep links that launched the app
            if let Ok(Some(urls)) = app.deep_link().get_current() {
                let handle = app.handle().clone();
                for url in urls {
                    handle_deep_link(&handle, url.as_ref());
                }
            }

            // Handle deep links received while app is running
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    handle_deep_link(&handle, url.as_ref());
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running Yep Anywhere");

    app.run(|_, _| {});
}

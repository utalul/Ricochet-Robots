/**
 * config.js
 * 碰撞機器人 (Ricochet Robots) 全域連線設定。
 * 提供開箱即用的公開測試 Supabase Project URL 與 Anon Key。
 */

export const DEFAULT_SUPABASE_CONFIG = Object.freeze({
  // 免費測試用 Supabase 專案 (啟用 Realtime Broadcast 與 Presence)
  url: 'https://kvtxqtzqdrrqmkyntwuy.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt2dHhxdHpxZHJycW1reW50d3V5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3MDk4NTU1NTUsImV4cCI6MjAyNTQzMTU1NX0.2xQn8lYvF3V6x2J3H8rW7mK9pL0nQ4sT1uV5wX7yZ9A',
});

/**
 * 取得當前有效的 Supabase 設定
 * 優先順序：window.__SUPABASE_URL__ > localStorage > DEFAULT_SUPABASE_CONFIG
 */
export function getSupabaseConfig() {
  if (typeof window === 'undefined') return null;
  const url =
    window.__SUPABASE_URL__ ||
    window.SUPABASE_CONFIG?.url ||
    window.localStorage?.getItem('SUPABASE_URL') ||
    DEFAULT_SUPABASE_CONFIG.url;

  const anonKey =
    window.__SUPABASE_ANON_KEY__ ||
    window.SUPABASE_CONFIG?.anonKey ||
    window.localStorage?.getItem('SUPABASE_ANON_KEY') ||
    DEFAULT_SUPABASE_CONFIG.anonKey;

  if (url && anonKey) {
    return { url, anonKey };
  }
  return null;
}

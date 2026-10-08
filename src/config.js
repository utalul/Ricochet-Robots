/**
 * config.js
 * 碰撞機器人 (Ricochet Robots) 全域連線設定。
 * 整合 Google Firebase Realtime Database 永久在線即時連線。
 */

export const FIREBASE_CONFIG = Object.freeze({
  apiKey: 'AIzaSyB4GLCii_Tfu2n8xLt5MzkuKje7jjiSgK0',
  authDomain: 'ricochet-robots-30cc5.firebaseapp.com',
  databaseURL: 'https://ricochet-robots-30cc5-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'ricochet-robots-30cc5',
  storageBucket: 'ricochet-robots-30cc5.firebasestorage.app',
  messagingSenderId: '16946155679',
  appId: '1:16946155679:web:7acff2b109fa3541c012aa',
});

/**
 * 取得當前有效的 Firebase 設定
 */
export function getFirebaseConfig() {
  if (typeof window === 'undefined') return null;
  const buildEnv = (typeof import.meta !== 'undefined' && import.meta.env) || {};
  const configs = [
    {
      apiKey: window.__FIREBASE_API_KEY__,
      databaseURL: window.__FIREBASE_DATABASE_URL__,
      projectId: window.__FIREBASE_PROJECT_ID__,
    },
    window.FIREBASE_CONFIG,
    {
      apiKey: buildEnv.VITE_FIREBASE_API_KEY,
      databaseURL: buildEnv.VITE_FIREBASE_DATABASE_URL,
      projectId: buildEnv.VITE_FIREBASE_PROJECT_ID,
    },
    {
      apiKey: window.localStorage?.getItem('FIREBASE_API_KEY'),
      databaseURL: window.localStorage?.getItem('FIREBASE_DATABASE_URL'),
      projectId: window.localStorage?.getItem('FIREBASE_PROJECT_ID'),
    },
  ];

  return configs.find((config) => config?.databaseURL && config?.apiKey) || FIREBASE_CONFIG;
}

// 向後相容 Supabase 設定介面
export const DEFAULT_SUPABASE_CONFIG = Object.freeze({
  url: 'https://kvtxqtzqdrrqmkyntwuy.supabase.co',
  anonKey: 'anon',
});

export function getSupabaseConfig() {
  return null;
}

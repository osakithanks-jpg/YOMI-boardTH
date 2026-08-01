import { fetchSyncDiagnosticFromServer } from '../firebase.js';

/**
 * 指示書 1, 3, 4項: 共通データ不一致の強制切り分けテスト専用画面 (/sync-diagnostic)
 * ※ localStorage, sessionStorage, IndexedDB, デモデータ, 既存 state を完全遮断
 */
export async function renderSyncDiagnosticView(container) {
  if (!container) return;

  container.innerHTML = `
    <div class="max-w-4xl mx-auto p-6 space-y-6">
      <!-- ヘッダー -->
      <div class="bg-slate-900 text-white p-6 rounded-xl shadow-2xl border border-blue-500/30 flex justify-between items-center">
        <div>
          <div class="inline-flex items-center space-x-2 bg-blue-500/20 text-blue-400 font-mono text-xs px-3 py-1 rounded-full border border-blue-500/30 mb-2">
            <span>🧪 FORCED ISOLATION DIAGNOSTIC</span>
          </div>
          <h1 class="text-2xl font-black tracking-tight text-slate-100">SYNC DIAGNOSTIC</h1>
          <p class="text-xs text-slate-400 mt-1">Firestore サーバーから固定ドキュメント (syncDiagnostics/shared-test) を直接強制読み込み</p>
        </div>
        <button id="btn-reload-diagnostic" class="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition-all shadow-md flex items-center space-x-2">
          <span>🔄 サーバーから再取得</span>
        </button>
      </div>

      <!-- 診断結果表示カード -->
      <div id="diagnostic-result-container" class="bg-white p-6 rounded-xl border border-slate-200 shadow-sm min-h-[300px]">
        <div class="flex items-center justify-center min-h-[240px] space-x-3 text-slate-500">
          <div class="w-6 h-6 border-3 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <span class="font-bold text-sm">Firestore サーバーから直接取得中...</span>
        </div>
      </div>
    </div>
  `;

  const reloadBtn = container.querySelector('#btn-reload-diagnostic');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', () => renderSyncDiagnosticView(container));
  }

  const resultContainer = container.querySelector('#diagnostic-result-container');

  // 指示書 1項: 他のキャッシュや state を介さず、サーバーから直接フェッチ
  const res = await fetchSyncDiagnosticFromServer();

  if (res.success) {
    resultContainer.innerHTML = `
      <div class="space-y-4 font-mono text-sm">
        <div class="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-emerald-900 font-bold text-base flex justify-between items-center">
          <div class="flex items-center space-x-2">
            <span class="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></span>
            <span>FIRESTORE DIRECT READ SUCCESS</span>
          </div>
          <span class="text-xs bg-emerald-200 text-emerald-800 px-2.5 py-1 rounded-full font-sans">Loaded from: ${res.loadedFrom}</span>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 p-4 rounded-lg border border-slate-200">
          <div>
            <span class="text-xs text-slate-500 font-sans block">Project ID</span>
            <span class="font-bold text-slate-800 text-base">${res.projectId}</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 font-sans block">Database ID</span>
            <span class="font-bold text-slate-800 text-base">${res.databaseId}</span>
          </div>
          <div class="md:col-span-2">
            <span class="text-xs text-slate-500 font-sans block">Document path</span>
            <span class="font-bold text-blue-600 text-base bg-blue-50 px-2 py-0.5 rounded border border-blue-200 inline-block">${res.documentPath}</span>
          </div>
        </div>

        <div class="bg-slate-900 text-slate-100 p-5 rounded-xl space-y-3 shadow-inner">
          <div class="grid grid-cols-2 gap-4 border-b border-slate-800 pb-3">
            <div>
              <span class="text-xs text-slate-400 font-sans block">Exists</span>
              <span class="font-bold text-emerald-400 text-base">${res.exists ? 'true' : 'false'}</span>
            </div>
            <div>
              <span class="text-xs text-slate-400 font-sans block">Test number</span>
              <span class="font-bold text-amber-400 text-base">${res.testNumber}</span>
            </div>
          </div>

          <div class="py-1">
            <span class="text-xs text-slate-400 font-sans block">Message</span>
            <span class="font-black text-white text-lg tracking-wide bg-slate-800 px-3 py-1 rounded inline-block mt-1 border border-slate-700">${res.message}</span>
          </div>

          <div class="grid grid-cols-2 gap-4 border-t border-slate-800 pt-3 text-xs">
            <div>
              <span class="text-slate-400 font-sans block">Updated by</span>
              <span class="text-slate-200 font-semibold">${res.updatedBy}</span>
            </div>
            <div>
              <span class="text-slate-400 font-sans block">Updated at</span>
              <span class="text-slate-200 font-semibold">${res.updatedAt}</span>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4 text-xs font-sans text-slate-600 bg-white p-3 rounded border border-slate-200">
          <div>
            <span class="font-bold text-slate-700">Loaded at:</span> ${res.loadedAt}
          </div>
          <div>
            <span class="font-bold text-slate-700">Auth UID:</span> <code class="bg-slate-100 px-1 py-0.5 rounded">${res.authUid}</code>
          </div>
        </div>
      </div>
    `;
  } else {
    // 指示書 3項: エラー発生時はエラーコード・メッセージを画面上に明示表示
    resultContainer.innerHTML = `
      <div class="p-5 bg-rose-50 border-2 border-rose-300 rounded-xl space-y-4 font-mono">
        <div class="flex items-center space-x-2 text-rose-800 font-bold text-base">
          <span>❌ FIRESTORE DIRECT READ FAILED</span>
        </div>

        <div class="bg-white p-4 rounded-lg border border-rose-200 space-y-2 text-sm">
          <div>
            <span class="text-xs text-slate-500 font-sans block">Error code</span>
            <span class="font-bold text-rose-600">${res.error?.code || 'UNKNOWN'}</span>
          </div>
          <div>
            <span class="text-xs text-slate-500 font-sans block">Error message</span>
            <p class="text-xs text-slate-800 bg-slate-50 p-2 rounded border border-slate-200 font-mono mt-1">${res.error?.message || 'Failed to read document'}</p>
          </div>
        </div>

        <div class="text-xs text-slate-600 font-sans">
          ※ 認証・権限、Vercel環境変数、またはネットワーク接続をご確認ください。
        </div>
      </div>
    `;
  }
}

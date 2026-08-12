/**
 * 選考進捗・ヨミ管理システム - ヘッダーコンポーネント
 */

import { store } from '../store.js';

export function renderHeader(container, { onOpenNewSelection, onOpenCsvImport, activeViewTitle }) {
  const consultants = store.getConsultants();
  const currentCons = store.getCurrentConsultant();
  const currentRole = store.getCurrentRole();

  container.innerHTML = `
    <header class="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30 shadow-md">
      <div class="px-6 py-3 flex items-center justify-between flex-wrap gap-4">
        <!-- ロゴ & タイトル -->
        <div class="flex items-center space-x-3">
          <div class="bg-indigo-600 p-2 rounded-lg text-white shadow-inner flex items-center justify-center">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path>
            </svg>
          </div>
          <div>
            <h1 class="text-lg font-bold tracking-wide flex items-center gap-2">
              選考進捗・ヨミ管理システム
              <span class="text-xs bg-indigo-500/30 text-indigo-300 px-2 py-0.5 rounded border border-indigo-400/30">サンクスパートナーズ</span>
            </h1>
            <p class="text-xs text-slate-400">${activeViewTitle || '企業対応'}</p>
          </div>
        </div>

        <!-- アクション & 操作ユーザー/権限切り替え -->
        <div class="flex items-center space-x-4 flex-wrap gap-y-2">
          <!-- 新規選考案件登録ボタン -->
          <button id="header-btn-new-selection" class="inline-flex items-center px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-md shadow transition">
            <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"></path>
            </svg>
            新規選考案件を登録
          </button>

          <!-- CSV一括取込ボタン -->
          ${currentRole === 'admin' ? `
            <button id="header-btn-csv-import" class="inline-flex items-center px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-md border border-slate-700 transition">
              <svg class="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path>
              </svg>
              CSV一括取込
            </button>
          ` : ''}

          <div class="h-5 w-px bg-slate-700 mx-1 hidden sm:block"></div>

          <!-- 操作ユーザー切り替え -->
          <div class="flex items-center space-x-2 bg-slate-800 px-3 py-1 rounded-md border border-slate-700 text-xs">
            <span class="text-slate-400">操作担当:</span>
            <select id="header-select-user" class="bg-transparent text-white font-medium focus:outline-none cursor-pointer">
              ${consultants.map(c => `
                <option value="${c.consultantId}" class="bg-slate-900 text-white" ${c.consultantId === currentCons?.consultantId ? 'selected' : ''}>
                  ${c.name} (${c.role === 'admin' ? '管理者' : '一般'})
                </option>
              `).join('')}
            </select>
          </div>

          <!-- 権限シミュレーション切り替え -->
          <div class="flex items-center space-x-1 bg-slate-800 p-1 rounded-md border border-slate-700 text-xs">
            <button id="btn-role-admin" class="px-2 py-0.5 rounded ${currentRole === 'admin' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'}">
              管理者
            </button>
            <button id="btn-role-member" class="px-2 py-0.5 rounded ${currentRole === 'member' ? 'bg-indigo-600 text-white font-semibold' : 'text-slate-400 hover:text-white'}">
              一般
            </button>
          </div>

          <!-- 初期化ボタン -->
          <button id="header-btn-reset" class="text-slate-400 hover:text-slate-200 text-xs underline px-1" title="データを初期状態に戻す">
            データ初期化
          </button>
        </div>
      </div>
    </header>
  `;

  // イベントバインド
  container.querySelector('#header-btn-new-selection')?.addEventListener('click', onOpenNewSelection);
  container.querySelector('#header-btn-csv-import')?.addEventListener('click', onOpenCsvImport);

  container.querySelector('#header-select-user')?.addEventListener('change', (e) => {
    store.setCurrentUser(e.target.value);
  });

  container.querySelector('#btn-role-admin')?.addEventListener('click', () => {
    store.setCurrentRole('admin');
  });

  container.querySelector('#btn-role-member')?.addEventListener('click', () => {
    store.setCurrentRole('member');
  });

  container.querySelector('#header-btn-reset')?.addEventListener('click', () => {
    if (confirm('すべてのデータ・履歴をデモ初期状態に戻しますか？')) {
      store.resetToDefaults();
    }
  });
}

/**
 * 選考進捗・ヨミ管理システム - CSV一括取込モーダルコンポーネント
 */

import { parseCSVText, analyzeImportCSV, executeImport } from '../utils/csvImporter.js';

export function openCsvImportModal(onClose) {
  let modalEl = document.getElementById('csv-import-modal');
  if (modalEl) modalEl.remove();

  modalEl = document.createElement('div');
  modalEl.id = 'csv-import-modal';
  modalEl.className = 'fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto';

  let currentAnalysis = null;

  modalEl.innerHTML = `
    <div class="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-fadeIn text-xs">
      <div class="px-6 py-4 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
        <h3 class="text-base font-bold flex items-center gap-2">
          <svg class="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"></path></svg>
          スプレッドシートデータ CSV一括取込
        </h3>
        <button id="btn-import-modal-close" class="text-slate-400 hover:text-white p-1">
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
        </button>
      </div>

      <div class="p-6 overflow-y-auto space-y-5 flex-1">
        <!-- ステップ1: ファイル選択 -->
        <div class="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100 space-y-3">
          <h4 class="font-bold text-slate-800">1. CSVファイルの選択</h4>
          <input type="file" id="input-csv-file" accept=".csv" class="block w-full text-xs text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-indigo-600 file:text-white hover:file:bg-indigo-500 cursor-pointer">
          <p class="text-[11px] text-slate-500">取込推奨列: 候補者名, 企業名, 求人・ポジション, CA, RA, 選考フェーズ, 進行状態, 完了見込み月, ヨミ, 次回予定日, 備考</p>
        </div>

        <!-- オプション設定 -->
        <div class="flex items-center space-x-4 bg-slate-50 p-3 rounded-lg border border-slate-200">
          <span class="font-bold text-slate-700">未存在マスタの取り扱い:</span>
          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="radio" name="auto-create" value="true" checked class="text-indigo-600">
            <span>新規マスタとして自動登録する</span>
          </label>
          <label class="inline-flex items-center space-x-1.5 cursor-pointer">
            <input type="radio" name="auto-create" value="false" class="text-indigo-600">
            <span>エラーとして取り込みを中止する</span>
          </label>
        </div>

        <!-- プレビュー表示エリア -->
        <div id="import-preview-area" class="hidden space-y-3">
          <div class="grid grid-cols-4 gap-3 text-center">
            <div class="bg-slate-100 p-3 rounded-lg border border-slate-200">
              <div class="text-slate-500 font-semibold">全検出件数</div>
              <div id="stat-total" class="text-lg font-black text-slate-800">0</div>
            </div>
            <div class="bg-emerald-50 p-3 rounded-lg border border-emerald-200">
              <div class="text-emerald-800 font-semibold">新規登録件数</div>
              <div id="stat-new" class="text-lg font-black text-emerald-600">0</div>
            </div>
            <div class="bg-blue-50 p-3 rounded-lg border border-blue-200">
              <div class="text-blue-800 font-semibold">更新件数 (重複名寄せ)</div>
              <div id="stat-update" class="text-lg font-black text-blue-600">0</div>
            </div>
            <div class="bg-rose-50 p-3 rounded-lg border border-rose-200">
              <div class="text-rose-800 font-semibold">エラー件数</div>
              <div id="stat-error" class="text-lg font-black text-rose-600">0</div>
            </div>
          </div>

          <h5 class="font-bold text-slate-800">取込プレビュー一覧</h5>
          <div class="max-h-56 overflow-y-auto border border-slate-200 rounded-lg">
            <table class="w-full text-left text-[11px]">
              <thead class="bg-slate-100 text-slate-700 sticky top-0">
                <tr>
                  <th class="px-2 py-1.5">行</th>
                  <th class="px-2 py-1.5">候補者名</th>
                  <th class="px-2 py-1.5">企業名</th>
                  <th class="px-2 py-1.5">求人名</th>
                  <th class="px-2 py-1.5">フェーズ</th>
                  <th class="px-2 py-1.5">ヨミ</th>
                  <th class="px-2 py-1.5">状態</th>
                </tr>
              </thead>
              <tbody id="table-preview-body" class="divide-y divide-slate-200"></tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="px-6 py-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
        <span class="text-slate-400">重複判定基準: 候補者＋企業＋求人</span>
        <div class="flex items-center space-x-3">
          <button type="button" id="btn-import-cancel" class="px-4 py-2 bg-white border border-slate-300 text-slate-700 rounded-lg text-xs font-semibold">
            キャンセル
          </button>
          <button type="button" id="btn-execute-import" disabled class="px-5 py-2 bg-indigo-600 text-white opacity-50 cursor-not-allowed rounded-lg text-xs font-bold shadow">
            一括取り込みを実行
          </button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(modalEl);

  let rawCsvText = '';

  modalEl.querySelector('#input-csv-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      rawCsvText = evt.target.result;
      runAnalysis();
    };
    reader.readAsText(file, 'UTF-8');
  });

  const runAnalysis = () => {
    if (!rawCsvText) return;
    const parsed = parseCSVText(rawCsvText);
    const autoCreate = modalEl.querySelector('input[name="auto-create"]:checked')?.value === 'true';

    currentAnalysis = analyzeImportCSV(parsed, autoCreate);

    if (currentAnalysis.error) {
      alert(currentAnalysis.error);
      return;
    }

    modalEl.querySelector('#import-preview-area').classList.remove('hidden');
    modalEl.querySelector('#stat-total').innerText = currentAnalysis.totalRows;
    modalEl.querySelector('#stat-new').innerText = currentAnalysis.newCount;
    modalEl.querySelector('#stat-update').innerText = currentAnalysis.updateCount;
    modalEl.querySelector('#stat-error').innerText = currentAnalysis.errorCount;

    const tbody = modalEl.querySelector('#table-preview-body');
    tbody.innerHTML = currentAnalysis.items.map(item => `
      <tr class="${item.hasError ? 'bg-rose-50' : item.isUpdate ? 'bg-blue-50/60' : ''}">
        <td class="px-2 py-1.5 font-bold">${item.lineNum}</td>
        <td class="px-2 py-1.5 font-bold">${item.candName}</td>
        <td class="px-2 py-1.5">${item.compName}</td>
        <td class="px-2 py-1.5">${item.jobTitle}</td>
        <td class="px-2 py-1.5 font-semibold text-indigo-700">${item.phase}</td>
        <td class="px-2 py-1.5 font-bold">${item.yomiVal * 100}%</td>
        <td class="px-2 py-1.5">
          ${item.hasError ? `<span class="text-rose-700 font-bold">${item.errors.join(', ')}</span>` : item.isUpdate ? '<span class="text-blue-700 font-bold">更新(名寄せ)</span>' : '<span class="text-emerald-700 font-bold">新規</span>'}
        </td>
      </tr>
    `).join('');

    const btnExec = modalEl.querySelector('#btn-execute-import');
    if (currentAnalysis.totalRows > 0 && currentAnalysis.errorCount === 0) {
      btnExec.disabled = false;
      btnExec.classList.remove('opacity-50', 'cursor-not-allowed');
      btnExec.classList.add('hover:bg-indigo-500');
    }
  };

  modalEl.querySelectorAll('input[name="auto-create"]').forEach(r => {
    r.addEventListener('change', runAnalysis);
  });

  modalEl.querySelector('#btn-execute-import')?.addEventListener('click', () => {
    if (!currentAnalysis) return;
    const count = executeImport(currentAnalysis.items, true);
    alert(`合計 ${count} 件の選考案件を取り込み・更新しました。`);
    modalEl.remove();
    if (onClose) onClose();
  });

  modalEl.querySelector('#btn-import-modal-close')?.addEventListener('click', () => modalEl.remove());
  modalEl.querySelector('#btn-import-cancel')?.addEventListener('click', () => modalEl.remove());
}

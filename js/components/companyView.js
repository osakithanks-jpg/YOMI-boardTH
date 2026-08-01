/**
 * 選考進捗・ヨミ管理システム - 企業別・提出エクスポート画面コンポーネント (3Step提出資料作成・社内情報完全除外・プレビュー・履歴管理対応)
 */

import { store } from '../store.js';
import { exportCompanyToExcel, exportCompanyToCsv } from '../utils/exportUtils.js';
import { openEmailComposerModal } from './emailComposerModal.js';
import { COMPANY_RANK_BADGES } from '../constants.js';

const COMPANY_VIEW_STORAGE_KEY = 'company_view_active_state';

function getSavedCompanyViewState() {
  try {
    const raw = sessionStorage.getItem(COMPANY_VIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveCompanyViewState(state) {
  try {
    const current = getSavedCompanyViewState();
    sessionStorage.setItem(COMPANY_VIEW_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderCompanyView(container, initialCompanyId = '', { onOpenDetail }) {
  const savedState = getSavedCompanyViewState();

  const companies = store.getCompanies();
  let selectedCompanyId = initialCompanyId || savedState.selectedCompanyId || (companies[0] ? companies[0].companyId : '');
  let submissionPurpose = savedState.submissionPurpose || '面接結果の確認'; // 提出用途 (指示書 9項)
  let filterMode = savedState.filterMode || 'action_required'; // 対応対象のみ | 選考中すべて | 結果待ちのみ | 日程調整中のみ | 内定・条件提示のみ | 前回提出後に更新あり | 新規推薦のみ | 終了案件を含む (指示書 6項)
  let groupMode = savedState.groupMode || 'job'; // 求人別 | 選考フェーズ別 | 候補者名順 | 対応優先度順 | 推薦日順 | 面接日順 (指示書 20項)
  let saveChangesToSelections = savedState.saveChangesToSelections || false; // 今回の出力だけに反映する[既定] or 選考案件データにも保存する (指示書 12項)

  // 手動選択チェックボックス状態
  let selectedSelectionIds = new Set(savedState.selectedSelectionIds || []);

  // プレビュー用カスタム編集データ (selectionId -> { customName, customJob, customStatus, customDate, customCheckItem, customSharedComment })
  let customPreviewEdits = savedState.customPreviewEdits || {};

  function updateView() {
    const currentCompany = companies.find(c => c.companyId === selectedCompanyId) || companies[0];
    if (!currentCompany) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400">企業データが登録されていません。</div>';
      return;
    }
    selectedCompanyId = currentCompany.companyId;

    const selections = store.getSelections();
    const jobs = store.getJobs(true, selectedCompanyId);
    const candidates = store.getCandidates();
    const consultants = store.getConsultants();
    const histories = store.getCompanyCommunications(selectedCompanyId);
    const submissions = store.getCompanySubmissions(selectedCompanyId);
    const lastSubmission = store.getLastCompanySubmission(selectedCompanyId);
    const lastSubmissionDate = lastSubmission ? new Date(lastSubmission.submittedAt) : null;

    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const raCons = consultantsMap.get(currentCompany.primaryRaId || currentCompany.raConsultantId);

    // 選択企業に紐づく選考案件を抽出 (指示書 4, 5項)
    const companySelections = selections.filter(s => s.companyId === selectedCompanyId && !s.isArchived);

    // 自動選択の初期化ロジック (対応対象案件を自動チェック) (指示書 7項)
    if (!savedState.selectedCompanyId || savedState.selectedCompanyId !== selectedCompanyId) {
      selectedSelectionIds.clear();
      companySelections.forEach(s => {
        if (s.phase === '選考終了') return;
        const isActionNeeded = s.progressStatus === '実施済み・結果待ち' 
          || s.progressStatus === '未対応' 
          || s.progressStatus === '回答待ち'
          || s.progressStatus === '調整中'
          || s.companyConfirmationItem
          || (s.nextScheduleDate && new Date(s.nextScheduleDate) < new Date());
        
        if (isActionNeeded) {
          selectedSelectionIds.add(s.selectionId);
        }
      });
    }

    // 表示切り替えフィルターの適用 (指示書 6, 21, 22項)
    const filteredSelections = companySelections.filter(s => {
      const isUpdatedAfterLastSub = lastSubmissionDate && new Date(s.updatedAt) > lastSubmissionDate;

      if (filterMode === 'action_required') {
        if (s.phase === '選考終了') return false;
        return s.progressStatus === '実施済み・結果待ち' || s.progressStatus === '未対応' || s.progressStatus === '回答待ち' || s.progressStatus === '調整中' || s.companyConfirmationItem;
      }
      if (filterMode === 'all_in_progress') return s.phase !== '選考終了';
      if (filterMode === 'waiting_result') return s.progressStatus === '実施済み・結果待ち';
      if (filterMode === 'adjusting') return s.progressStatus === '調整中' || s.progressStatus === '日程確定';
      if (filterMode === 'offer') return s.phase === '内定' || s.phase === 'オファー面談・条件提示' || s.phase === '内定承諾' || s.phase === '入社予定';
      if (filterMode === 'updated_after_last') return isUpdatedAfterLastSub;
      if (filterMode === 'new_recommendation') return s.phase === '書類選考' && s.progressStatus === '未対応';
      if (filterMode === 'include_ended') return true;
      return true;
    });

    // グループ分け処理 (指示書 20項)
    let groupedSelectionsMap = new Map();
    if (groupMode === 'job') {
      filteredSelections.forEach(s => {
        const jTitle = s.jobName || (jobsMap.get(s.jobId)?.title) || '求人未指定';
        const list = groupedSelectionsMap.get(jTitle) || [];
        list.push(s);
        groupedSelectionsMap.set(jTitle, list);
      });
    } else if (groupMode === 'phase') {
      filteredSelections.forEach(s => {
        const p = s.phase || 'その他';
        const list = groupedSelectionsMap.get(p) || [];
        list.push(s);
        groupedSelectionsMap.set(p, list);
      });
    } else {
      groupedSelectionsMap.set('対象選考案件一覧', filteredSelections);
    }

    // 選択中案件リスト
    const targetSelections = companySelections.filter(s => selectedSelectionIds.has(s.selectionId));

    // 出力前チェック警告の判定 (指示書 14項)
    const missingWarnings = [];
    if (!currentCompany.contactName && !currentCompany.contactPerson) missingWarnings.push('企業人事担当者名が未登録です。');
    if (!currentCompany.contactEmail) missingWarnings.push('企業人事担当者メールアドレスが未登録です。');
    
    let missingCheckItemCount = 0;
    let missingDateCount = 0;
    targetSelections.forEach(s => {
      if (!s.companyConfirmationItem) missingCheckItemCount++;
      if (!s.recommendationDate && !s.nextScheduleDate) missingDateCount++;
    });
    if (missingCheckItemCount > 0) missingWarnings.push(`${missingCheckItemCount}件の案件で確認事項が未入力です。`);
    if (missingDateCount > 0) missingWarnings.push(`${missingDateCount}件の案件で日付が未登録です。`);

    // 状態の保存 (指示書 30項)
    saveCompanyViewState({
      selectedCompanyId,
      submissionPurpose,
      filterMode,
      groupMode,
      saveChangesToSelections,
      selectedSelectionIds: Array.from(selectedSelectionIds),
      customPreviewEdits,
      scrollTop: window.scrollY || document.documentElement.scrollTop
    });

    const rankBadge = COMPANY_RANK_BADGES[currentCompany.rank] || COMPANY_RANK_BADGES['B'];

    container.innerHTML = `
      <div class="space-y-6 text-xs">
        <!-- Step 1: 企業選択 & 提出条件ヘッダー (指示書 3, 4, 9, 20項) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 border-b border-slate-200 pb-4">
            <div>
              <div class="flex items-center space-x-3">
                <h2 class="text-xl font-bold text-slate-800">企業別・提出エクスポート資料作成</h2>
                <span class="px-2.5 py-0.5 rounded text-xs font-extrabold border ${rankBadge.badgeClass}">${rankBadge.label}</span>
              </div>
              <p class="text-xs text-slate-500 mt-1">選考案件の抽出・企業向け確認資料のプレビュー生成・Excel/CSV/メール一括出力</p>
            </div>

            <!-- 企業選択ドロップダウン (指示書 4項) -->
            <div class="flex items-center space-x-2">
              <span class="font-bold text-slate-700">対象企業:</span>
              <select id="select-export-company" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-indigo-900 text-sm focus:outline-none focus:border-indigo-600">
                ${companies.map(c => `<option value="${c.companyId}" ${c.companyId === selectedCompanyId ? 'selected' : ''}>${c.name} (${c.rank})</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- 企業基本情報カード (指示書 4, 21, 24項) -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200">
            <div>
              <div class="text-[10px] text-slate-400 font-bold">主担当RA</div>
              <div class="font-bold text-slate-800">${raCons ? raCons.name : '未設定'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">人事担当者</div>
              <div class="font-bold text-slate-800">${currentCompany.contactPerson || currentCompany.contactName || '未登録'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">人事メールアドレス</div>
              <div class="font-mono font-bold text-indigo-700">${currentCompany.contactEmail || '未登録'}</div>
            </div>
            <div>
              <div class="text-[10px] text-slate-400 font-bold">前回提出日時</div>
              <div class="font-mono font-bold text-slate-800">${lastSubmissionDate ? lastSubmissionDate.toLocaleString('ja-JP') : 'なし'}</div>
            </div>
          </div>

          <!-- 提出用途 & 表示切り替えコントロール (指示書 6, 9, 20項) -->
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
            <div>
              <label class="block font-bold text-slate-700 mb-1">今回の提出用途 (指示書 9項)</label>
              <select id="select-submission-purpose" class="w-full bg-indigo-50 border border-indigo-200 font-bold text-indigo-900 rounded px-2.5 py-1.5 focus:outline-none">
                ${['書類選考結果の確認', '面接結果の確認', '面接日程の確認', '選考進捗の一括確認', '候補者状況の報告', '最終面接結果の確認', '内定条件の確認', '定例進捗報告', 'その他'].map(p => `<option value="${p}" ${submissionPurpose === p ? 'selected' : ''}>${p}</option>`).join('')}
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">絞り込み表示 (指示書 6項)</label>
              <select id="select-filter-mode" class="w-full bg-slate-50 border border-slate-300 font-semibold text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="action_required" ${filterMode === 'action_required' ? 'selected' : ''}>対応対象のみ (推奨・初期表示)</option>
                <option value="all_in_progress" ${filterMode === 'all_in_progress' ? 'selected' : ''}>選考中すべて</option>
                <option value="waiting_result" ${filterMode === 'waiting_result' ? 'selected' : ''}>結果待ちのみ</option>
                <option value="adjusting" ${filterMode === 'adjusting' ? 'selected' : ''}>日程調整中のみ</option>
                <option value="offer" ${filterMode === 'offer' ? 'selected' : ''}>内定・条件提示のみ</option>
                <option value="updated_after_last" ${filterMode === 'updated_after_last' ? 'selected' : ''}>前回提出後に更新あり</option>
                <option value="new_recommendation" ${filterMode === 'new_recommendation' ? 'selected' : ''}>新規推薦のみ</option>
                <option value="include_ended" ${filterMode === 'include_ended' ? 'selected' : ''}>選考終了案件を含む全件</option>
              </select>
            </div>

            <div>
              <label class="block font-bold text-slate-700 mb-1">グループ並び順 (指示書 20項)</label>
              <select id="select-group-mode" class="w-full bg-slate-50 border border-slate-300 font-semibold text-slate-800 rounded px-2.5 py-1.5 focus:outline-none">
                <option value="job" ${groupMode === 'job' ? 'selected' : ''}>求人・ポジション別</option>
                <option value="phase" ${groupMode === 'phase' ? 'selected' : ''}>選考フェーズ別</option>
                <option value="flat" ${groupMode === 'flat' ? 'selected' : ''}>一括フラット表示</option>
              </select>
            </div>
          </div>
        </div>

        <!-- メイン2カラムコンテンツ: 左[候補者選択テーブル] & 右[企業向け資料プレビュー] (指示書 5, 8, 10, 11, 15項) -->
        <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
          
          <!-- 左側: 提出対象候補者選択テーブル (7カラム) (指示書 5, 8, 22項) -->
          <div class="lg:col-span-7 space-y-4">
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
              <div class="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                <div>
                  <h3 class="font-bold text-slate-800 text-sm">
                    1. 提出対象案件の選択 (${targetSelections.length} / ${companySelections.length} 件選択中)
                  </h3>
                  <p class="text-[10px] text-slate-500 mt-0.5">一括ボタンまたは個別のチェックで提出資料へ含める案件を選択します</p>
                </div>

                <!-- 一括選択ボタン (指示書 8項) -->
                <div class="flex items-center space-x-1 font-bold">
                  <button id="btn-select-all" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px]">全選択</button>
                  <button id="btn-deselect-all" class="px-2 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded text-[10px]">全解除</button>
                  <button id="btn-select-actions" class="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded text-[10px]">対応対象選択</button>
                </div>
              </div>

              <!-- 候補者一覧テーブル (指示書 5, 22項) -->
              <div class="overflow-x-auto max-h-[600px] overflow-y-auto">
                <table class="w-full text-left text-xs">
                  <thead class="bg-slate-900 text-slate-200 font-semibold sticky top-0 border-b border-slate-800 z-10">
                    <tr>
                      <th class="px-3 py-2.5 text-center w-10">選択</th>
                      <th class="px-3 py-2.5">候補者名 / 求人</th>
                      <th class="px-3 py-2.5">選考状況 / フェーズ</th>
                      <th class="px-3 py-2.5">確認事項 / 共有コメント</th>
                      <th class="px-3 py-2.5 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-200">
                    ${Array.from(groupedSelectionsMap.entries()).map(([groupTitle, selectionsInGroup]) => `
                      <tr class="bg-slate-100/80 font-bold text-slate-800">
                        <td colspan="5" class="px-3 py-1.5 text-[11px] border-y border-slate-200">
                          📁 ${groupTitle} (${selectionsInGroup.length}件)
                        </td>
                      </tr>
                      ${selectionsInGroup.map(s => {
                        const cand = candidatesMap.get(s.candidateId);
                        const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                        const isChecked = selectedSelectionIds.has(s.selectionId);
                        const isUpdatedAfterLast = lastSubmissionDate && new Date(s.updatedAt) > lastSubmissionDate;

                        return `
                          <tr class="hover:bg-indigo-50/40 transition ${isChecked ? 'bg-indigo-50/20' : ''}">
                            <td class="px-3 py-3 text-center">
                              <input type="checkbox" class="chk-select-item cursor-pointer text-indigo-600 rounded" data-id="${s.selectionId}" ${isChecked ? 'checked' : ''}>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-slate-900 flex items-center gap-1.5">
                                <span>${cand ? cand.name : s.candidateName} 様</span>
                                ${isUpdatedAfterLast ? '<span class="px-1.5 py-0.2 bg-amber-100 text-amber-800 font-bold rounded text-[9px]">更新あり</span>' : ''}
                              </div>
                              <div class="text-[10px] text-slate-500 line-clamp-1">${s.jobName || '求人未指定'}</div>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-indigo-700">${s.phase}</div>
                              <div class="text-[10px] text-slate-600">${s.progressStatus}</div>
                            </td>
                            <td class="px-3 py-3">
                              <div class="font-bold text-amber-800 line-clamp-1">${s.companyConfirmationItem || '確認事項なし'}</div>
                              <div class="text-[10px] text-slate-500 line-clamp-1">${s.companySharedComment || '-'}</div>
                            </td>
                            <td class="px-3 py-3 text-center">
                              <button class="btn-detail px-2 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-[10px] font-bold" data-id="${s.selectionId}">詳細</button>
                            </td>
                          </tr>
                        `;
                      }).join('')}
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <!-- 右側: 企業向け資料リアルタイムプレビュー ＆ 出力アクション (5カラム) (指示書 10, 11, 12, 14, 15, 16, 17, 18項) -->
          <div class="lg:col-span-5 space-y-4">
            
            <!-- 出力前チェック不整合警告 (指示書 14項) -->
            ${missingWarnings.length > 0 ? `
              <div class="bg-amber-50 border-l-4 border-amber-500 p-3.5 rounded-r-xl shadow-sm space-y-1 text-xs">
                <div class="font-bold text-amber-900 flex items-center gap-1.5">
                  <svg class="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                  <span>出力前の確認事項・注意</span>
                </div>
                <ul class="list-disc list-inside text-[11px] text-amber-800 space-y-0.5">
                  ${missingWarnings.map(w => `<li>${w}</li>`).join('')}
                </ul>
              </div>
            ` : ''}

            <!-- 企業向けプレビューカード (社内情報完全除外) (指示書 10, 11, 15項) -->
            <div class="bg-white rounded-xl border border-indigo-200 shadow-md overflow-hidden space-y-4 p-5">
              <div class="flex items-center justify-between border-b border-slate-200 pb-3">
                <h3 class="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                  <svg class="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                  2. 企業向け提出資料 プレビュー
                </h3>
                <span class="text-[10px] bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-extrabold border border-emerald-200">
                  🔒 社内情報除外済み
                </span>
              </div>

              <!-- プレビュー上の反映設定 (指示書 12項) -->
              <div class="bg-slate-50 p-2.5 rounded-lg border border-slate-200 flex items-center justify-between text-[11px]">
                <span class="font-bold text-slate-700">プレビュー編集の反映範囲:</span>
                <label class="flex items-center space-x-1 font-bold text-indigo-800 cursor-pointer">
                  <input type="checkbox" id="chk-save-to-selections" ${saveChangesToSelections ? 'checked' : ''} class="text-indigo-600">
                  <span>選考案件データにも保存する</span>
                </label>
              </div>

              <!-- プレビュー本文エリア (指示書 10, 11, 13項) -->
              <div id="preview-document-area" class="bg-slate-50/70 p-4 rounded-xl border border-slate-200 space-y-4 max-h-[420px] overflow-y-auto font-mono text-[11px] leading-relaxed">
                <!-- 資料ヘッダー -->
                <div class="border-b border-slate-300 pb-2 space-y-1">
                  <div class="font-bold text-sm text-slate-900">${currentCompany.name} 御中</div>
                  <div class="font-extrabold text-indigo-900">${submissionPurpose} 一覧</div>
                  <div class="text-[10px] text-slate-500 flex justify-between pt-1">
                    <span>作成日: ${new Date().toLocaleDateString('ja-JP')}</span>
                    <span>担当: サンクスパートナーズ (${raCons ? raCons.name : '担当RA'})</span>
                  </div>
                </div>

                <!-- 候補者一覧プレビュー -->
                <div class="space-y-3">
                  ${targetSelections.length === 0 ? `
                    <div class="text-center py-8 text-slate-400">提出対象としてチェックされた候補者がありません。</div>
                  ` : targetSelections.map((s, idx) => {
                    const cand = candidatesMap.get(s.candidateId);
                    const dateStr = s.nextScheduleDate || s.recommendationDate || s.phaseUpdatedAt || '-';
                    const customEdit = customPreviewEdits[s.selectionId] || {};

                    return `
                      <div class="bg-white p-3 rounded-lg border border-slate-200 shadow-2xs space-y-1.5 relative group">
                        <div class="font-bold text-slate-900 text-xs flex items-center justify-between">
                          <span>${idx + 1}. ${customEdit.name || (cand ? cand.name : s.candidateName)} 様</span>
                          <span class="text-[10px] text-indigo-700 bg-indigo-50 px-1.5 py-0.2 rounded font-sans font-bold">${s.phase} (${s.progressStatus})</span>
                        </div>
                        <div class="text-slate-600 text-[10px]">応募ポジション: ${s.jobName || '求人未指定'}</div>
                        <div class="text-slate-600 text-[10px]">選考日/推薦日: ${dateStr}</div>
                        <div class="text-amber-900 font-bold text-[11px] bg-amber-50 p-1.5 rounded border border-amber-100">
                          📌 確認事項: ${customEdit.checkItem || s.companyConfirmationItem || '合否確認'}
                        </div>
                        ${s.companySharedComment ? `
                          <div class="text-slate-600 text-[10px]">💬 共有メモ: ${customEdit.sharedComment || s.companySharedComment}</div>
                        ` : ''}
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>

              <!-- Step 3: 出力 ＆ アクションボタン群 (指示書 16, 17, 18, 19, 25項) -->
              <div class="space-y-2 border-t border-slate-200 pt-4">
                <div class="font-bold text-slate-800 text-xs mb-1">3. 出力 ＆ 提出実行</div>
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <!-- Excel出力 -->
                  <button id="btn-export-excel" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h55.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                    <span>Excel出力</span>
                  </button>

                  <!-- CSV出力 -->
                  <button id="btn-export-csv" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                    <span>CSV出力</span>
                  </button>

                  <!-- メール作成 -->
                  <button id="btn-export-email" ${targetSelections.length === 0 ? 'disabled' : ''} class="w-full py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-slate-300 text-white font-bold rounded-lg shadow transition flex items-center justify-center space-x-1">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"></path></svg>
                    <span>メール本文作成</span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 提出履歴表示パネル (指示书 25, 26項) -->
            <div class="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3">
              <h3 class="font-bold text-slate-800 text-xs flex items-center justify-between border-b border-slate-200 pb-2">
                <span>過去の企業提出履歴 (${submissions.length}件)</span>
                <span class="text-[10px] text-slate-400 font-normal">提出記録 ＆ 回答状況</span>
              </h3>

              <div class="max-h-48 overflow-y-auto space-y-2">
                ${submissions.length === 0 ? `
                  <div class="text-slate-400 text-center py-4 text-[11px]">この企業への過去の提出履歴はありません。</div>
                ` : submissions.map(sub => `
                  <div class="p-2.5 bg-slate-50 rounded-lg border border-slate-200 space-y-1 text-[11px]">
                    <div class="flex items-center justify-between font-bold">
                      <span class="text-indigo-900">${new Date(sub.submittedAt).toLocaleString('ja-JP')}</span>
                      <span class="px-1.5 py-0.2 rounded text-[9px] ${sub.responseStatus === '回答済み' ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}">${sub.responseStatus || '未回答'}</span>
                    </div>
                    <div class="text-slate-700">用途: ${sub.submissionPurpose} (${sub.targetCount}件 / ${sub.outputType})</div>
                    <div class="text-slate-500 text-[10px]">担当: ${sub.submittedByName}</div>
                  </div>
                `).join('')}
              </div>
            </div>

          </div>
        </div>
      </div>
    `;

    // -------------------------------------------------------------
    // イベントバインド
    // -------------------------------------------------------------

    container.querySelector('#select-export-company')?.addEventListener('change', (e) => {
      selectedCompanyId = e.target.value;
      saveCompanyViewState({ selectedCompanyId });
      updateView();
    });

    container.querySelector('#select-submission-purpose')?.addEventListener('change', (e) => {
      submissionPurpose = e.target.value;
      updateView();
    });

    container.querySelector('#select-filter-mode')?.addEventListener('change', (e) => {
      filterMode = e.target.value;
      updateView();
    });

    container.querySelector('#select-group-mode')?.addEventListener('change', (e) => {
      groupMode = e.target.value;
      updateView();
    });

    container.querySelector('#chk-save-to-selections')?.addEventListener('change', (e) => {
      saveChangesToSelections = e.target.checked;
    });

    // 個別チェック
    container.querySelectorAll('.chk-select-item').forEach(chk => {
      chk.addEventListener('change', (e) => {
        const id = chk.getAttribute('data-id');
        if (e.target.checked) {
          selectedSelectionIds.add(id);
        } else {
          selectedSelectionIds.delete(id);
        }
        updateView();
      });
    });

    // 一括操作ボタン (指示書 8項)
    container.querySelector('#btn-select-all')?.addEventListener('click', () => {
      companySelections.forEach(s => selectedSelectionIds.add(s.selectionId));
      updateView();
    });

    container.querySelector('#btn-deselect-all')?.addEventListener('click', () => {
      selectedSelectionIds.clear();
      updateView();
    });

    container.querySelector('#btn-select-actions')?.addEventListener('click', () => {
      selectedSelectionIds.clear();
      companySelections.forEach(s => {
        if (s.phase !== '選考終了' && (s.progressStatus === '実施済み・結果待ち' || s.progressStatus === '未対応' || s.companyConfirmationItem)) {
          selectedSelectionIds.add(s.selectionId);
        }
      });
      updateView();
    });

    // Excel出力 (指示書 17, 28項)
    container.querySelector('#btn-export-excel')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const filename = `${submissionPurpose}_${currentCompany.name}_${new Date().toISOString().split('T')[0]}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
      exportCompanyToExcel(currentCompany, targetSelections, filename);

      // 履歴保存 (指示書 25項)
      store.saveCompanySubmission({
        companyId: currentCompany.companyId,
        submissionPurpose,
        outputType: 'EXCEL',
        selectionIds: targetSelections.map(s => s.selectionId),
        candidateIds: targetSelections.map(s => s.candidateId),
        jobIds: targetSelections.map(s => s.jobId)
      });

      alert(`Excelファイル「${filename}」を出力し、提出履歴に記録しました。`);
      updateView();
    });

    // CSV出力 (指示書 16, 28項)
    container.querySelector('#btn-export-csv')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const filename = `${submissionPurpose}_${currentCompany.name}_${new Date().toISOString().split('T')[0]}.csv`.replace(/[\\/:*?"<>|]/g, '_');
      exportCompanyToCsv(currentCompany, targetSelections, filename);

      store.saveCompanySubmission({
        companyId: currentCompany.companyId,
        submissionPurpose,
        outputType: 'CSV',
        selectionIds: targetSelections.map(s => s.selectionId),
        candidateIds: targetSelections.map(s => s.candidateId),
        jobIds: targetSelections.map(s => s.jobId)
      });

      alert(`CSVファイル「${filename}」を出力し、提出履歴に記録しました。`);
      updateView();
    });

    // メール作成モーダル連携 (指示書 18, 19項)
    container.querySelector('#btn-export-email')?.addEventListener('click', () => {
      if (targetSelections.length === 0) return;

      const selectionIds = targetSelections.map(s => s.selectionId);
      openEmailComposerModal(currentCompany.companyId, () => {
        store.saveCompanySubmission({
          companyId: currentCompany.companyId,
          submissionPurpose,
          outputType: 'EMAIL',
          selectionIds,
          candidateIds: targetSelections.map(s => s.candidateId),
          jobIds: targetSelections.map(s => s.jobId)
        });
        updateView();
      }, selectionIds);
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}

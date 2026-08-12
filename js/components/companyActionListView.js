/**
 * 選考進捗・ヨミ管理システム - ヨミ表画面コンポーネント (指示書全34項準拠)
 * ヨミ％順 (100% ➔ 75% ➔ 50% ➔ 25% ➔ 0%) ＞ コンサル順 ＞ フェーズ進行度順 に全選考案件を美しく整列
 */

import { store } from '../store.js';
import { COMPANY_ACTION_TYPES, COMPANY_ACTION_STATUSES } from '../constants.js';
import { getDateInfoForSelection, normalizeCandidateName } from '../utils/mailTemplate.js';
import { calculateUniqueCandidatesCount } from '../utils/yomiCalculations.js';

const YOMI_TABLE_STORAGE_KEY = 'yomi_table_active_state_v1';

function getSavedYomiState() {
  try {
    const raw = sessionStorage.getItem(YOMI_TABLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveYomiState(state) {
  try {
    const current = getSavedYomiState();
    sessionStorage.setItem(YOMI_TABLE_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

/**
 * 表示用ヨミ値 (displayYomi) の算出 (指示書 10, 11, 12, 32項)
 */
function getDisplayYomi(s) {
  if (!s) return 0;
  const p = (s.phase || '').trim();

  // 指示書 6, 27項: 内定承諾関係フェーズは表示上100%優先
  if (['内定承諾', '承諾', '入社予定', '入社日確定', '承諾後手続き', '入社手続き中'].includes(p)) {
    return 100;
  }

  // ヨミ値の正規化 (100, "75%", 0.75 -> 数値)
  const rawYomi = s.yomi;
  if (rawYomi === undefined || rawYomi === null || rawYomi === '' || rawYomi === 'なし') {
    return 0;
  }

  let num = Number(String(rawYomi).replace('%', '').trim());
  if (isNaN(num)) return 0;

  if (num <= 1 && num > 0) {
    num = Math.round(num * 100);
  }

  if ([100, 75, 50, 25, 0].includes(num)) {
    return num;
  }

  if (num >= 85) return 100;
  if (num >= 65) return 75;
  if (num >= 40) return 50;
  if (num >= 15) return 25;

  return 0;
}

/**
 * フェーズ進行度スコア (同一CA・同一ヨミ内のソート用 指示書 15項)
 */
function getPhaseOrderScore(phase) {
  const p = (phase || '').trim();
  if (['内定承諾', '承諾', '入社予定', '入社日確定'].includes(p)) return 100;
  if (['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整', '内定回答待ち'].includes(p)) return 90;
  if (['最終面接', '最終選考', '役員面接'].includes(p)) return 80;
  if (['三次面接', '三次選考'].includes(p)) return 70;
  if (['二次面接', '二次選考'].includes(p)) return 60;
  if (['一次面接', '一次選考', '一次面談'].includes(p)) return 50;
  if (['推薦済み', '書類提出済み', '書類選考', '書類選考結果待ち', '推薦準備'].includes(p)) return 40;
  return 10;
}

export function renderCompanyActionListView(container, { onOpenDetail, onOpenEmailComposer }) {
  const currentCons = store.getCurrentConsultant();
  const savedState = getSavedYomiState();

  let filterCaId = savedState.filterCaId || '';
  let searchKw = savedState.searchKw || '';
  let collapsedGroups = new Set(savedState.collapsedGroups || []);

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    const selections = store.getSelections() || [];
    const companies = store.getCompanies() || [];
    const jobs = store.getJobs() || [];
    const candidates = store.getCandidates() || [];
    const consultants = store.getConsultants() || [];

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    // コンサル順の定義作成 (指示書 13, 14項)
    const sortedConsultants = [...consultants].sort((a, b) => {
      const orderA = a.displayOrder !== undefined ? a.displayOrder : (a.sortOrder !== undefined ? a.sortOrder : 999);
      const orderB = b.displayOrder !== undefined ? b.displayOrder : (b.sortOrder !== undefined ? b.sortOrder : 999);
      if (orderA !== orderB) return orderA - orderB;
      const kanaA = a.nameKana || a.name || '';
      const kanaB = b.nameKana || b.name || '';
      return kanaA.localeCompare(kanaB, 'ja');
    });

    const consultantIndexMap = new Map();
    sortedConsultants.forEach((c, idx) => {
      consultantIndexMap.set(c.consultantId, idx);
      if (c.email) consultantIndexMap.set(c.email.toLowerCase(), idx);
      if (c.name) consultantIndexMap.set((c.name || '').split(' ')[0], idx);
    });

    const getCaOrder = (s) => {
      if (s.caId && consultantIndexMap.has(s.caId)) return consultantIndexMap.get(s.caId);
      if (s.caConsultantId && consultantIndexMap.has(s.caConsultantId)) return consultantIndexMap.get(s.caConsultantId);
      if (s.caEmail && consultantIndexMap.has(s.caEmail.toLowerCase())) return consultantIndexMap.get(s.caEmail.toLowerCase());
      if (s.caName && consultantIndexMap.has((s.caName || '').split(' ')[0])) return consultantIndexMap.get((s.caName || '').split(' ')[0]);
      return 9999; // 未設定
    };

    // 指示書 28項: 終了案件（見送り・選考終了・アーカイブ）は除外、辞退は除外
    const activeSelections = selections.filter(s => {
      if (!s || s.isArchived || s.isDeleted) return false;
      const p = s.phase || '';
      return p !== '選考終了' && p !== '書類見送り' && p !== '面接見送り' && p !== '候補者辞退' && p !== '他社決定' && p !== '内定辞退';
    });

    // 検索 ＆ 担当者フィルター
    let filteredSelections = activeSelections.filter(s => {
      if (filterCaId && s.caId !== filterCaId && s.caConsultantId !== filterCaId) return false;

      if (searchKw) {
        const kw = searchKw.toLowerCase();
        const cand = candidatesMap.get(s.candidateId);
        const comp = companiesMap.get(s.companyId);
        const job = jobsMap.get(s.jobId);
        const ca = consultantsMap.get(s.caId || s.caConsultantId);

        const candName = (cand ? cand.name : s.candidateName || '').toLowerCase();
        const compName = (comp ? comp.name : s.companyName || '').toLowerCase();
        const jobName = (job ? (job.title || job.jobName) : s.jobName || '').toLowerCase();
        const caName = (ca ? ca.name : s.caName || '').toLowerCase();

        if (!candName.includes(kw) && !compName.includes(kw) && !jobName.includes(kw) && !caName.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    // 各案件に displayYomi と CA順・フェーズ順キーを付与
    const enriched = filteredSelections.map(s => {
      const displayYomi = getDisplayYomi(s);
      const caOrder = getCaOrder(s);
      const phaseScore = getPhaseOrderScore(s.phase);
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);

      return {
        ...s,
        displayYomi,
        caOrder,
        phaseScore,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca
      };
    });

    // グルーピング (100% -> 75% -> 50% -> 25% -> 0%)
    const yomiGroupDefs = [
      { key: '100', label: '100％｜内定承諾', yomiVal: 100 },
      { key: '75', label: '75％', yomiVal: 75 },
      { key: '50', label: '50％', yomiVal: 50 },
      { key: '25', label: '25％', yomiVal: 25 },
      { key: '0', label: '0％｜なし・書類選考中', yomiVal: 0 }
    ];

    const yomiGroups = yomiGroupDefs.map(g => {
      const groupSels = enriched.filter(s => s.displayYomi === g.yomiVal);

      // グループ内ソート: CA順 (昇順) ➔ フェーズ順 (降順) ➔ ID
      groupSels.sort((a, b) => {
        if (a.caOrder !== b.caOrder) return a.caOrder - b.caOrder;
        if (a.phaseScore !== b.phaseScore) return b.phaseScore - a.phaseScore;
        return (a.selectionId || '').localeCompare(b.selectionId || '');
      });

      return {
        ...g,
        selections: groupSels,
        count: groupSels.length
      };
    });

    saveYomiState({
      filterCaId,
      searchKw,
      collapsedGroups: Array.from(collapsedGroups)
    });

    // 各ヨミグループのテーブルHTML組み立て
    const groupsHTML = yomiGroups.map(g => {
      const isCollapsed = collapsedGroups.has(g.key);
      const selCount = g.count;

      return `
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
          <!-- グループ見出しバナー (指示書 17, 18, 19項) -->
          <div
            class="px-4 py-3 bg-slate-900 text-white flex items-center justify-between cursor-pointer hover:bg-slate-800 transition select-none btn-toggle-yomi-group"
            data-group-key="${g.key}"
          >
            <div class="flex items-center space-x-3">
              <span class="text-indigo-400 font-black text-sm">${isCollapsed ? '▶' : '▼'}</span>
              <h3 class="font-extrabold text-sm text-white tracking-wide">${g.label}</h3>
              <span class="bg-indigo-600/40 text-indigo-200 border border-indigo-400/30 text-xs px-2.5 py-0.5 rounded-full font-bold">
                ${selCount} 件
              </span>
            </div>
            <div class="text-xs text-slate-400 font-medium">
              ${isCollapsed ? 'クリックして展開' : 'クリックして折りたたむ'}
            </div>
          </div>

          ${!isCollapsed ? `
            <div class="overflow-x-auto">
              ${selCount === 0 ? `
                <div class="p-6 text-center text-slate-400 text-xs font-semibold bg-slate-50/50">
                  該当する案件はありません
                </div>
              ` : `
                <table class="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr class="bg-slate-100/80 border-b border-slate-200 text-slate-600 font-extrabold">
                      <th class="py-2.5 px-3">候補者名</th>
                      <th class="py-2.5 px-3">企業名 ｜ 求人</th>
                      <th class="py-2.5 px-3">担当CA</th>
                      <th class="py-2.5 px-3">選考フェーズ</th>
                      <th class="py-2.5 px-3">進行状態</th>
                      <th class="py-2.5 px-3 text-center">ヨミ</th>
                      <th class="py-2.5 px-3 text-center">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100 text-slate-800">
                    ${g.selections.map(s => {
                      const candName = s.candidateObj ? s.candidateObj.name : (s.candidateName || '-');
                      const compName = s.companyObj ? s.companyObj.name : (s.companyName || '-');
                      const jobTitle = s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : (s.jobName || '-');
                      const caName = s.caObj ? (s.caObj.name || '').split(' ')[0] : (s.caName || '未設定');

                      return `
                        <tr class="hover:bg-indigo-50/40 transition group">
                          <td class="py-2.5 px-3 font-extrabold text-slate-900">
                            <span class="cursor-pointer hover:text-indigo-600 transition btn-open-detail" data-selection-id="${s.selectionId}">
                              ${candName} 様
                            </span>
                          </td>
                          <td class="py-2.5 px-3">
                            <div class="font-bold text-slate-900 line-clamp-1">${compName}</div>
                            <div class="text-[11px] text-slate-500 line-clamp-1">${jobTitle}</div>
                          </td>
                          <td class="py-2.5 px-3 font-bold text-indigo-900">
                            ${caName}
                          </td>
                          <td class="py-2.5 px-3 font-extrabold text-indigo-700">
                            ${s.phase}
                          </td>
                          <td class="py-2.5 px-3 font-medium text-slate-600">
                            ${s.progressStatus || '-'}
                          </td>
                          <td class="py-2.5 px-3 text-center">
                            <span class="px-2 py-0.5 rounded font-black text-xs ${
                              s.displayYomi === 100 ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' :
                              s.displayYomi === 75 ? 'bg-indigo-100 text-indigo-800 border border-indigo-300' :
                              s.displayYomi === 50 ? 'bg-sky-100 text-sky-800 border border-sky-300' :
                              s.displayYomi === 25 ? 'bg-amber-100 text-amber-800 border border-amber-300' :
                              'bg-slate-100 text-slate-600 border border-slate-300'
                            }">
                              ${s.displayYomi}%
                            </span>
                          </td>
                          <td class="py-2.5 px-3 text-center space-x-1">
                            <button class="px-2 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-[11px] transition shadow-2xs btn-open-detail" data-selection-id="${s.selectionId}">
                              詳細
                            </button>
                          </td>
                        </tr>
                      `;
                    }).join('')}
                  </tbody>
                </table>
              `}
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="space-y-4">
        <!-- ページタイトル ＆ コントロール (指示書 3, 4, 20, 22, 30項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
              ヨミ表
            </h2>
            <p class="text-xs text-slate-500 mt-1">選考案件をヨミ順に確認できます（総対象案件: ${enriched.length}件）</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <select id="select-yomi-ca-filter" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 font-bold focus:outline-none focus:bg-white focus:border-indigo-600">
              <option value="">担当CA: 全体</option>
              ${consultants.map(c => `<option value="${c.consultantId}" ${filterCaId === c.consultantId ? 'selected' : ''}>${c.name}</option>`).join('')}
            </select>

            <input type="text" id="input-yomi-search" value="${searchKw}" placeholder="候補者・企業・求人・CAで検索..." class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 w-56">
          </div>
        </div>

        <!-- 各ヨミ％グループのリスト -->
        <div>
          ${groupsHTML}
        </div>
      </div>
    `;

    if (savedScrollY > 0) window.scrollTo(0, savedScrollY);

    if (options.preserveFocusId) {
      const inputEl = container.querySelector('#' + options.preserveFocusId);
      if (inputEl) {
        inputEl.focus();
        if (options.selectionStart !== undefined) inputEl.setSelectionRange(options.selectionStart, options.selectionStart);
      }
    }

    // イベントバインド
    container.querySelector('#select-yomi-ca-filter')?.addEventListener('change', (e) => {
      filterCaId = e.target.value;
      saveYomiState({ filterCaId });
      updateView();
    });

    const searchInputEl = container.querySelector('#input-yomi-search');
    if (searchInputEl) {
      let isComposing = false;
      searchInputEl.addEventListener('compositionstart', () => { isComposing = true; });
      searchInputEl.addEventListener('compositionend', (e) => {
        isComposing = false;
        searchKw = e.target.value;
        saveYomiState({ searchKw });
        updateView({ preserveFocusId: 'input-yomi-search', selectionStart: e.target.selectionStart });
      });
      searchInputEl.addEventListener('input', (e) => {
        if (isComposing) return;
        searchKw = e.target.value;
        saveYomiState({ searchKw });
        updateView({ preserveFocusId: 'input-yomi-search', selectionStart: e.target.selectionStart });
      });
    }

    container.querySelectorAll('.btn-toggle-yomi-group').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.getAttribute('data-group-key');
        if (collapsedGroups.has(key)) {
          collapsedGroups.delete(key);
        } else {
          collapsedGroups.add(key);
        }
        saveYomiState({ collapsedGroups: Array.from(collapsedGroups) });
        updateView({ preserveScroll: true });
      });
    });

    container.querySelectorAll('.btn-open-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-selection-id');
        if (selId && onOpenDetail) onOpenDetail(selId);
      });
    });
  }

  updateView();
}

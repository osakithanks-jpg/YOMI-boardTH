/**
 * 選考進捗・ヨミ管理システム - 新ホワイトボード画面コンポーネント (WhiteboardV2)
 * 指示書 (全26項) に厳格準拠し、「企業対応」と同じ正常データソースを使用してゼロから堅牢再構築
 */

import { store } from '../store.js';
import { WHITEBOARD_5PHASES } from '../constants.js';
import { getWhiteboardPhaseGroup, calculateUrgency } from '../utils/kanbanCalculations.js';
import { calculateUniqueCandidatesCount } from '../utils/yomiCalculations.js';

const WHITEBOARD_V2_STORAGE_KEY = 'whiteboard_v2_state_v1';

function getSavedState() {
  try {
    const raw = sessionStorage.getItem(WHITEBOARD_V2_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveState(state) {
  try {
    const current = getSavedState();
    sessionStorage.setItem(WHITEBOARD_V2_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

/**
 * 新フェーズマッピング関数 (指示書 10項)
 */
function mapPhaseToWhiteboardGroup(phase) {
  const p = (phase || '').trim();

  // 1. 内定承諾
  if (['内定承諾', '承諾', '入社予定', '入社日確定', '承諾後手続き', '入社手続き中'].includes(p)) {
    return '内定承諾';
  }
  // 2. 内定
  if (['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整', '内定回答待ち', '候補者回答待ち'].includes(p)) {
    return '内定';
  }
  // 3. 最終・二次
  if (['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接'].includes(p)) {
    return '最終・二次';
  }
  // 4. 一次
  if (['一次面接', '一次選考', '一次面談', '一次面接日程調整', '一次面接結果待ち'].includes(p)) {
    return '一次';
  }
  // 5. 書類選考
  if (['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち'].includes(p)) {
    return '書類選考';
  }

  // デフォルトフォールバック (指示書 11項)
  return getWhiteboardPhaseGroup(p) || '書類選考';
}

export function renderWhiteboardV2(container, { onOpenDetail, onNavigateToCompanyActions }) {
  const savedState = getSavedState();

  let axisMode = savedState.axisMode || 'ca'; // 'ca' または 'company'
  let searchKeyword = savedState.searchKeyword || '';
  let isRaSummaryOpen = savedState.isRaSummaryOpen !== undefined ? savedState.isRaSummaryOpen : true;
  let isComposing = false;

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

    // 指示書 3, 4項: 「企業対応」と同じデータ取得処理をそのまま利用
    const selections = store.getSelections() || [];
    const companies = store.getCompanies() || [];
    const jobs = store.getJobs() || [];
    const candidates = store.getCandidates() || [];
    const consultants = store.getConsultants() || [];

    const isLoading = store.isLoading ? store.isLoading() : false;
    if (isLoading) {
      container.innerHTML = `
        <div class="p-12 text-center bg-white border border-slate-200 rounded-2xl shadow-sm space-y-3">
          <div class="inline-block animate-spin rounded-full h-8 w-8 border-4 border-indigo-600 border-t-transparent"></div>
          <p class="text-slate-700 font-bold text-sm">選考案件を読み込んでいます...</p>
        </div>
      `;
      return;
    }

    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));
    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 指示書 6, 12項: 進行中の全選考案件を対象とし、終了案件だけを除外
    const activeSelections = selections.filter(s => {
      if (!s || s.isArchived || s.isDeleted) return false;
      const p = s.phase || '';
      return p !== '選考終了' && p !== '書類見送り' && p !== '面接見送り' && p !== '候補者辞退' && p !== '他社決定';
    });

    const enrichedSelections = activeSelections.map(s => {
      const comp = companiesMap.get(s.companyId);
      const cand = candidatesMap.get(s.candidateId);
      const job = jobsMap.get(s.jobId);
      const ca = consultantsMap.get(s.caId || s.caConsultantId);
      const ra = consultantsMap.get(s.raId || s.raConsultantId);

      const wbGroup = mapPhaseToWhiteboardGroup(s.phase);
      const urgencyInfo = calculateUrgency(s, today);

      return {
        ...s,
        wbGroup,
        companyObj: comp,
        candidateObj: cand,
        jobObj: job,
        caObj: ca,
        raObj: ra,
        urgencyInfo
      };
    });

    // RAサマリー集計 (指示書 16項)
    const raActionSelections = enrichedSelections.filter(s => {
      if (s.phase === '内定辞退') return false;
      const uCode = s.urgencyInfo ? s.urgencyInfo.code : '';
      return (uCode === 'expired' || uCode === 'today' || uCode === 'waiting_reply' || uCode === 'ca_check' || uCode === 'within_3days');
    });

    const raSummary = {
      total: raActionSelections.length,
      expired: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'expired').length,
      today: raActionSelections.filter(s => s.urgencyInfo && s.urgencyInfo.code === 'today').length,
      companyWaiting: raActionSelections.filter(s => s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'waiting_reply')).length,
      caCheck: raActionSelections.filter(s => s.companyActionStatus === 'CA確認待ち' || (s.urgencyInfo && s.urgencyInfo.code === 'ca_check')).length
    };

    // 列（横軸）の決定 (指示書 6, 8, 9, 13項)
    let columns = [];
    if (axisMode === 'ca') {
      let targetCas = consultants.filter(c => {
        if (!c || c.isArchived || c.status === 'inactive') return false;
        if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
        return c.roleType === 'CA' || c.roleType === 'ADMIN' || c.role === 'CA' || !c.roleType;
      });

      if (targetCas.length === 0) targetCas = consultants;

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        targetCas = targetCas.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      columns = targetCas.map(c => ({
        id: c.consultantId,
        title: `${c.name} (CA)`,
        filterFn: (s) => {
          if (s.caId && s.caId === c.consultantId) return true;
          if (s.caConsultantId && s.caConsultantId === c.consultantId) return true;
          if (s.caEmail && c.email && s.caEmail.toLowerCase() === c.email.toLowerCase()) return true;
          if (s.caName && c.name && s.caName.includes((c.name || '').split(' ')[0])) return true;
          return false;
        }
      }));

      // 担当CA未設定案件の救済列 (指示書 9項)
      const hasUnassigned = enrichedSelections.some(s => !columns.some(col => col.filterFn(s)));
      if (hasUnassigned) {
        columns.push({
          id: 'UNASSIGNED_CA',
          title: '担当CA未設定',
          filterFn: (s) => !columns.some(col => col.id !== 'UNASSIGNED_CA' && col.filterFn(s))
        });
      }
    } else {
      // 企業別表示: 進行中案件が存在する企業のみ
      const activeCompanyIds = new Set(enrichedSelections.filter(s => s.phase !== '内定辞退').map(s => s.companyId));
      let targetCompanies = companies.filter(c => c && activeCompanyIds.has(c.companyId));

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        targetCompanies = targetCompanies.filter(c => (c.name || '').toLowerCase().includes(kw));
      }

      columns = targetCompanies.map(c => ({
        id: c.companyId,
        title: c.name,
        filterFn: (s) => s.companyId === c.companyId
      }));
    }

    // 縦軸 5フェーズ (指示書 7項: 必ず固定表示)
    const sorted5Phases = [...WHITEBOARD_5PHASES].sort((a, b) => b.order - a.order);

    saveState({
      axisMode,
      searchKeyword,
      isRaSummaryOpen
    });

    // グリッドHTMLの組み立て (指示書 8, 9, 12, 14, 25項)
    const gridHTML = columns.length === 0 ? `
      <div class="p-8 text-center bg-slate-50 border border-dashed border-slate-300 rounded-xl text-slate-500 font-bold text-sm">
        ${axisMode === 'ca' ? '該当するCAがありません' : '該当する企業がありません'}
      </div>
    ` : sorted5Phases.map(pObj => {
      const groupSels = enrichedSelections.filter(s => {
        if (s.phase === '内定辞退') {
          const prevPhase = s.previousPhaseBeforeDecline || '内定';
          return mapPhaseToWhiteboardGroup(prevPhase) === pObj.label;
        }
        return s.wbGroup === pObj.label;
      });

      const groupCases = groupSels.length;
      const groupPeople = calculateUniqueCandidatesCount(groupSels, false);
      const groupYomi = groupSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);

      const colsHTML = columns.map(col => {
        const colSels = groupSels.filter(s => col.filterFn(s));
        const colPeople = calculateUniqueCandidatesCount(colSels, false);
        const colYomi = colSels.reduce((sum, s) => sum + (s.phase === '内定辞退' ? 0 : Number(s.yomi || 0)), 0);

        const cardsHTML = colSels.length === 0 ? `
          <div class="h-full border border-dashed border-slate-200 rounded-lg flex items-center justify-center text-[10px] text-slate-400 py-6">
            案件なし
          </div>
        ` : colSels.map(s => renderCandidateCardHTML(s, axisMode === 'company')).join('');

        return `
          <div class="bg-slate-50 p-2.5 rounded-xl border border-slate-200 flex flex-col justify-between" data-column-id="${col.id}">
            <div class="flex items-center justify-between border-b border-slate-200 pb-1.5 mb-2">
              <span class="font-extrabold text-xs text-slate-800 line-clamp-1">${col.title}</span>
              <span class="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
                案件:${colSels.length} / 実人数:${colPeople} / ヨミ:${Math.round(colYomi * 100) / 100}
              </span>
            </div>
            <div class="space-y-2 flex-1 min-h-[90px] p-1">
              ${cardsHTML}
            </div>
          </div>
        `;
      }).join('');

      return `
        <div class="border border-slate-200 rounded-xl overflow-hidden shadow-sm bg-slate-50/50">
          <div class="px-4 py-2 bg-slate-900 text-white flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <span class="font-black text-sm text-indigo-200">${pObj.label}</span>
              <span class="text-[11px] text-slate-400">（優先度: ${pObj.order}）</span>
            </div>
            <div class="flex items-center space-x-4 text-xs font-semibold">
              <span>選考案件: <strong class="text-white">${groupCases}</strong>件</span>
              <span class="text-slate-400">|</span>
              <span>候補者実人数: <strong class="text-indigo-300">${groupPeople}</strong>名</span>
              <span class="text-slate-400">|</span>
              <span>ヨミ合計: <strong class="text-emerald-400">${Math.round(groupYomi * 100) / 100}</strong></span>
            </div>
          </div>
          <div class="p-2 bg-slate-100/50 min-h-[130px]" style="display: grid; grid-template-columns: repeat(${Math.max(columns.length, 1)}, minmax(240px, 1fr)); gap: 0.75rem;">
            ${colsHTML}
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="space-y-4">
        <!-- ヘッダー ＆ 切替 ＆ 検索 (指示书 17, 18, 25項) -->
        <div class="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 class="text-xl font-extrabold text-slate-900 flex items-center gap-2">
              <svg class="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2m0 10V7m6 10a2 2 0 002 2h2a2 0 002-2V7a2 0 00-2-2h-2a2 2 0 01-2 2"></path></svg>
              ホワイトボード (V2)
            </h2>
            <p class="text-xs text-slate-500 mt-1">全進行案件の選考進捗をCA別・企業別に俯瞰する画面です。（進行案件: ${activeSelections.length}件）</p>
          </div>

          <div class="flex items-center space-x-3 text-xs">
            <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold">
              <button id="btn-wbv2-toggle-ca" class="px-4 py-1.5 rounded transition ${axisMode === 'ca' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">CA別</button>
              <button id="btn-wbv2-toggle-company" class="px-4 py-1.5 rounded transition ${axisMode === 'company' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">企業別</button>
            </div>

            <input type="text" id="input-wbv2-search" value="${searchKeyword}" placeholder="${axisMode === 'ca' ? 'CA名で検索...' : '企業名で検索...'}" class="bg-slate-50 border border-slate-300 rounded px-2.5 py-1 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600">
          </div>
        </div>

        <!-- 本日のRA対応コンパクトバナー (指示書 16項) -->
        <div class="bg-slate-900 text-white rounded-xl shadow-md border border-slate-800 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div class="flex items-center space-x-3">
            <button id="btn-wbv2-toggle-ra" class="font-bold text-indigo-300 hover:text-white flex items-center gap-1.5 text-xs">
              <span>${isRaSummaryOpen ? '▼' : '▶'}</span>
              <span class="text-sm font-black">本日のRA対応</span>
              <span class="bg-rose-500/30 text-rose-300 border border-rose-400/30 text-[11px] px-2 py-0.5 rounded font-extrabold ml-1">
                ${raSummary.total} 件
              </span>
            </button>
          </div>
          ${isRaSummaryOpen ? `
            <div class="flex flex-wrap items-center gap-3">
              <div id="ra-click-expired" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">期限超過:</span>
                <strong class="text-rose-400 font-black ml-1 text-sm">${raSummary.expired}</strong>
              </div>
              <div id="ra-click-today" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">本日対応:</span>
                <strong class="text-amber-400 font-black ml-1 text-sm">${raSummary.today}</strong>
              </div>
              <div id="ra-click-waiting" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">企業回答待ち:</span>
                <strong class="text-sky-400 font-black ml-1 text-sm">${raSummary.companyWaiting}</strong>
              </div>
              <div id="ra-click-check" class="cursor-pointer hover:bg-slate-800 px-2 py-1 rounded transition border border-transparent hover:border-slate-700">
                <span class="text-slate-400 font-semibold">要確認:</span>
                <strong class="text-purple-400 font-black ml-1 text-sm">${raSummary.caCheck}</strong>
              </div>

              <button id="btn-wbv2-open-company-actions" class="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold rounded-lg text-xs transition shadow-sm border border-indigo-400 flex items-center gap-1.5 ml-2">
                <span>企業対応を開く</span>
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"></path></svg>
              </button>
            </div>
          ` : ''}
        </div>

        <!-- 5区分ボード領域 -->
        <div id="wbv2-horizontal-scroll-container" class="overflow-x-auto w-full bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <div class="space-y-4" style="min-width: max-content; width: 100%;">
            ${gridHTML}
          </div>
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
    container.querySelector('#btn-wbv2-toggle-ca')?.addEventListener('click', () => {
      axisMode = 'ca';
      saveState({ axisMode: 'ca' });
      updateView();
    });

    container.querySelector('#btn-wbv2-toggle-company')?.addEventListener('click', () => {
      axisMode = 'company';
      saveState({ axisMode: 'company' });
      updateView();
    });

    // 日本語IME保護付き検索イベント (指示書 17, 18項)
    const searchEl = container.querySelector('#input-wbv2-search');
    if (searchEl) {
      searchEl.addEventListener('compositionstart', () => { isComposing = true; });
      searchEl.addEventListener('compositionend', (e) => {
        isComposing = false;
        searchKeyword = e.target.value;
        saveState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wbv2-search', selectionStart: e.target.selectionStart });
      });
      searchEl.addEventListener('input', (e) => {
        if (isComposing) return;
        searchKeyword = e.target.value;
        saveState({ searchKeyword });
        updateView({ preserveFocusId: 'input-wbv2-search', selectionStart: e.target.selectionStart });
      });
    }

    container.querySelector('#btn-wbv2-toggle-ra')?.addEventListener('click', () => {
      isRaSummaryOpen = !isRaSummaryOpen;
      saveState({ isRaSummaryOpen });
      updateView({ preserveScroll: true });
    });

    container.querySelector('#btn-wbv2-open-company-actions')?.addEventListener('click', () => {
      if (onNavigateToCompanyActions) onNavigateToCompanyActions();
    });

    container.querySelectorAll('.wbv2-card-click').forEach(card => {
      card.addEventListener('click', () => {
        const selId = card.getAttribute('data-selection-id');
        if (selId && onOpenDetail) onOpenDetail(selId);
      });
    });
  }

  updateView();
}

/**
 * 候補者カードHTML生成関数 (指示書 12, 14項)
 */
function renderCandidateCardHTML(s, isCompanyAxis) {
  const isDeclined = s.phase === '内定辞退';
  const uObj = s.urgencyInfo || {};
  const percentStr = Math.round((Number(s.yomi) || 0) * 100) + '%';
  const candName = s.candidateObj ? s.candidateObj.name : s.candidateName;
  const compName = s.companyObj ? s.companyObj.name : s.companyName;
  const jobTitle = s.jobObj ? (s.jobObj.title || s.jobObj.jobName) : s.jobName;
  const caName = s.caObj ? (s.caObj.name || '').split(' ')[0] : s.caName || '-';

  return `
    <div
      data-selection-id="${s.selectionId}"
      class="wbv2-card-click kanban-card rounded-lg p-2.5 shadow-2xs transition space-y-1.5 border text-xs cursor-pointer ${
        isDeclined
          ? 'bg-slate-200/80 border-slate-300 text-slate-500 cursor-default opacity-75'
          : 'bg-white border-slate-200 hover:shadow-md hover:border-indigo-400 group'
      }"
    >
      <div class="flex items-center justify-between gap-1 border-b border-slate-100 pb-1">
        <div class="font-extrabold text-xs text-slate-900 truncate group-hover:text-indigo-600 transition" title="${candName}">
          ${candName} 様
        </div>
        ${isDeclined ? `
          <span class="px-1.5 py-0.2 rounded text-[9px] font-extrabold bg-slate-500 text-white shrink-0">内定辞退</span>
        ` : (uObj.code === 'expired' || uObj.code === 'today') ? `
          <span class="px-1.5 py-0.2 rounded text-[8px] font-extrabold ${uObj.badgeClass} shrink-0">${uObj.label}</span>
        ` : ''}
      </div>

      <div class="text-[10px] text-slate-700 truncate">
        ${isCompanyAxis ? `CA: <strong class="text-indigo-900 font-bold">${caName}</strong>` : `<strong class="text-slate-900 font-bold">${compName}</strong>`}
      </div>

      <div class="text-[10px] text-slate-500 truncate" title="${jobTitle}">
        ${jobTitle}
      </div>

      <div class="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
        <div class="font-bold text-indigo-800 truncate">${s.phase} <span class="text-slate-400 font-normal">｜ ${s.progressStatus}</span></div>
        <div class="font-black text-slate-900 shrink-0 ml-1">ヨミ ${percentStr}</div>
      </div>
    </div>
  `;
}

import { store } from '../store.js';
import {
  getFiscalYear,
  getFiscalQuarter,
  getQuarterDateRange,
  getQuarterFromYearMonth,
  getFiscalQuarterFromDate,
  normalizeYomi,
  isSelectionInQuarter
} from '../utils/yomiCalculations.js';

const DASHBOARD_STORAGE_KEY = 'dashboard_active_quarter_v2';

function getSavedDashboardState() {
  try {
    const raw = sessionStorage.getItem(DASHBOARD_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveDashboardState(state) {
  try {
    const current = getSavedDashboardState();
    sessionStorage.setItem(DASHBOARD_STORAGE_KEY, JSON.stringify({ ...current, ...state }));
  } catch (e) {}
}

export function renderDashboard(container, { onOpenDetail, onNavigateToSelections, onNavigateToConsultant, onNavigateToCompany }) {
  const savedState = getSavedDashboardState();

  const currentInitialFQ = getFiscalQuarterFromDate(new Date());

  let selectedFiscalYear = savedState.fiscalYear !== undefined ? parseInt(savedState.fiscalYear, 10) : currentInitialFQ.fiscalYear;
  let selectedQuarter = savedState.quarter !== undefined ? savedState.quarter : currentInitialFQ.quarter;
  
  // 初期表示は必ず「チーム全体」とする (指示書 3, 8, 10項)
  let selectedConsultantId = savedState.consultantId !== undefined ? savedState.consultantId : 'ALL';
  let activeRoleType = savedState.roleType !== undefined ? savedState.roleType : 'CA'; // 'CA' | 'RA'

  function updateView() {
    const selections = store.getSelections();
    const consultants = store.getConsultants();
    const companies = store.getCompanies();
    const jobs = store.getJobs();

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    const qRange = getQuarterDateRange(selectedFiscalYear, selectedQuarter);
    const startDate = new Date(qRange.startDate);
    const endDate = new Date(qRange.endDate);
    endDate.setHours(23, 59, 59, 999);

    const qTargets = store.getQTargets(selectedFiscalYear, selectedQuarter);
    const qTargetMap = new Map(qTargets.map(t => [t.consultantId, Number(t.targetCount || 0)]));

    // 有効な CA・兼任コンサルタントを抽出 (指示書 5項)
    const activeCaConsultants = consultants.filter(c => {
      if (c.isArchived || c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) return c.roles.includes('CA') || c.roles.includes('ADMIN');
      return c.roleType === 'CA' || c.roleType === 'ADMIN';
    });

    // チームQ目標 ＝ 対象QのCA個人目標の合計 (指示書 5項)
    let teamQTarget = activeCaConsultants.reduce((sum, c) => sum + (qTargetMap.get(c.consultantId) || 0), 0);
    if (teamQTarget === 0) teamQTarget = qTargetMap.get('TEAM') || 13;

    // 担当者フィルターに基づく案件フィルタリング (指示書 8項)
    const filteredSelections = selections.filter(s => {
      if (s.isArchived) return false;
      if (selectedConsultantId === 'ALL') return true;

      return activeRoleType === 'CA'
        ? (s.caId === selectedConsultantId || s.caConsultantId === selectedConsultantId)
        : (s.raId === selectedConsultantId || s.raConsultantId === selectedConsultantId);
    });

    // 1. Q承諾実績 (対象Q期間内に内定承諾・入社決定となった件数: 指示書 19項)
    const acceptedSelections = filteredSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const qAcceptedCount = acceptedSelections.length;

    // 2. Q進行中ヨミ (対象Qに着地見込みの進行中案件: 指示書 6, 17, 18項)
    const inProgressSelectionsInQ = filteredSelections.filter(s => {
      if (['選考終了', '内定辞退', '内定承諾', '入社予定', '書類見送り', '面接見送り', '候補者辞退', '他社決定'].includes(s.phase)) {
        return false;
      }
      return isSelectionInQuarter(s, selectedFiscalYear, selectedQuarter);
    });

    // ヨミの正規化合計計算 (指示書 6, 16項)
    const rawYomiSum = inProgressSelectionsInQ.reduce((sum, s) => sum + normalizeYomi(s.yomi), 0);
    const qInProgressYomi = Math.round(rawYomiSum * 100) / 100;

    // 3. 着地見込み, 4. 不足ヨミ, 5. 達成率 (指示書 7, 11, 12, 13項)
    const targetGoal = selectedConsultantId === 'ALL'
      ? teamQTarget
      : (activeRoleType === 'CA' ? (qTargetMap.get(selectedConsultantId) || 4) : null);

    const qForecastTotal = Math.round((qAcceptedCount + qInProgressYomi) * 100) / 100;
    const qShortage = targetGoal !== null ? Math.max(0, Math.round((targetGoal - qForecastTotal) * 100) / 100) : 0;
    const qAchievementRate = (targetGoal !== null && targetGoal > 0) ? Math.round((qForecastTotal / targetGoal) * 1000) / 10 : 0;

    // 担当者名・表示タイトルの成形 (指示書 21項)
    let scopeBadgeLabel = '集計対象: チーム全体';
    if (selectedConsultantId !== 'ALL') {
      const selectedCons = consultantsMap.get(selectedConsultantId);
      const cName = selectedCons ? selectedCons.name : '担当者';
      scopeBadgeLabel = `集計対象: ${cName} (${activeRoleType}担当)`;
    }

    // 動的年度選択肢 (現在年を中心)
    const baseFY = currentInitialFQ.fiscalYear;
    const fyOptions = [baseFY - 1, baseFY, baseFY + 1, baseFY + 2];

    // 企業別ヨミ集計 (上位社抽出用)
    const companyYomiMap = new Map();
    inProgressSelectionsInQ.forEach(s => {
      const compId = s.companyId;
      if (!compId) return;
      const current = companyYomiMap.get(compId) || {
        companyId: compId,
        companyName: s.companyName,
        totalYomi: 0,
        selectionCount: 0
      };
      current.totalYomi += normalizeYomi(s.yomi);
      current.selectionCount += 1;
      companyYomiMap.set(compId, current);
    });

    const topCompanyYomiList = Array.from(companyYomiMap.values())
      .map(item => ({ ...item, totalYomi: Math.round(item.totalYomi * 100) / 100 }))
      .sort((a, b) => b.totalYomi - a.totalYomi)
      .slice(0, 5);

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 画面ヘッダー & フィルターコントロール (指示書 3, 8, 21項) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">全体選考・ヨミダッシュボード</h2>
              <span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-lg border border-indigo-200 text-xs">${scopeBadgeLabel}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">※初期表示は「チーム全体」です。担当者フィルターで特定コンサルタントの状況へ切り替え可能です。</p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <!-- 年度選択 (指示書 4, 22項) -->
            <span class="font-bold text-slate-700">対象年度:</span>
            <select id="select-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${fyOptions.map(fy => `<option value="${fy}" ${selectedFiscalYear === fy ? 'selected' : ''}>${fy}年度</option>`).join('')}
            </select>

            <!-- Q選択 -->
            <span class="font-bold text-slate-700 ml-1">四半期 (Q):</span>
            <select id="select-fiscal-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900 focus:outline-none focus:border-indigo-600">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

            <!-- 担当者フィルター (初期値: チーム全体: 指示書 8項) -->
            <span class="font-bold text-slate-700 ml-1">担当者:</span>
            <select id="select-dashboard-consultant" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              <option value="ALL" ${selectedConsultantId === 'ALL' ? 'selected' : ''}>チーム全体 (全CA/RA)</option>
              ${consultants.map(c => {
                const cRoleLabel = c.roles && Array.isArray(c.roles) && c.roles.length > 0 ? c.roles.join('・') : (c.roleType || 'CA');
                return `<option value="${c.consultantId}" ${selectedConsultantId === c.consultantId ? 'selected' : ''}>${c.name} (${cRoleLabel})</option>`;
              }).join('')}
            </select>

            ${selectedConsultantId !== 'ALL' ? `
              <div class="bg-slate-100 p-1 rounded-lg flex items-center border border-slate-200 font-bold ml-1">
                <button id="btn-dashboard-role-ca" class="px-2.5 py-0.5 rounded transition ${activeRoleType === 'CA' ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">CA</button>
                <button id="btn-dashboard-role-ra" class="px-2.5 py-0.5 rounded transition ${activeRoleType === 'RA' ? 'bg-purple-600 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}">RA</button>
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 上段集計カード: Q目標・実績・進行中ヨミ (指示書 4, 5, 6, 7項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <!-- 1. Q目標 -->
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm space-y-1">
            <div class="text-xs text-slate-400 font-semibold">${selectedConsultantId === 'ALL' ? 'チームQ目標 (CA合計)' : 'Q目標'}</div>
            <div class="text-2xl font-black mt-1">
              ${targetGoal === null ? '<span class="text-sm text-slate-400 font-bold">対象外</span>' : `${targetGoal}<span class="text-xs font-normal text-slate-400 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-slate-400">${selectedConsultantId === 'ALL' ? '全CA目標の合算値' : (activeRoleType === 'RA' ? 'RA表示時は対象外' : '個人Q目標')}</div>
          </div>

          <!-- 2. Q承諾実績 -->
          <div class="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm space-y-1">
            <div class="text-xs text-emerald-800 font-extrabold">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${qAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
            <div class="text-[10px] text-emerald-700">期間内の確定承諾数</div>
          </div>

          <!-- 3. Q進行中ヨミ -->
          <div class="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-sm space-y-1">
            <div class="text-xs text-indigo-800 font-extrabold">Q進行中ヨミ合計</div>
            <div class="text-2xl font-black text-indigo-600 mt-1">${qInProgressYomi}<span class="text-xs font-normal text-indigo-700 ml-1">件</span></div>
            <div class="text-[10px] text-indigo-700">着地見込みヨミの加算値</div>
          </div>

          <!-- 4. Q着地見込み -->
          <div class="bg-purple-50/70 p-4 rounded-xl border border-purple-200 shadow-sm space-y-1">
            <div class="text-xs text-purple-800 font-extrabold">Q着地見込み</div>
            <div class="text-2xl font-black text-purple-600 mt-1">${qForecastTotal}<span class="text-xs font-normal text-purple-700 ml-1">件</span></div>
            <div class="text-[10px] text-purple-700">承諾実績 ＋ 進行中ヨミ</div>
          </div>

          <!-- 5. Q目標不足ヨミ -->
          <div class="bg-rose-50/70 p-4 rounded-xl border border-rose-200 shadow-sm space-y-1">
            <div class="text-xs text-rose-800 font-extrabold">Q目標不足ヨミ</div>
            <div class="text-2xl font-black text-rose-600 mt-1">
              ${targetGoal === null ? '<span class="text-sm text-rose-400 font-bold">-</span>' : `${qShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-rose-700">目標との差分Gap</div>
          </div>

          <!-- 6. Q見込み達成率 -->
          <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm space-y-1">
            <div class="text-xs text-amber-800 font-extrabold">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">
              ${targetGoal === null ? '<span class="text-sm text-amber-400 font-bold">-</span>' : `${qAchievementRate}%`}
            </div>
            <div class="text-[10px] text-amber-700">着地見込み ÷ 目標</div>
          </div>
        </div>

        <!-- 担当案件一覧テーブル (指示書 4, 20項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">
              対象Q 進行案件一覧 (${inProgressSelectionsInQ.length}件)
            </h3>
            <span class="text-xs text-slate-500 font-semibold">ヨミ合計: <strong class="text-indigo-600 text-sm font-black">${qInProgressYomi}</strong> 件</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">企業名</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">担当CA</th>
                  <th class="px-3 py-3">担当RA</th>
                  <th class="px-3 py-3">選考フェーズ</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${inProgressSelectionsInQ.length === 0 ? `
                  <tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">対象Qに着地見込みの選考案件がありません。</td></tr>
                ` : inProgressSelectionsInQ.map(s => {
                  const comp = companiesMap.get(s.companyId);
                  const job = jobsMap.get(s.jobId);
                  const caCons = consultantsMap.get(s.caId || s.caConsultantId);
                  const raCons = consultantsMap.get(s.raId || s.raConsultantId);
                  const normalizedYomiVal = normalizeYomi(s.yomi);
                  const percentStr = Math.round(normalizedYomiVal * 100) + '%';

                  return `
                  <tr class="hover:bg-indigo-50/40 transition">
                    <td class="px-4 py-2.5 font-bold text-slate-900">
                      <div>${s.candidateName}</div>
                      <div class="text-[10px] text-indigo-600 font-semibold">次行動: ${s.nextAction || '要確認'}</div>
                    </td>
                    <td class="px-4 py-2.5 font-medium text-slate-800">${comp ? comp.name : s.companyName}</td>
                    <td class="px-4 py-2.5 text-slate-600">${job ? (job.title || job.jobName) : s.jobName}</td>
                    <td class="px-3 py-2.5 font-semibold text-slate-700">${caCons ? caCons.name : (s.caName || '-')}</td>
                    <td class="px-3 py-2.5 font-semibold text-slate-700">${raCons ? raCons.name : (s.raName || '-')}</td>
                    <td class="px-3 py-2.5 font-semibold text-indigo-700">
                      <div>${s.phase}</div>
                      <span class="text-[9px] font-bold ${s.currentBall === 'CA' ? 'bg-indigo-100 text-indigo-800' : (s.currentBall === 'RA' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800')} px-1.5 py-0.2 rounded">ボール: ${s.currentBall || 'CA'}</span>
                    </td>
                    <td class="px-3 py-2.5 text-right font-black ${normalizedYomiVal > 0 ? 'text-indigo-600' : 'text-slate-400'}">${percentStr}</td>
                    <td class="px-3 py-2.5 font-mono text-slate-700 font-bold">${s.expectedCompletionMonth || s.actionDeadline || '-'}</td>
                    <td class="px-3 py-2.5 text-center">
                      <button class="btn-detail px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded text-xs transition shadow-2xs" data-id="${s.selectionId}">詳細</button>
                    </td>
                  </tr>
                  `;
                }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;

    // イベントリスナーの設定
    container.querySelector('#select-fiscal-year')?.addEventListener('change', (e) => {
      selectedFiscalYear = parseInt(e.target.value, 10);
      saveDashboardState({ fiscalYear: selectedFiscalYear });
      updateView();
    });

    container.querySelector('#select-fiscal-q')?.addEventListener('change', (e) => {
      selectedQuarter = e.target.value;
      saveDashboardState({ quarter: selectedQuarter });
      updateView();
    });

    container.querySelector('#select-dashboard-consultant')?.addEventListener('change', (e) => {
      selectedConsultantId = e.target.value;
      saveDashboardState({ consultantId: selectedConsultantId });
      updateView();
    });

    container.querySelector('#btn-dashboard-role-ca')?.addEventListener('click', () => {
      activeRoleType = 'CA';
      saveDashboardState({ roleType: 'CA' });
      updateView();
    });

    container.querySelector('#btn-dashboard-role-ra')?.addEventListener('click', () => {
      activeRoleType = 'RA';
      saveDashboardState({ roleType: 'RA' });
      updateView();
    });

    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        if (onOpenDetail) {
          onOpenDetail(selId);
        } else if (onNavigateToSelections) {
          onNavigateToSelections(selId);
        }
      });
    });
  }

  updateView();
}

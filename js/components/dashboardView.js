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
  
  // 初期表示は必ず「チーム全体」とする (指示書 3, 8, 10, 5項)
  let selectedConsultantId = savedState.consultantId !== undefined ? savedState.consultantId : 'ALL';
  let activeRoleType = savedState.roleType !== undefined ? savedState.roleType : 'CA'; // 'CA' | 'RA'
  let searchKeyword = savedState.searchKeyword || '';
  let activeBallFilter = savedState.activeBallFilter || 'ALL'; // 'ALL' | 'CA' | 'RA' | 'OVERDUE' | 'COMPANY'

  function updateView(options = {}) {
    const savedScrollY = options.preserveScroll !== false ? (window.scrollY || document.documentElement.scrollTop) : 0;

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

    // 担当者フィルターに基づく案件フィルタリング (指示書 6, 7項: ID最優先)
    const filteredSelections = selections.filter(s => {
      if (s.isArchived) return false;
      if (selectedConsultantId === 'ALL') return true;

      return activeRoleType === 'CA'
        ? (s.caId === selectedConsultantId || s.caConsultantId === selectedConsultantId)
        : (s.raId === selectedConsultantId || s.raConsultantId === selectedConsultantId);
    });

    // 「本日の対応」サマリー用件数算出 (Step 9項)
    const caBallCount = filteredSelections.filter(s => s.currentBall === 'CA' && s.phase !== '選考終了' && s.phase !== '内定辞退').length;
    const raBallCount = filteredSelections.filter(s => s.currentBall === 'RA' && s.phase !== '選考終了' && s.phase !== '内定辞退').length;
    const overdueCount = filteredSelections.filter(s => {
      if (s.phase === '選考終了' || s.phase === '内定辞退') return false;
      const comp = companiesMap.get(s.companyId);
      return store.getSelectionAlerts ? store.getSelectionAlerts(s, comp).isOverdue : false;
    }).length;
    const waitingCompanyCount = filteredSelections.filter(s => (s.currentBall === 'COMPANY' || s.companyActionStatus === '企業回答待ち') && s.phase !== '選考終了' && s.phase !== '内定辞退').length;

    // 1. Q承諾実績 (対象Q期間内に内定承諾・入社決定となった件数)
    const acceptedSelections = filteredSelections.filter(s => {
      if (s.phase !== '内定承諾' && s.phase !== '入社予定') return false;
      const acceptDateStr = s.selectionEndDate || s.phaseUpdatedAt || s.updatedAt;
      if (!acceptDateStr) return false;
      const aDate = new Date(acceptDateStr);
      return aDate >= startDate && aDate <= endDate;
    });
    const qAcceptedCount = acceptedSelections.length;

    // 2. Q進行中ヨミ (対象Qに着地見込みの進行中案件)
    const inProgressSelectionsInQ = filteredSelections.filter(s => {
      if (['選考終了', '内定辞退', '内定承諾', '入社予定', '書類見送り', '面接見送り', '候補者辞退', '他社決定'].includes(s.phase)) {
        return false;
      }
      return isSelectionInQuarter(s, selectedFiscalYear, selectedQuarter);
    });

    // ヨミの正規化合計計算
    const rawYomiSum = inProgressSelectionsInQ.reduce((sum, s) => sum + normalizeYomi(s.yomi), 0);
    const qInProgressYomi = Math.round(rawYomiSum * 100) / 100;

    // 3. 着地見込み, 4. 不足ヨミ, 5. 達成率 (Step 7項: RA時は「対象外」)
    const isRaFilterMode = selectedConsultantId !== 'ALL' && activeRoleType === 'RA';
    const targetGoal = isRaFilterMode ? null : (selectedConsultantId === 'ALL' ? teamQTarget : (qTargetMap.get(selectedConsultantId) || 4));

    const qForecastTotal = Math.round((qAcceptedCount + qInProgressYomi) * 100) / 100;
    const qShortage = targetGoal !== null ? Math.max(0, Math.round((targetGoal - qForecastTotal) * 100) / 100) : 0;
    const qAchievementRate = (targetGoal !== null && targetGoal > 0) ? Math.round((qForecastTotal / targetGoal) * 1000) / 10 : 0;

    // キーワード検索 ＆ ボール絞り込み適用 (Step 10, 13, 18, 19項)
    let displayTableSelections = inProgressSelectionsInQ.filter(s => {
      if (activeBallFilter === 'CA' && s.currentBall !== 'CA') return false;
      if (activeBallFilter === 'RA' && s.currentBall !== 'RA') return false;
      if (activeBallFilter === 'COMPANY' && s.currentBall !== 'COMPANY' && s.companyActionStatus !== '企業回答待ち') return false;
      if (activeBallFilter === 'OVERDUE') {
        const comp = companiesMap.get(s.companyId);
        if (!store.getSelectionAlerts || !store.getSelectionAlerts(s, comp).isOverdue) return false;
      }

      if (searchKeyword) {
        const kw = searchKeyword.toLowerCase();
        const candName = (s.candidateName || '').toLowerCase();
        const compName = (s.companyName || '').toLowerCase();
        const jobName = (s.jobName || '').toLowerCase();
        const caName = (s.caName || '').toLowerCase();
        const raName = (s.raName || '').toLowerCase();

        if (!candName.includes(kw) && !compName.includes(kw) && !jobName.includes(kw) && !caName.includes(kw) && !raName.includes(kw)) {
          return false;
        }
      }

      return true;
    });

    let scopeBadgeLabel = '集計対象: チーム全体';
    if (selectedConsultantId !== 'ALL') {
      const selectedCons = consultantsMap.get(selectedConsultantId);
      const cName = selectedCons ? selectedCons.name : '担当者';
      scopeBadgeLabel = `集計対象: ${cName} (${activeRoleType}担当)`;
    }

    const baseFY = currentInitialFQ.fiscalYear;
    const fyOptions = [baseFY - 1, baseFY, baseFY + 1, baseFY + 2];

    container.innerHTML = `
      <div class="space-y-6">
        <!-- 画面ヘッダー & フィルターコントロール (指示書 Step 5) -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">全体選考・ヨミダッシュボード</h2>
              <span class="px-2.5 py-1 bg-indigo-50 text-indigo-700 font-bold rounded-lg border border-indigo-200 text-xs">${scopeBadgeLabel}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">※本システムのホーム操作画面です。各種集計とワンクリック操作・検索を完備しています。</p>
          </div>

          <div class="flex flex-wrap items-center gap-2 text-xs">
            <span class="font-bold text-slate-700">対象年度:</span>
            <select id="select-fiscal-year" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-slate-800 focus:outline-none focus:border-indigo-600">
              ${fyOptions.map(fy => `<option value="${fy}" ${selectedFiscalYear === fy ? 'selected' : ''}>${fy}年度</option>`).join('')}
            </select>

            <span class="font-bold text-slate-700 ml-1">四半期 (Q):</span>
            <select id="select-fiscal-q" class="bg-slate-50 border border-slate-300 font-bold rounded px-2.5 py-1.5 text-indigo-900 focus:outline-none focus:border-indigo-600">
              <option value="Q1" ${selectedQuarter === 'Q1' ? 'selected' : ''}>1Q (10-12月)</option>
              <option value="Q2" ${selectedQuarter === 'Q2' ? 'selected' : ''}>2Q (1-3月)</option>
              <option value="Q3" ${selectedQuarter === 'Q3' ? 'selected' : ''}>3Q (4-6月)</option>
              <option value="Q4" ${selectedQuarter === 'Q4' ? 'selected' : ''}>4Q (7-9月)</option>
              <option value="ALL" ${selectedQuarter === 'ALL' ? 'selected' : ''}>年度通期</option>
            </select>

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

        <!-- 本日の対応 サマリーエリア (Step 9項) -->
        <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'CA' ? 'bg-indigo-600 text-white shadow-md border-indigo-700' : 'bg-indigo-50/70 border-indigo-200 hover:bg-indigo-100 text-indigo-950'}" id="dash-card-ca-ball">
            <div class="text-xs font-extrabold opacity-90">CA対応</div>
            <div class="text-2xl font-black mt-1">${caBallCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: CA</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'RA' ? 'bg-sky-600 text-white shadow-md border-sky-700' : 'bg-sky-50/70 border-sky-200 hover:bg-sky-100 text-sky-950'}" id="dash-card-ra-ball">
            <div class="text-xs font-extrabold opacity-90">RA対応</div>
            <div class="text-2xl font-black mt-1">${raBallCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: RA</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'OVERDUE' ? 'bg-rose-600 text-white shadow-md border-rose-700' : 'bg-rose-50/70 border-rose-200 hover:bg-rose-100 text-rose-950'}" id="dash-card-overdue">
            <div class="text-xs font-extrabold opacity-90">期限超過</div>
            <div class="text-2xl font-black mt-1">${overdueCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">要緊急対応</div>
          </div>
          <div class="p-3.5 rounded-xl border transition cursor-pointer ${activeBallFilter === 'COMPANY' ? 'bg-amber-600 text-white shadow-md border-amber-700' : 'bg-amber-50/70 border-amber-200 hover:bg-amber-100 text-amber-950'}" id="dash-card-company-waiting">
            <div class="text-xs font-extrabold opacity-90">企業回答待ち</div>
            <div class="text-2xl font-black mt-1">${waitingCompanyCount}<span class="text-xs font-normal opacity-80 ml-1">件</span></div>
            <div class="text-[10px] opacity-75 mt-0.5">ボール: 企業</div>
          </div>
        </div>

        <!-- 6大集計数値カード (Step 5, 6, 7項) -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <!-- 1. Q目標 -->
          <div class="bg-slate-900 text-white p-4 rounded-xl border border-slate-800 shadow-sm space-y-1">
            <div class="text-xs text-slate-400 font-semibold">${isRaFilterMode ? 'Q目標' : (selectedConsultantId === 'ALL' ? 'チームQ目標 (CA合計)' : '個人Q目標')}</div>
            <div class="text-2xl font-black mt-1">
              ${targetGoal === null ? '<span class="text-sm text-amber-400 font-bold">対象外</span>' : `${targetGoal}<span class="text-xs font-normal text-slate-400 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-slate-400">${isRaFilterMode ? 'RA表示時は対象外' : (selectedConsultantId === 'ALL' ? '全CA目標の合算' : '個人Q目標')}</div>
          </div>

          <!-- 2. Q承諾実績 -->
          <div class="bg-emerald-50/70 p-4 rounded-xl border border-emerald-200 shadow-sm space-y-1">
            <div class="text-xs text-emerald-800 font-extrabold">Q承諾実績</div>
            <div class="text-2xl font-black text-emerald-600 mt-1">${qAcceptedCount}<span class="text-xs font-normal text-emerald-700 ml-1">件</span></div>
            <div class="text-[10px] text-emerald-700">期間内の確定承諾数</div>
          </div>

          <!-- 3. Q進行中ヨミ -->
          <div class="bg-indigo-50/70 p-4 rounded-xl border border-indigo-200 shadow-sm space-y-1">
            <div class="text-xs text-indigo-800 font-extrabold">Q進行中ヨミ</div>
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
              ${targetGoal === null ? '<span class="text-sm text-rose-400 font-bold">対象外</span>' : `${qShortage}<span class="text-xs font-normal text-rose-700 ml-1">件</span>`}
            </div>
            <div class="text-[10px] text-rose-700">${targetGoal === null ? 'RA表示時は対象外' : '目標との差分Gap'}</div>
          </div>

          <!-- 6. Q見込み達成率 -->
          <div class="bg-amber-50/70 p-4 rounded-xl border border-amber-200 shadow-sm space-y-1">
            <div class="text-xs text-amber-800 font-extrabold">Q見込み達成率</div>
            <div class="text-2xl font-black text-amber-600 mt-1">
              ${targetGoal === null ? '<span class="text-sm text-amber-400 font-bold">対象外</span>' : `${qAchievementRate}%`}
            </div>
            <div class="text-[10px] text-amber-700">${targetGoal === null ? 'RA表示時は対象外' : '着地見込み ÷ 目標'}</div>
          </div>
        </div>

        <!-- 担当案件一覧テーブル & リアルタイム検索バー (Step 10, 11, 13, 18, 19項) -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 class="font-bold text-slate-800 text-sm flex items-center gap-2">
                <span>対象Q 進行案件一覧 (${displayTableSelections.length}件)</span>
                ${activeBallFilter !== 'ALL' ? `<span class="px-2 py-0.5 bg-indigo-100 text-indigo-800 rounded-full text-[10px]">絞り込み: ${activeBallFilter}</span>` : ''}
              </h3>
              <p class="text-xs text-slate-500 mt-0.5">※次行動・ボール確認およびワンクリックでのバトンタッチが可能です。</p>
            </div>

            <!-- 検索バー (Step 19項) -->
            <div class="flex items-center space-x-2">
              <input type="text" id="input-dashboard-search" value="${searchKeyword}" placeholder="候補者名 / 企業名 / 求人 / CA / RA で検索..." class="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-xs text-slate-800 focus:outline-none focus:bg-white focus:border-indigo-600 min-w-[240px]">
              ${activeBallFilter !== 'ALL' ? `<button id="btn-reset-ball-filter" class="text-xs text-indigo-600 underline font-bold px-1">全件解除</button>` : ''}
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-900 text-slate-200 font-semibold border-b border-slate-800">
                <tr>
                  <th class="px-4 py-3">候補者名 / 次行動</th>
                  <th class="px-4 py-3">応募先企業</th>
                  <th class="px-4 py-3">求人・ポジション</th>
                  <th class="px-3 py-3">担当CA</th>
                  <th class="px-3 py-3">担当RA</th>
                  <th class="px-3 py-3">選考フェーズ / ボール</th>
                  <th class="px-3 py-3 text-right">ヨミ</th>
                  <th class="px-3 py-3">完了見込み月</th>
                  <th class="px-3 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${displayTableSelections.length === 0 ? `
                  <tr><td colspan="9" class="text-center py-8 text-slate-400 font-bold">条件に該当する進行案件がありません。</td></tr>
                ` : displayTableSelections.map(s => {
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
                        <div class="text-[10px] text-indigo-600 font-semibold mt-0.5">次行動: ${s.nextAction || '要確認'}</div>
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
                      <td class="px-3 py-2.5 text-right">
                        <div class="flex items-center justify-end space-x-1">
                          <button data-dash-ca-act="GOT_DATES" data-id="${s.selectionId}" class="px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded text-[10px] font-bold shadow-2xs">候補日取得</button>
                          <button data-dash-ca-act="ACCEPT_INTENT" data-id="${s.selectionId}" class="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] font-bold shadow-2xs">承諾意向</button>
                          <button class="btn-detail px-2.5 py-0.5 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded text-[10px] transition shadow-2xs" data-id="${s.selectionId}">詳細</button>
                        </div>
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

    container.querySelector('#input-dashboard-search')?.addEventListener('input', (e) => {
      searchKeyword = e.target.value;
      saveDashboardState({ searchKeyword });
      updateView();
    });

    // 「本日の対応」サマリーカードのクリックフィルタリング (Step 10, 13項)
    container.querySelector('#dash-card-ca-ball')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'CA' ? 'ALL' : 'CA';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-ra-ball')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'RA' ? 'ALL' : 'RA';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-overdue')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'OVERDUE' ? 'ALL' : 'OVERDUE';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#dash-card-company-waiting')?.addEventListener('click', () => {
      activeBallFilter = activeBallFilter === 'COMPANY' ? 'ALL' : 'COMPANY';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    container.querySelector('#btn-reset-ball-filter')?.addEventListener('click', () => {
      activeBallFilter = 'ALL';
      saveDashboardState({ activeBallFilter });
      updateView();
    });

    // ワンクリックバトンボタン (Step 11項)
    container.querySelectorAll('button[data-dash-ca-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        const selId = btn.getAttribute('data-id');
        const act = btn.getAttribute('data-dash-ca-act');
        store.handleCaAction(selId, act);
        updateView({ preserveScroll: true });
      });
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

    if (options.preserveScroll !== false && savedScrollY > 0) {
      setTimeout(() => {
        window.scrollTo({ top: savedScrollY, behavior: 'instant' });
      }, 0);
    }
  }

  updateView({ preserveScroll: false });
}

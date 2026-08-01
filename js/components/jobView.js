/**
 * 選考進捗・ヨミ管理システム - 求人・ポジション別画面コンポーネント
 */

import { store } from '../store.js';

export function renderJobView(container, { onOpenDetail }) {
  const jobs = store.getJobs();
  const companies = store.getCompanies();
  const selections = store.getSelections();
  const candidates = store.getCandidates();

  const companiesMap = new Map(companies.map(c => [c.companyId, c]));
  const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));

  let selectedJobId = jobs[0] ? jobs[0].jobId : '';

  function updateView() {
    const job = jobs.find(j => j.jobId === selectedJobId) || jobs[0];
    if (!job) {
      container.innerHTML = '<div class="p-8 text-center text-slate-400">求人マスタが登録されていません。</div>';
      return;
    }

    const company = companiesMap.get(job.companyId);
    const jobSelections = selections.filter(s => !s.isArchived && s.jobId === job.jobId);

    // 各フェーズ人数
    const recCount = jobSelections.length;
    const docCount = jobSelections.filter(s => s.phase === '書類選考' || s.phase === '推薦準備').length;
    const interviewCount = jobSelections.filter(s => s.phase === '一次面接' || s.phase === '二次面接').length;
    const finalCount = jobSelections.filter(s => s.phase === '最終面接').length;
    const offerCount = jobSelections.filter(s => s.phase === 'オファー面談・条件提示' || s.phase === '内定').length;
    const acceptedCount = jobSelections.filter(s => s.phase === '内定承諾' || s.phase === '入社予定').length;
    const endedCount = jobSelections.filter(s => s.phase === '選考終了').length;
    const totalYomi = jobSelections.reduce((sum, s) => sum + (s.phase !== '選考終了' ? Number(s.yomi || 0) : 0), 0);

    // 平均選考日数の計算 (推薦日〜現在または終了日)
    let totalDays = 0;
    let validCount = 0;
    const today = new Date();

    jobSelections.forEach(s => {
      if (s.recommendationDate) {
        const start = new Date(s.recommendationDate);
        const end = s.selectionEndDate ? new Date(s.selectionEndDate) : today;
        const diff = Math.max(1, Math.floor((end - start) / (1000 * 60 * 60 * 24)));
        totalDays += diff;
        validCount++;
      }
    });

    const avgDays = validCount > 0 ? Math.round(totalDays / validCount) : 0;

    container.innerHTML = `
      <div class="space-y-6">
        <!-- ヘッダー & 求人切り替え -->
        <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div class="flex items-center space-x-3">
              <h2 class="text-xl font-bold text-slate-800">${job.title}</h2>
              <span class="px-2.5 py-0.5 bg-slate-100 text-slate-700 border border-slate-300 rounded font-bold text-xs">${job.status}</span>
            </div>
            <p class="text-xs text-slate-500 mt-1">企業名: ${company ? company.name : '不明'} / 勤務地: ${job.location || '未定'} / 雇用形態: ${job.employmentType || '正社員'}</p>
          </div>

          <div class="flex items-center space-x-2 text-xs">
            <span class="text-slate-500 font-semibold">求人ポジション切替:</span>
            <select id="select-job-change" class="bg-slate-50 border border-slate-300 font-bold rounded px-3 py-2 text-slate-800 focus:outline-none">
              ${jobs.map(j => {
                const comp = companiesMap.get(j.companyId);
                return `<option value="${j.jobId}" ${j.jobId === job.jobId ? 'selected' : ''}>${j.title} (${comp ? comp.name : ''})</option>`;
              }).join('')}
            </select>
          </div>
        </div>

        <!-- 求人KPI -->
        <div class="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3 text-center text-xs">
          <div class="bg-white border border-slate-200 p-3 rounded-xl shadow-sm">
            <div class="text-slate-500 font-semibold">推薦総数</div>
            <div class="text-xl font-black text-slate-800 mt-1">${recCount}名</div>
          </div>
          <div class="bg-slate-50 border border-slate-200 p-3 rounded-xl shadow-sm">
            <div class="text-slate-600 font-semibold">書類選考中</div>
            <div class="text-xl font-black text-slate-700 mt-1">${docCount}名</div>
          </div>
          <div class="bg-blue-50 border border-blue-200 p-3 rounded-xl shadow-sm">
            <div class="text-blue-800 font-semibold">面接中</div>
            <div class="text-xl font-black text-blue-600 mt-1">${interviewCount}名</div>
          </div>
          <div class="bg-indigo-50 border border-indigo-200 p-3 rounded-xl shadow-sm">
            <div class="text-indigo-800 font-semibold">最終面接</div>
            <div class="text-xl font-black text-indigo-600 mt-1">${finalCount}名</div>
          </div>
          <div class="bg-purple-50 border border-purple-200 p-3 rounded-xl shadow-sm">
            <div class="text-purple-800 font-semibold">オファー・内定</div>
            <div class="text-xl font-black text-purple-600 mt-1">${offerCount}名</div>
          </div>
          <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-xl shadow-sm">
            <div class="text-emerald-800 font-semibold">内定承諾</div>
            <div class="text-xl font-black text-emerald-600 mt-1">${acceptedCount}名</div>
          </div>
          <div class="bg-rose-50 border border-rose-200 p-3 rounded-xl shadow-sm">
            <div class="text-rose-800 font-semibold">選考終了</div>
            <div class="text-xl font-black text-rose-600 mt-1">${endedCount}名</div>
          </div>
          <div class="bg-slate-900 text-white p-3 rounded-xl shadow-sm">
            <div class="text-slate-400 font-semibold">平均選考日数</div>
            <div class="text-xl font-black text-white mt-1">${avgDays}日</div>
          </div>
        </div>

        <!-- 候補者一覧 -->
        <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-3">
          <div class="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 class="font-bold text-slate-800 text-sm">この求人の選考中候補者一覧 (${jobSelections.length}名)</h3>
            <span class="text-xs text-indigo-700 font-bold">ヨミ合計: ${Math.round(totalYomi * 100) / 100}件</span>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full text-left text-xs">
              <thead class="bg-slate-50 text-slate-700 font-semibold border-b border-slate-200">
                <tr>
                  <th class="px-4 py-3">候補者名</th>
                  <th class="px-4 py-3">推薦日</th>
                  <th class="px-4 py-3">選考フェーズ</th>
                  <th class="px-4 py-3">進行状態</th>
                  <th class="px-4 py-3 text-right">ヨミ</th>
                  <th class="px-4 py-3">次回予定日</th>
                  <th class="px-3 py-3 text-center">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-slate-200">
                ${jobSelections.length === 0 ? `
                  <tr><td colspan="7" class="text-center py-8 text-slate-400">該当する選考案件がありません。</td></tr>
                ` : jobSelections.map(s => {
                  const cand = candidatesMap.get(s.candidateId);
                  return `
                    <tr class="hover:bg-slate-50 transition">
                      <td class="px-4 py-2.5 font-bold text-slate-900">${cand ? cand.name : ''}</td>
                      <td class="px-4 py-2.5 text-slate-500">${s.recommendationDate || '-'}</td>
                      <td class="px-4 py-2.5 font-bold text-indigo-700">${s.phase}</td>
                      <td class="px-4 py-2.5 text-slate-700">${s.progressStatus}</td>
                      <td class="px-4 py-2.5 text-right font-black text-indigo-600">${s.yomi * 100}%</td>
                      <td class="px-4 py-2.5 text-slate-600">${s.nextScheduleDate || '-'}</td>
                      <td class="px-3 py-2.5 text-center">
                        <button class="btn-detail px-2.5 py-1 bg-slate-100 hover:bg-indigo-600 hover:text-white rounded text-xs transition" data-id="${s.selectionId}">詳細</button>
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

    container.querySelector('#select-job-change')?.addEventListener('change', (e) => { selectedJobId = e.target.value; updateView(); });
    container.querySelectorAll('.btn-detail').forEach(btn => {
      btn.addEventListener('click', () => onOpenDetail(btn.getAttribute('data-id')));
    });
  }

  updateView();
}

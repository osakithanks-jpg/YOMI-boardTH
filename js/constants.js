/**
 * 選考進捗・ヨミ管理システム - 定数定義 (ホワイトボード5区分化 ＆ 本日のRA対応表示対応)
 */

export const ROLES = {
  ADMIN: 'admin',
  MEMBER: 'member'
};

export const CONSULTANT_ROLES = {
  CA: 'CA',
  RA: 'RA',
  ADMIN: 'ADMIN'
};

// 選考フェーズ (マスター定義)
export const PHASES = [
  '推薦準備',
  '書類選考',
  '一次面接',
  '二次面接',
  '三次面接',
  '最終面接',
  'オファー面談・条件提示',
  '内定',
  '内定承諾',
  '入社予定',
  '内定辞退',
  '選考終了'
];

// ホワイトボード専用 5区分フェーズグループ定義 (指示書 5, 6, 7項)
export const WHITEBOARD_5PHASES = [
  { groupCode: 'group_5', order: 50, label: '内定承諾', phases: ['内定承諾', '承諾', '入社予定', '入社日確定', '入社手続き中', '内定承諾後'] },
  { groupCode: 'group_4', order: 40, label: '内定', phases: ['内定', 'オファー面談', 'オファー面談・条件提示', '条件提示', '条件調整中', '内定回答待ち', '候補者回答待ち', 'オファー面談調整中'] },
  { groupCode: 'group_3', order: 30, label: '最終・二次', phases: ['二次面接', '二次選考', '三次面接', '三次選考', '最終面接', '最終選考', '役員面接', '二次面接以降', '最終面接前面談', '最終'] },
  { groupCode: 'group_2', order: 20, label: '一次', phases: ['一次面接', '一次選考', '一次面談', 'カジュアル面談', '一次面接日程調整', '一次面接結果待ち', '一次'] },
  { groupCode: 'group_1', order: 10, label: '書類選考', phases: ['推薦準備', '推薦済み', '書類提出済み', '書類選考', '書類確認中', '書類選考結果待ち', '企業推薦前確認', '書類'] }
];

// 互換性のための定義
export const KANBAN_VERTICAL_LEVELS = WHITEBOARD_5PHASES.map(g => ({
  levelId: g.groupCode,
  order: g.order,
  label: g.label,
  phases: g.phases
}));

// 緊急度区分 (指示書 17項)
export const URGENCY_LEVELS = {
  EXPIRED: { code: 'expired', label: '期限超過', borderClass: 'border-l-4 border-l-rose-600 border-rose-300', badgeClass: 'bg-rose-600 text-white font-black animate-pulse' },
  TODAY: { code: 'today', label: '本日対応', borderClass: 'border-l-4 border-l-orange-500 border-orange-300', badgeClass: 'bg-orange-500 text-white font-extrabold' },
  WAITING_REPLY: { code: 'waiting_reply', label: '企業回答待ち', borderClass: 'border-l-4 border-l-sky-400 border-slate-200', badgeClass: 'bg-sky-100 text-sky-800 border border-sky-300 font-bold' },
  CA_CHECK: { code: 'ca_check', label: 'CA確認待ち', borderClass: 'border-l-4 border-l-purple-400 border-slate-200', badgeClass: 'bg-purple-100 text-purple-800 border border-purple-300 font-bold' },
  WITHIN_3DAYS: { code: 'within_3days', label: '3日以内', borderClass: 'border-l-4 border-l-amber-400 border-amber-200', badgeClass: 'bg-amber-100 text-amber-900 border border-amber-300 font-bold' },
  NONE: { code: 'none', label: '対応不要', borderClass: 'border-l-2 border-l-slate-300 border-slate-200', badgeClass: 'bg-slate-100 text-slate-600 font-normal' },
  DECLINED: { code: 'declined', label: '内定辞退', borderClass: 'border-l-4 border-l-slate-400 border-slate-300 bg-slate-200/80', badgeClass: 'bg-slate-500 text-white font-extrabold' }
};

// 対応先 (指示書 16項)
export const NEXT_ACTION_TARGETS = [
  { code: 'company', label: '企業', badgeClass: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  { code: 'ca', label: 'CA', badgeClass: 'bg-purple-100 text-purple-800 border-purple-200' },
  { code: 'internal', label: '社内', badgeClass: 'bg-slate-100 text-slate-800 border-slate-200' },
  { code: 'none', label: '対応不要', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200' }
];

// 選考終了理由
export const END_REASONS = [
  '書類見送り',
  '一次面接見送り',
  '二次面接見送り',
  '最終面接見送り',
  '候補者辞退',
  '内定辞退',
  '他社決定',
  '求人クローズ',
  '企業都合終了',
  'その他'
];

// エントリー経路
export const ENTRY_SOURCES = [
  { code: 'BIZREACH', label: 'ビズ' },
  { code: 'MIDDLE', label: 'ミドル' },
  { code: 'AMBI', label: 'AMBI' },
  { code: 'RDS', label: 'RDS' },
  { code: 'DB', label: 'DB' },
  { code: 'IX', label: 'IX' },
  { code: 'MAPS', label: 'Maps' },
  { code: 'INDEED', label: 'Indeed' },
  { code: 'PASS_UP', label: 'パスアップ' },
  { code: 'OTHER', label: 'その他' }
];

export const PROGRESS_STATUSES = [
  '未対応',
  '推薦済み・回答待ち',
  '日程調整中',
  '日程確定',
  '実施済み・結果待ち',
  '条件提示中',
  '承諾完了',
  '不通過',
  '候補者辞退',
  '企業都合終了',
  '完了'
];

export const YOMI_OPTIONS = [
  { value: 1.0, label: '100% (確定)' },
  { value: 0.75, label: '75% (極高)' },
  { value: 0.5, label: '50% (五分)' },
  { value: 0.25, label: '25% (チャレンジ)' },
  { value: 0, label: '0% (見込みなし/終了)' }
];

export const COMPANY_RANKS = ['SS', 'S', 'A', 'B'];

export const COMPANY_RANK_BADGES = {
  'SS': { label: 'ランク: SS (最重要)', badgeClass: 'bg-rose-100 text-rose-900 border-rose-300 font-black' },
  'S':  { label: 'ランク: S (重点)', badgeClass: 'bg-amber-100 text-amber-900 border-amber-300 font-extrabold' },
  'A':  { label: 'ランク: A (通常)', badgeClass: 'bg-blue-100 text-blue-900 border-blue-300 font-bold' },
  'B':  { label: 'ランク: B (経過観察)', badgeClass: 'bg-slate-100 text-slate-800 border-slate-300 font-semibold' }
};

export const COMPANY_ACTION_TYPES = [
  '推薦後の回答確認',
  '面接調整の依頼・確認',
  '面接結果の確認',
  '内定条件・オファー回答の確認',
  '選考進捗の一括確認',
  'その他'
];

export const COMPANY_ACTION_STATUSES = [
  '未対応',
  '連絡済み',
  '回答待ち',
  '催促中',
  '完了'
];

export const JOB_STATUSES = [
  '募集中',
  '一時停止',
  '募集終了'
];

export const INITIAL_CONSULTANTS = [
  { consultantId: 'c1', name: '佐藤 健太', email: 'sato@thanks-partners.com', role: 'admin', roleType: 'ADMIN', status: 'active', displayOrder: 1, isArchived: false, isDemo: true },
  { consultantId: 'c2', name: '田中 美咲', email: 'tanaka@thanks-partners.com', role: 'member', roleType: 'CA', status: 'active', displayOrder: 2, isArchived: false, isDemo: true },
  { consultantId: 'c3', name: '鈴木 拓也', email: 'suzuki@thanks-partners.com', role: 'member', roleType: 'RA', status: 'active', displayOrder: 3, isArchived: false, isDemo: true },
  { consultantId: 'c4', name: '高橋 優花', email: 'takahashi@thanks-partners.com', role: 'member', roleType: 'CA', status: 'active', displayOrder: 4, isArchived: false, isDemo: true }
];

export const INITIAL_COMPANIES = [
  { companyId: 'comp1', name: '株式会社テクノロジーパートナーズ', rank: 'SS', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 3, contactPerson: '山田 太郎', contactName: '山田 太郎', contactEmail: 'yamada@tech-partners.co.jp', isArchived: false, isDemo: true, createdBySeed: true },
  { companyId: 'comp2', name: 'グローバルソリューションズ株式会社', rank: 'S', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 7, contactPerson: '佐藤 二郎', contactName: '佐藤 二郎', contactEmail: 'sato@global-sol.co.jp', isArchived: false, isDemo: true, createdBySeed: true },
  { companyId: 'comp3', name: 'イノベーション・システムズ', rank: 'A', primaryRaId: 'c3', primaryRaName: '鈴木 拓也', raConsultantId: 'c3', checkIntervalDays: 14, contactPerson: '高橋 三郎', contactName: '高橋 三郎', contactEmail: '', isArchived: false, isDemo: true, createdBySeed: true }
];

export const INITIAL_JOBS = [
  { jobId: 'job1', companyId: 'comp1', companyName: '株式会社テクノロジーパートナーズ', title: 'シニアフロントエンドエンジニア', location: '東京都千代田区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job2', companyId: 'comp1', companyName: '株式会社テクノロジーパートナーズ', title: 'バックエンドエンジニア (Go/Python)', location: '東京都千代田区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job3', companyId: 'comp2', companyName: 'グローバルソリューションズ株式会社', title: 'ITコンサルタント', location: '東京都港区', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true },
  { jobId: 'job4', companyId: 'comp3', companyName: 'イノベーション・システムズ', title: 'インフラエンジニア (AWS/K8s)', location: 'リモート可', status: '募集中', raId: 'c3', raConsultantId: 'c3', isArchived: false, isDemo: true, createdBySeed: true }
];

export const INITIAL_CANDIDATES = [
  { candidateId: 'cand1', name: '山田 太郎', kana: 'ヤマダ タロウ', caId: 'c2', caConsultantId: 'c2', caName: '田中 美咲', activityStatus: '選考中', entrySource: 'BIZREACH', entrySourceDetail: '', internalManagementNumber: 'CD-2026-001', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand2', name: '佐藤 花子', kana: 'サトウ ハナコ', caId: 'c2', caConsultantId: 'c2', caName: '田中 美咲', activityStatus: '選考中', entrySource: 'PASS_UP', entrySourceDetail: '若山さんスカウト', internalManagementNumber: 'CD-2026-002', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand3', name: '鈴木 一郎', kana: 'スズキ イチロウ', caId: 'c4', caConsultantId: 'c4', caName: '高橋 優花', activityStatus: '選考中', entrySource: 'AMBI', entrySourceDetail: '', internalManagementNumber: 'CD-2026-003', isArchived: false, isDemo: true, createdBySeed: true },
  { candidateId: 'cand4', name: '高橋 健二', kana: 'タカハシ ケンジ', caId: 'c4', caConsultantId: 'c4', caName: '高橋 優花', activityStatus: '選考中', entrySource: 'RDS', entrySourceDetail: '', internalManagementNumber: 'CD-2026-004', isArchived: false, isDemo: true, createdBySeed: true }
];

export const INITIAL_SELECTIONS = [
  {
    selectionId: 'sel1',
    candidateId: 'cand1',
    candidateName: '山田 太郎',
    companyId: 'comp1',
    companyName: '株式会社テクノロジーパートナーズ',
    jobId: 'job1',
    jobName: 'シニアフロントエンドエンジニア',
    caId: 'c2',
    caConsultantId: 'c2',
    caName: '田中 美咲',
    raId: 'c3',
    raConsultantId: 'c3',
    raName: '鈴木 拓也',
    entrySource: 'BIZREACH',
    entrySourceDetail: '',
    recommendationDate: '2026-07-01',
    phase: '一次面接',
    progressStatus: '実施済み・結果待ち',
    phaseUpdatedAt: '2026-07-20T10:00:00Z',
    nextScheduleDate: '2026-07-24',
    expectedCompletionMonth: '2026-08',
    yomi: 0.50,
    yomiReason: '一次面接の手応え良好',
    nextAction: '企業へ一次面接結果を確認',
    nextActionTarget: '企業',
    actionDeadline: '2026-07-26',
    companyActionType: '面接結果の確認',
    companyConfirmationItem: '一次面接結果のご確認をお願いいたします。',
    companyActionStatus: '未対応',
    internalMemo: '志望度高く、他社選考なし。',
    companySharedComment: '候補者様も結果を楽しみにしております。',
    isArchived: false,
    isDemo: true,
    createdBySeed: true
  },
  {
    selectionId: 'sel2',
    candidateId: 'cand2',
    candidateName: '佐藤 花子',
    companyId: 'comp2',
    companyName: 'グローバルソリューションズ株式会社',
    jobId: 'job3',
    jobName: 'ITコンサルタント',
    caId: 'c2',
    caConsultantId: 'c2',
    caName: '田中 美咲',
    raId: 'c3',
    raConsultantId: 'c3',
    raName: '鈴木 拓也',
    entrySource: 'PASS_UP',
    entrySourceDetail: '若山さんスカウト',
    recommendationDate: '2026-07-05',
    phase: '最終面接',
    progressStatus: '日程確定',
    phaseUpdatedAt: '2026-07-22T14:30:00Z',
    nextScheduleDate: '2026-07-29',
    expectedCompletionMonth: '2026-08',
    yomi: 0.75,
    yomiReason: '最終面接調整完了',
    nextAction: '企業へ選考進捗・評価観点を確認',
    nextActionTarget: '企業',
    actionDeadline: '2026-07-28',
    companyActionType: '選考進捗の一括確認',
    companyConfirmationItem: '最終面接時の評価観点について確認中',
    companyActionStatus: '回答待ち',
    internalMemo: '競合A社と最終面接重複あり。',
    companySharedComment: '面接設定ありがとうございます。',
    isArchived: false,
    isDemo: true,
    createdBySeed: true
  }
];

export const INITIAL_TARGETS = [];
export const INITIAL_Q_TARGETS = [
  { id: 'qt_c2_2025_Q4', consultantId: 'c2', fiscalYear: 2025, quarter: 'Q4', targetCount: 6, isDemo: true, createdBySeed: true },
  { id: 'qt_c4_2025_Q4', consultantId: 'c4', fiscalYear: 2025, quarter: 'Q4', targetCount: 5, isDemo: true, createdBySeed: true }
];

export const INITIAL_HISTORIES = [];
export const INITIAL_EMAIL_TEMPLATES = [
  { templateId: 't1', name: '標準・結果待ち催促', subject: '【選考進捗のご確認】貴社選考中候補者様の状況につきまして（サンクスパートナーズ）', body: 'いつも大変お世話になっております。', isDemo: true, createdBySeed: true }
];

export const INITIAL_COMPANY_COMMUNICATIONS = [];

/**
 * 既存データの互換性読み替えルール
 */
export function normalizeSelectionPhaseAndReason(selection) {
  let phase = selection.phase || '書類選考';
  let progressStatus = selection.progressStatus || '未対応';
  let endReason = selection.endReason || selection.endReasonDetail || '';

  if (phase === '内定後辞退' || progressStatus === '候補者辞退' && (phase === '内定' || phase === '内定承諾' || phase === 'オファー面談・条件提示')) {
    phase = '内定辞退';
    endReason = endReason || '内定辞退';
  } else if (progressStatus === '不通過' || phase === '書類不通過' || phase === '面接不通過') {
    if (phase === '書類選考' || phase === '書類不通過') {
      phase = '選考終了';
      endReason = endReason || '書類見送り';
    } else {
      phase = '選考終了';
      endReason = endReason || '面接見送り';
    }
  }

  return { phase, progressStatus, endReason };
}

/**
 * 選考進捗・ヨミ管理システム - データストア (マスタ編集・2段階削除・関連データ保護・監査ログ対応)
 */

import {
  INITIAL_CONSULTANTS,
  INITIAL_COMPANIES,
  INITIAL_JOBS,
  INITIAL_CANDIDATES,
  INITIAL_SELECTIONS,
  INITIAL_TARGETS,
  INITIAL_Q_TARGETS,
  INITIAL_HISTORIES,
  INITIAL_EMAIL_TEMPLATES,
  INITIAL_COMPANY_COMMUNICATIONS
} from './constants.js';
import { deriveCompanyActionFromSelection } from './utils/kanbanCalculations.js';
import { initFirebase, subscribeCollection, saveDocument, deleteDocument } from './firebase.js';

const STORAGE_KEYS = {
  CONSULTANTS: 'selection_app_consultants',
  COMPANIES: 'selection_app_companies',
  JOBS: 'selection_app_jobs',
  CANDIDATES: 'selection_app_candidates',
  SELECTIONS: 'selection_app_selections',
  TARGETS: 'selection_app_targets',
  Q_TARGETS: 'selection_app_q_targets',
  Q_TARGET_HISTORIES: 'selection_app_q_target_histories',
  HISTORIES: 'selection_app_histories',
  EMAIL_TEMPLATES: 'selection_app_email_templates',
  COMPANY_COMMUNICATIONS: 'selection_app_company_communications',
  COMPANY_SUBMISSIONS: 'selection_app_company_submissions',
  COMPANY_SUBMISSION_TEMPLATES: 'selection_app_company_submission_templates',
  MASTER_AUDIT_LOGS: 'selection_app_master_audit_logs',
  CURRENT_CONSULTANT: 'selection_app_current_consultant',
  SIMULATED_ROLE: 'selection_app_simulated_role',
  IS_INITIALIZED: 'selection_app_initialized'
};

class Store {
  constructor() {
    this.listeners = [];
    this.isLoading = true; // 指示書 1項: ローディング状態制御
    this.firestoreSyncedCollections = new Set();
    
    // 指示書 2, 3項: 業務データの唯一の正本はメモリ state (this.data)
    this.data = {
      selections: [],
      companies: [],
      jobs: [],
      candidates: [],
      consultants: INITIAL_CONSULTANTS,
      qTargets: [],
      histories: [],
      companyCommunications: []
    };

    this.initFirestoreSync();
  }

  initFirestoreSync() {
    // 指示書 3, 7項: Firestore サーバーからの監視と反映
    const collectionsToSync = [
      { name: 'selections', field: 'selections' },
      { name: 'companies', field: 'companies' },
      { name: 'jobs', field: 'jobs' },
      { name: 'candidates', field: 'candidates' },
      { name: 'consultants', field: 'consultants' },
      { name: 'qTargets', field: 'qTargets' },
      { name: 'histories', field: 'histories' },
      { name: 'companyCommunications', field: 'companyCommunications' }
    ];

    collectionsToSync.forEach(({ name, field }) => {
      subscribeCollection(
        name,
        (items) => {
          const validItems = Array.isArray(items) ? items : [];

          // 指示書 7項: SHARED_DATA_STATE_UPDATED ログ (Firestore 正本からの直接反映)
          console.log("SHARED_DATA_STATE_UPDATED", {
            source: "Firestore",
            collectionName: name,
            count: validItems.length,
            data: validItems
          });

          // 指示書 2, 3項: localStorage やキャッシュは使用せず、state にそのまま反映
          this.data[field] = validItems;

          this.firestoreSyncedCollections.add(name);
          
          // 初回データ受信が完了したらローディング解除 (指示書 1, 6項)
          if (this.firestoreSyncedCollections.size >= 4) {
            this.isLoading = false;
          }

          this.notify();
        },
        (error) => {
          console.warn(`Firestore sync error for ${name}:`, error);
          this.isLoading = false;
          this.notify();
        }
      );
    });
  }

  getItem(key) {
    // 指示書 2項: 業務データの表示元・正本として localStorage を使用することを完全禁止
    const keyToDataField = {
      [STORAGE_KEYS.SELECTIONS]: 'selections',
      [STORAGE_KEYS.COMPANIES]: 'companies',
      [STORAGE_KEYS.JOBS]: 'jobs',
      [STORAGE_KEYS.CANDIDATES]: 'candidates',
      [STORAGE_KEYS.CONSULTANTS]: 'consultants',
      [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
      [STORAGE_KEYS.HISTORIES]: 'histories',
      [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
    };

    const dataField = keyToDataField[key];
    if (dataField) {
      // 業務データはメモリ state (this.data) からのみ返却
      return this.data[dataField] || [];
    }

    // UI設定（現在選択コンサルタント・ロール設定など）のみ localStorage から取得可
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  ensureBackwardCompatibility() {
    const consultants = this.getItem(STORAGE_KEYS.CONSULTANTS);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);

    const consultantsMap = new Map(consultants.map(c => [c.consultantId, c]));

    let consUpdated = false;
    consultants.forEach(c => {
      if (!c.roleType) {
        c.roleType = c.role === 'admin' ? 'ADMIN' : (c.name.includes('鈴木') ? 'RA' : 'CA');
        consUpdated = true;
      }
      if (!c.roles || !Array.isArray(c.roles) || c.roles.length === 0) {
        if (c.roleType === 'ADMIN') {
          c.roles = ['ADMIN', 'CA', 'RA'];
        } else if (c.roleType === 'RA') {
          c.roles = ['RA'];
        } else {
          c.roles = ['CA'];
        }
        consUpdated = true;
      }
      if (c.status === undefined) {
        c.status = 'active';
        consUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        consUpdated = true;
      }
    });
    if (consUpdated) this.setItem(STORAGE_KEYS.CONSULTANTS, consultants);

    const demoCompanyIds = new Set(['comp1', 'comp2', 'comp3']);
    const demoJobIds = new Set(['job1', 'job2', 'job3', 'job4']);
    const demoCandIds = new Set(['cand1', 'cand2', 'cand3', 'cand4']);
    const demoSelIds = new Set(['sel1', 'sel2']);

    let compUpdated = false;
    const mapRank = (r) => {
      if (r === '最重要' || r === 'SS') return 'SS';
      if (r === '重点' || r === 'S') return 'S';
      if (r === '通常' || r === 'A') return 'A';
      if (r === '経過観察' || r === 'B') return 'B';
      return 'B';
    };

    companies.forEach(c => {
      if (c.isDemo === undefined && (demoCompanyIds.has(c.companyId) || c.createdBySeed)) {
        c.isDemo = true;
        c.createdBySeed = true;
        compUpdated = true;
      }
      const newRank = mapRank(c.rank);
      if (c.rank !== newRank) {
        c.rank = newRank;
        compUpdated = true;
      }
      if (!c.contactName && c.contactPerson) {
        c.contactName = c.contactPerson;
        compUpdated = true;
      }
      if (!c.contactPerson && c.contactName) {
        c.contactPerson = c.contactName;
        compUpdated = true;
      }
      if (!c.primaryRaId) {
        c.primaryRaId = c.raConsultantId || 'c3';
        c.primaryRaName = consultantsMap.get(c.primaryRaId)?.name || '鈴木 拓也';
        compUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        compUpdated = true;
      }
    });
    if (compUpdated) this.setItem(STORAGE_KEYS.COMPANIES, companies);

    let jobsUpdated = false;
    jobs.forEach(j => {
      if (j.isDemo === undefined && (demoJobIds.has(j.jobId) || j.createdBySeed)) {
        j.isDemo = true;
        j.createdBySeed = true;
        jobsUpdated = true;
      }
      if (!j.raId) {
        j.raId = j.raConsultantId || 'c3';
        jobsUpdated = true;
      }
      if (j.location === undefined) {
        j.location = '';
        jobsUpdated = true;
      }
      if (j.isArchived === undefined) {
        j.isArchived = false;
        jobsUpdated = true;
      }
    });
    if (jobsUpdated) this.setItem(STORAGE_KEYS.JOBS, jobs);

    let candUpdated = false;
    candidates.forEach(c => {
      if (c.isDemo === undefined && (demoCandIds.has(c.candidateId) || c.createdBySeed)) {
        c.isDemo = true;
        c.createdBySeed = true;
        candUpdated = true;
      }
      if (c.isArchived === undefined) {
        c.isArchived = false;
        candUpdated = true;
      }
    });
    let selUpdated = false;
    const companiesMap = new Map(companies.map(c => [c.companyId, c]));
    const candidatesMap = new Map(candidates.map(c => [c.candidateId, c]));
    const jobsMap = new Map(jobs.map(j => [j.jobId, j]));

    selections.forEach(s => {
      if (s.isDemo === undefined && (demoSelIds.has(s.selectionId) || s.createdBySeed)) {
        s.isDemo = true;
        s.createdBySeed = true;
        selUpdated = true;
      }
      const cand = candidatesMap.get(s.candidateId);
      const comp = companiesMap.get(s.companyId);
      const job = jobsMap.get(s.jobId);

      if (s.entrySource === undefined) {
        s.entrySource = 'UNSET';
        s.entrySourceDetail = '';
        selUpdated = true;
      }
      if (!s.caId) {
        s.caId = s.caConsultantId || (cand ? cand.caId : 'c2');
        s.caName = consultantsMap.get(s.caId)?.name || s.caName || '-';
        selUpdated = true;
      }
      if (!s.raId) {
        s.raId = s.raConsultantId || (job ? job.raId : (comp ? comp.primaryRaId : 'c3'));
        s.raName = consultantsMap.get(s.raId)?.name || s.raName || '-';
        selUpdated = true;
      }
      if (s.isArchived === undefined) {
        s.isArchived = false;
        selUpdated = true;
      }
    });
    if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  getItem(key) {
    try {
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error(`Error reading ${key} from localStorage`, e);
      return [];
    }
  }

  setItem(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify(data));

      // キーから Firestore コレクション名へのマッピング (指示書 4, 7項)
      const keyToCollection = {
        [STORAGE_KEYS.SELECTIONS]: 'selections',
        [STORAGE_KEYS.COMPANIES]: 'companies',
        [STORAGE_KEYS.JOBS]: 'jobs',
        [STORAGE_KEYS.CANDIDATES]: 'candidates',
        [STORAGE_KEYS.CONSULTANTS]: 'consultants',
        [STORAGE_KEYS.Q_TARGETS]: 'qTargets',
        [STORAGE_KEYS.HISTORIES]: 'histories',
        [STORAGE_KEYS.COMPANY_COMMUNICATIONS]: 'companyCommunications'
      };

      const collectionName = keyToCollection[key];
      if (collectionName && Array.isArray(data)) {
        // Firestore ドキュメントの一括保存 (IDをキーとしてドキュメント化)
        data.forEach(item => {
          const docId = item.selectionId || item.companyId || item.jobId || item.candidateId || item.consultantId || item.id || item.historyId;
          if (docId) {
            saveDocument(collectionName, String(docId), item).catch(err => {
              console.warn(`Background Firestore save failed for ${collectionName}/${docId}:`, err);
            });
          }
        });
      }

      this.notify();
    } catch (e) {
      console.error(`Error writing ${key} to localStorage/Firestore`, e);
    }
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  notify() {
    this.listeners.forEach(l => l());
  }

  // --- 操作アカウント & 権限設定 ---
  getCurrentConsultant() {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CURRENT_CONSULTANT);
      return raw ? JSON.parse(raw) : INITIAL_CONSULTANTS[0];
    } catch (e) {
      return INITIAL_CONSULTANTS[0];
    }
  }

  setCurrentConsultant(consultantId) {
    const consultants = this.getConsultants(true);
    const target = consultants.find(c => c.consultantId === consultantId);
    if (target) {
      localStorage.setItem(STORAGE_KEYS.CURRENT_CONSULTANT, JSON.stringify(target));
      const role = (target.roleType === 'ADMIN' || target.role === 'admin') ? 'admin' : 'member';
      localStorage.setItem(STORAGE_KEYS.SIMULATED_ROLE, role);
      this.notify();
    }
  }

  setCurrentUser(consultantId) {
    this.setCurrentConsultant(consultantId);
  }

  getCurrentRole() {
    try {
      const simRole = localStorage.getItem(STORAGE_KEYS.SIMULATED_ROLE);
      if (simRole) return simRole;
      const current = this.getCurrentConsultant();
      return (current.roleType === 'ADMIN' || current.role === 'admin') ? 'admin' : 'member';
    } catch (e) {
      return 'admin';
    }
  }

  setCurrentRole(role) {
    try {
      localStorage.setItem(STORAGE_KEYS.SIMULATED_ROLE, role);
      this.notify();
    } catch (e) {}
  }

  isAdmin() {
    return this.getCurrentRole() === 'admin';
  }

  resetToDefaults() {
    localStorage.clear();
    sessionStorage.clear();
    this.initData();
    this.notify();
  }

  checkConsultantEmailDuplicate(email, excludeConsultantId = null) {
    const info = this.checkConsultantEmailDuplicateInfo(email, excludeConsultantId);
    return info.isDuplicate;
  }

  checkConsultantEmailDuplicateInfo(email, excludeConsultantId = null, inputName = '') {
    if (!email) return { isDuplicate: false, existingConsultant: null, isSameName: false };
    const normalized = email.trim().toLowerCase();
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);

    const existing = list.find(c => {
      if (excludeConsultantId && c.consultantId === excludeConsultantId) return false;
      return (c.email || '').trim().toLowerCase() === normalized;
    });

    if (!existing) {
      return { isDuplicate: false, existingConsultant: null, isSameName: false };
    }

    const trimmedInputName = inputName.trim().replace(/\s+/g, '');
    const trimmedExistingName = (existing.name || '').trim().replace(/\s+/g, '');
    const isSameName = !trimmedInputName || trimmedInputName === trimmedExistingName;

    return {
      isDuplicate: true,
      existingConsultant: existing,
      isSameName
    };
  }

  checkConsultantRoleInUse(consultantId, roleTypeToRemove) {
    if (!consultantId || !roleTypeToRemove) return 0;
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(s => !s.isArchived);

    if (roleTypeToRemove === 'CA') {
      return selections.filter(s => s.caId === consultantId || s.caConsultantId === consultantId).length;
    }
    if (roleTypeToRemove === 'RA') {
      return selections.filter(s => s.raId === consultantId || s.raConsultantId === consultantId).length;
    }
    return 0;
  }

  // --- Q目標管理メソッド (重要機能の完全復元) ---
  getQTargets(fiscalYear = 2025, quarter = 'Q4') {
    const list = this.getItem(STORAGE_KEYS.Q_TARGETS);
    if (quarter === 'ALL') {
      return list.filter(t => t.fiscalYear === parseInt(fiscalYear, 10));
    }
    return list.filter(t => t.fiscalYear === parseInt(fiscalYear, 10) && t.quarter === quarter);
  }

  saveQTarget(targetData) {
    const list = this.getItem(STORAGE_KEYS.Q_TARGETS);
    const histories = this.getItem(STORAGE_KEYS.Q_TARGET_HISTORIES);
    const fy = parseInt(targetData.fiscalYear, 10);
    const q = targetData.quarter;
    const cId = targetData.consultantId;

    const existingIdx = list.findIndex(t => t.consultantId === cId && t.fiscalYear === fy && t.quarter === q);
    const prevVal = existingIdx >= 0 ? list[existingIdx].targetCount : 0;
    const newVal = Number(targetData.targetCount || 0);

    const user = this.getCurrentConsultant();
    const newRecord = {
      id: `qt_${cId}_${fy}_${q}`,
      consultantId: cId,
      fiscalYear: fy,
      quarter: q,
      targetCount: newVal,
      notes: targetData.notes || '',
      updatedAt: new Date().toISOString(),
      updatedBy: user.name
    };

    if (existingIdx >= 0) {
      list[existingIdx] = { ...list[existingIdx], ...newRecord };
    } else {
      list.push(newRecord);
    }
    this.setItem(STORAGE_KEYS.Q_TARGETS, list);

    if (prevVal !== newVal) {
      const historyItem = {
        id: `qth_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
        consultantId: cId,
        consultantName: targetData.consultantName || cId,
        fiscalYear: fy,
        quarter: q,
        previousTarget: prevVal,
        newTarget: newVal,
        changedAt: new Date().toISOString(),
        changedBy: user.name,
        notes: targetData.notes || ''
      };
      histories.push(historyItem);
      this.setItem(STORAGE_KEYS.Q_TARGET_HISTORIES, histories);
    }
  }

  // --- 企業別提出テンプレート ---
  getCompanySubmissionTemplate(companyId) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES);
    return list.find(t => t.companyId === companyId) || null;
  }

  saveCompanySubmissionTemplate(templateData) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES);
    const idx = list.findIndex(t => t.companyId === templateData.companyId);
    if (idx >= 0) {
      list[idx] = { ...list[idx], ...templateData, updatedAt: new Date().toISOString() };
    } else {
      templateData.createdAt = new Date().toISOString();
      list.push(templateData);
    }
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSION_TEMPLATES, list);
  }

  // --- 監査ログ機能 (指示書 14項) ---
  recordMasterAuditLog(actionType, masterType, targetId, targetName, previousValue = null, newValue = null, reason = '') {
    const logs = this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
    const user = this.getCurrentConsultant();

    const logEntry = {
      id: 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      actionType, // CREATE | UPDATE | ARCHIVE | RESTORE | DELETE
      masterType, // candidate | company | job | consultant
      targetId,
      targetName,
      previousValue,
      newValue,
      reason,
      performedAt: new Date().toISOString(),
      performedBy: user.consultantId,
      performedByName: user.name
    };

    logs.push(logEntry);
    this.setItem(STORAGE_KEYS.MASTER_AUDIT_LOGS, logs);
  }

  getMasterAuditLogs() {
    return this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS).sort((a, b) => new Date(b.performedAt) - new Date(a.performedAt));
  }

  // --- 関連データカウント機能 (完全削除ブロック用) (指示書 7, 8, 9, 10項) ---
  getRelatedDataCounts(masterType, targetId) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const comms = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    const subs = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS);

    if (masterType === 'candidate') {
      const activeSelections = selections.filter(s => s.candidateId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.candidateId === targetId);
      return {
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        hasRelatedData: totalSelections.length > 0
      };
    }

    if (masterType === 'company') {
      const activeJobs = jobs.filter(j => j.companyId === targetId && !j.isArchived);
      const totalJobs = jobs.filter(j => j.companyId === targetId);
      const activeSelections = selections.filter(s => s.companyId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.companyId === targetId);
      const companyComms = comms.filter(c => c.companyId === targetId);
      const companySubs = subs.filter(s => s.companyId === targetId);

      const hasRelated = totalJobs.length > 0 || totalSelections.length > 0 || companyComms.length > 0 || companySubs.length > 0;
      return {
        jobCount: activeJobs.length,
        totalJobCount: totalJobs.length,
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        commCount: companyComms.length,
        subCount: companySubs.length,
        hasRelatedData: hasRelated
      };
    }

    if (masterType === 'job') {
      const activeSelections = selections.filter(s => s.jobId === targetId && !s.isArchived);
      const totalSelections = selections.filter(s => s.jobId === targetId);
      return {
        selectionCount: activeSelections.length,
        totalSelectionCount: totalSelections.length,
        hasRelatedData: totalSelections.length > 0
      };
    }

    if (masterType === 'consultant') {
      const caCandidates = candidates.filter(c => (c.caId === targetId || c.caConsultantId === targetId) && !c.isArchived);
      const raCompanies = companies.filter(c => (c.primaryRaId === targetId || c.raConsultantId === targetId) && !c.isArchived);
      const raJobs = jobs.filter(j => (j.raId === targetId || j.raConsultantId === targetId) && !j.isArchived);
      const consultantSelections = selections.filter(s => (s.caId === targetId || s.raId === targetId || s.caConsultantId === targetId || s.raConsultantId === targetId) && !s.isArchived);
      const consultantSubs = subs.filter(s => s.submittedBy === targetId);
      const consultantTargets = qTargets.filter(t => t.consultantId === targetId && t.targetCount > 0);

      const hasRelated = caCandidates.length > 0 || raCompanies.length > 0 || raJobs.length > 0 || consultantSelections.length > 0 || consultantSubs.length > 0;
      return {
        caCandidateCount: caCandidates.length,
        raCompanyCount: raCompanies.length,
        raJobCount: raJobs.length,
        selectionCount: consultantSelections.length,
        subCount: consultantSubs.length,
        targetCount: consultantTargets.length,
        hasRelatedData: hasRelated
      };
    }

    return { hasRelatedData: false };
  }

  // --- コンサル担当一括引き継ぎ (指示書 11項) ---
  reassignConsultantResponsibilities(fromConsultantId, toConsultantId) {
    if (!fromConsultantId || !toConsultantId || fromConsultantId === toConsultantId) return;

    const consultants = this.getConsultants(true);
    const toCons = consultants.find(c => c.consultantId === toConsultantId);
    if (!toCons) return;

    const user = this.getCurrentConsultant();

    // 1. 担当候補者引き継ぎ
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    let candCount = 0;
    candidates.forEach(c => {
      if (c.caId === fromConsultantId || c.caConsultantId === fromConsultantId) {
        c.caId = toConsultantId;
        c.caConsultantId = toConsultantId;
        c.caName = toCons.name;
        c.updatedAt = new Date().toISOString();
        c.updatedBy = user.name;
        candCount++;
      }
    });
    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);

    // 2. 担当企業引き継ぎ
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    let compCount = 0;
    companies.forEach(c => {
      if (c.primaryRaId === fromConsultantId || c.raConsultantId === fromConsultantId) {
        c.primaryRaId = toConsultantId;
        c.raConsultantId = toConsultantId;
        c.primaryRaName = toCons.name;
        c.updatedAt = new Date().toISOString();
        c.updatedBy = user.name;
        compCount++;
      }
    });
    this.setItem(STORAGE_KEYS.COMPANIES, companies);

    // 3. 担当求人引き継ぎ
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    let jobCount = 0;
    jobs.forEach(j => {
      if (j.raId === fromConsultantId || j.raConsultantId === fromConsultantId) {
        j.raId = toConsultantId;
        j.raConsultantId = toConsultantId;
        j.raName = toCons.name;
        j.updatedAt = new Date().toISOString();
        jobCount++;
      }
    });
    this.setItem(STORAGE_KEYS.JOBS, jobs);

    // 4. 進行中選考案件引き継ぎ
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    let selCount = 0;
    selections.forEach(s => {
      if (!s.isArchived && s.phase !== '選考終了') {
        if (s.caId === fromConsultantId || s.caConsultantId === fromConsultantId) {
          s.caId = toConsultantId;
          s.caConsultantId = toConsultantId;
          s.caName = toCons.name;
          s.updatedAt = new Date().toISOString();
          selCount++;
        }
        if (s.raId === fromConsultantId || s.raConsultantId === fromConsultantId) {
          s.raId = toConsultantId;
          s.raConsultantId = toConsultantId;
          s.raName = toCons.name;
          s.updatedAt = new Date().toISOString();
          selCount++;
        }
      }
    });
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);

    this.recordMasterAuditLog('UPDATE', 'consultant', fromConsultantId, '担当引き継ぎ', null, `引き継ぎ先: ${toCons.name}`, `候補者:${candCount}件, 企業:${compCount}件, 求人:${jobCount}件, 案件:${selCount}件を一括変更`);
  }

  // --- 2段階削除: 通常アーカイブ (指示書 3項) ---
  archiveMasterItem(masterType, targetId, reason = '') {
    const user = this.getCurrentConsultant();

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const idx = list.findIndex(c => c.candidateId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.CANDIDATES, list);
        this.recordMasterAuditLog('ARCHIVE', 'candidate', targetId, item.name, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const idx = list.findIndex(c => c.companyId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.COMPANIES, list);
        this.recordMasterAuditLog('ARCHIVE', 'company', targetId, item.name, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const idx = list.findIndex(j => j.jobId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.JOBS, list);
        this.recordMasterAuditLog('ARCHIVE', 'job', targetId, item.title || item.jobName, null, 'isArchived: true', reason);
      }
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const idx = list.findIndex(c => c.consultantId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: true, status: 'inactive', archivedAt: new Date().toISOString(), archivedBy: user.name, archiveReason: reason };
        this.setItem(STORAGE_KEYS.CONSULTANTS, list);
        this.recordMasterAuditLog('ARCHIVE', 'consultant', targetId, item.name, null, 'isArchived: true', reason);
      }
    }
  }

  // --- 復元機能 (指示書 12項) ---
  restoreMasterItem(masterType, targetId) {
    const user = this.getCurrentConsultant();

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const idx = list.findIndex(c => c.candidateId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.CANDIDATES, list);
        this.recordMasterAuditLog('RESTORE', 'candidate', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const idx = list.findIndex(c => c.companyId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.COMPANIES, list);
        this.recordMasterAuditLog('RESTORE', 'company', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const idx = list.findIndex(j => j.jobId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.JOBS, list);
        this.recordMasterAuditLog('RESTORE', 'job', targetId, item.title || item.jobName, 'isArchived: true', 'isArchived: false');
      }
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const idx = list.findIndex(c => c.consultantId === targetId);
      if (idx >= 0) {
        const item = list[idx];
        list[idx] = { ...item, isArchived: false, status: 'active', restoredAt: new Date().toISOString(), restoredBy: user.name };
        this.setItem(STORAGE_KEYS.CONSULTANTS, list);
        this.recordMasterAuditLog('RESTORE', 'consultant', targetId, item.name, 'isArchived: true', 'isArchived: false');
      }
    }
  }

  // --- 管理者限定 完全物理削除 (指示書 3, 7, 8, 9, 10項) ---
  deleteMasterItemPermanently(masterType, targetId) {
    if (!this.isAdmin()) {
      alert('完全削除権限がありません。管理者アカウントで実行してください。');
      return false;
    }

    const counts = this.getRelatedDataCounts(masterType, targetId);
    if (counts.hasRelatedData) {
      alert('関連データが存在するため完全削除できません。アーカイブ機能をご利用ください。');
      return false;
    }

    if (masterType === 'candidate') {
      const list = this.getItem(STORAGE_KEYS.CANDIDATES);
      const item = list.find(c => c.candidateId === targetId);
      const newList = list.filter(c => c.candidateId !== targetId);
      this.setItem(STORAGE_KEYS.CANDIDATES, newList);
      this.recordMasterAuditLog('DELETE', 'candidate', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'company') {
      const list = this.getItem(STORAGE_KEYS.COMPANIES);
      const item = list.find(c => c.companyId === targetId);
      const newList = list.filter(c => c.companyId !== targetId);
      this.setItem(STORAGE_KEYS.COMPANIES, newList);
      this.recordMasterAuditLog('DELETE', 'company', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'job') {
      const list = this.getItem(STORAGE_KEYS.JOBS);
      const item = list.find(j => j.jobId === targetId);
      const newList = list.filter(j => j.jobId !== targetId);
      this.setItem(STORAGE_KEYS.JOBS, newList);
      this.recordMasterAuditLog('DELETE', 'job', targetId, item ? (item.title || item.jobName) : targetId, null, 'PERMANENTLY_DELETED');
    } else if (masterType === 'consultant') {
      const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
      const item = list.find(c => c.consultantId === targetId);
      const newList = list.filter(c => c.consultantId !== targetId);
      this.setItem(STORAGE_KEYS.CONSULTANTS, newList);
      this.recordMasterAuditLog('DELETE', 'consultant', targetId, item ? item.name : targetId, null, 'PERMANENTLY_DELETED');
    }

    return true;
  }

  // --- Getters ---
  getConsultants(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getCaConsultants() {
    return this.getConsultants().filter(c => {
      if (c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) {
        return c.roles.includes('CA') || c.roles.includes('ADMIN');
      }
      return c.roleType === 'CA' || c.roleType === 'ADMIN';
    });
  }

  getRaConsultants() {
    return this.getConsultants().filter(c => {
      if (c.status === 'inactive') return false;
      if (c.roles && Array.isArray(c.roles)) {
        return c.roles.includes('RA') || c.roles.includes('ADMIN');
      }
      return c.roleType === 'RA' || c.roleType === 'ADMIN';
    });
  }

  getCompanies(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.COMPANIES);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getJobs(includeArchived = false, companyId = null) {
    let list = this.getItem(STORAGE_KEYS.JOBS);
    if (!includeArchived) list = list.filter(j => !j.isArchived);
    if (companyId) list = list.filter(j => j.companyId === companyId);
    return list;
  }

  getCandidates(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.CANDIDATES);
    return includeArchived ? list : list.filter(c => !c.isArchived);
  }

  getSelections(includeArchived = false) {
    const list = this.getItem(STORAGE_KEYS.SELECTIONS);
    return includeArchived ? list : list.filter(s => !s.isArchived);
  }

  getTargets(year = 2026, month = 7) {
    const list = this.getItem(STORAGE_KEYS.TARGETS);
    return list.filter(t => t.year === year && t.month === month);
  }

  getHistories(selectionId = null) {
    const list = this.getItem(STORAGE_KEYS.HISTORIES);
    let filtered = selectionId ? list.filter(h => h.selectionId === selectionId) : list;
    return filtered.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  }

  getEmailTemplates() {
    return this.getItem(STORAGE_KEYS.EMAIL_TEMPLATES);
  }

  getCompanyCommunications(companyId = null) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    if (companyId) return list.filter(c => c.companyId === companyId);
    return list.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
  }

  getCompanySubmissions(companyId = null) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    let filtered = companyId ? list.filter(s => s.companyId === companyId) : list;
    return filtered.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
  }

  getLastCompanySubmission(companyId) {
    const list = this.getCompanySubmissions(companyId);
    return list.length > 0 ? list[0] : null;
  }

  // --- 保存処理 (名義動的更新ロジック付き) (指示書 5項) ---
  saveCandidate(candidateData, cascadeToSelections = false) {
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const consultants = this.getConsultants(true);
    const caCons = consultants.find(c => c.consultantId === candidateData.caId);

    candidateData.caName = caCons ? caCons.name : '未設定';
    candidateData.caConsultantId = candidateData.caId;
    candidateData.updatedAt = new Date().toISOString();
    candidateData.updatedBy = this.getCurrentConsultant().name;

    const existingIndex = candidates.findIndex(c => c.candidateId === candidateData.candidateId);
    let isNew = false;
    let oldName = '';

    if (existingIndex >= 0) {
      oldName = candidates[existingIndex].name;
      candidates[existingIndex] = { ...candidates[existingIndex], ...candidateData };
      this.recordMasterAuditLog('UPDATE', 'candidate', candidateData.candidateId, candidateData.name, `name:${oldName}`, `name:${candidateData.name}`);
    } else {
      isNew = true;
      candidateData.candidateId = candidateData.candidateId || 'cand_' + Date.now();
      candidateData.createdAt = new Date().toISOString();
      candidateData.createdBy = this.getCurrentConsultant().name;
      candidateData.isArchived = false;
      candidates.push(candidateData);
      this.recordMasterAuditLog('CREATE', 'candidate', candidateData.candidateId, candidateData.name);
    }

    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);

    // 候補者名変更時の選考案件表示名一括更新 (指示書 5項)
    if (!isNew && oldName && oldName !== candidateData.name) {
      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let updated = false;
      selections.forEach(s => {
        if (s.candidateId === candidateData.candidateId) {
          s.candidateName = candidateData.name;
          s.updatedAt = new Date().toISOString();
          updated = true;
        }
      });
      if (updated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveCompany(companyData, cascadeToSelections = false) {
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const consultants = this.getConsultants(true);
    const raCons = consultants.find(c => c.consultantId === companyData.primaryRaId);

    if (companyData.contactName && !companyData.contactPerson) companyData.contactPerson = companyData.contactName;
    if (companyData.contactPerson && !companyData.contactName) companyData.contactName = companyData.contactPerson;

    companyData.primaryRaName = raCons ? raCons.name : '未設定';
    companyData.raConsultantId = companyData.primaryRaId;
    companyData.updatedAt = new Date().toISOString();
    companyData.updatedBy = this.getCurrentConsultant().name;

    const existingIndex = companies.findIndex(c => c.companyId === companyData.companyId);
    let isNew = false;
    let oldName = '';

    if (existingIndex >= 0) {
      oldName = companies[existingIndex].name;
      companies[existingIndex] = { ...companies[existingIndex], ...companyData };
      this.recordMasterAuditLog('UPDATE', 'company', companyData.companyId, companyData.name, `name:${oldName}`, `name:${companyData.name}`);
    } else {
      isNew = true;
      companyData.companyId = companyData.companyId || 'comp_' + Date.now();
      companyData.createdAt = new Date().toISOString();
      companyData.createdBy = this.getCurrentConsultant().name;
      companyData.isArchived = false;
      companies.push(companyData);
      this.recordMasterAuditLog('CREATE', 'company', companyData.companyId, companyData.name);
    }

    this.setItem(STORAGE_KEYS.COMPANIES, companies);

    // 企業名変更時の求人・選考案件表示名一括更新 (指示書 5項)
    if (!isNew && oldName && oldName !== companyData.name) {
      const jobs = this.getItem(STORAGE_KEYS.JOBS);
      let jobsUpdated = false;
      jobs.forEach(j => {
        if (j.companyId === companyData.companyId) {
          j.companyName = companyData.name;
          jobsUpdated = true;
        }
      });
      if (jobsUpdated) this.setItem(STORAGE_KEYS.JOBS, jobs);

      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let selUpdated = false;
      selections.forEach(s => {
        if (s.companyId === companyData.companyId) {
          s.companyName = companyData.name;
          s.updatedAt = new Date().toISOString();
          selUpdated = true;
        }
      });
      if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveJob(jobData) {
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const companies = this.getCompanies(true);
    const comp = companies.find(c => c.companyId === jobData.companyId);

    jobData.companyName = comp ? comp.name : '';
    jobData.raConsultantId = jobData.raId || (comp ? comp.primaryRaId : 'c3');
    jobData.raId = jobData.raConsultantId;
    jobData.updatedAt = new Date().toISOString();

    const idx = jobs.findIndex(j => j.jobId === jobData.jobId);
    let isNew = false;
    let oldTitle = '';

    if (idx >= 0) {
      oldTitle = jobs[idx].title || jobs[idx].jobName;
      jobs[idx] = { ...jobs[idx], ...jobData };
      this.recordMasterAuditLog('UPDATE', 'job', jobData.jobId, jobData.title || jobData.jobName, `title:${oldTitle}`, `title:${jobData.title}`);
    } else {
      isNew = true;
      jobData.jobId = jobData.jobId || 'job_' + Date.now();
      jobData.createdAt = new Date().toISOString();
      jobData.isArchived = false;
      jobs.push(jobData);
      this.recordMasterAuditLog('CREATE', 'job', jobData.jobId, jobData.title || jobData.jobName);
    }

    this.setItem(STORAGE_KEYS.JOBS, jobs);

    // 求人名変更時の選考案件表示名一括更新 (指示書 5項)
    const newTitle = jobData.title || jobData.jobName;
    if (!isNew && oldTitle && oldTitle !== newTitle) {
      const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
      let selUpdated = false;
      selections.forEach(s => {
        if (s.jobId === jobData.jobId) {
          s.jobName = newTitle;
          s.updatedAt = new Date().toISOString();
          selUpdated = true;
        }
      });
      if (selUpdated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    }
  }

  saveConsultant(consultantData) {
    const list = this.getItem(STORAGE_KEYS.CONSULTANTS);
    const idx = list.findIndex(c => c.consultantId === consultantData.consultantId);

    if (idx >= 0) {
      const oldName = list[idx].name;
      list[idx] = { ...list[idx], ...consultantData };
      this.recordMasterAuditLog('UPDATE', 'consultant', consultantData.consultantId, consultantData.name, `name:${oldName}`, `name:${consultantData.name}`);
    } else {
      consultantData.consultantId = consultantData.consultantId || 'c_' + Date.now();
      consultantData.isArchived = false;
      consultantData.createdAt = new Date().toISOString();
      consultantData.status = consultantData.status || 'active';
      list.push(consultantData);
      this.recordMasterAuditLog('CREATE', 'consultant', consultantData.consultantId, consultantData.name);
    }
    this.setItem(STORAGE_KEYS.CONSULTANTS, list);
  }

  saveCompanySubmission(submissionData) {
    const list = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const user = this.getCurrentConsultant();
    const comp = this.getCompanies(true).find(c => c.companyId === submissionData.companyId);

    const newSub = {
      id: 'sub_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      companyId: submissionData.companyId,
      companyName: comp ? comp.name : (submissionData.companyName || ''),
      selectionIds: submissionData.selectionIds || [],
      candidateIds: submissionData.candidateIds || [],
      jobIds: submissionData.jobIds || [],
      submissionPurpose: submissionData.submissionPurpose || '選考進捗の一括確認',
      outputType: submissionData.outputType || 'EXCEL',
      templateId: submissionData.templateId || '',
      subject: submissionData.subject || '',
      body: submissionData.body || '',
      submittedAt: new Date().toISOString(),
      submittedBy: user.consultantId,
      submittedByName: user.name,
      targetCount: submissionData.selectionIds ? submissionData.selectionIds.length : 0,
      nextContactDate: submissionData.nextContactDate || null,
      responseStatus: '未回答',
      responses: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    list.push(newSub);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, list);

    if (comp) {
      comp.lastContactDate = new Date().toISOString().split('T')[0];
      if (submissionData.nextContactDate) comp.nextContactDate = submissionData.nextContactDate;
      this.saveCompany(comp, false);
    }

    return newSub;
  }

  addSelection(selectionData) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const candidates = this.getCandidates(true);
    const companies = this.getCompanies(true);
    const jobs = this.getJobs(true);
    const consultants = this.getConsultants(true);

    const cand = candidates.find(c => c.candidateId === selectionData.candidateId);
    const comp = companies.find(c => c.companyId === selectionData.companyId);
    const job = jobs.find(j => j.jobId === selectionData.jobId);

    const caId = selectionData.caId || selectionData.caConsultantId || (cand ? cand.caId : 'c2');
    const raId = selectionData.raId || selectionData.raConsultantId || (job ? job.raId : (comp ? comp.primaryRaId : 'c3'));

    const caCons = consultants.find(c => c.consultantId === caId);
    const raCons = consultants.find(c => c.consultantId === raId);

    const newSelection = {
      selectionId: 'sel_' + Date.now(),
      candidateId: selectionData.candidateId,
      candidateName: cand ? cand.name : selectionData.candidateName || '不明',
      companyId: selectionData.companyId,
      companyName: comp ? comp.name : selectionData.companyName || '不明',
      jobId: selectionData.jobId,
      jobName: job ? (job.title || job.jobName) : selectionData.jobName || '不明',
      caId: caId,
      caConsultantId: caId,
      caName: caCons ? caCons.name : '未設定',
      raId: raId,
      raConsultantId: raId,
      raName: raCons ? raCons.name : '未設定',
      entrySource: selectionData.entrySource || 'UNSET',
      entrySourceDetail: selectionData.entrySourceDetail || '',
      recommendationDate: selectionData.recommendationDate || new Date().toISOString().split('T')[0],
      phase: selectionData.phase || '書類選考',
      progressStatus: selectionData.progressStatus || '未対応',
      phaseUpdatedAt: new Date().toISOString(),
      nextScheduleDate: selectionData.nextScheduleDate || null,
      expectedCompletionMonth: selectionData.expectedCompletionMonth || null,
      selectionEndDate: null,
      endReason: null,
      endReasonDetail: '',
      yomi: selectionData.yomi !== undefined ? Number(selectionData.yomi) : 0.25,
      yomiReason: selectionData.yomiReason || '新規案件登録',
      yomiUpdatedAt: new Date().toISOString(),
      yomiUpdatedBy: this.getCurrentConsultant().name,
      nextAction: selectionData.nextAction || '',
      actionDeadline: selectionData.actionDeadline || null,
      companyActionType: selectionData.companyActionType || '書類選考結果の確認',
      companyConfirmationItem: selectionData.companyConfirmationItem || '',
      companyActionStatus: selectionData.companyActionStatus || '未対応',
      internalMemo: selectionData.internalMemo || '',
      companySharedComment: selectionData.companySharedComment || '',
      createdAt: new Date().toISOString(),
      createdBy: this.getCurrentConsultant().name,
      updatedAt: new Date().toISOString(),
      updatedBy: this.getCurrentConsultant().name,
      isArchived: false
    };

    selections.push(newSelection);
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    this.recordHistory(newSelection.selectionId, '新規案件登録', '-', newSelection.phase, '新規選考案件を作成');

    return newSelection;
  }

  updateSelection(selectionId, updateFields, historyComment = '', options = {}) {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const index = selections.findIndex(s => s.selectionId === selectionId);
    if (index < 0) return;

    const currentSelection = selections[index];
    let updatedSelection = { ...currentSelection, ...updateFields };
    updatedSelection.updatedAt = new Date().toISOString();
    updatedSelection.updatedBy = this.getCurrentConsultant().name;

    // CA更新連動によるRA企業対応項目の自動判定 (指示書 1, 3, 4, 5, 7, 8, 9, 10, 22項)
    const isPhaseChanged = updateFields.phase && updateFields.phase !== currentSelection.phase;
    const isStatusChanged = updateFields.progressStatus && updateFields.progressStatus !== currentSelection.progressStatus;
    const isScheduleChanged = updateFields.nextScheduleDate && updateFields.nextScheduleDate !== currentSelection.nextScheduleDate;

    if (isPhaseChanged || isStatusChanged || isScheduleChanged || options.forceAuto) {
      const currentSource = updateFields.companyActionSource || currentSelection.companyActionSource || 'auto';

      // 手動設定済みでかつ forceAuto でなく、手動指定が更新フィールドに含まれていない場合の保護判定 (指示書 8, 10, 12項)
      const hasManualAction = (currentSource === 'manual') && !options.forceAuto && !updateFields.companyActionType;

      if (!hasManualAction) {
        // 自動連動判定を実行
        const derived = deriveCompanyActionFromSelection({
          phase: updatedSelection.phase,
          progressStatus: updatedSelection.progressStatus,
          recommendationDate: updatedSelection.recommendationDate,
          nextScheduleDate: updatedSelection.nextScheduleDate,
          currentCompanyAction: currentSelection
        });

        updatedSelection = {
          ...updatedSelection,
          companyActionType: derived.companyActionType,
          companyActionStatus: derived.companyActionStatus,
          companyConfirmationItem: (options.appendItem && currentSelection.companyConfirmationItem)
            ? `${currentSelection.companyConfirmationItem} / 【自動判定】${derived.companyConfirmationItem}`
            : (derived.companyConfirmationItem || updatedSelection.companyConfirmationItem || ''),
          nextAction: derived.nextAction,
          nextActionTarget: derived.nextActionTarget,
          actionDeadline: derived.actionDeadline || updatedSelection.actionDeadline,
          nextCompanyContactDate: derived.nextCompanyContactDate || updatedSelection.nextCompanyContactDate,
          companyActionSource: 'auto',
          companyActionUpdatedAt: new Date().toISOString(),
          companyActionUpdatedBy: this.getCurrentConsultant().name
        };

        // 連動履歴の記録 (指示書 22項)
        if (isPhaseChanged || isStatusChanged) {
          this.recordHistory(
            selectionId,
            '企業対応項目連動',
            `${currentSelection.companyActionType || '-'} (${currentSelection.companyActionStatus || '未対応'})`,
            `${derived.companyActionType} (${derived.companyActionStatus})`,
            `選考フェーズ・進行状態の変更に伴うRA自動連動更新 [CA_SELECTION_UPDATE]`
          );
        }
      }
    }

    if (isPhaseChanged) {
      updatedSelection.phaseUpdatedAt = new Date().toISOString();
      this.recordHistory(selectionId, '選考フェーズ', currentSelection.phase, updateFields.phase, historyComment);
    }

    if (updateFields.yomi !== undefined && Number(updateFields.yomi) !== Number(currentSelection.yomi)) {
      updatedSelection.yomiUpdatedAt = new Date().toISOString();
      updatedSelection.yomiUpdatedBy = this.getCurrentConsultant().name;
      this.recordHistory(selectionId, 'ヨミ', `${currentSelection.yomi * 100}%`, `${updateFields.yomi * 100}%`, historyComment || updateFields.yomiReason);
    }

    selections[index] = updatedSelection;
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  declineOtherSelectionsForCandidate(candidateId, targetSelectionId, reasonComment = '') {
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    let updated = false;

    selections.forEach(s => {
      if (s.candidateId === candidateId && s.selectionId !== targetSelectionId && !s.isArchived && s.phase !== '選考終了') {
        s.phase = '選考終了';
        s.progressStatus = '候補者辞退';
        s.endReason = '内定辞退';
        s.endReasonDetail = reasonComment || '他社内定承諾に伴う辞退';
        s.yomi = 0;
        s.updatedAt = new Date().toISOString();
        updated = true;
        this.recordHistory(s.selectionId, '他社内定連動', s.phase, '選考終了 (候補者辞退)', reasonComment);
      }
    });

    if (updated) this.setItem(STORAGE_KEYS.SELECTIONS, selections);
  }

  recordHistory(selectionId, fieldName, previousValue, newValue, comment = '') {
    const histories = this.getItem(STORAGE_KEYS.HISTORIES);
    const newHistory = {
      historyId: 'h_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      selectionId,
      changedAt: new Date().toISOString(),
      changedBy: this.getCurrentConsultant().name,
      fieldName,
      previousValue: String(previousValue),
      newValue: String(newValue),
      comment
    };

    histories.push(newHistory);
    this.setItem(STORAGE_KEYS.HISTORIES, histories);
  }

  archiveSelection(selectionId) {
    this.updateSelection(selectionId, { isArchived: true }, 'アーカイブ化');
  }

  saveTarget(targetData) {
    const targets = this.getItem(STORAGE_KEYS.TARGETS);
    const idx = targets.findIndex(t => t.consultantId === targetData.consultantId && t.year === targetData.year && t.month === targetData.month);
    if (idx >= 0) {
      targets[idx] = { ...targets[idx], ...targetData };
    } else {
      targetData.targetId = 't_' + Date.now();
      targets.push(targetData);
    }
    this.setItem(STORAGE_KEYS.TARGETS, targets);
  }

  // --- データ管理 ＆ 初期化 ＆ 監査ログ機能 (指示書 4〜22項) ---

  recordAuditLog(operationType, targetCounts = {}, result = 'SUCCESS', errorMessage = '') {
    const logs = this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
    const current = this.getCurrentConsultant();
    const log = {
      id: 'audit_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      operationType,
      targetCounts,
      executedBy: current.consultantId || 'unknown',
      executedByName: current.name || '不明',
      executedAt: new Date().toISOString(),
      result,
      errorMessage
    };
    logs.unshift(log);
    this.setItem(STORAGE_KEYS.MASTER_AUDIT_LOGS, logs.slice(0, 100)); // 最新100件保存
    return log;
  }

  getAuditLogs() {
    return this.getItem(STORAGE_KEYS.MASTER_AUDIT_LOGS);
  }

  getDeletionPreviewCounts() {
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES);
    const companies = this.getItem(STORAGE_KEYS.COMPANIES);
    const jobs = this.getItem(STORAGE_KEYS.JOBS);
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS);
    const histories = this.getItem(STORAGE_KEYS.HISTORIES);
    const companyCommunications = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS);
    const companySubmissions = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS);
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS);
    const emailTemplates = this.getItem(STORAGE_KEYS.EMAIL_TEMPLATES);

    const isDemoItem = item => Boolean(item.isDemo || item.createdBySeed);

    return {
      demo: {
        candidates: candidates.filter(isDemoItem).length,
        companies: companies.filter(isDemoItem).length,
        jobs: jobs.filter(isDemoItem).length,
        selections: selections.filter(isDemoItem).length,
        histories: histories.filter(isDemoItem).length,
        companyCommunications: companyCommunications.filter(isDemoItem).length,
        companySubmissions: companySubmissions.filter(isDemoItem).length,
        qTargets: qTargets.filter(isDemoItem).length,
        emailTemplates: emailTemplates.filter(isDemoItem).length,
        total: candidates.filter(isDemoItem).length +
               companies.filter(isDemoItem).length +
               jobs.filter(isDemoItem).length +
               selections.filter(isDemoItem).length +
               histories.filter(isDemoItem).length +
               companyCommunications.filter(isDemoItem).length +
               qTargets.filter(isDemoItem).length
      },
      all: {
        candidates: candidates.length,
        companies: companies.length,
        jobs: jobs.length,
        selections: selections.length,
        histories: histories.length,
        companyCommunications: companyCommunications.length,
        companySubmissions: companySubmissions.length,
        qTargets: qTargets.length,
        emailTemplates: emailTemplates.length,
        total: candidates.length + companies.length + jobs.length + selections.length + histories.length + companyCommunications.length + qTargets.length
      }
    };
  }

  deleteDemoData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const isDemoItem = item => Boolean(item.isDemo || item.createdBySeed);

    const demoSelections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(isDemoItem);
    const demoSelectionIds = new Set(demoSelections.map(s => s.selectionId));

    // 削除対象カウント
    const previewCounts = this.getDeletionPreviewCounts().demo;

    // 1. 子データから削除
    const histories = this.getItem(STORAGE_KEYS.HISTORIES).filter(h => !isDemoItem(h) && !demoSelectionIds.has(h.selectionId));
    const comms = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS).filter(c => !isDemoItem(c) && !demoSelectionIds.has(c.selectionId));
    const subs = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS).filter(s => !isDemoItem(s) && !demoSelectionIds.has(s.selectionId));
    const selections = this.getItem(STORAGE_KEYS.SELECTIONS).filter(s => !isDemoItem(s));
    const candidates = this.getItem(STORAGE_KEYS.CANDIDATES).filter(c => !isDemoItem(c));
    const jobs = this.getItem(STORAGE_KEYS.JOBS).filter(j => !isDemoItem(j));
    const companies = this.getItem(STORAGE_KEYS.COMPANIES).filter(c => !isDemoItem(c));
    const qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS).filter(q => !isDemoItem(q));

    this.setItem(STORAGE_KEYS.HISTORIES, histories);
    this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, comms);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, subs);
    this.setItem(STORAGE_KEYS.SELECTIONS, selections);
    this.setItem(STORAGE_KEYS.CANDIDATES, candidates);
    this.setItem(STORAGE_KEYS.JOBS, jobs);
    this.setItem(STORAGE_KEYS.COMPANIES, companies);
    this.setItem(STORAGE_KEYS.Q_TARGETS, qTargets);

    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('DELETE_DEMO_DATA', previewCounts);
    this.notifyListeners();

    return previewCounts;
  }

  deleteSelectedDataTypes(selectedTypes = []) {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const typesSet = new Set(selectedTypes);
    const deletedCounts = {};

    if (typesSet.has('histories') || typesSet.has('selections')) {
      deletedCounts.histories = this.getItem(STORAGE_KEYS.HISTORIES).length;
      this.setItem(STORAGE_KEYS.HISTORIES, []);
    }
    if (typesSet.has('communications') || typesSet.has('selections')) {
      deletedCounts.companyCommunications = this.getItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS).length;
      this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, []);
    }
    if (typesSet.has('submissions') || typesSet.has('selections')) {
      deletedCounts.companySubmissions = this.getItem(STORAGE_KEYS.COMPANY_SUBMISSIONS).length;
      this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, []);
    }
    if (typesSet.has('selections')) {
      deletedCounts.selections = this.getItem(STORAGE_KEYS.SELECTIONS).length;
      this.setItem(STORAGE_KEYS.SELECTIONS, []);
    }
    if (typesSet.has('candidates')) {
      deletedCounts.candidates = this.getItem(STORAGE_KEYS.CANDIDATES).length;
      this.setItem(STORAGE_KEYS.CANDIDATES, []);
    }
    if (typesSet.has('jobs')) {
      deletedCounts.jobs = this.getItem(STORAGE_KEYS.JOBS).length;
      this.setItem(STORAGE_KEYS.JOBS, []);
    }
    if (typesSet.has('companies')) {
      deletedCounts.companies = this.getItem(STORAGE_KEYS.COMPANIES).length;
      this.setItem(STORAGE_KEYS.COMPANIES, []);
    }
    if (typesSet.has('qTargets')) {
      deletedCounts.qTargets = this.getItem(STORAGE_KEYS.Q_TARGETS).length;
      this.setItem(STORAGE_KEYS.Q_TARGETS, []);
    }

    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('DELETE_SELECTED_DATA', { selectedTypes, ...deletedCounts });
    this.notifyListeners();

    return deletedCounts;
  }

  resetAllBusinessData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    const previewCounts = this.getDeletionPreviewCounts().all;

    // 業務データを全て空配列にセット（コンサルタント・認証・システム設定は保護）
    this.setItem(STORAGE_KEYS.SELECTIONS, []);
    this.setItem(STORAGE_KEYS.CANDIDATES, []);
    this.setItem(STORAGE_KEYS.JOBS, []);
    this.setItem(STORAGE_KEYS.COMPANIES, []);
    this.setItem(STORAGE_KEYS.HISTORIES, []);
    this.setItem(STORAGE_KEYS.COMPANY_COMMUNICATIONS, []);
    this.setItem(STORAGE_KEYS.COMPANY_SUBMISSIONS, []);
    this.setItem(STORAGE_KEYS.TARGETS, []);
    this.setItem(STORAGE_KEYS.Q_TARGETS, []);
    this.setItem(STORAGE_KEYS.Q_TARGET_HISTORIES, []);

    // デモ再自動生成を停止する初期化フラグを確実に立てる
    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    this.recordAuditLog('RESET_ALL_BUSINESS_DATA', previewCounts);
    this.notifyListeners();

    return previewCounts;
  }

  seedDemoData() {
    if (!this.isAdmin()) throw new Error('管理者権限が必要です。');

    this.setItem(STORAGE_KEYS.COMPANIES, INITIAL_COMPANIES);
    this.setItem(STORAGE_KEYS.JOBS, INITIAL_JOBS);
    this.setItem(STORAGE_KEYS.CANDIDATES, INITIAL_CANDIDATES);
    this.setItem(STORAGE_KEYS.SELECTIONS, INITIAL_SELECTIONS);
    this.setItem(STORAGE_KEYS.Q_TARGETS, INITIAL_Q_TARGETS);
    this.setItem(STORAGE_KEYS.EMAIL_TEMPLATES, INITIAL_EMAIL_TEMPLATES);
    this.setItem(STORAGE_KEYS.IS_INITIALIZED, 'true');

    const counts = {
      candidates: INITIAL_CANDIDATES.length,
      companies: INITIAL_COMPANIES.length,
      jobs: INITIAL_JOBS.length,
      selections: INITIAL_SELECTIONS.length
    };

    this.recordAuditLog('CREATE_DEMO_DATA', counts);
    this.notifyListeners();

    return counts;
  }
}

export const store = new Store();

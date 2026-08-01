/**
 * 選考進捗・ヨミ管理システム - ソート ＆ フェーズ優先度判定ユーティリティ (指示書 1, 3, 5, 6項対応)
 */

/**
 * 選考フェーズの優先度スコアを取得 (表記ゆれ対応) (指示書 5, 6項)
 */
export function getPhasePriorityScore(phaseInput) {
  if (!phaseInput) return 0;

  const phase = String(phaseInput).trim();

  // 1. 内定承諾 / 入社予定
  if (phase === '内定承諾') return 100;
  if (phase === '入社予定') return 95;

  // 2. 内定
  if (phase === '内定') return 90;

  // 3. オファー面談・条件提示 (表記ゆれ: オファー面談, 条件提示)
  if (phase === 'オファー面談・条件提示' || phase === 'オファー面談' || phase === '条件提示') return 80;

  // 4. 面接フェーズ (最終, 三次, 二次, 一次)
  if (phase === '最終面接' || phase === '最終') return 70;
  if (phase === '三次面接' || phase === '三次') return 65;
  if (phase === '二次面接' || phase === '二次') return 60;
  if (phase === '一次面接' || phase === '一次') return 50;

  // 5. 書類選考 (表記ゆれ: 書類選考中, 書類)
  if (phase === '書類選考' || phase === '書類選考中' || phase === '書類') return 40;

  // 6. 推薦準備
  if (phase === '推薦準備' || phase === '推薦') return 30;

  // 7. 終了系フェーズ
  if (phase === '内定辞退') return 10;
  if (phase === '選考終了') return 0;

  return 20; // その他
}

/**
 * 選考案件のマルチキーソート関数 (指示書 1, 2, 3項)
 */
export function sortSelections(selections, sortBy = 'phase_desc') {
  const list = [...selections];

  return list.sort((a, b) => {
    const isEndedA = a.phase === '選考終了' || a.phase === '内定辞退';
    const isEndedB = b.phase === '選考終了' || b.phase === '内定辞退';

    // 進行中案件と終了案件が混在する場合、常に進行中案件を上部に表示 (指示書 2項)
    if (!isEndedA && isEndedB) return -1;
    if (isEndedA && !isEndedB) return 1;

    // 終了案件同士のソート (終了日の新しい順) (指示書 2項)
    if (isEndedA && isEndedB) {
      const dateA = a.phaseUpdatedAt || a.nextScheduleDate || '0000-00-00';
      const dateB = b.phaseUpdatedAt || b.nextScheduleDate || '0000-00-00';
      return dateB.localeCompare(dateA);
    }

    // 進行中案件の並び替え指定別の処理
    if (sortBy === 'phase_desc') {
      // 1. 選考フェーズ優先度スコア降順 (指示書 1, 5項)
      const scoreA = getPhasePriorityScore(a.phase);
      const scoreB = getPhasePriorityScore(b.phase);
      if (scoreA !== scoreB) return scoreB - scoreA;

      // 2. 同一フェーズ内のサブソート (指示書 3項)
      // ① 次回予定日が近い順 (未設定は後に表示)
      const dateA = a.nextScheduleDate ? a.nextScheduleDate : '9999-99-99';
      const dateB = b.nextScheduleDate ? b.nextScheduleDate : '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);

      // ② アクション期限が近い順
      const dlineA = a.actionDeadline ? a.actionDeadline : '9999-99-99';
      const dlineB = b.actionDeadline ? b.actionDeadline : '9999-99-99';
      if (dlineA !== dlineB) return dlineA.localeCompare(dlineB);

      // ③ 最終更新日の新しい順
      const updatedA = a.phaseUpdatedAt || a.recommendationDate || '0000-00-00';
      const updatedB = b.phaseUpdatedAt || b.recommendationDate || '0000-00-00';
      if (updatedA !== updatedB) return updatedB.localeCompare(updatedA);

      // ④ 候補者名の五十音順
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'nextDate_asc') {
      const dateA = a.nextScheduleDate ? a.nextScheduleDate : '9999-99-99';
      const dateB = b.nextScheduleDate ? b.nextScheduleDate : '9999-99-99';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'updated_desc') {
      const updatedA = a.phaseUpdatedAt || a.recommendationDate || '0000-00-00';
      const updatedB = b.phaseUpdatedAt || b.recommendationDate || '0000-00-00';
      return updatedB.localeCompare(updatedA);
    }

    if (sortBy === 'yomi_desc') {
      const yomiA = Number(a.yomi || 0);
      const yomiB = Number(b.yomi || 0);
      if (yomiA !== yomiB) return yomiB - yomiA;
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    if (sortBy === 'candName_asc') {
      return (a.candidateName || '').localeCompare(b.candidateName || '', 'ja');
    }

    return 0;
  });
}

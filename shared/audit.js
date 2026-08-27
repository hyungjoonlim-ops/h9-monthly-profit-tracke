// 변경 이력 (감사 로그) — 누가 언제 무엇을 바꿨는지 한 줄씩 남깁니다.
// 기록 실패가 본 작업을 막으면 안 되므로 항상 조용히 삼킵니다.
import express from 'express';
import { pool } from '../db.js';
import { requireAdmin, appKeyOf } from './auth.js';

// 어느 앱에서 고친 것인지도 함께 남깁니다 — 두 앱이 같은 표를 씁니다.
export function audit(req, action, entity, entityId, summary) {
  const actor = req && req.user ? req.user.email : null;
  pool.query(
    `INSERT INTO audit_log (actor, app, action, entity, entity_id, summary)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [actor, appKeyOf(), action, entity, entityId == null ? null : Number(entityId),
     String(summary || '').slice(0, 500)]
  ).catch(() => {});
}

const ACTION_LABEL = {
  create: '생성', update: '수정', delete: '삭제', restore: '복구',
  duplicate: '복제', status: '상태 변경', convert: '수주 전환',
  version: '새 버전', upload: '파일 첨부', 'file-delete': '파일 삭제',
  import: '가져오기 실행', stage: '단계 이동',
};
const ENTITY_LABEL = {
  quote: '견적서', project: '프로젝트', rate_card: '단가표', parts: '파트·역할',
  stamp: '회사 직인', alias: '고객사 별칭', user: '계정', file: '첨부파일',
  client: '고객사', employee: '직원', contact: '담당자',
};

export function auditRoutes() {
  const r = express.Router();
  r.get('/api/audit', requireAdmin, async (req, res) => {
    const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 100));
    try {
      const { rows } = await pool.query(
        `SELECT id, actor, action, entity, entity_id, summary, created_at
           FROM audit_log ORDER BY id DESC LIMIT $1`, [limit]
      );
      res.json(rows.map((x) => ({
        id: Number(x.id), actor: x.actor,
        action: x.action, actionLabel: ACTION_LABEL[x.action] || x.action,
        entity: x.entity, entityLabel: ENTITY_LABEL[x.entity] || x.entity,
        entityId: x.entity_id == null ? null : Number(x.entity_id),
        summary: x.summary, at: x.created_at,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });
  return r;
}

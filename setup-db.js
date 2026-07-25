import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// 기본 단가표 (직군: [초급, 중급, 고급, 특급]) — 기존 견적 앱과 동일 기준
const DEFAULT_RATES = {
  'DT개발': [5200000, 6800000, 8900000, 9400000],
  'TF (수원,SDS)': [4900000, 6300000, 7700000, 9100000],
  '서비스개발': [4700000, 5500000, 7200000, 9500000],
  'PM': [5100000, 5600000, 6700000, 7400000],
  'Interaction': [4900000, 5700000, 6300000, 9000000],
  'UX': [4800000, 5900000, 7000000, 7500000],
  'Visual': [4900000, 5700000, 6200000, 9100000],
};

async function main() {
  const client = await pool.connect();
  try {
    console.log('▶ 스키마 생성 중...');
    const schema = await readFile(join(__dirname, 'db', 'schema.sql'), 'utf8');
    await client.query(schema);
    console.log('  ✓ 테이블 준비 완료 (mt_projects, mt_plan_rows, mt_staff, mt_assignments, mt_monthly_records, mt_rate_cards)');

    const { rows } = await client.query('SELECT COUNT(*)::int AS n FROM mt_rate_cards');
    if (rows[0].n === 0) {
      console.log('▶ 기본 단가표 시딩 중...');
      let i = 0;
      for (const [role, g] of Object.entries(DEFAULT_RATES)) {
        await client.query(
          `INSERT INTO mt_rate_cards (role, junior, mid, senior, expert, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [role, g[0], g[1], g[2], g[3], i++]
        );
      }
      console.log(`  ✓ 기본 단가표 ${i}개 직군 삽입`);
    } else {
      console.log(`▶ 단가표에 이미 ${rows[0].n}개 직군이 있어 시딩을 건너뜁니다.`);
    }

    console.log('\n✅ DB 초기화 완료');
  } catch (err) {
    console.error('❌ DB 초기화 실패:', err.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

main();

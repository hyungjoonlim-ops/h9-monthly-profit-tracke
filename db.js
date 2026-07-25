import 'dotenv/config';
import pg from 'pg';

const required = ['PGHOST', 'PGPORT', 'PGUSER', 'PGPASSWORD', 'PGDATABASE'];
const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0 || process.env.PGPASSWORD === 'your-password-here') {
  console.error(`❌ .env 설정을 확인하세요. 누락/미설정: ${missing.join(', ') || 'PGPASSWORD'}`);
  process.exit(1);
}

// Supabase Session pooler 연결 (IPv4). 특수문자 비밀번호는 개별 항목으로 안전 전달.
export const pool = new pg.Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
  max: 5,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (err) => console.error('예상치 못한 DB 풀 오류:', err.message));

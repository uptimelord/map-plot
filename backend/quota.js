import {ServiceError} from './google.js';
// Every admission is an atomic SQL statement. Never retry on an unknown outcome:
// over-counting a failed request is safer than exceeding the paid request budget.
export async function reserveQuota(db,bucket,maximum,expires){
  const row=await db.prepare(`INSERT INTO scan_quotas (bucket,used,expires) VALUES (?,1,?)
    ON CONFLICT(bucket) DO UPDATE SET used=used+1 WHERE used < ? RETURNING used`).bind(bucket,expires,maximum).first();
  if(!row)throw new ServiceError('The reading allowance has been reached. Please try later or use device reading.',429);
}
export async function acquireLease(db,id,now){
  const row=await db.prepare(`INSERT INTO scan_leases (id,expires) SELECT ?,? WHERE
    (SELECT COUNT(*) FROM scan_leases WHERE expires > ?) < 2 RETURNING id`).bind(id,now+90_000,now).first();
  if(!row)throw new ServiceError('Other documents are being read. Please try again shortly.',429);
}
export async function releaseLease(db,id){await db.prepare('DELETE FROM scan_leases WHERE id = ?').bind(id).run();}
export async function pruneQuota(db,now){await db.batch([
  db.prepare('DELETE FROM scan_quotas WHERE expires < ?').bind(now),
  db.prepare('DELETE FROM scan_leases WHERE expires < ?').bind(now),
]);}

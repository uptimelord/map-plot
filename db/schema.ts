import {sqliteTable,text,integer,index} from 'drizzle-orm/sqlite-core';
// No document text or images are stored. Keys are aggregate or salted user hashes.
export const quotas=sqliteTable('scan_quotas',{
  bucket:text('bucket').primaryKey(),
  used:integer('used').notNull().default(0),
  expires:integer('expires').notNull(),
},table=>[index('scan_quotas_expiry').on(table.expires)]);
export const leases=sqliteTable('scan_leases',{
  id:text('id').primaryKey(),
  expires:integer('expires').notNull(),
},table=>[index('scan_leases_expiry').on(table.expires)]);

const { PGlite } = require('./push-test-runtime/node_modules/@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const a = '11111111-1111-4111-8111-111111111111', b = '22222222-2222-4222-8222-222222222222', c = '33333333-3333-4333-8333-333333333333';
(async () => {
 const pg = new PGlite();
 try {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
   create schema auth; create table auth.users(id uuid primary key); create table auth.sessions(id uuid primary key);
   create table profiles(id uuid primary key,email text,first_name text,last_name text,raven_id text);
   create table trips(id text primary key,name text,due_date date,creator_email text,member_emails text,people jsonb,status text,type text);
   create table direct_messages(id uuid default gen_random_uuid(),sender_id uuid,receiver_id uuid);
   create table raven_chat_messages(id uuid default gen_random_uuid(),chat_id uuid,sender_id uuid);
   create table raven_chat_members(chat_id uuid,user_id uuid);
   create table participants(id uuid default gen_random_uuid(),bill_id text,phone text);
   create table trip_messages(id uuid default gen_random_uuid(),trip_id text,user_id uuid);
   create table trip_comments(id bigint generated always as identity,trip_id text,user_id text);
   create table trip_receipts(id uuid default gen_random_uuid(),trip_id text,added_by text,splits jsonb);
   create table raven_friends(id uuid default gen_random_uuid(),user_id uuid,friend_id uuid,status text);
  `);
  const sql = fs.readFileSync('output/raven-phone-alerts-migration.sql', 'utf8');
  await pg.exec(sql); // Compile the exact production migration first.
  await pg.exec(fs.readFileSync('output/raven-notification-upgrade.sql','utf8'));
  await pg.exec(`create function public.test_now() returns timestamptz language sql stable as $$select current_setting('raven.test_now')::timestamptz$$;
    set raven.test_now='2026-10-09T14:05:00Z';`);
  // Clock injection only, for deterministic scheduling/quiet-hour/DST tests.
  await pg.exec(sql.replace(/\bnow\(\)/g, 'public.test_now()'));
  await pg.exec(`alter table raven_push_events alter column created_at set default public.test_now();
   alter table raven_push_events alter column available_at set default public.test_now();
   insert into auth.users values('${a}'),('${b}'),('${c}'); insert into auth.sessions values('${a}'),('${b}');
   insert into profiles values('${a}','alice@test.invalid','Alice','A','alice'),('${b}','bob@test.invalid','Bob','B','bob'),('${c}','other@test.invalid','Bob','C','other');
   insert into trips values('ABCDE','Coast Trip','2026-10-06','alice@test.invalid','["bob@test.invalid"]','["Alice","Bob"]','active','trip');
   insert into raven_push_devices(token,user_id,session_id,platform) values(repeat('a',64),'${a}','${a}','ios'),(repeat('b',64),'${b}','${b}','ios');
   delete from raven_push_events;
   insert into direct_messages(sender_id,receiver_id) values('${a}','${b}');
   insert into trip_comments(trip_id,user_id) values('ABCDE','${a}');
   insert into trip_messages(trip_id,user_id) values('ABCDE','${a}');
  `);
  const events = (await pg.query('select kind,user_id,actor_name,trip_name from raven_push_events order by kind')).rows;
  assert.equal(events.length, 3);
  assert.ok(events.every(e => e.user_id === b && e.actor_name === 'Alice'));
  assert.equal(events.find(e => e.kind === 'trip_comment').trip_name, 'Coast Trip');
  assert.equal((await pg.query("select count(*)::int as n from raven_push_linked_trip_profiles('ABCDE')")).rows[0].n, 2);
  const enqueue = async (due = '2026-10-06', cycle = 1, users = [b,c]) => (await pg.query('select raven_enqueue_trip_reminders($1,$2,$3,$4) as n', ['ABCDE',due,cycle,users])).rows[0].n;
  assert.equal(await enqueue(),1); // Only linked+opted-in Bob, not unrelated same-name account.
  assert.equal(await enqueue(),0); // Replica/restart idempotency.
  assert.equal(await enqueue('2026-10-05'),0); // Stale due date refused.
  await pg.exec("update trips set due_date='2026-10-03' where id='ABCDE'");
  assert.equal(await enqueue('2026-10-03',2),0); // Editing due date can't send again today.
  await pg.exec("set raven.test_now='2026-10-12T13:59:00Z'");
  assert.equal(await enqueue('2026-10-03',3),0); // Before 10 AM Eastern.
  await pg.exec("set raven.test_now='2026-10-12T14:00:00Z'");
  assert.equal(await enqueue('2026-10-03',3),1);
  await pg.exec("set raven.test_now='2026-10-16T00:00:00Z'");
  assert.equal(await enqueue('2026-10-03',4),0); // 8 PM Eastern.
  await pg.exec("set raven.test_now='2026-10-18T14:00:00Z'; delete from raven_push_devices where user_id='"+b+"'");
  assert.equal(await enqueue('2026-10-03',5,[b]),0); // Off means no reminder.
  const acl = (await pg.query("select has_function_privilege('anon','raven_enqueue_trip_reminders(text,text,integer,uuid[])','execute') as anon,has_function_privilege('authenticated','raven_push_linked_trip_profiles(text)','execute') as authenticated,has_function_privilege('service_role','raven_enqueue_trip_reminders(text,text,integer,uuid[])','execute') as service")).rows[0];
  assert.deepEqual(acl,{anon:false,authenticated:false,service:true});
  console.log('PASS PostgreSQL: migration/rerun, short trip IDs, first-name metadata, sender exclusion, linked recipients, 3-day reminders, quiet hours, due-date edits, opt-out, dedupe and service-only permissions. Synthetic local data only.');
 } finally { await pg.close(); }
})().catch(error=>{console.error(error.message);process.exitCode=1});

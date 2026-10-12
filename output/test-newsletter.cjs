const {PGlite}=require('./push-test-runtime/node_modules/@electric-sql/pglite');
const fs=require('node:fs'),assert=require('node:assert/strict'),vm=require('node:vm');
const newsletter=require('../raven-newsletter');
(async()=>{
 const pg=new PGlite();
 const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222';
 try{
  await pg.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
   create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
   create table profiles(id uuid primary key,privacy_email_marketing boolean,updated_at timestamptz);
   insert into auth.users values('${a}','yes@example.invalid',now()),('${b}','no@example.invalid',now());
   insert into profiles values('${a}',true,now()),('${b}',false,now());`);
  const sql=fs.readFileSync('output/raven-newsletter.sql','utf8');await pg.exec(sql);await pg.exec(sql);
  assert.equal((await pg.query('select * from raven_newsletter_subscribers')).rows.length,1);
  assert.equal((await pg.query('select * from raven_newsletter_claim()')).rows.length,0,'draft never sends');
  await pg.exec("update raven_newsletter_campaigns set status='queued',scheduled_at=now()-interval '1 day'");
  let rows=(await pg.query('select * from raven_newsletter_claim()')).rows;assert.equal(rows.length,1);assert.equal(rows[0].user_id,a);
  assert.equal((await pg.query('select * from raven_newsletter_claim()')).rows.length,0,'restart does not resend');
  await pg.exec(`update profiles set privacy_email_marketing=false where id='${a}'`);
  assert.equal((await pg.query('select enabled from raven_newsletter_subscribers')).rows[0].enabled,false);
  await pg.exec(sql);assert.equal((await pg.query('select enabled from raven_newsletter_subscribers')).rows[0].enabled,false,'migration cannot re-enroll');
  const token=newsletter.tokenFor(a,'yes@example.invalid','secret');
  assert.deepEqual(newsletter.readToken(token,'secret'),[a,'yes@example.invalid']);
  assert.equal(newsletter.readToken(token+'x','secret'),null);assert.equal(newsletter.readToken(token,'wrong'),null);
  const html=newsletter.render('https://example.invalid/unsubscribe?token=x');
  assert.ok(html.includes('1624 Broadway'));assert.ok(html.includes('href="https://example.invalid/unsubscribe?token=x"'));assert.ok(!html.includes('DRAFT'));
  for(const file of ['dashboard.html','onboarding.html']){
   const source=fs.readFileSync(file,'utf8');let count=0;
   for(const match of source.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)){
    if(/src=|application\//i.test(match[1]))continue;new vm.Script(match[2],{filename:file+':inline'+count++});
   }
  }
  assert.ok(!/id="newsletter-consent"[^>]*\bchecked/.test(fs.readFileSync('onboarding.html','utf8')));
  console.log('PASS: migration, explicit opt-in, drafts, dedup, legacy opt-out, signed unsubscribe, template, inline JS');
 }finally{await pg.close();}
})().catch(e=>{console.error(e);process.exit(1)});

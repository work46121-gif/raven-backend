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
  await pg.exec(fs.readFileSync('output/raven-newsletter-prompts.sql','utf8'));
  const prompt=async id=>(await pg.query('select raven_claim_newsletter_prompt($1) as show',[id])).rows[0].show;
  assert.equal(await prompt(a),true,'first visit');
  assert.equal(await prompt(a),false,'repeat visit and second device suppressed');
  assert.equal(await prompt(b),true,'separate account has separate schedule');
  await pg.exec(`update raven_newsletter_prompts set next_prompt_at=now()-interval '1 second' where user_id='${a}';update raven_newsletter_subscribers set enabled=true where user_id='${a}'`);
  assert.equal(await prompt(a),false,'enabled subscribers never prompted even when due');
  await pg.exec(`update raven_newsletter_subscribers set enabled=false where user_id='${a}'`);
  assert.equal(await prompt(a),true,'disabled account prompted when monthly interval expires');
  assert.equal((await pg.query(`select next_prompt_at>now()+interval '27 days' as delayed from raven_newsletter_prompts where user_id='${a}'`)).rows[0].delayed,true);
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

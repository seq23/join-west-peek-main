import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const candidates=[path.join(root,'sites/productions/community-as-a-service/index.html'),path.join(root,'implementation/sites/productions/community-as-a-service/index.html')];
const htmlPath=candidates.find(fs.existsSync);
const jsCandidates=[path.join(root,'shared/assets/js/community-assessment.js'),path.join(root,'implementation/shared/assets/js/community-assessment.js')];
const jsPath=jsCandidates.find(fs.existsSync);
const required=[
  [htmlPath,'landing page'],[jsPath,'assessment runtime']
];
const errors=[];
for(const [file,label] of required)if(!file||!fs.existsSync(file))errors.push(`Missing ${label}: ${file||'unresolved'}`);
if(!errors.length){
  const html=fs.readFileSync(htmlPath,'utf8');
  const js=fs.readFileSync(jsPath,'utf8');
  if(!/Community Viability Assessment/.test(html))errors.push('Clear Community Viability Assessment naming is absent.');
  if(!/action="\/api\/lead"/.test(html))errors.push('Lead form is not wired to /api/lead.');
  if(!/data-lead-status/.test(html))errors.push('Lead form has no server outcome region.');
  const questionCount=(js.match(/\{d:'(?:clarity|engagement|experiences|content|growth|operations)',q:/g)||[]).length;
  if(questionCount!==18)errors.push(`Expected 18 scored questions; found ${questionCount}.`);
  for(const dimension of ['clarity','engagement','experiences','content','growth','operations'])if(!new RegExp(dimension+":\\{name:").test(js))errors.push(`Missing diagnosis for ${dimension}.`);
  if(!/response\.ok&&x\.b&&x\.b\.ok===true|x\.ok&&x\.b&&x\.b\.ok===true/.test(js))errors.push('Results are not guarded by confirmed server receipt.');
  if(/AI Scooter|D-ID|HeyGen|avatar\/render|avatar\/status/i.test(html+js))errors.push('Removed AI media system is still referenced by the assessment.');
  for(const field of ['organization_type','audience_size','community_status','primary_objective','internal_owner','annual_program_volume','timeline','support_readiness','investment_range'])if(!html.includes(`name="${field}"`))errors.push(`Missing qualification field ${field}.`);
  if(!html.includes('name="assessment_answers"')||!js.includes("[data-answers-field]"))errors.push('Complete question-level answers are not included in the lead record.');
}
if(errors.length){console.error('validate:community-viability FAILED');for(const e of errors)console.error(' - '+e);process.exit(1)}
console.log('validate:community-viability PASS — route, 18 questions, six diagnoses, lead guard, qualification, and no AI media present');

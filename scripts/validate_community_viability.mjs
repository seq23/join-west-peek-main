import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const candidates=[path.join(root,'sites/productions/community-as-a-service/index.html'),path.join(root,'implementation/sites/productions/community-as-a-service/index.html')];
const htmlPath=candidates.find(fs.existsSync);
const jsCandidates=[path.join(root,'shared/assets/js/community-assessment.js'),path.join(root,'implementation/shared/assets/js/community-assessment.js')];
const jsPath=jsCandidates.find(fs.existsSync);
const required=[
  [htmlPath,'landing page'],[jsPath,'assessment runtime'],
  [path.join(root,htmlPath?.includes('/implementation/')?'implementation/functions/api/avatar/render.js':'functions/api/avatar/render.js'),'avatar render endpoint'],
  [path.join(root,htmlPath?.includes('/implementation/')?'implementation/functions/api/avatar/status.js':'functions/api/avatar/status.js'),'avatar status endpoint']
];
const errors=[];
for(const [file,label] of required)if(!file||!fs.existsSync(file))errors.push(`Missing ${label}: ${file||'unresolved'}`);
if(!errors.length){
  const html=fs.readFileSync(htmlPath,'utf8');
  const js=fs.readFileSync(jsPath,'utf8');
  if(!/Community Viability Assessment/.test(html))errors.push('Clear Community Viability Assessment naming is absent.');
  if(!/action="\/api\/lead"/.test(html))errors.push('Lead form is not wired to /api/lead.');
  if(!/data-lead-status/.test(html))errors.push('Lead form has no server outcome region.');
  if(!/AI-generated presentation of Scooter/.test(html))errors.push('AI Scooter likeness disclosure is absent.');
  const questionCount=(js.match(/\{d:'(?:clarity|engagement|experiences|content|growth|operations)',q:/g)||[]).length;
  if(questionCount!==14)errors.push(`Expected 14 scored questions; found ${questionCount}.`);
  for(const dimension of ['clarity','engagement','experiences','content','growth','operations'])if(!new RegExp(dimension+":\\{name:").test(js))errors.push(`Missing diagnosis for ${dimension}.`);
  if(!/response\.ok&&x\.b&&x\.b\.ok===true|x\.ok&&x\.b&&x\.b\.ok===true/.test(js))errors.push('Results are not guarded by confirmed server receipt.');
  if(!/written (?:guidance|results|result|briefing)/i.test(js))errors.push('Avatar failure does not preserve an honest written fallback.');
}
if(errors.length){console.error('validate:community-viability FAILED');for(const e of errors)console.error(' - '+e);process.exit(1)}
console.log('validate:community-viability PASS — route, 14 questions, six diagnoses, lead guard, disclosure, and avatar fallback present');

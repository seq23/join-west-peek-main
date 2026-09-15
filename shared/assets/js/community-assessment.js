(function(){
  'use strict';

  var questions=[
    {d:'clarity',q:'Can you clearly identify who your community is for?',h:'Think beyond customers or followers. Is there a specific group with a shared identity, need, or ambition?'},
    {d:'clarity',q:'Do people understand why they should join and keep participating?',h:'A viable community offers an ongoing reason to belong—not only a one-time transaction.'},
    {d:'clarity',q:'Is the community connected to a measurable business or organizational outcome?',h:'Examples include retention, referrals, learning, advocacy, partnerships, innovation, or revenue.'},
    {d:'engagement',q:'Do members participate without your team personally prompting every interaction?',h:'Look for conversations, contributions, introductions, or member-led activity.'},
    {d:'engagement',q:'Do people return and deepen their involvement over time?',h:'Consider repeat attendance, recurring participation, contribution, and relationships.'},
    {d:'experiences',q:'Do your events or programs create meaningful interaction between participants?',h:'Attendance alone is not engagement. Consider whether people meet, contribute, or act.'},
    {d:'experiences',q:'Is there a clear participation path before and after each event or program?',h:'A viable community gives people an obvious next step after the moment ends.'},
    {d:'content',q:'Does community activity consistently become useful stories, insights, or content?',h:'Consider recordings, member stories, editorial themes, clips, reports, or reusable learning.'},
    {d:'content',q:'Does your content invite people into participation rather than only broadcasting at them?',h:'Strong community content creates a response, contribution, or next action.'},
    {d:'growth',q:'Can the right new people reliably discover and enter the community?',h:'Consider referrals, partnerships, search, events, social distribution, and direct invitations.'},
    {d:'growth',q:'Do you know which channels produce participating members—not just impressions?',h:'Viable growth is measured by the quality and activity of the people who arrive.'},
    {d:'operations',q:'Is one person clearly accountable for community outcomes?',h:'Multiple contributors are fine, but ownership cannot be ambiguous.'},
    {d:'operations',q:'Does your team have a repeatable cadence for programming, content, and follow-up?',h:'The work should not have to be reinvented each week or after each event.'},
    {d:'operations',q:'Can you measure whether the community is becoming more valuable?',h:'Useful signals may include return participation, contributions, relationships, referrals, retention, or qualified opportunities.'}
  ];

  var options=[
    {v:1,t:'Not yet',s:'This is absent or almost entirely ad hoc.'},
    {v:2,t:'Partially',s:'Some pieces exist, but execution is inconsistent.'},
    {v:3,t:'Mostly',s:'This works with occasional gaps or exceptions.'},
    {v:4,t:'Consistently',s:'This is intentional, repeatable, and produces evidence.'}
  ];

  var labels={clarity:'Community clarity',engagement:'Engagement',experiences:'Experiences',content:'Storytelling & content',growth:'Audience growth',operations:'Operations'};
  var diagnoses={
    clarity:{name:'Audience Without a Community Promise',summary:'You may have access to people, but the reason they should belong, participate, and return is not yet specific enough.',priorities:['Define the exact group the community exists to serve and the shared outcome that connects them.','Write a one-sentence participation promise that is stronger than “networking” or “access.”','Choose one business outcome the community must support over the next 90 days.']},
    engagement:{name:'Community Without Participation',summary:'The foundation exists, but too much activity still depends on your team initiating every interaction.',priorities:['Design one recurring member-to-member interaction that does not require a major event.','Give members a clear contribution role, not only content to consume.','Track return participation and contributions instead of total membership alone.']},
    experiences:{name:'Events Without Continuity',summary:'You can create moments that attract people, but the relationship weakens when the event or program ends.',priorities:['Give every event a defined pre-event and post-event participation path.','Build one follow-up ritual that reconnects attendees within seven days.','Design the next invitation before producing the current experience.']},
    content:{name:'Content Without Participation',summary:'Your organization communicates, but the content is not consistently converting attention into contribution and connection.',priorities:['Build an event-to-content workflow with named owners and deadlines.','Create content from member questions, expertise, and outcomes—not only organizational announcements.','Add one explicit participation action to every major content series.']},
    growth:{name:'Community Without a Growth Engine',summary:'Existing relationships may be valuable, but discovery and entry depend too heavily on inconsistent promotion or personal outreach.',priorities:['Identify the two channels producing the highest-quality participating members.','Create a referral or partner pathway with a specific invitation.','Measure activation after arrival so audience growth is tied to participation.']},
    operations:{name:'Community Without an Operating System',summary:'The ambition is stronger than the infrastructure. Ownership, cadence, workflows, or measurement are limiting execution.',priorities:['Assign one accountable community owner and define decision rights.','Create a 90-day programming, content, and follow-up cadence.','Adopt a small scorecard covering participation, return behavior, contribution, and opportunity.']}
  };

  var app=document.querySelector('[data-assessment-app]');
  if(!app)return;
  var startScreen=app.querySelector('[data-start-screen]');
  var form=app.querySelector('[data-assessment-form]');
  var panel=app.querySelector('[data-question-panel]');
  var leadGate=app.querySelector('[data-lead-gate]');
  var leadForm=app.querySelector('[data-lead-form]');
  var results=app.querySelector('[data-results]');
  var answers=new Array(questions.length).fill(null);
  var index=0;
  var computed=null;

  function show(el){el.hidden=false;}
  function hide(el){el.hidden=true;}
  function esc(v){return String(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function renderQuestion(){
    var item=questions[index];
    panel.innerHTML='<legend>'+esc(item.q)+'</legend><p class="question-help">'+esc(item.h)+'</p><div class="answer-options">'+options.map(function(o){return '<label class="answer-option"><input type="radio" name="question_'+index+'" value="'+o.v+'" '+(answers[index]===o.v?'checked':'')+'><span><strong>'+esc(o.t)+'</strong><span>'+esc(o.s)+'</span></span></label>';}).join('')+'</div>';
    app.querySelector('[data-progress-label]').textContent='Question '+(index+1)+' of '+questions.length;
    var p=Math.round(((index+1)/questions.length)*100);
    app.querySelector('[data-progress-percent]').textContent=p+'%';
    app.querySelector('[data-progress-bar]').style.width=p+'%';
    app.querySelector('[data-back]').disabled=index===0;
    app.querySelector('[data-next]').textContent=index===questions.length-1?'See preliminary result':'Continue';
    app.querySelector('[data-question-error]').textContent='';
    panel.querySelector('legend').focus?.();
  }

  function calculate(){
    var groups={clarity:[],engagement:[],experiences:[],content:[],growth:[],operations:[]};
    questions.forEach(function(q,i){groups[q.d].push(answers[i]);});
    var dimensions={};
    Object.keys(groups).forEach(function(k){dimensions[k]=Math.round((groups[k].reduce(function(a,b){return a+b;},0)/(groups[k].length*4))*100);});
    var overall=Math.round(Object.keys(dimensions).reduce(function(sum,k){return sum+dimensions[k];},0)/Object.keys(dimensions).length);
    var weakest=Object.keys(dimensions).sort(function(a,b){return dimensions[a]-dimensions[b];})[0];
    var band=overall>=80?'Viable and ready to compound':overall>=65?'Viable foundation with a material constraint':overall>=45?'Promising but not yet reliably viable':'Community viability is not established yet';
    return {overall:overall,dimensions:dimensions,weakest:weakest,band:band,diagnosis:diagnoses[weakest]};
  }

  function finalScript(data){
    return 'Your Community Viability Score is '+data.overall+' out of 100. '+data.band+'. Your primary diagnosis is '+data.diagnosis.name+'. '+data.diagnosis.summary+' The first priority I would focus on is: '+data.diagnosis.priorities[0];
  }

  function renderResults(){
    var d=computed;
    app.querySelector('[data-score]').textContent=d.overall;
    app.querySelector('[data-diagnosis]').textContent=d.diagnosis.name;
    app.querySelector('[data-summary]').textContent=d.band+'. '+d.diagnosis.summary;
    app.querySelector('[data-dimension-grid]').innerHTML=Object.keys(d.dimensions).map(function(k){return '<div class="dimension-result"><div><strong>'+esc(labels[k])+'</strong><span>'+d.dimensions[k]+'/100</span></div><meter min="0" max="100" value="'+d.dimensions[k]+'">'+d.dimensions[k]+' out of 100</meter></div>';}).join('');
    app.querySelector('[data-priorities]').innerHTML=d.diagnosis.priorities.map(function(p){return '<li>'+esc(p)+'</li>';}).join('');
    app.querySelector('[data-briefing-copy]').textContent=finalScript(d);
    hide(leadGate);show(results);results.scrollIntoView({behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'start'});
  }

  function mediaElement(url){var video=document.createElement('video');video.controls=true;video.playsInline=true;video.src=url;return video;}
  function pollAvatar(id,provider,statusEl,target,attempt){
    if(attempt>24){statusEl.textContent='The video is still processing. Your complete written briefing is ready above.';return;}
    window.setTimeout(function(){fetch('/api/avatar/status?id='+encodeURIComponent(id)+'&provider='+encodeURIComponent(provider),{headers:{Accept:'application/json'}}).then(function(r){return r.json().then(function(b){return {ok:r.ok,b:b};});}).then(function(x){
      if(x.ok&&x.b.avatarReady&&x.b.videoUrl){target.replaceChildren(mediaElement(x.b.videoUrl));statusEl.textContent='Your AI Scooter briefing is ready.';return;}
      if(x.b.status==='avatar_failed'){statusEl.textContent='The video could not be generated. Your written briefing remains available.';return;}
      pollAvatar(id,provider,statusEl,target,attempt+1);
    }).catch(function(){statusEl.textContent='Video status is unavailable. Your written briefing remains available.';});},2500);
  }
  function generateAvatar(text,moment,statusEl,target){
    statusEl.textContent='Preparing the AI Scooter video…';
    fetch('/api/avatar/render',{method:'POST',headers:{'content-type':'application/json',Accept:'application/json'},body:JSON.stringify({text:text,moment:moment})}).then(function(r){return r.json().then(function(b){return {ok:r.ok,b:b};});}).then(function(x){
      if(!x.ok||!x.b||!x.b.providerResponse||!x.b.providerResponse.id){statusEl.textContent='Talking video is not available in this environment. The written guidance remains complete.';return;}
      pollAvatar(x.b.providerResponse.id,x.b.provider,statusEl,target,0);
    }).catch(function(){statusEl.textContent='Talking video is not available right now. The written guidance remains complete.';});
  }

  app.querySelector('[data-start]').addEventListener('click',function(){hide(startScreen);show(form);renderQuestion();});
  app.querySelector('[data-back]').addEventListener('click',function(){if(index>0){index-=1;renderQuestion();}});
  app.querySelector('[data-next]').addEventListener('click',function(){var selected=panel.querySelector('input:checked');if(!selected){app.querySelector('[data-question-error]').textContent='Choose the answer that most closely describes the organization today.';return;}answers[index]=Number(selected.value);if(index<questions.length-1){index+=1;renderQuestion();return;}computed=calculate();hide(form);show(leadGate);app.querySelector('[data-score-field]').value=String(computed.overall);app.querySelector('[data-diagnosis-field]').value=computed.diagnosis.name;app.querySelector('[data-dimensions-field]').value=JSON.stringify(computed.dimensions);leadGate.scrollIntoView({behavior:'smooth',block:'start'});});
  panel.addEventListener('change',function(){app.querySelector('[data-question-error]').textContent='';});

  leadForm.addEventListener('submit',function(event){
    event.preventDefault();if(!leadForm.reportValidity())return;
    var status=app.querySelector('[data-lead-status]');var button=leadForm.querySelector('button[type=submit]');var original=button.textContent;button.disabled=true;button.textContent='Generating…';status.dataset.state='pending';status.textContent='Securely submitting your responses…';
    fetch(leadForm.action,{method:'POST',body:new FormData(leadForm),headers:{Accept:'application/json'}}).then(function(r){return r.json().catch(function(){return null;}).then(function(b){return {ok:r.ok,b:b};});}).then(function(x){if(!(x.ok&&x.b&&x.b.ok===true))throw new Error('delivery_failed');status.dataset.state='ok';status.textContent='Your responses were received. Your scorecard is ready below.';renderResults();}).catch(function(){status.dataset.state='error';status.innerHTML='We could not deliver your responses, so nothing was submitted. Please email <a href="mailto:scooter@westpeek.ventures">scooter@westpeek.ventures</a>.';}).finally(function(){button.disabled=false;button.textContent=original;});
  });

  document.querySelector('[data-scooter-intro]')?.addEventListener('click',function(){generateAvatar('Most organizations do not have a lack of content problem. Their events, audience, and community activity simply operate separately. This assessment will show you whether your business has the foundation for a viable community and where value is getting lost.','welcome',document.querySelector('[data-intro-status]'),document.querySelector('[data-intro-media]'));});
  app.querySelector('[data-generate-briefing]').addEventListener('click',function(){generateAvatar(finalScript(computed),'final_summary',app.querySelector('[data-briefing-status]'),app.querySelector('[data-briefing-media]'));});
})();
